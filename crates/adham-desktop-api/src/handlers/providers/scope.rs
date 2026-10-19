//! Shared scope resolver: full workspace/project/session context or refusal.

use super::StreamIds;
use crate::dtos::*;
use adham_core_types::*;

pub(crate) fn expect_full_scope(context: &CommandContext) -> Result<StreamIds, String> {
    let ws_id = WorkspaceId::from_string(
        context
            .workspace_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let proj_id = ProjectId::from_string(
        context
            .project_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: projectId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let sess_id = SessionId::from_string(
        context
            .session_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;
    Ok(StreamIds {
        ws_id,
        proj_id,
        sess_id,
    })
}
