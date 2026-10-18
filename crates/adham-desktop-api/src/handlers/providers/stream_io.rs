//! Stream pump + terminal persistence internals (Delivery A).

use super::{ApiContext, EventSink, StreamIds};

use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_provider::adapters::AnyAdapter;
use adham_provider::domain::model::ModelSelectionSnapshot;
use adham_provider::domain::request::{ChatMessage, MessageRole, ProviderRequestV1};
use adham_provider::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use adham_provider::registry::{LocalAccount, PinnedModel};
use sqlx::Row;
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;

/// Bounded server-side history: cap N messages and N bytes, trimmed from the
/// oldest end. The newest user message (the dispatch input) is always kept.
const MAX_HISTORY_MESSAGES: usize = 20;
const MAX_HISTORY_BYTES: usize = 16_384;
/// Assistant accumulation bound: provider output beyond this is a protocol
/// failure (bounded content, never an unbounded write).
const MAX_ASSISTANT_BYTES: usize = 262_144;

/// Bounded server-side history: newest-last message list, capped; interrupted
/// and failed rows never enter next-dispatch context.
pub(crate) fn bounded_history(
    rows: impl Iterator<Item = adham_projections::ConversationMessageView>,
) -> Vec<ChatMessage> {
    let mut kept: Vec<(usize, String, String)> = Vec::new(); // (index, role, content)
    for row in rows.enumerate() {
        if matches!(
            row.1.completion,
            Some(MessageCompletionV1::Interrupted) | Some(MessageCompletionV1::Failed)
        ) {
            continue;
        }
        kept.push((row.0, row.1.role, row.1.content));
    }
    // trim from the oldest end; the newest messages win
    while kept.len() > MAX_HISTORY_MESSAGES {
        kept.remove(0);
    }
    let mut bytes: usize = kept.iter().map(|(_, _, c)| c.len()).sum();
    while bytes > MAX_HISTORY_BYTES && kept.len() > 1 {
        bytes -= kept.remove(0).2.len();
    }
    kept.into_iter()
        .map(|(_, role, content)| ChatMessage {
            role: if role == "assistant" {
                MessageRole::Assistant
            } else {
                MessageRole::User
            },
            content,
        })
        .collect()
}

fn terminal_status(outcome: &StreamCompletionOutcome) -> (&'static str, bool) {
    match outcome {
        StreamCompletionOutcome::Stop => ("completed", false),
        StreamCompletionOutcome::LengthExceeded => ("completed", true),
        StreamCompletionOutcome::Interrupted => ("interrupted", false),
        StreamCompletionOutcome::ContentFilter => ("failed", false),
    }
}

fn map_completion(outcome: &StreamCompletionOutcome) -> MessageCompletionV1 {
    match outcome {
        StreamCompletionOutcome::Stop => MessageCompletionV1::Completed { truncated: false },
        StreamCompletionOutcome::LengthExceeded => {
            MessageCompletionV1::Completed { truncated: true }
        }
        StreamCompletionOutcome::Interrupted => MessageCompletionV1::Interrupted,
        StreamCompletionOutcome::ContentFilter => MessageCompletionV1::Failed,
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
    sink: &S,
) -> &'static str
where
    S: EventSink,
{
    // bounded history from protected content (server-side, never the renderer's)
    let history_rows = adham_projections::ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &ids.sess_id,
    )
    .await
    .unwrap_or_default();
    let mut messages = bounded_history(history_rows.into_iter());
    // non-empty content guard: model gets a user prompt (the submitted row is in history)
    if messages.last().map(|m| m.role) != Some(MessageRole::User) {
        messages.push(ChatMessage {
            role: MessageRole::User,
            content: "(empty prompt)".to_string(),
        });
    }

    let request = ProviderRequestV1 {
        operation_id: op_id.to_string(),
        model_selection: ModelSelectionSnapshot {
            account_id: account.account_id.clone(),
            endpoint_id: account.endpoint_id.clone(),
            model_id: pinned.model_id.clone(),
            privacy_class: pinned.descriptor.privacy_class,
        },
        messages,
        max_output_tokens: None,
        temperature: None,
    };

    let stream = match adapter.stream_chat(pinned, &request).await {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("completion op {op_id}: dispatch failed pre-wire: {e}");
            // after the op handle exists: a pre-wire dispatch failure is a
            // failed terminal, never a vanished generation
            let mut seq = 0u64;
            sink.send(stream_event(
                op_id,
                &mut seq,
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
            )
            .await;
        }
    };

    // StreamStarted first, per-op sequence numbers increase in order.
    let mut sequence: u64 = 0;
    sink.send(stream_event(
        op_id,
        &mut sequence,
        StreamEventPayloadDto::Started,
    ))
    .ok_or_log(op_id);

    let mut acc = String::new();
    let mut usage: Option<MessageUsageV1> = None;
    let mut stream = stream;
    let mut terminal_outcome: Option<StreamCompletionOutcome> = None;
    let mut failed_reason: Option<String> = None;

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
                Some(Ok(NormalizedStreamEvent::ThinkingDelta(_))) => {
                    // provider-internal reasoning: not part of the persisted
                    // assistant answer in Delivery A
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

    let outcome = terminal_outcome.unwrap_or(StreamCompletionOutcome::ContentFilter);
    // sink failure path: log; persistence below is unconditional
    if failed_reason.is_some()
        || matches!(
            outcome,
            StreamCompletionOutcome::ContentFilter | StreamCompletionOutcome::Interrupted
        )
    {
        sink.send(stream_event(
            op_id,
            &mut sequence,
            StreamEventPayloadDto::Completed {
                completion: if failed_reason.is_some() {
                    "failed"
                } else {
                    "interrupted"
                }
                .to_string(),
                truncated: false,
                usage: usage.clone(),
            },
        ))
        .ok_or_log(op_id);
    }
    // completed terminals go straight to the same DTO shape
    if matches!(
        outcome,
        StreamCompletionOutcome::Stop | StreamCompletionOutcome::LengthExceeded
    ) {
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
    }

    persist_terminal(ctx, op_id, request_id, ids, &acc, &outcome, usage.as_ref()).await
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

pub(crate) async fn persist_terminal(
    ctx: &ApiContext,
    op_id: &str,
    request_id: &str,
    ids: &StreamIds,
    text: &str,
    outcome: &StreamCompletionOutcome,
    usage: Option<&MessageUsageV1>,
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

    let mut tx = match ctx.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!("completion op {op_id}: terminal persistence unavailable: {e}");
            return "failed";
        }
    };

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

    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;
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
