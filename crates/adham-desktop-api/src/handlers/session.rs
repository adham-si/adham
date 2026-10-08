use crate::dtos::*;

pub async fn handle_create_session(
    ctx: &super::ApiContext,
    env: CommandEnvelope<CreateSessionPayload>,
) -> Result<CommandResult<SessionSummary>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    crate::service::create_session_atomic(ctx, env).await
}
