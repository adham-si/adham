use crate::dtos::*;
use adham_core_types::*;
use adham_projections::ConversationProjection;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub async fn handle_get_conversation(
    ctx: &super::ApiContext,
    context: CommandContext,
) -> Result<ConversationPage, String> {
    let sess_id_str = context
        .session_id
        .as_deref()
        .ok_or("sessionId context required")?;
    let session_id = SessionId::from_string(sess_id_str).map_err(|e| e.to_string())?;

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
        });
        max_pos += 1;
    }

    Ok(ConversationPage {
        items: dtos,
        next_cursor: None,
        projection_position: max_pos.to_string(),
    })
}
