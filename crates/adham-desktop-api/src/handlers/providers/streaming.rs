//! Streaming completion handlers + stop (Delivery A).

use super::stream_io::run_stream;
use super::{
    any_adapter, local_account, ok_result, validate_session_scope, ApiContext, EventSink, StreamIds,
};

use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_provider::domain::account::ProviderAccountId;
use adham_provider::registry::PinnedModel;
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

/// Ownership check: the session's stream row must carry exactly this
/// workspace/project pair (renderer-supplied scope can never cross).
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
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;

    // Model evidence before ANY socket: unknown ids dispatch nothing.
    let account = local_account(ctx, &env.payload.account_id).await?;
    let pinned = resolve_pinned(ctx, &account.account_id, &env.payload.model_id).await?;

    // Google-style kinds hold their credential in the sealed vault; it is
    // loaded per-dispatch, moved into the adapter, and dropped with it. A
    // missing or unopenable seal refuses pre-session — before op creation,
    // so no pending op ever leaks.
    let credential = match account.kind {
        adham_provider::domain::account::ProviderKind::GoogleGemini => Some(
            adham_event_log::read_provider_credential_plaintext(
                &ctx.pool,
                ctx.content_key.as_ref(),
                &account.account_id.0,
                &ctx.installation_id.0.to_string(),
            )
            .await
            .map_err(|e| {
                format!("VALIDATION_FAILED: no usable credential for this Google account: {e}")
            })?,
        ),
        _ => None,
    };
    let adapter = any_adapter(&account, credential)?;
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
        event_version: 1,
        scope: scope.clone(),
        actor: EventActor {
            actor_id: ctx.actor_id,
            kind: ActorKind::LocalHuman,
        },
        request_id,
        correlation_id,
        causation_id: None,
        payload_json: serde_json::to_vec(&MessageSubmittedV1 {
            message_id,
            content_id,
            content_kind: "user_text".to_string(),
            size_bytes: trimmed.len() as u64,
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

    let start = CompletionStartDto {
        op_id: op_id.to_string(),
        message_id: message_id.to_string(),
    };
    let persisted = serde_json::to_vec(&start).unwrap_or_default();
    let request_fp = adham_event_log::request_fingerprint("complete_once_streaming", 1, &trimmed);
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

    info!("provider completion dispatching op {}", start.op_id);
    let outcome = run_stream(
        ctx,
        &adapter,
        &pinned,
        &account,
        &start.op_id,
        &request_id.to_string(),
        &ids,
        &token,
        sink,
    )
    .await;
    ctx.completion_runs.remove(&start.op_id);
    info!(
        "provider completion op {} outcome: {}",
        start.op_id, outcome
    );

    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: start,
    })
}

async fn resolve_pinned(
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
