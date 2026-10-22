pub fn conflict_msg() -> String {
    "REQUEST_ID_CONFLICT: request_id reused with differing command, scope, actor, or payload"
        .to_string()
}

/// Resolve the context's session and prove it exists inside the requested
/// workspace/project scope. Every session-scoped command validates this the
/// same way, with the same refusal strings.
pub async fn resolve_scoped_session(
    ctx: &crate::handlers::ApiContext,
    context: &crate::dtos::CommandContext,
) -> Result<adham_core_types::SessionId, String> {
    use sqlx::Row;

    let session_id = adham_core_types::SessionId::from_string(
        context
            .session_id
            .as_deref()
            .ok_or("sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;

    let sess_stream = format!("session:{session_id}");
    let sess_row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(&sess_stream)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let sess_row =
        sess_row.ok_or("SESSION_NOT_FOUND: session stream does not exist".to_string())?;
    if let Some(expected) = context.workspace_id.as_deref() {
        let actual: Option<String> = sess_row.get("workspace_id");
        if actual.as_deref() != Some(expected) {
            return Err(
                "CONTEXT_MISMATCH: session does not belong to specified workspace".to_string(),
            );
        }
    }
    if let Some(expected) = context.project_id.as_deref() {
        let actual: Option<String> = sess_row.get("project_id");
        if actual.as_deref() != Some(expected) {
            return Err(
                "CONTEXT_MISMATCH: session does not belong to specified project".to_string(),
            );
        }
    }
    let deleted: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM events WHERE stream_id = ? AND event_type = 'SessionDeleted' LIMIT 1",
    )
    .bind(&sess_stream)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    if deleted.is_some() {
        return Err("SESSION_DELETED: session is deleted".to_string());
    }
    Ok(session_id)
}

/// Take the per-session write serialization before any action reads a receipt
/// or decides whether the session is still active.
pub async fn lock_session_stream_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session_id: &str,
) -> Result<(), String> {
    let result =
        sqlx::query("UPDATE streams SET current_sequence = current_sequence WHERE stream_id = ?")
            .bind(format!("session:{session_id}"))
            .execute(&mut **tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    if result.rows_affected() == 0 {
        return Err("SESSION_NOT_FOUND: session stream does not exist".to_string());
    }
    Ok(())
}

/// A tombstone wins over every later action, including a replay of a request
/// that succeeded before the delete.
pub async fn ensure_session_active_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session_id: &str,
) -> Result<(), String> {
    let deleted: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM events WHERE stream_id = ? AND event_type = 'SessionDeleted' LIMIT 1",
    )
    .bind(format!("session:{session_id}"))
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    if deleted.is_some() {
        return Err("SESSION_DELETED: session is deleted".to_string());
    }
    Ok(())
}

/// A live completion blocks history mutations. First sends can be recorded
/// before the session exists, so match those rows by their create request.
pub(crate) async fn ensure_no_live_operation_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session_id: &str,
) -> Result<(), String> {
    let create_request: Option<String> = sqlx::query_scalar(
        "SELECT request_id FROM events WHERE stream_id = ? AND event_type IN ('SessionCreated', 'session/created') ORDER BY global_position ASC LIMIT 1",
    )
    .bind(format!("session:{session_id}"))
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let live: Option<i64> = sqlx::query_scalar(
        "SELECT 1 FROM pending_operations WHERE status = 'pending' AND (session_id = ? OR (session_id IS NULL AND create_request_id = ?)) LIMIT 1",
    )
    .bind(session_id)
    .bind(create_request)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    if live.is_some() {
        return Err("SESSION_BUSY: a live operation is still running on this session".to_string());
    }
    Ok(())
}
