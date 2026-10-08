//! Atomic submit-message service. ID newtypes are `Copy`; `.clone()` below
//! follows the surrounding codebase style.
#![allow(clippy::clone_on_copy)]
use super::common::conflict_msg;
use crate::dtos::*;
use crate::handlers::ApiContext;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use serde::{Deserialize, Serialize};
use sqlx::Row;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Persisted receipt: structural references only, never cleartext.
/// The authorized IPC response (`SubmittedMessage`) still carries `text`,
/// hydrated from decrypted content on replay.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct PersistedMessageReceipt {
    message_id: String,
    session_id: String,
    content_id: String,
    created_at: String,
    stream_sequence: String,
    projection_position: String,
}

fn expected_scope(
    ctx: &ApiContext,
    ws: &WorkspaceId,
    proj: &ProjectId,
    sess: &SessionId,
) -> EventScope {
    EventScope {
        installation_id: ctx.installation_id.clone(),
        workspace_id: Some(ws.clone()),
        project_id: Some(proj.clone()),
        session_id: Some(sess.clone()),
    }
}

async fn hydrate(
    ctx: &ApiContext,
    request_id: String,
    correlation_id: String,
    persisted: PersistedMessageReceipt,
    scope: &EventScope,
) -> Result<CommandResult<SubmittedMessage>, String> {
    let content_id = ContentId::from_string(&persisted.content_id).map_err(|e| e.to_string())?;
    let plain = ctx
        .store
        .get_content(ctx.content_key.as_ref(), &content_id, scope)
        .await
        .map_err(|e| e.to_string())?;
    let bytes = plain.ok_or_else(|| "STORAGE_REPAIR_REQUIRED: content missing".to_string())?;
    let text = String::from_utf8(bytes)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: content invalid utf-8".to_string())?;
    Ok(CommandResult {
        protocol_version: 1,
        request_id,
        correlation_id,
        data: SubmittedMessage {
            message_id: persisted.message_id,
            session_id: persisted.session_id,
            text,
            created_at: persisted.created_at,
            stream_sequence: persisted.stream_sequence,
            projection_position: persisted.projection_position,
        },
    })
}

async fn hydrate_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    ctx: &ApiContext,
    request_id: String,
    correlation_id: String,
    persisted: PersistedMessageReceipt,
    scope: &EventScope,
) -> Result<CommandResult<SubmittedMessage>, String> {
    let content_id = ContentId::from_string(&persisted.content_id).map_err(|e| e.to_string())?;
    let plain = SqliteEventStore::get_content_tx(tx, ctx.content_key.as_ref(), &content_id, scope)
        .await
        .map_err(|e| e.to_string())?;
    let bytes = plain.ok_or_else(|| "STORAGE_REPAIR_REQUIRED: content missing".to_string())?;
    let text = String::from_utf8(bytes)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: content invalid utf-8".to_string())?;
    Ok(CommandResult {
        protocol_version: 1,
        request_id,
        correlation_id,
        data: SubmittedMessage {
            message_id: persisted.message_id,
            session_id: persisted.session_id,
            text,
            created_at: persisted.created_at,
            stream_sequence: persisted.stream_sequence,
            projection_position: persisted.projection_position,
        },
    })
}

fn parse_persisted(
    receipt: &adham_event_log::CommandReceiptRecord,
) -> Result<PersistedMessageReceipt, String> {
    serde_json::from_slice::<PersistedMessageReceipt>(&receipt.response_json)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string())
}

/// Atomic submit-message: content + event + stream + projection/checkpoint +
/// receipt in one transaction owned here (not in the transport handler).
pub async fn submit_message(
    ctx: &ApiContext,
    env: CommandEnvelope<SubmitMessagePayload>,
) -> Result<CommandResult<SubmittedMessage>, String> {
    let trimmed = env.payload.text.trim().to_string();
    let ws_id = WorkspaceId::from_string(
        env.context
            .workspace_id
            .as_deref()
            .ok_or("workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let proj_id = ProjectId::from_string(
        env.context
            .project_id
            .as_deref()
            .ok_or("projectId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let sess_id = SessionId::from_string(
        env.context
            .session_id
            .as_deref()
            .ok_or("sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    let request_fp = adham_event_log::request_fingerprint("submit_message", 1, &trimmed);
    let scope_fp = adham_event_log::scope_fingerprint(
        "submit_message",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ws_id),
        Some(&proj_id),
        Some(&sess_id),
    );
    let scope = expected_scope(ctx, &ws_id, &proj_id, &sess_id);

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let sess_stream = format!("session:{}", sess_id);
    let sess_row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(&sess_stream)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| e.to_string())?;
    match sess_row {
        Some(row) => {
            let row_ws: Option<String> = row.get("workspace_id");
            let row_proj: Option<String> = row.get("project_id");
            if row_ws.as_deref() != Some(&ws_id.to_string())
                || row_proj.as_deref() != Some(&proj_id.to_string())
            {
                return Err(
                    "CONTEXT_MISMATCH: session does not belong to specified project or workspace"
                        .to_string(),
                );
            }
        }
        None => return Err("SESSION_NOT_FOUND: session stream does not exist".to_string()),
    }

    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        let matches = receipt.command_type == "submit_message"
            && receipt.command_version == 1
            && receipt.actor_id == ctx.actor_id.to_string()
            && receipt.scope_fingerprint == scope_fp
            && receipt.request_fingerprint == request_fp;
        if matches {
            let persisted = parse_persisted(&receipt)?;
            let correlation = receipt.correlation_id.clone();
            let out =
                hydrate_tx(&mut tx, ctx, env.request_id, correlation, persisted, &scope).await?;
            tx.rollback()
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
            return Ok(out);
        } else {
            let _ = tx.rollback().await;
            return Err(conflict_msg());
        }
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
    let content_bytes = env.payload.text.as_bytes().to_vec();
    SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        "user_text",
        "text/plain",
        &scope,
        &content_bytes,
    )
    .await
    .map_err(|e| e.to_string())?;

    let message_id = MessageId::new_v7();
    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();
    let correlation_id = CorrelationId::new_v7();
    let event_payload = MessageSubmittedV1 {
        message_id: message_id.clone(),
        content_id: content_id.clone(),
        content_kind: "user_text".to_string(),
        size_bytes: content_bytes.len() as u64,
    };
    let payload_bytes = serde_json::to_vec(&event_payload).map_err(|e| e.to_string())?;
    let append_req = AppendEventRequest {
        stream_id: sess_stream,
        stream_kind: "session".to_string(),
        expected_sequence: current_seq,
        event_type: "MessageSubmitted".to_string(),
        event_version: 1,
        scope: scope.clone(),
        actor: EventActor {
            actor_id: ctx.actor_id.clone(),
            kind: ActorKind::LocalHuman,
        },
        request_id: request_id.clone(),
        correlation_id: correlation_id.clone(),
        causation_id: None,
        payload_json: payload_bytes,
        metadata_json: b"{}".to_vec(),
    };
    let append_res = match SqliteEventStore::append_event_tx(&mut tx, append_req).await {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.rollback().await;
            return Err(e.to_string());
        }
    };

    if let Err(e) = adham_projections::ConversationProjection::insert_message_tx(
        &mut tx,
        &message_id.to_string(),
        &ws_id.to_string(),
        &proj_id.to_string(),
        &sess_id.to_string(),
        "user",
        &content_id.to_string(),
        &append_res.event_id.to_string(),
        append_res.global_position,
        now_us,
    )
    .await
    {
        let _ = tx.rollback().await;
        return Err(e.to_string());
    }

    // Persisted receipt carries structural refs only, never cleartext.
    let persisted = PersistedMessageReceipt {
        message_id: message_id.to_string(),
        session_id: sess_id.to_string(),
        content_id: content_id.to_string(),
        created_at: created_at_iso.clone(),
        stream_sequence: append_res.stream_sequence.to_string(),
        projection_position: append_res.global_position.to_string(),
    };
    let response_json = serde_json::to_vec(&persisted).unwrap_or_default();
    if let Err(e) = SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "submit_message",
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
    {
        let _ = tx.rollback().await;
        return Err(format!(
            "STORAGE_UNAVAILABLE: failed to record receipt: {e}"
        ));
    }

    if let Err(e) = tx.commit().await {
        // Winner's receipt decides replay vs conflict.
        match ctx.store.check_receipt(&request_id).await {
            Ok(Some(receipt)) => {
                let matches = receipt.command_type == "submit_message"
                    && receipt.command_version == 1
                    && receipt.actor_id == ctx.actor_id.to_string()
                    && receipt.scope_fingerprint == scope_fp
                    && receipt.request_fingerprint == request_fp;
                if matches {
                    let persisted = parse_persisted(&receipt)?;
                    let correlation = receipt.correlation_id.clone();
                    return hydrate(ctx, env.request_id, correlation, persisted, &scope).await;
                }
                return Err(conflict_msg());
            }
            _ => return Err(format!("STORAGE_UNAVAILABLE: commit failed: {e}")),
        }
    }

    // Authorized IPC response keeps text; persisted receipt does not.
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: SubmittedMessage {
            message_id: message_id.to_string(),
            session_id: sess_id.to_string(),
            text: env.payload.text,
            created_at: created_at_iso,
            stream_sequence: append_res.stream_sequence.to_string(),
            projection_position: append_res.global_position.to_string(),
        },
    })
}
