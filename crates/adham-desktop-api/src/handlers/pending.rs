use crate::dtos::*;
use crate::pending_dtos::*;

pub async fn handle_record_pending_operation(
    ctx: &super::ApiContext,
    env: CommandEnvelope<RecordPendingOperationPayload>,
) -> Result<CommandResult<PendingOperationDto>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    crate::service::record_pending_operation(ctx, env).await
}

pub async fn handle_list_pending_operations(
    ctx: &super::ApiContext,
) -> Result<PendingOperationList, String> {
    crate::service::list_pending_operations(ctx).await
}

pub async fn handle_clear_pending_operation(
    ctx: &super::ApiContext,
    env: CommandEnvelope<ClearPendingOperationPayload>,
) -> Result<CommandResult<()>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    crate::service::clear_pending_operation(ctx, env).await
}
