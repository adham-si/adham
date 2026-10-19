//! Streaming completion handlers + stop (Delivery A).

use super::assembly::{
    AssembledContext, assemble_context, branch_aware_rows, budget_with_reserve, mode_instruction,
};
use super::stream_io::{persist_terminal, run_stream};
use super::{
    ApiContext, EventSink, StreamIds, ok_result, resolve_dispatch_adapter, validate_mode,
    validate_session_scope, validate_think,
};

use crate::dtos::*;
use crate::pending_dtos::{MarkCompletionInterruptedPayload, MarkCompletionInterruptedResponse};
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_provider::adapters::AnyAdapter;
use adham_provider::domain::account::ProviderAccountId;
use adham_provider::domain::request::ThinkValue;
use adham_provider::domain::stream::StreamCompletionOutcome;
use adham_provider::registry::{LocalAccount, PinnedModel};
use sqlx::Row;
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;
use tracing::info;

pub(crate) fn expect_full_scope(context: &CommandContext) -> Result<StreamIds, String> {
    let ws_id = WorkspaceId::from_string(
        context
            .workspace_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let proj_id = ProjectId::from_string(
        context
            .project_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: projectId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let sess_id = SessionId::from_string(
        context
            .session_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;
    Ok(StreamIds {
        ws_id,
        proj_id,
        sess_id,
    })
}

pub async fn handle_stop_completion(
    ctx: &ApiContext,
    env: CommandEnvelope<StopCompletionPayload>,
) -> Result<CommandResult<StopCompletionResponse>, String> {
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;

    let op_id = OperationId::from_string(&env.payload.op_id).map_err(|_| {
        format!(
            "VALIDATION_FAILED: unknown completion operation '{}'",
            env.payload.op_id
        )
    })?;
    let op_str = op_id.to_string();

    let pending: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id, session_id, status FROM pending_operations \
             WHERE operation_id = ? AND kind = 'provider-completion'",
    )
    .bind(&op_str)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| e.to_string())?;
    let row = pending
        .ok_or_else(|| format!("CONTEXT_MISMATCH: unknown completion operation '{op_str}'"))?;
    let matches = row.get::<String, _>("workspace_id") == ids.ws_id.to_string()
        && row.get::<String, _>("project_id") == ids.proj_id.to_string()
        && row.get::<Option<String>, _>("session_id").as_deref() == Some(&ids.sess_id.to_string());
    if !matches {
        return Err(format!(
            "CONTEXT_MISMATCH: completion operation '{op_str}' does not belong to this session"
        ));
    }

    let status = if ctx.completion_runs.cancel_of(&op_str) {
        "cancelled"
    } else {
        "already-resolved"
    };
    Ok(ok_result(
        env.request_id,
        StopCompletionResponse {
            op_id: op_str,
            status: status.to_string(),
        },
    ))
}

pub(crate) async fn resolve_pinned(
    ctx: &ApiContext,
    account_id: &ProviderAccountId,
    model_id: &str,
) -> Result<PinnedModel, String> {
    let models = ctx
        .registry
        .list_models(account_id)
        .await
        .map_err(|e| e.to_string())?;
    models
        .into_iter()
        .find(|m| m.model_id.0 == model_id)
        .ok_or_else(|| format!("VALIDATION_FAILED: unknown model '{model_id}' — discover first"))
}

/// Complete exactly once, streaming deltas over the sink. Returns only after
/// the terminal outcome is persisted. The user message is atomically
/// submitted first; the op handle is durable BEFORE dispatch.
pub async fn handle_complete_once_streaming<S>(
    ctx: &ApiContext,
    env: CommandEnvelope<CompleteOncePayload>,
    sink: &S,
) -> Result<CommandResult<CompletionStartDto>, String>
where
    S: EventSink,
{
    let trimmed = env.payload.text.trim().to_string();
    if trimmed.is_empty() {
        return Err("VALIDATION_FAILED: text cannot be empty".to_string());
    }
    if trimmed.len() > 65536 {
        return Err("VALIDATION_FAILED: text exceeds 65536 bytes".to_string());
    }
    validate_mode(env.payload.mode.as_deref())?;
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;

    // A submission reference is validated against persisted history before
    // anything else: unknown targets and non-user edits refuse the whole
    // send, pre-append and pre-socket.
    if let Some(reference) = &env.payload.reference {
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &ids.sess_id,
        )
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        validate_submit_reference(&rows, reference)?;
    }

    // Model evidence before ANY socket: unknown ids dispatch nothing.
    let (account, pinned, adapter) =
        resolve_dispatch_adapter(ctx, &env.payload.account_id, &env.payload.model_id).await?;
    if let Some(think) = &env.payload.think {
        validate_think(&pinned, think)?;
    }
    let op_id = OperationId::new_v7();
    let message_id = MessageId::new_v7();
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ids.ws_id),
        project_id: Some(ids.proj_id),
        session_id: Some(ids.sess_id),
    };
    let sess_stream = format!("session:{}", ids.sess_id);

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    // idempotent IPC retry: same request → same op handle, never a second dispatch
    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        let persisted: CompletionStartDto = serde_json::from_slice(&receipt.response_json)
            .map_err(|_| "STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string())?;
        tx.rollback()
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        return Ok(CommandResult {
            protocol_version: 1,
            request_id: env.request_id,
            correlation_id: receipt.correlation_id,
            data: persisted,
        });
    }

    let seq_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&sess_stream)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let current_seq = seq_row
        .map(|r| r.get::<i64, _>("current_sequence") as u64)
        .unwrap_or(0);

    let content_id = ContentId::new_v7();
    SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        "user_text",
        "text/plain",
        &scope,
        trimmed.as_bytes(),
    )
    .await
    .map_err(|e| e.to_string())?;

    let correlation_id = CorrelationId::new_v7();
    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;
    let append_req = AppendEventRequest {
        stream_id: sess_stream,
        stream_kind: "session".to_string(),
        expected_sequence: current_seq,
        event_type: "MessageSubmitted".to_string(),
        event_version: MESSAGE_SUBMITTED_CURRENT_VERSION,
        scope: scope.clone(),
        actor: EventActor {
            actor_id: ctx.actor_id,
            kind: ActorKind::LocalHuman,
        },
        request_id,
        correlation_id,
        causation_id: None,
        payload_json: serde_json::to_vec(&MessageSubmittedV2 {
            message_id,
            content_id,
            content_kind: "user_text".to_string(),
            size_bytes: trimmed.len() as u64,
            reference: env
                .payload
                .reference
                .as_ref()
                .map(message_reference_v1)
                .transpose()?,
        })
        .map_err(|e| e.to_string())?,
        metadata_json: b"{}".to_vec(),
    };
    let append_res = SqliteEventStore::append_event_tx(&mut tx, append_req)
        .await
        .map_err(|e| e.to_string())?;
    adham_projections::ConversationProjection::insert_message_tx(
        &mut tx,
        &message_id.to_string(),
        &ids.ws_id.to_string(),
        &ids.proj_id.to_string(),
        &ids.sess_id.to_string(),
        "user",
        &content_id.to_string(),
        &append_res.event_id.to_string(),
        append_res.global_position,
        now_us,
        env.payload
            .reference
            .as_ref()
            .map(|r| (r.refers_to_message_id.as_str(), r.relation.as_str())),
    )
    .await
    .map_err(|e| e.to_string())?;

    // Durable op handle BEFORE any socket (fail-closed record-then-POST).
    SqliteEventStore::record_pending_operation_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &op_id.to_string(),
        "provider-completion",
        &scope,
        None,
        &request_id.to_string(),
        "",
        None,
    )
    .await
    .map_err(|e| e.to_string())?;

    // The stored receipt is the replay record; the assembly summary is filled
    // in after the submitted row is durable (below), so a replayed receipt
    // carries none.
    let start = CompletionStartDto {
        op_id: op_id.to_string(),
        message_id: message_id.to_string(),
        context: None,
    };
    let persisted = serde_json::to_vec(&start).unwrap_or_default();
    // The fingerprint covers the semantic input: a reference, when present, is
    // part of it, so a reused request id with a different reference conflicts.
    // A reference-free send hashes exactly as before.
    let request_input = match &env.payload.reference {
        Some(r) => format!("{trimmed}|{}|{}", r.refers_to_message_id, r.relation),
        None => trimmed.clone(),
    };
    let request_fp =
        adham_event_log::request_fingerprint("complete_once_streaming", 1, &request_input);
    let scope_fp = adham_event_log::scope_fingerprint(
        "complete_once_streaming",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ids.ws_id),
        Some(&ids.proj_id),
        Some(&ids.sess_id),
    );
    SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "complete_once_streaming",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "completed",
        &persisted,
        append_res.global_position,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let token = CancellationToken::new();
    ctx.completion_runs.insert(&start.op_id, token.clone());

    // Budgeted assembly runs inside this branch's reap protection, after the
    // submitted row above is durable (it must reach the model). History comes
    // from protected content server-side, never from the renderer.
    let (input_budget, max_output_tokens) = budget_with_reserve(&pinned.descriptor);
    let history_rows = adham_projections::ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &ids.sess_id,
    )
    .await
    .unwrap_or_default();
    let assembled = assemble_context(
        branch_aware_rows(
            history_rows,
            env.payload.reference.as_ref(),
            &ids.sess_id,
            ctx,
        )
        .await,
        env.payload.mode.as_deref().and_then(mode_instruction),
        input_budget,
        // A fresh send keeps the whole session history; the branch lives in
        // the row iterator instead of a stop_after cut.
        None,
    );

    Ok(run_and_settle(
        ctx,
        env.request_id,
        correlation_id,
        &ids,
        &adapter,
        &account,
        &pinned,
        &token,
        start,
        assembled,
        max_output_tokens,
        env.payload.think,
        sink,
    )
    .await)
}

/// Assembly summary + dispatch + settle for one completion op. Shared by a
/// fresh send and a retry/regenerate attempt: both write exactly one assistant
/// terminal for one durable op handle, and the op leaves `completion_runs`
/// before this returns.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_and_settle<S>(
    ctx: &ApiContext,
    request_id: String,
    correlation_id: CorrelationId,
    ids: &StreamIds,
    adapter: &AnyAdapter,
    account: &LocalAccount,
    pinned: &PinnedModel,
    token: &CancellationToken,
    mut start: CompletionStartDto,
    assembled: AssembledContext,
    max_output_tokens: Option<u32>,
    think: Option<ThinkValue>,
    sink: &S,
) -> CommandResult<CompletionStartDto>
where
    S: EventSink,
{
    start.context = Some(ContextAssemblyDto {
        estimated_input_tokens: assembled.estimated_input_tokens,
        input_budget_tokens: assembled.input_budget_tokens,
        dropped_messages: assembled.dropped_messages,
    });

    info!("provider completion dispatching op {}", start.op_id);
    let outcome = run_stream(
        ctx,
        adapter,
        pinned,
        account,
        &start.op_id,
        &request_id,
        ids,
        token,
        assembled.messages,
        max_output_tokens,
        think,
        sink,
    )
    .await;
    ctx.completion_runs.remove(&start.op_id);
    info!(
        "provider completion op {} outcome: {}",
        start.op_id, outcome
    );

    CommandResult {
        protocol_version: 1,
        request_id,
        correlation_id: correlation_id.to_string(),
        data: start,
    }
}

/// Close a stale provider op left pending by a crash or a failed terminal
/// commit. Explicit, one-shot authority from the recovery surface: the op is
/// claimed inside the same tx that writes the canonical `interrupted`
/// terminal, so history gains a labelled cancelled turn instead of staying
/// silently unanswered. The pending row itself is never deleted.
pub async fn handle_mark_completion_interrupted(
    ctx: &ApiContext,
    env: CommandEnvelope<MarkCompletionInterruptedPayload>,
) -> Result<CommandResult<MarkCompletionInterruptedResponse>, String> {
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;

    let op_id = OperationId::from_string(&env.payload.operation_id).map_err(|_| {
        format!(
            "VALIDATION_FAILED: unknown completion operation '{}'",
            env.payload.operation_id
        )
    })?;
    let op_str = op_id.to_string();

    let row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id, session_id, message_request_id, status \
         FROM pending_operations WHERE operation_id = ? AND kind = 'provider-completion'",
    )
    .bind(&op_str)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let row =
        row.ok_or_else(|| format!("CONTEXT_MISMATCH: unknown completion operation '{op_str}'"))?;

    let matches = row.get::<String, _>("workspace_id") == ids.ws_id.to_string()
        && row.get::<String, _>("project_id") == ids.proj_id.to_string()
        && row.get::<Option<String>, _>("session_id").as_deref() == Some(&ids.sess_id.to_string());
    if !matches {
        return Err(format!(
            "CONTEXT_MISMATCH: completion operation '{op_str}' does not belong to this session"
        ));
    }
    if row.get::<String, _>("message_request_id") != env.payload.expected_message_request_id {
        return Err(
            "REQUEST_ID_CONFLICT: expected_message_request_id does not match the operation"
                .to_string(),
        );
    }
    if ctx.completion_runs.is_live(&op_str) {
        // A healthy run owns its own terminal (Stop or completion).
        return Err(format!(
            "CONFLICT: completion operation '{op_str}' is still running"
        ));
    }

    let status = if row.get::<String, _>("status") == "pending" {
        match persist_terminal(
            ctx,
            &op_str,
            &env.payload.expected_message_request_id,
            &ids,
            "",
            &StreamCompletionOutcome::Interrupted,
            None,
            true,
        )
        .await
        {
            "succeeded" => "interrupted",
            "already-resolved" => "already-resolved",
            _ => {
                return Err(
                    "STORAGE_UNAVAILABLE: interrupted terminal could not be recorded".to_string(),
                );
            }
        }
    } else {
        "already-resolved"
    };

    Ok(ok_result(
        env.request_id,
        MarkCompletionInterruptedResponse {
            status: status.to_string(),
        },
    ))
}

/// Validate a submission reference against this session's persisted history:
/// the target must be a message of the session, and only a user message can be
/// edited. Nothing is written on refusal.
fn validate_submit_reference(
    rows: &[adham_projections::ConversationMessageView],
    reference: &MessageReferenceDto,
) -> Result<(), String> {
    if reference.relation != "replied" && reference.relation != "edited-from" {
        return Err("VALIDATION_FAILED: relation must be replied or edited-from".to_string());
    }
    let target = rows
        .iter()
        .find(|r| r.message_id == reference.refers_to_message_id)
        .ok_or_else(|| "VALIDATION_FAILED: reference target is not in this session".to_string())?;
    if reference.relation == "edited-from" && target.role != "user" {
        return Err("VALIDATION_FAILED: only a user message can be edited".to_string());
    }
    Ok(())
}

/// The canonical event payload form of a validated IPC reference.
fn message_reference_v1(reference: &MessageReferenceDto) -> Result<MessageReferenceV1, String> {
    Ok(MessageReferenceV1 {
        refers_to_message_id: MessageId::from_string(&reference.refers_to_message_id)
            .map_err(|e| format!("VALIDATION_FAILED: {e}"))?,
        relation: reference.relation.clone(),
    })
}
