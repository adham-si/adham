//! Atomic session creation service. ID newtypes are `Copy`.
#![allow(clippy::clone_on_copy)]
use super::common::conflict_msg;
use crate::dtos::*;
use crate::handlers::ApiContext;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use sqlx::Row;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

fn replay(
    request_id: String,
    receipt: adham_event_log::CommandReceiptRecord,
) -> Result<CommandResult<SessionSummary>, String> {
    match serde_json::from_slice::<SessionSummary>(&receipt.response_json) {
        Ok(data) => Ok(CommandResult {
            protocol_version: 1,
            request_id,
            correlation_id: receipt.correlation_id,
            data,
        }),
        Err(_) => Err("STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string()),
    }
}

/// Atomic session creation: event + stream + receipt in one tx.
pub async fn create_session(
    ctx: &ApiContext,
    env: CommandEnvelope<CreateSessionPayload>,
) -> Result<CommandResult<SessionSummary>, String> {
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
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    let title_str = env
        .payload
        .title
        .as_deref()
        .unwrap_or("")
        .trim()
        .to_string();
    let request_fp = adham_event_log::request_fingerprint("create_session", 1, &title_str);
    let scope_fp = adham_event_log::scope_fingerprint(
        "create_session",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ws_id),
        Some(&proj_id),
        None,
    );

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let proj_stream = format!("project:{}", proj_id);
    let proj_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT workspace_id FROM events WHERE stream_id = ? AND stream_sequence = 1")
            .bind(&proj_stream)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    match proj_row {
        Some(row) => {
            let row_ws: Option<String> = row.get("workspace_id");
            if row_ws.as_deref() != Some(&ws_id.to_string()) {
                return Err(
                    "CONTEXT_MISMATCH: project does not belong to specified workspace".to_string(),
                );
            }
        }
        None => return Err("PROJECT_NOT_FOUND: project stream does not exist".to_string()),
    }

    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        let matches = receipt.command_type == "create_session"
            && receipt.command_version == 1
            && receipt.actor_id == ctx.actor_id.to_string()
            && receipt.scope_fingerprint == scope_fp
            && receipt.request_fingerprint == request_fp;
        tx.rollback()
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        if matches {
            return replay(env.request_id, receipt);
        }
        return Err(conflict_msg());
    }

    let session_id = SessionId::new_v7();
    let stream_id = format!("session:{}", session_id);
    let now = OffsetDateTime::now_utc();
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();
    let payload = SessionCreatedV1 {
        session_id: session_id.clone(),
        project_id: proj_id.clone(),
        title: env.payload.title.clone(),
    };
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let correlation_id = CorrelationId::new_v7();
    let req = AppendEventRequest {
        stream_id,
        stream_kind: "session".to_string(),
        expected_sequence: 0,
        event_type: "SessionCreated".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: ctx.installation_id.clone(),
            workspace_id: Some(ws_id),
            project_id: Some(proj_id.clone()),
            session_id: Some(session_id.clone()),
        },
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
    let append_res = match SqliteEventStore::append_event_tx(&mut tx, req).await {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.rollback().await;
            return Err(e.to_string());
        }
    };
    let summary = SessionSummary {
        session_id: session_id.to_string(),
        project_id: proj_id.to_string(),
        title: env.payload.title.clone(),
        created_at: created_at_iso,
    };
    let response_json = serde_json::to_vec(&summary).unwrap_or_default();
    if let Err(e) = SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "create_session",
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
        match ctx.store.check_receipt(&request_id).await {
            Ok(Some(receipt)) => {
                let matches = receipt.command_type == "create_session"
                    && receipt.request_fingerprint == request_fp
                    && receipt.scope_fingerprint == scope_fp;
                if matches {
                    return replay(env.request_id, receipt);
                }
                return Err(conflict_msg());
            }
            _ => return Err(format!("STORAGE_UNAVAILABLE: commit failed: {e}")),
        }
    }
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: summary,
    })
}
