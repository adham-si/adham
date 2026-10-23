//! Bounded session-history reads. The event log is the source of truth; this
//! module folds it, derives effective summaries, and returns list metadata.
use crate::dtos::{ListSessionsOptions, SessionList, SessionMetadata, SessionSummary};
use crate::handlers::ApiContext;
use adham_core_types::history::*;
use adham_core_types::*;
use adham_event_log::{ContentKeyProvider, SqliteEventStore};
use sqlx::{Row, Sqlite, Transaction};
use std::collections::HashMap;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use super::key_cache::CachedContentKeyProvider;

const LIST_LIMIT: usize = 100;

#[derive(Debug, Clone)]
pub(crate) struct HistoryRow {
    pub session_id: SessionId,
    pub project_id: ProjectId,
    pub workspace_id: Option<WorkspaceId>,
    pub title: Option<String>,
    pub created_at_us: i64,
    pub last_activity_us: i64,
    pub has_messages: bool,
    pub pinned: bool,
    pub archived: bool,
    pub summary_content_id: Option<ContentId>,
    pub summary: Option<String>,
    pub summary_origin: Option<String>,
    pub summary_unavailable: bool,
}

#[derive(Debug, Clone)]
struct MessagePart {
    message_id: String,
    content_id: ContentId,
}

fn storage_unavailable<E: std::fmt::Display>(e: E) -> String {
    format!("STORAGE_UNAVAILABLE: {e}")
}

fn occurred_iso(occurred_at_us: i64) -> String {
    let dt = OffsetDateTime::from_unix_timestamp_nanos((occurred_at_us * 1_000) as i128)
        .unwrap_or_else(|_| OffsetDateTime::now_utc());
    dt.format(&Rfc3339).unwrap_or_default()
}

fn clip_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn normalized(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub async fn list_sessions(
    ctx: &ApiContext,
    project_id: &str,
    workspace_id: Option<&str>,
    options: &ListSessionsOptions,
) -> Result<SessionList, String> {
    let proj_id = ProjectId::from_string(project_id)
        .map_err(|_| "VALIDATION_FAILED: project_id must be UUID".to_string())?;
    let proj_stream = format!("project:{proj_id}");
    let proj_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT workspace_id FROM events WHERE stream_id = ? AND stream_sequence = 1")
            .bind(&proj_stream)
            .fetch_optional(&ctx.pool)
            .await
            .map_err(storage_unavailable)?;
    let row = match proj_row {
        Some(row) => row,
        None => return Err("PROJECT_NOT_FOUND: project stream does not exist".to_string()),
    };
    if let Some(expected_ws) = workspace_id {
        let actual_ws: Option<String> = row.get("workspace_id");
        if actual_ws.as_deref() != Some(expected_ws) {
            return Err(
                "CONTEXT_MISMATCH: project does not belong to specified workspace".to_string(),
            );
        }
    }

    let (rows, truncated, unreadable_summaries) =
        load_history_rows(ctx, project_id, options).await?;
    Ok(SessionList {
        project_id: proj_id.to_string(),
        sessions: rows.into_iter().map(summary_from_row).collect(),
        truncated,
        unreadable_summaries,
    })
}

pub(crate) async fn load_history_rows(
    ctx: &ApiContext,
    project_id: &str,
    options: &ListSessionsOptions,
) -> Result<(Vec<HistoryRow>, bool, u32), String> {
    let proj_id = ProjectId::from_string(project_id)
        .map_err(|_| "VALIDATION_FAILED: project_id must be UUID".to_string())?;
    let mut tx = ctx.pool.begin().await.map_err(storage_unavailable)?;
    let (rows, activity) = read_fold_and_activity_tx(&mut tx, &proj_id).await?;

    let active_id = options
        .active_session_id
        .as_deref()
        .and_then(|value| SessionId::from_string(value).ok())
        .filter(|id| rows.iter().any(|row| row.session_id == *id));

    let mut eligible: Vec<HistoryRow> = rows
        .into_iter()
        .filter(|row| {
            options.include_archived
                || !row.archived
                || active_id.is_some_and(|id| id == row.session_id)
        })
        .map(|mut row| {
            if let Some(last) = activity.get(&row.session_id.to_string()) {
                row.has_messages = true;
                row.last_activity_us = row.last_activity_us.max(*last);
            }
            row
        })
        .collect();

    eligible.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.last_activity_us.cmp(&a.last_activity_us))
            .then_with(|| b.created_at_us.cmp(&a.created_at_us))
            .then_with(|| a.session_id.to_string().cmp(&b.session_id.to_string()))
    });

    let mut truncated = eligible.len() > LIST_LIMIT;
    let active_row =
        active_id.and_then(|id| eligible.iter().find(|row| row.session_id == id).cloned());
    let mut selected: Vec<HistoryRow> = eligible.into_iter().take(LIST_LIMIT).collect();
    if let Some(active) = active_row {
        if !selected
            .iter()
            .any(|row| row.session_id == active.session_id)
        {
            if selected.len() == LIST_LIMIT {
                selected.pop();
            }
            selected.push(active);
            truncated = true;
        }
    }

    let provider = CachedContentKeyProvider::new(std::sync::Arc::clone(&ctx.content_key));
    let unreadable =
        hydrate_summaries_tx(&mut tx, &provider, &ctx.installation_id, &mut selected).await?;
    tx.commit().await.map_err(storage_unavailable)?;
    Ok((selected, truncated, unreadable))
}

#[allow(dead_code)]
pub(crate) async fn load_all_history_rows(
    ctx: &ApiContext,
    project_id: &str,
) -> Result<(Vec<HistoryRow>, u32), String> {
    let proj_id = ProjectId::from_string(project_id)
        .map_err(|_| "VALIDATION_FAILED: project_id must be UUID".to_string())?;
    let mut tx = ctx.pool.begin().await.map_err(storage_unavailable)?;
    let provider = CachedContentKeyProvider::new(std::sync::Arc::clone(&ctx.content_key));
    let rows = load_all_history_rows_tx(&mut tx, &provider, &ctx.installation_id, &proj_id).await?;
    tx.commit().await.map_err(storage_unavailable)?;
    Ok(rows)
}

/// Fold all sessions and hydrate their summaries inside an existing read
/// transaction, so search can reuse one cached content key.
pub(crate) async fn load_all_history_rows_tx(
    tx: &mut Transaction<'_, Sqlite>,
    provider: &dyn ContentKeyProvider,
    installation_id: &InstallationId,
    project_id: &ProjectId,
) -> Result<(Vec<HistoryRow>, u32), String> {
    let (rows, activity) = read_fold_and_activity_tx(tx, project_id).await?;
    let mut rows: Vec<HistoryRow> = rows
        .into_iter()
        .map(|mut row| {
            if let Some(last) = activity.get(&row.session_id.to_string()) {
                row.has_messages = true;
                row.last_activity_us = row.last_activity_us.max(*last);
            }
            row
        })
        .collect();
    let unreadable = hydrate_summaries_tx(tx, provider, installation_id, &mut rows).await?;
    Ok((rows, unreadable))
}

/// Read one session's metadata in the caller's transaction. Actions use this
/// so their receipt response matches the next list read.
#[allow(dead_code)]
pub(crate) async fn read_session_metadata_tx(
    tx: &mut Transaction<'_, Sqlite>,
    provider: &dyn ContentKeyProvider,
    installation_id: &InstallationId,
    session_id: &SessionId,
) -> Result<SessionMetadata, String> {
    let stream_id = format!("session:{session_id}");
    let events = sqlx::query(
        "SELECT stream_id, event_type, payload_json, occurred_at_us, workspace_id
         FROM events WHERE stream_id = ? ORDER BY global_position ASC",
    )
    .bind(&stream_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(storage_unavailable)?;
    let mut rows = fold_events(events)?;
    let mut row = rows
        .pop()
        .ok_or("SESSION_NOT_FOUND: session stream does not exist".to_string())?;

    let last: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(created_at_us) FROM conversation_messages WHERE session_id = ?",
    )
    .bind(session_id.to_string())
    .fetch_one(&mut **tx)
    .await
    .map_err(storage_unavailable)?;
    if let Some(last) = last {
        row.has_messages = true;
        row.last_activity_us = row.last_activity_us.max(last);
    }
    let mut one = vec![row];
    hydrate_summaries_tx(tx, provider, installation_id, &mut one).await?;
    let row = one.pop().expect("one row");
    Ok(SessionMetadata {
        session_id: row.session_id.to_string(),
        project_id: row.project_id.to_string(),
        title: row.title,
        summary_origin: row.summary_origin,
        pinned: row.pinned,
        archived: row.archived,
        created_at: occurred_iso(row.created_at_us),
        last_activity_at: occurred_iso(row.last_activity_us),
    })
}

async fn read_fold_and_activity_tx(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &ProjectId,
) -> Result<(Vec<HistoryRow>, HashMap<String, i64>), String> {
    let events = sqlx::query(
        "SELECT stream_id, event_type, payload_json, occurred_at_us, workspace_id
         FROM events WHERE project_id = ? AND event_type IN
         ('SessionCreated', 'SessionRenamed', 'SessionPinChanged',
          'SessionArchiveChanged', 'SessionSummaryUpdated', 'SessionDeleted')
         ORDER BY global_position ASC",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut **tx)
    .await
    .map_err(storage_unavailable)?;
    let rows = fold_events(events)?;

    let activity_rows = sqlx::query(
        "SELECT session_id, MAX(created_at_us) AS last_us
         FROM conversation_messages WHERE project_id = ? GROUP BY session_id",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut **tx)
    .await
    .map_err(storage_unavailable)?;
    let mut activity = HashMap::new();
    for row in activity_rows {
        activity.insert(
            row.get::<String, _>("session_id"),
            row.get::<i64, _>("last_us"),
        );
    }
    Ok((rows, activity))
}

fn fold_events(events: Vec<sqlx::sqlite::SqliteRow>) -> Result<Vec<HistoryRow>, String> {
    let mut by_id: HashMap<SessionId, HistoryRow> = HashMap::new();
    for event in events {
        let event_type: String = event.get("event_type");
        let payload: Vec<u8> = event.get("payload_json");
        let occurred_at_us: i64 = event.get("occurred_at_us");
        let stream_id: String = event.get("stream_id");
        let stream_session = stream_id
            .strip_prefix("session:")
            .and_then(|value| SessionId::from_string(value).ok());

        match event_type.as_str() {
            EVENT_TYPE_SESSION_CREATED | "SessionCreated" => {
                let created: SessionCreatedV1 = serde_json::from_slice(&payload).map_err(|_| {
                    "STORAGE_REPAIR_REQUIRED: session record unparseable".to_string()
                })?;
                let workspace_id = event
                    .get::<Option<String>, _>("workspace_id")
                    .and_then(|value| WorkspaceId::from_string(&value).ok());
                by_id.insert(
                    created.session_id,
                    HistoryRow {
                        session_id: created.session_id,
                        project_id: created.project_id,
                        workspace_id,
                        title: created.title,
                        created_at_us: occurred_at_us,
                        last_activity_us: occurred_at_us,
                        has_messages: false,
                        pinned: false,
                        archived: false,
                        summary_content_id: None,
                        summary: None,
                        summary_origin: None,
                        summary_unavailable: false,
                    },
                );
            }
            EVENT_TYPE_SESSION_RENAMED => {
                let update: SessionRenamedV1 = serde_json::from_slice(&payload).map_err(|_| {
                    "STORAGE_REPAIR_REQUIRED: session history unparseable".to_string()
                })?;
                if let Some(id) = stream_session {
                    if let Some(row) = by_id.get_mut(&id) {
                        row.title = Some(update.title);
                    }
                }
            }
            EVENT_TYPE_SESSION_PIN_CHANGED => {
                let update: SessionPinChangedV1 =
                    serde_json::from_slice(&payload).map_err(|_| {
                        "STORAGE_REPAIR_REQUIRED: session history unparseable".to_string()
                    })?;
                if let Some(id) = stream_session {
                    if let Some(row) = by_id.get_mut(&id) {
                        row.pinned = update.pinned;
                    }
                }
            }
            EVENT_TYPE_SESSION_ARCHIVE_CHANGED => {
                let update: SessionArchiveChangedV1 =
                    serde_json::from_slice(&payload).map_err(|_| {
                        "STORAGE_REPAIR_REQUIRED: session history unparseable".to_string()
                    })?;
                if let Some(id) = stream_session {
                    if let Some(row) = by_id.get_mut(&id) {
                        row.archived = update.archived;
                    }
                }
            }
            EVENT_TYPE_SESSION_SUMMARY_UPDATED => {
                let update: SessionSummaryUpdatedV1 =
                    serde_json::from_slice(&payload).map_err(|_| {
                        "STORAGE_REPAIR_REQUIRED: session history unparseable".to_string()
                    })?;
                if let Some(id) = stream_session {
                    if let Some(row) = by_id.get_mut(&id) {
                        row.summary_content_id = update.content_id;
                    }
                }
            }
            EVENT_TYPE_SESSION_DELETED => {
                if let Some(id) = stream_session {
                    by_id.remove(&id);
                }
            }
            _ => {}
        }
    }
    Ok(by_id.into_values().collect())
}

async fn hydrate_summaries_tx(
    tx: &mut Transaction<'_, Sqlite>,
    provider: &dyn ContentKeyProvider,
    installation_id: &InstallationId,
    rows: &mut [HistoryRow],
) -> Result<u32, String> {
    if rows.is_empty() {
        return Ok(0);
    }
    let parts = load_message_parts_tx(tx, rows).await?;
    let mut unreadable = 0;
    for row in rows.iter_mut() {
        row.summary = None;
        row.summary_origin = None;
        row.summary_unavailable = false;
        if !row.has_messages {
            continue;
        }
        let scope = EventScope {
            installation_id: *installation_id,
            workspace_id: row.workspace_id,
            project_id: Some(row.project_id),
            session_id: Some(row.session_id),
        };

        if let Some(content_id) = row.summary_content_id {
            if let Ok(text) = read_text_tx(tx, provider, &content_id, &scope).await {
                let text = normalized(&text);
                if !text.is_empty() {
                    row.summary = Some(text);
                    row.summary_origin = Some("user".to_string());
                    continue;
                }
            }
        }

        let (user_part, assistant_part) = parts
            .get(&row.session_id.to_string())
            .cloned()
            .unwrap_or((None, None));
        let mut any_readable = false;
        let mut user_text = None;
        if let Some(part) = user_part {
            if let Ok(text) = read_text_tx(tx, provider, &part.content_id, &scope).await {
                any_readable = true;
                let text = normalized(&text);
                if text.is_empty() {
                    let names = attachment_names_tx(tx, &part.message_id).await?;
                    if !names.is_empty() {
                        user_text = Some(clip_chars(&names.join(", "), 120));
                    }
                } else {
                    user_text = Some(clip_chars(&text, 120));
                }
            }
        }
        let mut assistant_text = None;
        if let Some(part) = assistant_part {
            if let Ok(text) = read_text_tx(tx, provider, &part.content_id, &scope).await {
                any_readable = true;
                let text = normalized(&text);
                if !text.is_empty() {
                    assistant_text = Some(clip_chars(&text, 140));
                }
            }
        }

        match (user_text, assistant_text) {
            (None, None) => {
                if !any_readable {
                    row.summary_unavailable = true;
                    unreadable += 1;
                }
            }
            (Some(user), None) => {
                row.summary = Some(user);
                row.summary_origin = Some("auto".to_string());
            }
            (None, Some(assistant)) => {
                row.summary = Some(assistant);
                row.summary_origin = Some("auto".to_string());
            }
            (Some(user), Some(assistant)) => {
                row.summary = Some(clip_chars(&format!("{user} — {assistant}"), 240));
                row.summary_origin = Some("auto".to_string());
            }
        }
    }
    Ok(unreadable)
}

async fn load_message_parts_tx(
    tx: &mut Transaction<'_, Sqlite>,
    rows: &[HistoryRow],
) -> Result<HashMap<String, (Option<MessagePart>, Option<MessagePart>)>, String> {
    if rows.is_empty() {
        return Ok(HashMap::new());
    }
    let placeholders = std::iter::repeat_n("?", rows.len())
        .collect::<Vec<_>>()
        .join(",");
    let sql = format!(
        "SELECT cm.session_id, cm.message_id, cm.role, cm.content_id
         FROM conversation_messages cm
         WHERE cm.session_id IN ({placeholders})
           AND (
             (cm.role = 'user' AND cm.source_global_position = (
               SELECT MIN(cm2.source_global_position) FROM conversation_messages cm2
               WHERE cm2.session_id = cm.session_id AND cm2.role = 'user'))
             OR
             (cm.role = 'assistant' AND cm.source_global_position = (
               SELECT MAX(cm3.source_global_position) FROM conversation_messages cm3
               WHERE cm3.session_id = cm.session_id AND cm3.role = 'assistant'))
           )"
    );
    let mut query = sqlx::query(&sql);
    for row in rows {
        query = query.bind(row.session_id.to_string());
    }
    let message_rows = query
        .fetch_all(&mut **tx)
        .await
        .map_err(storage_unavailable)?;
    let mut parts: HashMap<String, (Option<MessagePart>, Option<MessagePart>)> = HashMap::new();
    for row in message_rows {
        let session_id: String = row.get("session_id");
        let content_id = match ContentId::from_string(&row.get::<String, _>("content_id")) {
            Ok(id) => id,
            Err(_) => continue,
        };
        let part = MessagePart {
            message_id: row.get("message_id"),
            content_id,
        };
        let entry = parts.entry(session_id).or_insert((None, None));
        match row.get::<String, _>("role").as_str() {
            "user" => entry.0 = Some(part),
            "assistant" => entry.1 = Some(part),
            _ => {}
        }
    }
    Ok(parts)
}

pub(crate) async fn read_text_tx(
    tx: &mut Transaction<'_, Sqlite>,
    provider: &dyn ContentKeyProvider,
    content_id: &ContentId,
    scope: &EventScope,
) -> Result<String, ()> {
    match SqliteEventStore::get_content_tx(tx, provider, content_id, scope).await {
        Ok(Some(bytes)) => String::from_utf8(bytes).map_err(|_| ()),
        _ => Err(()),
    }
}

async fn attachment_names_tx(
    tx: &mut Transaction<'_, Sqlite>,
    message_id: &str,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar(
        "SELECT ar.file_name FROM message_attachments ma
         JOIN attachment_records ar ON ar.attachment_id = ma.attachment_id
         WHERE ma.message_id = ? ORDER BY ma.position ASC",
    )
    .bind(message_id)
    .fetch_all(&mut **tx)
    .await
    .map_err(storage_unavailable)
}

fn summary_from_row(row: HistoryRow) -> SessionSummary {
    SessionSummary {
        session_id: row.session_id.to_string(),
        project_id: row.project_id.to_string(),
        title: row.title,
        created_at: occurred_iso(row.created_at_us),
        summary: row.summary,
        summary_origin: row.summary_origin,
        summary_unavailable: row.summary_unavailable,
        pinned: row.pinned,
        archived: row.archived,
        last_activity_at: occurred_iso(row.last_activity_us),
    }
}
