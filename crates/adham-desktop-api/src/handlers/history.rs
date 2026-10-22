use super::ApiContext;
use crate::dtos::{
    CommandContext, CommandEnvelope, CommandResult, DeleteSessionPayload, DeleteSessionResponse,
    DuplicateSessionPayload, ExportSessionResponse, RenameSessionPayload, SessionMetadata,
    SetSessionArchivedPayload, SetSessionPinnedPayload, SetSessionSummaryPayload,
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

pub async fn handle_set_session_summary(
    ctx: &ApiContext,
    env: CommandEnvelope<SetSessionSummaryPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    crate::service::set_session_summary(ctx, env).await
}

pub async fn handle_duplicate_session(
    ctx: &ApiContext,
    env: CommandEnvelope<DuplicateSessionPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    crate::service::duplicate_session(ctx, env).await
}

pub async fn handle_delete_session(
    ctx: &ApiContext,
    env: CommandEnvelope<DeleteSessionPayload>,
) -> Result<CommandResult<DeleteSessionResponse>, String> {
    crate::service::delete_session(ctx, env).await
}

pub async fn handle_export_session_markdown(
    ctx: &ApiContext,
    context: CommandContext,
) -> Result<ExportSessionResponse, String> {
    crate::service::export_session_markdown(ctx, context).await
}
