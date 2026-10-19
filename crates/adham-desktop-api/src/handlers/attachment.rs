use crate::dtos::*;

/// Ingest one picked or pasted text file. Refusals (type, size, encoding)
/// come back as `VALIDATION_FAILED: attachment.<code>` with nothing written.
pub async fn handle_ingest_attachment(
    ctx: &super::ApiContext,
    env: CommandEnvelope<IngestAttachmentPayload>,
) -> Result<CommandResult<AttachmentDto>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    let data = crate::service::attachment::ingest_text_attachment(
        ctx,
        &env.context,
        &env.payload.file_name,
        env.payload.text.as_bytes(),
    )
    .await?;
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: uuid::Uuid::now_v7().to_string(),
        data,
    })
}

/// Ingest a dropped file: the Rust side owns the bounded read.
pub async fn handle_ingest_attachment_path(
    ctx: &super::ApiContext,
    env: CommandEnvelope<IngestAttachmentPathPayload>,
) -> Result<CommandResult<AttachmentDto>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    let data = crate::service::attachment::ingest_attachment_path(
        ctx,
        &env.context,
        &env.payload.file_path,
    )
    .await?;
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: uuid::Uuid::now_v7().to_string(),
        data,
    })
}

/// Rehydrate the exact text a sent attachment carried, for an honest preview.
pub async fn handle_read_attachment_text(
    ctx: &super::ApiContext,
    env: CommandEnvelope<ReadAttachmentPayload>,
) -> Result<CommandResult<AttachmentDto>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    let data = crate::service::attachment::read_attachment_text(
        ctx,
        &env.context,
        &env.payload.attachment_id,
    )
    .await?;
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: uuid::Uuid::now_v7().to_string(),
        data,
    })
}
