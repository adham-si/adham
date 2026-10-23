//! Delete a session by tombstone and purge its mutable rows. Event metadata and
//! receipts remain; exported Markdown is deliberately untouched.
use crate::dtos::{CommandEnvelope, CommandResult, DeleteSessionPayload, DeleteSessionResponse};
use crate::handlers::ApiContext;
use crate::service::common::{
    conflict_msg, ensure_no_live_operation_tx, ensure_session_active_tx, lock_session_stream_tx,
};
use crate::service::history::actions::{parse_scope, receipt_matches};
use crate::service::history::duplicate::ensure_source_scope_tx;
use adham_core_types::history::{EVENT_TYPE_SESSION_DELETED, SessionDeletedV1};
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use std::collections::HashSet;

fn parse_response(
    receipt: &adham_event_log::CommandReceiptRecord,
) -> Result<DeleteSessionResponse, String> {
    serde_json::from_slice(&receipt.response_json)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string())
}

pub async fn delete_session(
    ctx: &ApiContext,
    env: CommandEnvelope<DeleteSessionPayload>,
) -> Result<CommandResult<DeleteSessionResponse>, String> {
    if !env.payload.confirm {
        return Err("VALIDATION_FAILED:confirm_required".to_string());
    }

    let (ws_id, proj_id, sess_id, request_id) = parse_scope(&env.context, &env.request_id)?;
    let command_type = "delete_session";
    let request_fp = adham_event_log::request_fingerprint(command_type, 1, "confirm=true");
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

    // A delete receipt replays even after its own tombstone exists.
    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        if receipt_matches(&receipt, ctx, command_type, &scope_fp, &request_fp) {
            let data = parse_response(&receipt)?;
            let correlation_id = receipt.correlation_id.clone();
            tx.rollback()
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
            return Ok(CommandResult {
                protocol_version: 1,
                request_id: env.request_id,
                correlation_id,
                data,
            });
        }
        let _ = tx.rollback().await;
        return Err(conflict_msg());
    }

    ensure_session_active_tx(&mut tx, &session_id).await?;
    if let Err(e) = ensure_source_scope_tx(&mut tx, &session_id, &ws_id, &proj_id).await {
        let _ = tx.rollback().await;
        return Err(e);
    }
    ensure_no_live_operation_tx(&mut tx, &session_id).await?;

    let create_request_id: Option<String> = sqlx::query_scalar(
        "SELECT request_id FROM events WHERE stream_id = ? AND event_type IN ('SessionCreated', 'session/created') ORDER BY global_position ASC LIMIT 1",
    )
    .bind(&stream_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let current_seq: i64 =
        sqlx::query_scalar("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&stream_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let correlation_id = CorrelationId::new_v7();
    let payload_json = serde_json::to_vec(&SessionDeletedV1 {}).map_err(|e| e.to_string())?;
    let append_res = SqliteEventStore::append_event_tx(
        &mut tx,
        AppendEventRequest {
            stream_id: stream_id.clone(),
            stream_kind: "session".to_string(),
            expected_sequence: current_seq as u64,
            event_type: EVENT_TYPE_SESSION_DELETED.to_string(),
            event_version: 1,
            scope,
            actor: EventActor {
                actor_id: ctx.actor_id,
                kind: ActorKind::LocalHuman,
            },
            request_id,
            correlation_id,
            causation_id: None,
            payload_json,
            metadata_json: b"{}".to_vec(),
        },
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut content_ids: HashSet<String> = sqlx::query_scalar::<_, String>(
        "SELECT content_id FROM content_records WHERE session_id = ?",
    )
    .bind(&session_id)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    .into_iter()
    .collect();
    content_ids.extend(
        SqliteEventStore::purge_pending_operations_tx(
            &mut tx,
            &session_id,
            create_request_id.as_deref(),
        )
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?,
    );

    for id in content_ids {
        let content_id = ContentId::from_string(&id)
            .map_err(|_| "STORAGE_REPAIR_REQUIRED: invalid content id".to_string())?;
        SqliteEventStore::erase_content_tx(&mut tx, &content_id, "session_deleted")
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    }

    SqliteEventStore::delete_session_attachments_tx(&mut tx, &sess_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    for table in [
        "conversation_messages",
        "answer_feedback",
        "branch_selections",
        "message_bookmarks",
    ] {
        sqlx::query(&format!("DELETE FROM {table} WHERE session_id = ?"))
            .bind(&session_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    }

    let data = DeleteSessionResponse {
        session_id,
        deleted: true,
    };
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
                    request_id: env.request_id,
                    correlation_id: receipt.correlation_id.clone(),
                    data: parse_response(&receipt)?,
                });
            }
            Ok(Some(_)) => return Err(conflict_msg()),
            _ => return Err(format!("STORAGE_UNAVAILABLE: commit failed: {e}")),
        }
    }

    let _ = sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
        .execute(&ctx.pool)
        .await;

    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data,
    })
}
