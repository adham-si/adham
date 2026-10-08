use crate::dtos::*;

pub async fn handle_create_workspace(
    ctx: &super::ApiContext,
    env: CommandEnvelope<CreateWorkspacePayload>,
) -> Result<CommandResult<WorkspaceSummary>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    if env.payload.name.trim().is_empty() {
        return Err("VALIDATION_FAILED: workspace name cannot be empty".to_string());
    }
    crate::service::create_workspace_atomic(ctx, env).await
}

pub async fn handle_create_project(
    ctx: &super::ApiContext,
    env: CommandEnvelope<CreateProjectPayload>,
) -> Result<CommandResult<ProjectSummary>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    if env.payload.name.trim().is_empty() {
        return Err("VALIDATION_FAILED: project name cannot be empty".to_string());
    }
    crate::service::create_project_atomic(ctx, env).await
}
