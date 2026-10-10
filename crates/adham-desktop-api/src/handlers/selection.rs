use crate::dtos::*;

pub async fn handle_list_workspaces(
    ctx: &super::ApiContext,
) -> Result<Vec<WorkspaceSummary>, String> {
    crate::service::list_workspaces(ctx).await
}

pub async fn handle_list_projects(
    ctx: &super::ApiContext,
    context: CommandContext,
) -> Result<Vec<ProjectSummary>, String> {
    let workspace_id = context
        .workspace_id
        .as_deref()
        .ok_or("workspaceId context required")?;
    crate::service::list_projects(ctx, workspace_id).await
}

pub async fn handle_select_project(
    ctx: &super::ApiContext,
    env: CommandEnvelope<SelectProjectPayload>,
) -> Result<CommandResult<BootstrapState>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    if env.payload.project_id.trim().is_empty() {
        return Err("VALIDATION_FAILED: project_id cannot be empty".to_string());
    }
    crate::service::select_project_atomic(ctx, env).await
}
