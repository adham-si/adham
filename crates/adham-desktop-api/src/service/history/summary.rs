//! User summaries are sealed content referenced by one event. Replacing or
//! clearing one erases the previous content in the same transaction.
use crate::dtos::{CommandEnvelope, CommandResult, SessionMetadata, SetSessionSummaryPayload};
use crate::handlers::ApiContext;
use crate::service::common::{conflict_msg, ensure_session_active_tx, lock_session_stream_tx};
use crate::service::history::actions::{parse_metadata, parse_scope, receipt_matches};
use crate::service::history::key_cache::CachedContentKeyProvider;
use crate::service::history::list::read_session_metadata_tx;
use adham_core_types::history::*;
use adham_core_types::*;
use adham_event_log::SqliteEventStore;
use std::sync::Arc;

const MAX_SUMMARY_SCALARS: usize = 500;
const SUMMARY_KIND: &str = "session_summary";

fn normalize_summary(summary: Option<&str>) -> Result<Option<String>, String> {
    let trimmed = summary.map(str::trim).filter(|text| !text.is_empty());
    if let Some(text) = trimmed {
        if text.chars().count() > MAX_SUMMARY_SCALARS {
            return Err("VALIDATION_FAILED:summary_too_long".to_string());
        }
        return Ok(Some(text.to_string()));
    }
    Ok(None)
}

async fn current_summary_content_id_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    stream_id: &str,
) -> Result<Option<ContentId>, String> {
    let payload: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT payload_json FROM events WHERE stream_id = ? AND event_type = ? ORDER BY global_position DESC LIMIT 1",
    )
    .bind(stream_id)
    .bind(EVENT_TYPE_SESSION_SUMMARY_UPDATED)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    match payload {
        None => Ok(None),
        Some(bytes) => {
            let update: SessionSummaryUpdatedV1 = serde_json::from_slice(&bytes)
                .map_err(|_| "STORAGE_REPAIR_REQUIRED: summary event unparseable".to_string())?;
            Ok(update.content_id)
        }
    }
}

pub async fn set_session_summary(
    ctx: &ApiContext,
    env: CommandEnvelope<SetSessionSummaryPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    let summary = normalize_summary(env.payload.summary.as_deref())?;
    let (ws_id, proj_id, sess_id, request_id) = parse_scope(&env.context, &env.request_id)?;
    let command_type = "set_session_summary";
    let request_input = serde_json::to_string(&summary).map_err(|e| e.to_string())?;
    let request_fp = adham_event_log::request_fingerprint(command_type, 1, &request_input);
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
                request_id: env.request_id,
                correlation_id,
                data,
            });
        }
        let _ = tx.rollback().await;
        return Err(conflict_msg());
    }

    let previous_id = current_summary_content_id_tx(&mut tx, &stream_id).await?;
    let provider = CachedContentKeyProvider::new(Arc::clone(&ctx.content_key));
    let new_id = match summary.as_deref() {
        Some(text) => {
            let id = ContentId::new_v7();
            SqliteEventStore::put_content_tx(
                &mut tx,
                &provider,
                &id,
                SUMMARY_KIND,
                "text/plain; charset=utf-8",
                &scope,
                text.as_bytes(),
            )
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
            Some(id)
        }
        None => None,
    };

    let current_seq: i64 =
        sqlx::query_scalar("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&stream_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let correlation_id = CorrelationId::new_v7();
    let payload_json = serde_json::to_vec(&SessionSummaryUpdatedV1 { content_id: new_id })
        .map_err(|e| e.to_string())?;
    let append_res = SqliteEventStore::append_event_tx(
        &mut tx,
        adham_event_log::AppendEventRequest {
            stream_id,
            stream_kind: "session".to_string(),
            expected_sequence: current_seq as u64,
            event_type: EVENT_TYPE_SESSION_SUMMARY_UPDATED.to_string(),
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

    if let Some(old_id) = previous_id {
        SqliteEventStore::erase_content_tx(&mut tx, &old_id, "session_summary_replaced")
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    }

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
                    request_id: env.request_id,
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
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data,
    })
}
