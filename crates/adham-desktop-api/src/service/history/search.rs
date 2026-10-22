//! Bounded, decrypt-on-read session search. No index, no plaintext at rest.
use crate::dtos::{
    CommandContext, SessionSearchRequest, SessionSearchResponse, SessionSearchResult,
};
use crate::handlers::ApiContext;
use crate::service::history::key_cache::CachedContentKeyProvider;
use crate::service::history::list::{HistoryRow, load_all_history_rows_tx, read_text_tx};
use adham_core_types::*;
use sqlx::{Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

const SEARCH_SESSION_LIMIT: usize = 100;
const SEARCH_RESULT_LIMIT: usize = 50;
const SEARCH_MESSAGE_LIMIT: usize = 10_000;

#[derive(Debug, Clone)]
struct BookmarkRow {
    message_id: String,
    role: String,
    position: i64,
}

#[derive(Debug)]
struct Hit {
    result: SessionSearchResult,
    activity: i64,
    position: i64,
}

fn storage_unavailable<E: std::fmt::Display>(e: E) -> String {
    format!("STORAGE_UNAVAILABLE: {e}")
}

fn occurred_iso(occurred_at_us: i64) -> String {
    let dt = OffsetDateTime::from_unix_timestamp_nanos((occurred_at_us * 1_000) as i128)
        .unwrap_or_else(|_| OffsetDateTime::now_utc());
    dt.format(&Rfc3339).unwrap_or_default()
}

fn placeholders(n: usize) -> String {
    std::iter::repeat_n("?", n).collect::<Vec<_>>().join(",")
}

fn parse_date(value: &str) -> Result<i64, String> {
    OffsetDateTime::parse(value, &Rfc3339)
        .map(|dt| (dt.unix_timestamp_nanos() / 1_000) as i64)
        .map_err(|_| "VALIDATION_FAILED:date_range".to_string())
}

fn lower_contains(haystack: &str, needle_lower: &str) -> bool {
    haystack.to_lowercase().contains(needle_lower)
}

/// Map a byte offset in `text.to_lowercase()` back to an original char index.
/// Lowercasing can expand some characters; the containing char is enough for a
/// snippet window.
fn match_char_index(text: &str, needle_lower: &str) -> Option<usize> {
    let lower = text.to_lowercase();
    let position = lower.find(needle_lower)?;
    let mut lower_bytes = 0usize;
    for (index, ch) in text.chars().enumerate() {
        if lower_bytes >= position {
            return Some(index);
        }
        lower_bytes += ch.to_lowercase().map(char::len_utf8).sum::<usize>();
    }
    Some(text.chars().count())
}

fn snippet_around(text: &str, match_char: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    let total = chars.len();
    let mut begin = match_char.saturating_sub(60);
    let end = (begin + 180).min(total);
    if end - begin < 180 {
        begin = end.saturating_sub(180);
    }
    let prefix = begin > 0;
    let suffix = end < total;
    let budget = 180usize
        .saturating_sub(usize::from(prefix))
        .saturating_sub(usize::from(suffix));
    let body: String = chars[begin..end].iter().take(budget).collect();
    let mut out = String::new();
    if prefix {
        out.push('…');
    }
    out.push_str(&body);
    if suffix {
        out.push('…');
    }
    out
}

fn matching_text(text: &str, needle_lower: &str) -> Option<String> {
    match_char_index(text, needle_lower).map(|index| snippet_around(text, index))
}

fn result_for(
    row: &HistoryRow,
    match_kind: &str,
    message_id: Option<String>,
    role: Option<String>,
    snippet: Option<String>,
    attachment_name: Option<String>,
) -> SessionSearchResult {
    SessionSearchResult {
        session_id: row.session_id.to_string(),
        title: row.title.clone(),
        summary: row.summary.clone(),
        summary_origin: row.summary_origin.clone(),
        last_activity_at: occurred_iso(row.last_activity_us),
        match_kind: match_kind.to_string(),
        message_id,
        role,
        snippet,
        attachment_name,
    }
}

async fn load_bookmarks_tx(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &ProjectId,
) -> Result<HashMap<String, Vec<BookmarkRow>>, String> {
    let rows = sqlx::query(
        "SELECT b.session_id, b.message_id, cm.role, cm.source_global_position
         FROM message_bookmarks b
         JOIN conversation_messages cm
           ON cm.session_id = b.session_id AND cm.message_id = b.message_id
         WHERE cm.project_id = ?
         ORDER BY cm.source_global_position ASC",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut **tx)
    .await
    .map_err(storage_unavailable)?;
    let mut by_session: HashMap<String, Vec<BookmarkRow>> = HashMap::new();
    for row in rows {
        by_session
            .entry(row.get::<String, _>("session_id"))
            .or_default()
            .push(BookmarkRow {
                message_id: row.get("message_id"),
                role: row.get("role"),
                position: row.get("source_global_position"),
            });
    }
    Ok(by_session)
}

async fn load_attachment_sessions_tx(
    tx: &mut Transaction<'_, Sqlite>,
    project_id: &ProjectId,
) -> Result<HashSet<String>, String> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT cm.session_id
         FROM message_attachments ma
         JOIN conversation_messages cm ON cm.message_id = ma.message_id
         JOIN attachment_records ar ON ar.attachment_id = ma.attachment_id
         WHERE cm.project_id = ?",
    )
    .bind(project_id.to_string())
    .fetch_all(&mut **tx)
    .await
    .map_err(storage_unavailable)?;
    Ok(rows.into_iter().collect())
}

fn session_scope(row: &HistoryRow, installation_id: InstallationId) -> EventScope {
    EventScope {
        installation_id,
        workspace_id: row.workspace_id,
        project_id: Some(row.project_id),
        session_id: Some(row.session_id),
    }
}

fn sort_and_cap(mut hits: Vec<Hit>) -> (Vec<SessionSearchResult>, bool) {
    hits.sort_by(|a, b| {
        b.activity
            .cmp(&a.activity)
            .then_with(|| a.position.cmp(&b.position))
    });
    let truncated = hits.len() > SEARCH_RESULT_LIMIT;
    let results = hits
        .into_iter()
        .take(SEARCH_RESULT_LIMIT)
        .map(|hit| hit.result)
        .collect();
    (results, truncated)
}

pub async fn search_history(
    ctx: &ApiContext,
    context: &CommandContext,
    request: SessionSearchRequest,
) -> Result<SessionSearchResponse, String> {
    let workspace_id = context
        .workspace_id
        .as_deref()
        .ok_or("workspaceId context required")?;
    let project_id = context
        .project_id
        .as_deref()
        .ok_or("projectId context required")?;
    let ws_id = WorkspaceId::from_string(workspace_id).map_err(|e| e.to_string())?;
    let proj_id = ProjectId::from_string(project_id)
        .map_err(|_| "VALIDATION_FAILED: project_id must be UUID".to_string())?;
    let filters = request.filters;
    let query = request.query.trim().to_string();

    let role = match filters.role.as_deref() {
        None => None,
        Some("user") => Some("user"),
        Some("assistant") => Some("assistant"),
        Some(_) => return Err("VALIDATION_FAILED:role".to_string()),
    };
    let filter_without_query = filters.pinned_only
        || filters.bookmarked_only
        || filters.has_attachments
        || filters.from.is_some()
        || filters.to.is_some();
    if query.is_empty() {
        if role.is_some() {
            return Err("VALIDATION_FAILED:role_requires_query".to_string());
        }
        if !filter_without_query {
            return Err("VALIDATION_FAILED:empty_query".to_string());
        }
    } else if query.chars().filter(|c| !c.is_whitespace()).count() < 2 {
        return Err("VALIDATION_FAILED:query_too_short".to_string());
    }
    let from_us = filters.from.as_deref().map(parse_date).transpose()?;
    let to_us = filters.to.as_deref().map(parse_date).transpose()?;
    if let (Some(from), Some(to)) = (from_us, to_us) {
        if from > to {
            return Err("VALIDATION_FAILED:date_range".to_string());
        }
    }

    let mut tx = ctx.pool.begin().await.map_err(storage_unavailable)?;
    let proj_stream = format!("project:{proj_id}");
    let proj_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT workspace_id FROM events WHERE stream_id = ? AND stream_sequence = 1")
            .bind(&proj_stream)
            .fetch_optional(&mut *tx)
            .await
            .map_err(storage_unavailable)?;
    let proj_row =
        proj_row.ok_or("PROJECT_NOT_FOUND: project stream does not exist".to_string())?;
    if proj_row.get::<Option<String>, _>("workspace_id").as_deref()
        != Some(ws_id.to_string().as_str())
    {
        return Err("CONTEXT_MISMATCH: project does not belong to specified workspace".to_string());
    }

    let provider = CachedContentKeyProvider::new(Arc::clone(&ctx.content_key));
    let (rows, summary_unreadable) =
        load_all_history_rows_tx(&mut tx, &provider, &ctx.installation_id, &proj_id).await?;
    let mut skipped_unreadable = summary_unreadable;
    let bookmarks = load_bookmarks_tx(&mut tx, &proj_id).await?;
    let attachment_sessions = load_attachment_sessions_tx(&mut tx, &proj_id).await?;

    let mut candidates: Vec<HistoryRow> = rows
        .into_iter()
        .filter(|row| {
            (filters.include_archived || !row.archived)
                && (!filters.pinned_only || row.pinned)
                && (!filters.bookmarked_only || bookmarks.contains_key(&row.session_id.to_string()))
                && (!filters.has_attachments
                    || attachment_sessions.contains(&row.session_id.to_string()))
                && from_us.is_none_or(|from| row.last_activity_us >= from)
                && to_us.is_none_or(|to| row.last_activity_us <= to)
        })
        .collect();
    candidates.sort_by(|a, b| {
        b.last_activity_us
            .cmp(&a.last_activity_us)
            .then_with(|| a.session_id.to_string().cmp(&b.session_id.to_string()))
    });
    let candidates_truncated = candidates.len() > SEARCH_SESSION_LIMIT;
    candidates.truncate(SEARCH_SESSION_LIMIT);
    let scanned_sessions = candidates.len() as u32;
    let candidate_ids: HashSet<String> = candidates
        .iter()
        .map(|row| row.session_id.to_string())
        .collect();

    if query.is_empty() {
        let mut hits = Vec::new();
        if filters.bookmarked_only {
            for row in &candidates {
                if let Some(rows) = bookmarks.get(&row.session_id.to_string()) {
                    for bookmark in rows {
                        hits.push(Hit {
                            result: result_for(
                                row,
                                "bookmark",
                                Some(bookmark.message_id.clone()),
                                Some(bookmark.role.clone()),
                                None,
                                None,
                            ),
                            activity: row.last_activity_us,
                            position: bookmark.position,
                        });
                    }
                }
            }
        } else {
            for row in &candidates {
                hits.push(Hit {
                    result: result_for(row, "session", None, None, None, None),
                    activity: row.last_activity_us,
                    position: 0,
                });
            }
        }
        let (results, result_truncated) = sort_and_cap(hits);
        tx.commit().await.map_err(storage_unavailable)?;
        return Ok(SessionSearchResponse {
            results,
            truncated: candidates_truncated || result_truncated,
            scanned_sessions,
            scan_limit_reached: false,
            skipped_unreadable,
        });
    }

    let needle_lower = query.to_lowercase();
    let mut hits = Vec::new();
    if role.is_none() && !filters.bookmarked_only {
        for row in &candidates {
            if row
                .title
                .as_deref()
                .is_some_and(|title| lower_contains(title, &needle_lower))
            {
                hits.push(Hit {
                    result: result_for(row, "title", None, None, None, None),
                    activity: row.last_activity_us,
                    position: -2,
                });
            } else if row
                .summary
                .as_deref()
                .is_some_and(|summary| lower_contains(summary, &needle_lower))
            {
                hits.push(Hit {
                    result: result_for(row, "summary", None, None, None, None),
                    activity: row.last_activity_us,
                    position: -1,
                });
            }
        }
    }

    let session_scopes: HashMap<String, EventScope> = candidates
        .iter()
        .map(|row| {
            (
                row.session_id.to_string(),
                session_scope(row, ctx.installation_id),
            )
        })
        .collect();
    let bookmark_ids: HashSet<(String, String)> = bookmarks
        .iter()
        .flat_map(|(session, rows)| {
            rows.iter()
                .map(move |bookmark| (session.clone(), bookmark.message_id.clone()))
        })
        .collect();

    if !candidates.is_empty() {
        let ids = placeholders(candidates.len());
        let sql = format!(
            "SELECT session_id, message_id, role, content_id, source_global_position
             FROM conversation_messages
             WHERE project_id = ? AND session_id IN ({ids})
             ORDER BY source_global_position ASC LIMIT {}",
            SEARCH_MESSAGE_LIMIT + 1
        );
        let mut message_query = sqlx::query(&sql).bind(proj_id.to_string());
        for row in &candidates {
            message_query = message_query.bind(row.session_id.to_string());
        }
        let mut message_rows = message_query
            .fetch_all(&mut *tx)
            .await
            .map_err(storage_unavailable)?;
        let scan_limit_reached = message_rows.len() > SEARCH_MESSAGE_LIMIT;
        if scan_limit_reached {
            message_rows.truncate(SEARCH_MESSAGE_LIMIT);
        }
        for message in message_rows {
            let session_id: String = message.get("session_id");
            let message_id: String = message.get("message_id");
            let message_role: String = message.get("role");
            if role.is_some_and(|expected| expected != message_role) {
                continue;
            }
            if filters.bookmarked_only
                && !bookmark_ids.contains(&(session_id.clone(), message_id.clone()))
            {
                continue;
            }
            let content_id = match ContentId::from_string(&message.get::<String, _>("content_id")) {
                Ok(id) => id,
                Err(_) => {
                    skipped_unreadable += 1;
                    continue;
                }
            };
            let Some(scope) = session_scopes.get(&session_id) else {
                continue;
            };
            let text = match read_text_tx(&mut tx, &provider, &content_id, scope).await {
                Ok(text) => text,
                Err(()) => {
                    skipped_unreadable += 1;
                    continue;
                }
            };
            if !lower_contains(&text, &needle_lower) {
                continue;
            }
            let Some(row) = candidates
                .iter()
                .find(|row| row.session_id.to_string() == session_id)
            else {
                continue;
            };
            hits.push(Hit {
                result: result_for(
                    row,
                    "message",
                    Some(message_id),
                    Some(message_role),
                    matching_text(&text, &needle_lower),
                    None,
                ),
                activity: row.last_activity_us,
                position: message.get("source_global_position"),
            });
        }

        let attach_sql = format!(
            "SELECT ar.session_id, ar.file_name, ar.content_id,
                    cm.message_id, cm.role, cm.source_global_position
             FROM attachment_records ar
             JOIN message_attachments ma ON ma.attachment_id = ar.attachment_id
             JOIN conversation_messages cm ON cm.message_id = ma.message_id
             WHERE ar.session_id IN ({ids})
               AND cm.source_global_position = (
                 SELECT MIN(cm2.source_global_position)
                 FROM message_attachments ma2
                 JOIN conversation_messages cm2 ON cm2.message_id = ma2.message_id
                 WHERE ma2.attachment_id = ar.attachment_id
                   AND cm2.session_id = ar.session_id
               )
             ORDER BY cm.source_global_position ASC",
        );
        let mut attach_query = sqlx::query(&attach_sql);
        for row in &candidates {
            attach_query = attach_query.bind(row.session_id.to_string());
        }
        let attachments = attach_query
            .fetch_all(&mut *tx)
            .await
            .map_err(storage_unavailable)?;
        for attachment in attachments {
            let session_id: String = attachment.get("session_id");
            if !candidate_ids.contains(&session_id) {
                continue;
            }
            let message_id: String = attachment.get("message_id");
            let message_role: String = attachment.get("role");
            if role.is_some_and(|expected| expected != message_role) {
                continue;
            }
            if filters.bookmarked_only
                && !bookmark_ids.contains(&(session_id.clone(), message_id.clone()))
            {
                continue;
            }
            let file_name: String = attachment.get("file_name");
            let content_id =
                match ContentId::from_string(&attachment.get::<String, _>("content_id")) {
                    Ok(id) => id,
                    Err(_) => {
                        skipped_unreadable += 1;
                        continue;
                    }
                };
            let Some(scope) = session_scopes.get(&session_id) else {
                continue;
            };
            let text = match read_text_tx(&mut tx, &provider, &content_id, scope).await {
                Ok(text) => text,
                Err(()) => {
                    skipped_unreadable += 1;
                    continue;
                }
            };
            let name_match = lower_contains(&file_name, &needle_lower);
            if !name_match && !lower_contains(&text, &needle_lower) {
                continue;
            }
            let Some(row) = candidates
                .iter()
                .find(|row| row.session_id.to_string() == session_id)
            else {
                continue;
            };
            hits.push(Hit {
                result: result_for(
                    row,
                    "attachment",
                    Some(message_id),
                    Some(message_role),
                    if name_match {
                        None
                    } else {
                        matching_text(&text, &needle_lower)
                    },
                    Some(file_name),
                ),
                activity: row.last_activity_us,
                position: attachment.get("source_global_position"),
            });
        }

        let (results, result_truncated) = sort_and_cap(hits);
        tx.commit().await.map_err(storage_unavailable)?;
        return Ok(SessionSearchResponse {
            results,
            truncated: candidates_truncated || result_truncated,
            scanned_sessions,
            scan_limit_reached,
            skipped_unreadable,
        });
    }

    let (results, result_truncated) = sort_and_cap(hits);
    tx.commit().await.map_err(storage_unavailable)?;
    Ok(SessionSearchResponse {
        results,
        truncated: candidates_truncated || result_truncated,
        scanned_sessions,
        scan_limit_reached: false,
        skipped_unreadable,
    })
}
