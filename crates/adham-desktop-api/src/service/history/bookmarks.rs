//! Message bookmarks are local state, not events: one row per persisted
//! message, validated against the session's projection rows.
use crate::dtos::CommandContext;
use crate::handlers::ApiContext;
use crate::service::common::{
    ensure_session_active_tx, lock_session_stream_tx, resolve_scoped_session,
};
use sqlx::SqlitePool;
use time::OffsetDateTime;

async fn read_ids(
    executor: impl sqlx::Executor<'_, Database = sqlx::Sqlite>,
    session_id: &str,
) -> Result<Vec<String>, String> {
    sqlx::query_scalar(
        "SELECT message_id FROM message_bookmarks WHERE session_id = ? ORDER BY message_id ASC",
    )
    .bind(session_id)
    .fetch_all(executor)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))
}

pub async fn read_bookmarked_message_ids(
    pool: &SqlitePool,
    session_id: &str,
) -> Result<Vec<String>, String> {
    read_ids(pool, session_id).await
}

pub async fn set_message_bookmark(
    ctx: &ApiContext,
    context: &CommandContext,
    message_id: &str,
    bookmarked: bool,
) -> Result<Vec<String>, String> {
    let session_id = resolve_scoped_session(ctx, context).await?;
    let session_id = session_id.to_string();
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    lock_session_stream_tx(&mut tx, &session_id).await?;
    ensure_session_active_tx(&mut tx, &session_id).await?;

    let message_exists: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM conversation_messages WHERE message_id = ? AND session_id = ? LIMIT 1",
    )
    .bind(message_id)
    .bind(&session_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    if message_exists.is_none() {
        return Err("VALIDATION_FAILED:message_not_found".to_string());
    }

    if bookmarked {
        let now_us = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
        sqlx::query(
            "INSERT OR IGNORE INTO message_bookmarks (session_id, message_id, created_at_us) VALUES (?, ?, ?)",
        )
        .bind(&session_id)
        .bind(message_id)
        .bind(now_us)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    } else {
        sqlx::query("DELETE FROM message_bookmarks WHERE session_id = ? AND message_id = ?")
            .bind(&session_id)
            .bind(message_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    }

    let ids = read_ids(&mut *tx, &session_id).await?;
    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    Ok(ids)
}
