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

pub async fn handle_list_sessions(
    ctx: &super::ApiContext,
    context: CommandContext,
    options: Option<ListSessionsOptions>,
) -> Result<SessionList, String> {
    let project_id = context
        .project_id
        .as_deref()
        .ok_or("projectId context required")?;
    let options = options.unwrap_or_default();
    crate::service::list_sessions(ctx, project_id, context.workspace_id.as_deref(), &options).await
}
