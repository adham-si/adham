//! Retry / regenerate: one NEW attempt for an existing user turn (Delivery A).

use super::assembly::{assemble_context, budget_with_reserve, mode_instruction};
use super::scope::expect_full_scope;
use super::streaming::run_and_settle;
use super::{
    ApiContext, EventSink, resolve_dispatch_adapter, validate_mode, validate_session_scope,
    validate_think,
};

use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::SqliteEventStore;
use std::collections::HashMap;
use tokio_util::sync::CancellationToken;

/// Retry / regenerate: one NEW assistant attempt for an existing user turn.
///
/// The user row is never duplicated and previous attempts stay persisted, so
/// history is preserved and each retry is an explicit, visible dispatch with
/// its own durable op handle — never a silent re-run and never a resend of the
/// user's message as a new turn. Only the session's latest user turn can be
/// retried: history is append-only, so an older turn cannot be answered now
/// without answering it out of order (refused before any socket).
pub async fn handle_retry_completion_streaming<S>(
    ctx: &ApiContext,
    env: CommandEnvelope<RetryCompletionPayload>,
    sink: &S,
) -> Result<CommandResult<CompletionStartDto>, String>
where
    S: EventSink,
{
    validate_mode(env.payload.mode.as_deref())?;
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    let (account, pinned, adapter) =
        resolve_dispatch_adapter(ctx, &env.payload.account_id, &env.payload.model_id).await?;
    if let Some(think) = &env.payload.think {
        validate_think(&pinned, think)?;
    }

    // The retried turn must be a persisted user row of this session, and the
    // session's latest user turn. History comes from protected content
    // server-side; the renderer only names the turn.
    let reply_to = env.payload.reply_to_message_id.clone();
    let history_rows = adham_projections::ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &ids.sess_id,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let target = history_rows
        .iter()
        .find(|r| r.message_id == reply_to)
        .ok_or_else(|| "VALIDATION_FAILED: reply target is not in this session".to_string())?;
    if target.role != "user" {
        return Err("VALIDATION_FAILED: only a user turn can be retried".to_string());
    }
    let latest_user = history_rows.iter().rev().find(|r| r.role == "user");
    if latest_user.map(|r| r.message_id.as_str()) != Some(reply_to.as_str()) {
        return Err("RETRY_NOT_LATEST_TURN: only the latest user turn can be retried".to_string());
    }

    let op_id = OperationId::new_v7();
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ids.ws_id),
        project_id: Some(ids.proj_id),
        session_id: Some(ids.sess_id),
    };
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    // idempotent IPC retry: same request → same op handle, never a second
    // attempt. A deliberate second retry is a new request id, and then it IS
    // a second visible attempt.
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

    // Durable op handle BEFORE any socket (fail-closed record-then-POST). The
    // response names the retried user turn: there is no new user message.
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

    let correlation_id = CorrelationId::new_v7();
    let start = CompletionStartDto {
        op_id: op_id.to_string(),
        message_id: reply_to.clone(),
        context: None,
    };
    let persisted = serde_json::to_vec(&start).unwrap_or_default();
    let request_input = format!("{reply_to}|{}", env.payload.model_id);
    let request_fp = adham_event_log::request_fingerprint("retry_completion", 1, &request_input);
    let scope_fp = adham_event_log::scope_fingerprint(
        "retry_completion",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ids.ws_id),
        Some(&ids.proj_id),
        Some(&ids.sess_id),
    );
    // A retry appends no event at dispatch (the user row already exists), so
    // this receipt has no global position to point at; 0 marks that. Receipt
    // replay reads the stored response only, never these positions.
    SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "retry_completion",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "completed",
        &persisted,
        0,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let token = CancellationToken::new();
    ctx.completion_runs.insert(&start.op_id, token.clone());

    // The retried turn's own context: history stops at the user row being
    // answered, so the previous attempts of this turn are not sent back to the
    // model (they stay persisted and visible) and later turns cannot exist —
    // the latest-turn rule above guarantees it.
    let (input_budget, max_output_tokens) = budget_with_reserve(&pinned.descriptor);
    // Files the answered turn was sent with, from the durable links: a retry
    // re-sends exactly what the original send carried (a read failure refuses
    // the dispatch rather than dropping file content silently).
    let attachments_by_message: HashMap<_, _> =
        crate::service::attachment_dispatch::session_dispatch_attachments(
            ctx,
            &ids.ws_id,
            &ids.proj_id,
            &ids.sess_id,
        )
        .await?;
    let assembled = assemble_context(
        history_rows.into_iter(),
        env.payload.mode.as_deref().and_then(mode_instruction),
        input_budget,
        Some(&reply_to),
        &attachments_by_message,
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
