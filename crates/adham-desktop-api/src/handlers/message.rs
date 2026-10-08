use crate::dtos::*;

pub async fn handle_submit_message(
    ctx: &super::ApiContext,
    env: CommandEnvelope<SubmitMessagePayload>,
) -> Result<CommandResult<SubmittedMessage>, String> {
    // Transport-level validation only. All stateful work (receipt check,
    // content, event, projection, receipt write) runs atomically in the
    // application service transaction.
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    if env.payload.text.trim().is_empty() {
        return Err("VALIDATION_FAILED: message text cannot be empty".to_string());
    }
    if env.payload.text.len() > 65536 {
        return Err("VALIDATION_FAILED: message text exceeds 64KB limit".to_string());
    }
    crate::service::submit_message_atomic(ctx, env).await
}
