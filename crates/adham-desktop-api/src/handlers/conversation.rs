use crate::dtos::*;
use adham_projections::ConversationProjection;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

pub async fn handle_get_conversation(
    ctx: &super::ApiContext,
    context: CommandContext,
) -> Result<ConversationPage, String> {
    let session_id = crate::service::common::resolve_scoped_session(ctx, &context).await?;

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

    let branch_selections = crate::service::branch::read_branch_selections(&ctx.pool, &session_id)
        .await
        .map_err(|e| e.to_string())?;
    let feedback = crate::service::feedback::read_answer_feedback(&ctx.pool, &session_id)
        .await
        .map_err(|e| e.to_string())?;

    Ok(ConversationPage {
        items: dtos,
        next_cursor: None,
        projection_position: max_pos.to_string(),
        branch_selections,
        feedback,
    })
}

/// Record the active member of an edited branch. Validation lives in the
/// service: a refused selection never writes (the previous selection stands).
pub async fn handle_set_active_alternative(
    ctx: &super::ApiContext,
    context: CommandContext,
    payload: SetActiveAlternativePayload,
) -> Result<Vec<BranchSelectionDto>, String> {
    crate::service::branch::set_active_alternative(ctx, context, payload).await
}

/// Record, switch, or remove the local verdict for one answer row. Validation
/// lives in the service: a refused feedback never writes (the stored verdict
/// stands).
pub async fn handle_set_answer_feedback(
    ctx: &super::ApiContext,
    context: CommandContext,
    payload: SetAnswerFeedbackPayload,
) -> Result<Vec<AnswerFeedbackDto>, String> {
    crate::service::feedback::set_answer_feedback(ctx, context, payload).await
}
