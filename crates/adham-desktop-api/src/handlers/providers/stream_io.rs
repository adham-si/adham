//! Stream pump + terminal persistence internals (Delivery A).

use super::{ApiContext, EventSink, StreamIds};

use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_provider::adapters::AnyAdapter;
use adham_provider::domain::model::ModelSelectionSnapshot;
use adham_provider::domain::request::{ChatMessage, ProviderRequestV1, ThinkValue};
use adham_provider::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use adham_provider::registry::{LocalAccount, PinnedModel};
use sqlx::Row;
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;

/// Assistant accumulation bound: provider output beyond this is a protocol
/// failure (bounded content, never an unbounded write).
const MAX_ASSISTANT_BYTES: usize = 262_144;

fn terminal_status(outcome: &StreamCompletionOutcome) -> (&'static str, bool) {
    match outcome {
        StreamCompletionOutcome::Stop => ("completed", false),
        StreamCompletionOutcome::LengthExceeded => ("completed", true),
        StreamCompletionOutcome::Interrupted => ("interrupted", false),
        StreamCompletionOutcome::ContentFilter
        | StreamCompletionOutcome::EmptyAnswer
        | StreamCompletionOutcome::StructuredOnly
        | StreamCompletionOutcome::Unknown { .. } => ("failed", false),
    }
}

fn map_completion(outcome: &StreamCompletionOutcome) -> MessageCompletionV1 {
    match outcome {
        StreamCompletionOutcome::Stop => MessageCompletionV1::Completed { truncated: false },
        StreamCompletionOutcome::LengthExceeded => {
            MessageCompletionV1::Completed { truncated: true }
        }
        StreamCompletionOutcome::Interrupted => MessageCompletionV1::Interrupted,
        StreamCompletionOutcome::ContentFilter
        | StreamCompletionOutcome::EmptyAnswer
        | StreamCompletionOutcome::StructuredOnly
        | StreamCompletionOutcome::Unknown { .. } => MessageCompletionV1::Failed,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_stream<S>(
    ctx: &ApiContext,
    adapter: &AnyAdapter,
    pinned: &PinnedModel,
    account: &LocalAccount,
    op_id: &str,
    request_id: &str,
    ids: &StreamIds,
    token: &CancellationToken,
    // Assembled + budgeted by the caller after the submitted row was durable.
    messages: Vec<ChatMessage>,
    max_output_tokens: Option<u32>,
    // Documented `think` parameter; validated against model evidence already.
    think: Option<ThinkValue>,
    sink: &S,
) -> &'static str
where
    S: EventSink,
{
    // The op handle is announced before dispatch: the renderer must be able
    // to Stop while the socket is still connecting, before any frame.
    let mut sequence: u64 = 0;
    sink.send(stream_event(
        op_id,
        &mut sequence,
        StreamEventPayloadDto::Started,
    ))
    .ok_or_log(op_id);

    let request = ProviderRequestV1 {
        operation_id: op_id.to_string(),
        model_selection: ModelSelectionSnapshot {
            account_id: account.account_id.clone(),
            endpoint_id: account.endpoint_id.clone(),
            model_id: pinned.model_id.clone(),
            privacy_class: pinned.descriptor.privacy_class,
        },
        messages,
        max_output_tokens,
        think,
        temperature: None,
    };

    // A user Stop during connect cancels the in-flight request instead of
    // waiting for a first frame; `biased` also observes a token cancelled
    // before dispatch (no socket is kept). Cancellation never depends on an
    // answer delta.
    let dispatch = tokio::select! {
        biased;
        _ = token.cancelled() => None,
        res = adapter.stream_chat(pinned, &request) => Some(res),
    };
    let mut stream = match dispatch {
        None => {
            // cancelled while connecting: Interrupted, even with no text yet
            sink.send(stream_event(
                op_id,
                &mut sequence,
                StreamEventPayloadDto::Completed {
                    completion: "interrupted".to_string(),
                    truncated: false,
                    usage: None,
                },
            ))
            .ok_or_log(op_id);
            return persist_terminal(
                ctx,
                op_id,
                request_id,
                ids,
                "",
                &StreamCompletionOutcome::Interrupted,
                None,
                false,
            )
            .await;
        }
        Some(Err(e)) => {
            tracing::debug!("completion op {op_id}: dispatch failed pre-wire: {e}");
            // after the op handle exists: a pre-wire dispatch failure is a
            // failed terminal, never a vanished generation
            sink.send(stream_event(
                op_id,
                &mut sequence,
                StreamEventPayloadDto::Completed {
                    completion: "failed".to_string(),
                    truncated: false,
                    usage: None,
                },
            ))
            .ok_or_log(op_id);
            return persist_terminal(
                ctx,
                op_id,
                request_id,
                ids,
                "",
                &StreamCompletionOutcome::ContentFilter,
                None,
                false,
            )
            .await;
        }
        Some(Ok(s)) => s,
    };

    let mut acc = String::new();
    let mut usage: Option<MessageUsageV1> = None;
    let mut terminal_outcome: Option<StreamCompletionOutcome> = None;
    let mut failed_reason: Option<String> = None;
    let mut saw_thinking = false;
    let mut saw_structured = false;

    loop {
        if token.is_cancelled() {
            terminal_outcome = Some(StreamCompletionOutcome::Interrupted);
            break;
        }
        tokio::select! {
            biased;
            _ = token.cancelled() => {
                terminal_outcome = Some(StreamCompletionOutcome::Interrupted);
                break;
            }
            event = stream.next_event() => match event {
                None => break,
                // StreamStarted is protocol parity; the sink-led Started
                // event already carries the contract.
                Some(Ok(NormalizedStreamEvent::StreamStarted)) => {}
                Some(Ok(NormalizedStreamEvent::TextDelta(text))) => {
                    acc.push_str(&text);
                    if acc.len() > MAX_ASSISTANT_BYTES {
                        failed_reason = Some("assistant content exceeded bounded size".to_string());
                        break;
                    }
                    sink.send(stream_event(op_id, &mut sequence, StreamEventPayloadDto::Delta { text }))
                        .ok_or_log(op_id);
                }
                Some(Ok(NormalizedStreamEvent::Progress(StreamUsage { prompt_tokens, completion_tokens, total_tokens }))) => {
                    usage = Some(MessageUsageV1 {
                        prompt_tokens: Some(prompt_tokens as u64),
                        completion_tokens: Some(completion_tokens as u64),
                        total_tokens: Some(total_tokens as u64),
                    });
                }
                Some(Ok(NormalizedStreamEvent::ThinkingActivity))
                | Some(Ok(NormalizedStreamEvent::ThinkingDelta(_))) => {
                    // reasoning text never crosses this boundary: exactly one
                    // activity marker per op, so the UI can say "Thinking…"
                    // without ever seeing the model's reasoning
                    if !saw_thinking {
                        saw_thinking = true;
                        sink.send(stream_event(
                            op_id,
                            &mut sequence,
                            StreamEventPayloadDto::Thinking,
                        ))
                        .ok_or_log(op_id);
                    }
                }
                Some(Ok(NormalizedStreamEvent::StructuredActivity)) => {
                    // non-text output seen: the empty-answer rule must not
                    // claim this turn as a silent refusal
                    saw_structured = true;
                }
                Some(Ok(NormalizedStreamEvent::StreamCompleted(outcome))) => {
                    terminal_outcome = Some(outcome);
                    break;
                }
                Some(Err(e)) => {
                    tracing::warn!("completion op {op_id}: stream error mid-wire: {e}");
                    failed_reason = Some(e.to_string());
                    break;
                }
            },
        }
    }

    let mut outcome = terminal_outcome.unwrap_or(StreamCompletionOutcome::ContentFilter);
    if let Some(reason) = &failed_reason {
        // bounded: transport/accounting reason only, never model output
        tracing::debug!("completion op {op_id}: error terminal ({reason})");
    }
    if failed_reason.is_none() && acc.is_empty() {
        // A normal terminal with no answer text at all is not a success:
        // thinking-only runs and silent refusals fail visibly. Tool-only
        // output is its own outcome, never an "empty answer" error.
        outcome = match outcome {
            StreamCompletionOutcome::Stop | StreamCompletionOutcome::LengthExceeded => {
                if saw_structured {
                    StreamCompletionOutcome::StructuredOnly
                } else {
                    StreamCompletionOutcome::EmptyAnswer
                }
            }
            other => other,
        };
    }

    // one honest terminal on the wire, in contract order (Started is first)
    let (completion, truncated) = terminal_status(&outcome);
    sink.send(stream_event(
        op_id,
        &mut sequence,
        StreamEventPayloadDto::Completed {
            completion: completion.to_string(),
            truncated,
            usage: usage.clone(),
        },
    ))
    .ok_or_log(op_id);

    persist_terminal(
        ctx,
        op_id,
        request_id,
        ids,
        &acc,
        &outcome,
        usage.as_ref(),
        false,
    )
    .await
}

pub(crate) fn stream_event(
    op_id: &str,
    sequence: &mut u64,
    event: StreamEventPayloadDto,
) -> StreamEventDto {
    *sequence += 1;
    StreamEventDto {
        op_id: op_id.to_string(),
        sequence: *sequence,
        event,
    }
}

trait SinkLog {
    fn ok_or_log(self, op_id: &str);
}

impl SinkLog for Result<(), String> {
    fn ok_or_log(self, op_id: &str) {
        if let Err(e) = self {
            tracing::debug!(
                "completion op {op_id}: renderer went away mid-stream ({}), terminal persists regardless",
                e
            );
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn persist_terminal(
    ctx: &ApiContext,
    op_id: &str,
    request_id: &str,
    ids: &StreamIds,
    text: &str,
    outcome: &StreamCompletionOutcome,
    usage: Option<&MessageUsageV1>,
    // Recovery callers claim the pending row exactly once inside this tx:
    // zero rows claimed means another call already recorded a terminal.
    require_pending: bool,
) -> &'static str {
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ids.ws_id),
        project_id: Some(ids.proj_id),
        session_id: Some(ids.sess_id),
    };
    let sess_stream = format!("session:{}", ids.sess_id);
    let message_id = MessageId::new_v7();
    let content_id = ContentId::new_v7();
    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;

    let mut tx = match ctx.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!("completion op {op_id}: terminal persistence unavailable: {e}");
            return "failed";
        }
    };

    if require_pending {
        let claimed = match sqlx::query(
            "UPDATE pending_operations SET status = 'resolved', updated_at_us = ? \
             WHERE operation_id = ? AND message_request_id = ? \
               AND kind = 'provider-completion' AND status = 'pending'",
        )
        .bind(now_us)
        .bind(op_id)
        .bind(request_id)
        .execute(&mut *tx)
        .await
        {
            Ok(result) => result.rows_affected(),
            Err(e) => {
                tracing::error!("completion op {op_id}: pending claim failed: {e}");
                let _ = tx.rollback().await;
                return "failed";
            }
        };
        if claimed == 0 {
            // The claim and the terminal roll back together, so a crash
            // between them leaves the op recoverable.
            let _ = tx.rollback().await;
            return "already-resolved";
        }
    }

    if let Err(e) = SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        "assistant_text",
        "text/plain",
        &scope,
        text.as_bytes(),
    )
    .await
    {
        tracing::error!("completion op {op_id}: terminal content store failed: {e}");
        let _ = tx.rollback().await;
        return "failed";
    }

    // current stream sequence + event append
    let seq_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&sess_stream)
            .fetch_optional(&mut *tx)
            .await
            .ok()
            .flatten();
    let current_seq = seq_row
        .map(|r| r.get::<i64, _>("current_sequence") as u64)
        .unwrap_or(0);

    let completion = map_completion(outcome);
    let event_payload = MessageCompletedV1 {
        op_id: OperationId::from_string(op_id).unwrap_or_else(|_| OperationId::new_v7()),
        message_id,
        content_id,
        content_kind: "assistant_text".to_string(),
        size_bytes: text.len() as u64,
        completion,
        usage: usage.cloned(),
    };
    let append_req = AppendEventRequest {
        stream_id: sess_stream,
        stream_kind: "session".to_string(),
        expected_sequence: current_seq,
        event_type: EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED.to_string(),
        event_version: 1,
        scope: scope.clone(),
        actor: EventActor {
            actor_id: ctx.actor_id,
            kind: ActorKind::System,
        },
        request_id: RequestId::from_string(op_id).unwrap_or_else(|_| RequestId::new_v7()),
        correlation_id: CorrelationId::from_string(op_id)
            .unwrap_or_else(|_| CorrelationId::new_v7()),
        causation_id: None,
        payload_json: serde_json::to_vec(&event_payload).unwrap_or_default(),
        metadata_json: b"{}".to_vec(),
    };
    let append_res = match SqliteEventStore::append_event_tx(&mut tx, append_req).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("completion op {op_id}: terminal append failed: {e}");
            let _ = tx.rollback().await;
            return "failed";
        }
    };
    if let Err(e) = adham_projections::ConversationProjection::insert_assistant_completion_tx(
        &mut tx,
        &message_id.to_string(),
        &ids.ws_id.to_string(),
        &ids.proj_id.to_string(),
        &ids.sess_id.to_string(),
        op_id,
        &content_id.to_string(),
        &serde_json::to_string(&completion).unwrap_or_default(),
        usage
            .map(|u| serde_json::to_string(u).unwrap_or_default())
            .as_deref(),
        &append_res.event_id.to_string(),
        append_res.global_position,
        now_us,
    )
    .await
    {
        tracing::error!("completion op {op_id}: terminal projection failed: {e}");
        let _ = tx.rollback().await;
        return "failed";
    }
    if let Err(e) = SqliteEventStore::resolve_pending_operation_tx(&mut tx, op_id, request_id).await
    {
        tracing::error!("completion op {op_id}: pending op resolution failed: {e}");
        let _ = tx.rollback().await;
        return "failed";
    }
    if let Err(e) = tx.commit().await {
        tracing::error!("completion op {op_id}: terminal commit failed: {e}");
        return "failed";
    }

    // op_id doubles as the pending op's message_request_id? No — resolve by op
    // id only; the request-id guard applies to client-minted flows.
    "succeeded"
}
