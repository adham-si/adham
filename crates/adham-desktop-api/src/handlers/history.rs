use super::ApiContext;
use crate::dtos::{
    CommandContext, CommandEnvelope, CommandResult, DeleteSessionPayload, DeleteSessionResponse,
    DuplicateSessionPayload, ExportSessionResponse, RenameSessionPayload, SessionMetadata,
    SessionSearchRequest, SessionSearchResponse, SetSessionArchivedPayload,
    SetSessionPinnedPayload, SetSessionSummaryPayload,
};
use std::path::PathBuf;

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

pub async fn handle_search_history(
    ctx: &ApiContext,
    context: CommandContext,
    request: SessionSearchRequest,
) -> Result<SessionSearchResponse, String> {
    crate::service::search_history(ctx, &context, request).await
}

pub async fn handle_delete_session(
    ctx: &ApiContext,
    env: CommandEnvelope<DeleteSessionPayload>,
) -> Result<CommandResult<DeleteSessionResponse>, String> {
    crate::service::delete_session(ctx, env).await
}

pub async fn handle_validate_export_session(
    ctx: &ApiContext,
    context: &CommandContext,
) -> Result<(), String> {
    crate::service::validate_export_session(ctx, context).await
}

pub async fn handle_export_session_markdown(
    ctx: &ApiContext,
    context: CommandContext,
    destination: PathBuf,
) -> Result<ExportSessionResponse, String> {
    crate::service::export_session_markdown(ctx, context, destination).await
}
