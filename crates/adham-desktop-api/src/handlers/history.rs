use super::ApiContext;
use crate::dtos::{
    CommandEnvelope, CommandResult, RenameSessionPayload, SessionMetadata,
    SetSessionArchivedPayload, SetSessionPinnedPayload,
};

pub async fn handle_rename_session(
    ctx: &ApiContext,
    env: CommandEnvelope<RenameSessionPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    crate::service::rename_session(ctx, env).await
}

pub async fn handle_set_session_pinned(
    ctx: &ApiContext,
    env: CommandEnvelope<SetSessionPinnedPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    crate::service::set_session_pinned(ctx, env).await
}

pub async fn handle_set_session_archived(
    ctx: &ApiContext,
    env: CommandEnvelope<SetSessionArchivedPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    crate::service::set_session_archived(ctx, env).await
}
