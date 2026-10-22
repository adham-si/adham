//! Structural session actions. Every action appends one desired-state event
//! and stores a structural-only receipt so replay is deterministic.
use crate::dtos::{
    CommandContext, CommandEnvelope, CommandResult, RenameSessionPayload, SessionMetadata,
    SetSessionArchivedPayload, SetSessionPinnedPayload,
};
use crate::handlers::ApiContext;
use crate::service::common::{conflict_msg, ensure_session_active_tx, lock_session_stream_tx};
use crate::service::history::key_cache::CachedContentKeyProvider;
use crate::service::history::list::read_session_metadata_tx;
use adham_core_types::history::*;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use serde::Serialize;
use std::sync::Arc;

fn parse_scope(
    context: &CommandContext,
    request_id: &str,
) -> Result<(WorkspaceId, ProjectId, SessionId, RequestId), String> {
    let ws_id = WorkspaceId::from_string(
        context
            .workspace_id
            .as_deref()
            .ok_or("workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let proj_id = ProjectId::from_string(
        context
            .project_id
            .as_deref()
            .ok_or("projectId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let sess_id = SessionId::from_string(
        context
            .session_id
            .as_deref()
            .ok_or("sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let request_id = RequestId::from_client_str(request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    Ok((ws_id, proj_id, sess_id, request_id))
}

fn receipt_matches(
    receipt: &adham_event_log::CommandReceiptRecord,
    ctx: &ApiContext,
    command_type: &str,
    scope_fp: &str,
    request_fp: &str,
) -> bool {
    receipt.command_type == command_type
        && receipt.command_version == 1
        && receipt.actor_id == ctx.actor_id.to_string()
        && receipt.scope_fingerprint == scope_fp
        && receipt.request_fingerprint == request_fp
}

fn parse_metadata(
    receipt: &adham_event_log::CommandReceiptRecord,
) -> Result<SessionMetadata, String> {
    serde_json::from_slice(&receipt.response_json)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string())
}

async fn structural_action<P: Serialize>(
    ctx: &ApiContext,
    context: &CommandContext,
    request_id_str: &str,
    command_type: &'static str,
    event_type: &'static str,
    request_input: &str,
    event_payload: P,
) -> Result<CommandResult<SessionMetadata>, String> {
    let (ws_id, proj_id, sess_id, request_id) = parse_scope(context, request_id_str)?;
    let request_fp = adham_event_log::request_fingerprint(command_type, 1, request_input);
    let scope_fp = adham_event_log::scope_fingerprint(
        command_type,
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ws_id),
        Some(&proj_id),
        Some(&sess_id),
    );
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ws_id),
        project_id: Some(proj_id),
        session_id: Some(sess_id),
    };
    let session_id = sess_id.to_string();
    let stream_id = format!("session:{session_id}");

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    lock_session_stream_tx(&mut tx, &session_id).await?;
    ensure_session_active_tx(&mut tx, &session_id).await?;

    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        if receipt_matches(&receipt, ctx, command_type, &scope_fp, &request_fp) {
            let data = parse_metadata(&receipt)?;
            let correlation_id = receipt.correlation_id.clone();
            tx.rollback()
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
            return Ok(CommandResult {
                protocol_version: 1,
                request_id: request_id_str.to_string(),
                correlation_id,
                data,
            });
        }
        let _ = tx.rollback().await;
        return Err(conflict_msg());
    }

    let current_seq: i64 =
        sqlx::query_scalar("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&stream_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let correlation_id = CorrelationId::new_v7();
    let payload_json = serde_json::to_vec(&event_payload).map_err(|e| e.to_string())?;
    let append_res = SqliteEventStore::append_event_tx(
        &mut tx,
        AppendEventRequest {
            stream_id,
            stream_kind: "session".to_string(),
            expected_sequence: current_seq as u64,
            event_type: event_type.to_string(),
            event_version: 1,
            scope,
            actor: EventActor {
                actor_id: ctx.actor_id.clone(),
                kind: ActorKind::LocalHuman,
            },
            request_id: request_id.clone(),
            correlation_id: correlation_id.clone(),
            causation_id: None,
            payload_json,
            metadata_json: b"{}".to_vec(),
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    let provider = CachedContentKeyProvider::new(Arc::clone(&ctx.content_key));
    let data = read_session_metadata_tx(&mut tx, &provider, &ctx.installation_id, &sess_id).await?;
    let response_json = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        command_type,
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "success",
        &response_json,
        append_res.global_position,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: failed to record receipt: {e}"))?;

    if let Err(e) = tx.commit().await {
        match ctx.store.check_receipt(&request_id).await {
            Ok(Some(receipt))
                if receipt_matches(&receipt, ctx, command_type, &scope_fp, &request_fp) =>
            {
                return Ok(CommandResult {
                    protocol_version: 1,
                    request_id: request_id_str.to_string(),
                    correlation_id: receipt.correlation_id.clone(),
                    data: parse_metadata(&receipt)?,
                });
            }
            Ok(Some(_)) => return Err(conflict_msg()),
            _ => return Err(format!("STORAGE_UNAVAILABLE: commit failed: {e}")),
        }
    }

    Ok(CommandResult {
        protocol_version: 1,
        request_id: request_id_str.to_string(),
        correlation_id: correlation_id.to_string(),
        data,
    })
}

pub async fn rename_session(
    ctx: &ApiContext,
    env: CommandEnvelope<RenameSessionPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    let title = env.payload.title.trim();
    validate_title(title).map_err(|_| "VALIDATION_FAILED:title_invalid".to_string())?;
    structural_action(
        ctx,
        &env.context,
        &env.request_id,
        "rename_session",
        EVENT_TYPE_SESSION_RENAMED,
        title,
        SessionRenamedV1 {
            title: title.to_string(),
        },
    )
    .await
}

pub async fn set_session_pinned(
    ctx: &ApiContext,
    env: CommandEnvelope<SetSessionPinnedPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    let request_input = format!("pinned={}", env.payload.pinned);
    structural_action(
        ctx,
        &env.context,
        &env.request_id,
        "set_session_pinned",
        EVENT_TYPE_SESSION_PIN_CHANGED,
        &request_input,
        SessionPinChangedV1 {
            pinned: env.payload.pinned,
        },
    )
    .await
}

pub async fn set_session_archived(
    ctx: &ApiContext,
    env: CommandEnvelope<SetSessionArchivedPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    let request_input = format!("archived={}", env.payload.archived);
    structural_action(
        ctx,
        &env.context,
        &env.request_id,
        "set_session_archived",
        EVENT_TYPE_SESSION_ARCHIVE_CHANGED,
        &request_input,
        SessionArchiveChangedV1 {
            archived: env.payload.archived,
        },
    )
    .await
}
