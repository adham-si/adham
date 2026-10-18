use crate::dtos::*;
use adham_core_types::*;
use adham_projections::ConversationProjection;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

use sqlx::Row;

pub async fn handle_get_conversation(
    ctx: &super::ApiContext,
    context: CommandContext,
) -> Result<ConversationPage, String> {
    let sess_id_str = context
        .session_id
        .as_deref()
        .ok_or("sessionId context required")?;
    let session_id = SessionId::from_string(sess_id_str).map_err(|e| e.to_string())?;

    let sess_stream = format!("session:{}", session_id);
    let sess_row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(&sess_stream)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let row = match sess_row {
        Some(r) => r,
        None => return Err("SESSION_NOT_FOUND: session stream does not exist".to_string()),
    };

    if let Some(expected_ws) = context.workspace_id.as_deref() {
        let actual_ws: Option<String> = row.get("workspace_id");
        if actual_ws.as_deref() != Some(expected_ws) {
            return Err(
                "CONTEXT_MISMATCH: session does not belong to specified workspace".to_string(),
            );
        }
    }
    if let Some(expected_proj) = context.project_id.as_deref() {
        let actual_proj: Option<String> = row.get("project_id");
        if actual_proj.as_deref() != Some(expected_proj) {
            return Err(
                "CONTEXT_MISMATCH: session does not belong to specified project".to_string(),
            );
        }
    }

    let messages = ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &session_id,
    )
    .await
    .map_err(|e| e.to_string())?;

    let mut dtos = Vec::with_capacity(messages.len());
    let mut max_pos: i64 = 0;

    for m in messages {
        let dt = OffsetDateTime::from_unix_timestamp_nanos((m.created_at_us * 1_000) as i128)
            .unwrap_or_else(|_| OffsetDateTime::now_utc());
        dtos.push(ConversationMessageDto {
            message_id: m.message_id,
            role: m.role,
            text: m.content,
            created_at: dt.format(&Rfc3339).unwrap_or_default(),
            source_event_id: String::new(),
            completion: m.completion,
            // Both columns are written together or left NULL together; a
            // half-present pair is not a reference.
            reference: m.refers_to_message_id.zip(m.refers_to_relation).map(
                |(refers_to_message_id, relation)| MessageReferenceDto {
                    refers_to_message_id,
                    relation,
                },
            ),
        });
        max_pos += 1;
    }

    Ok(ConversationPage {
        items: dtos,
        next_cursor: None,
        projection_position: max_pos.to_string(),
    })
}
