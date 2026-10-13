use crate::dtos::*;
use crate::handlers::ApiContext;
use crate::pending_dtos::*;
use adham_core_types::*;
use adham_event_log::SqliteEventStore;
use sqlx::Row;
use time::OffsetDateTime;

pub async fn record_pending_operation(
    ctx: &ApiContext,
    env: CommandEnvelope<RecordPendingOperationPayload>,
) -> Result<CommandResult<PendingOperationDto>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_PROTOCOL_VERSION: protocol_version must be 1".to_string());
    }

    let op_id = uuid::Uuid::parse_str(&env.payload.operation_id)
        .map_err(|_| "VALIDATION_FAILED: operation_id must be UUID".to_string())?;
    let msg_req_id = uuid::Uuid::parse_str(&env.payload.message_request_id)
        .map_err(|_| "VALIDATION_FAILED: message_request_id must be UUID".to_string())?;

    let create_req_id = if let Some(ref c) = env.payload.create_request_id {
        Some(
            uuid::Uuid::parse_str(c)
                .map_err(|_| "VALIDATION_FAILED: create_request_id must be UUID".to_string())?,
        )
    } else {
        None
    };

    if env.payload.kind != "single_message" && env.payload.kind != "first_send" {
        return Err("VALIDATION_FAILED: kind must be single_message or first_send".to_string());
    }

    if env.payload.kind == "first_send" && create_req_id.is_none() {
        return Err("VALIDATION_FAILED: create_request_id required for first_send".to_string());
    }

    let text_trimmed = env.payload.text.trim();
    if text_trimmed.is_empty() {
        return Err("VALIDATION_FAILED: text cannot be empty".to_string());
    }

    let ws_id = WorkspaceId::from_string(
        env.context
            .workspace_id
            .as_deref()
            .ok_or("workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;

    let proj_id = ProjectId::from_string(
        env.context
            .project_id
            .as_deref()
            .ok_or("projectId context required")?,
    )
    .map_err(|e| e.to_string())?;

    let sess_id = env
        .context
        .session_id
        .as_deref()
        .map(SessionId::from_string)
        .transpose()
        .map_err(|e| e.to_string())?;

    if env.payload.kind == "single_message" {
        if sess_id.is_none() {
            return Err(
                "VALIDATION_FAILED: session_id context required for single_message".to_string(),
            );
        }
        if create_req_id.is_some() {
            return Err(
                "VALIDATION_FAILED: create_request_id prohibited for single_message".to_string(),
            );
        }
        if env.payload.title.is_some() {
            return Err("VALIDATION_FAILED: title prohibited for single_message".to_string());
        }
    }

    let title_trimmed = env
        .payload
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty());

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    // Verify project exists and belongs to workspace
    let proj_stream = format!("project:{}", proj_id);
    let proj_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT workspace_id FROM events WHERE stream_id = ? AND stream_sequence = 1")
            .bind(&proj_stream)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    match proj_row {
        Some(row) => {
            let row_ws: Option<String> = row.get("workspace_id");
            if row_ws.as_deref() != Some(&ws_id.to_string()) {
                return Err(
                    "CONTEXT_MISMATCH: project does not belong to specified workspace".to_string(),
                );
            }
        }
        None => return Err("PROJECT_NOT_FOUND: project stream does not exist".to_string()),
    }

    // If session provided, verify it exists and belongs to workspace/project
    if let Some(ref s_id) = sess_id {
        let sess_stream = format!("session:{}", s_id);
        let sess_row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
            "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
        )
        .bind(&sess_stream)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
        match sess_row {
            Some(row) => {
                let row_ws: Option<String> = row.get("workspace_id");
                let row_proj: Option<String> = row.get("project_id");
                if row_ws.as_deref() != Some(&ws_id.to_string())
                    || row_proj.as_deref() != Some(&proj_id.to_string())
                {
                    return Err(
                        "CONTEXT_MISMATCH: session does not belong to specified project or workspace"
                            .to_string(),
                    );
                }
            }
            None => return Err("SESSION_NOT_FOUND: session stream does not exist".to_string()),
        }
    }

    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ws_id),
        project_id: Some(proj_id),
        session_id: sess_id,
    };

    let record = SqliteEventStore::record_pending_operation_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &op_id.to_string(),
        &env.payload.kind,
        &scope,
        create_req_id.as_ref().map(|id| id.to_string()).as_deref(),
        &msg_req_id.to_string(),
        text_trimmed,
        title_trimmed,
    )
    .await
    .map_err(|e| match e {
        DomainError::RequestIdConflict(msg) => format!("REQUEST_ID_CONFLICT: {msg}"),
        DomainError::ContextMismatch(msg) => format!("CONTEXT_MISMATCH: {msg}"),
        DomainError::Validation(msg) => format!("VALIDATION_FAILED: {msg}"),
        DomainError::Storage(msg) => format!("STORAGE_UNAVAILABLE: {msg}"),
        other => format!("STORAGE_UNAVAILABLE: {other}"),
    })?;

    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let created_dt =
        OffsetDateTime::from_unix_timestamp_nanos(record.created_at_us as i128 * 1_000)
            .map_err(|e| format!("INTERNAL_ERROR: {e}"))?;
    let created_at = created_dt
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|e| format!("INTERNAL_ERROR: {e}"))?;

    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: uuid::Uuid::now_v7().to_string(),
        data: PendingOperationDto {
            operation_id: record.operation_id,
            kind: record.kind,
            workspace_id: record.workspace_id,
            project_id: record.project_id,
            session_id: record.session_id,
            create_request_id: record.create_request_id,
            message_request_id: record.message_request_id,
            text: text_trimmed.to_string(),
            title: title_trimmed.map(str::to_string),
            status: record.status,
            created_at,
        },
    })
}

pub async fn list_pending_operations(ctx: &ApiContext) -> Result<PendingOperationList, String> {
    let (hydrated, truncated) = ctx
        .store
        .list_pending_operations(ctx.content_key.as_ref(), &ctx.installation_id, 50)
        .await
        .map_err(|e| match e {
            DomainError::Storage(msg) => format!("STORAGE_UNAVAILABLE: {msg}"),
            other => format!("INTERNAL_ERROR: {other}"),
        })?;

    let operations = hydrated
        .into_iter()
        .map(|op| PendingOperationDto {
            operation_id: op.operation_id,
            kind: op.kind,
            workspace_id: op.workspace_id,
            project_id: op.project_id,
            session_id: op.session_id,
            create_request_id: op.create_request_id,
            message_request_id: op.message_request_id,
            text: op.text,
            title: op.title,
            status: op.status,
            created_at: op.created_at,
        })
        .collect();

    Ok(PendingOperationList {
        operations,
        truncated,
    })
}

pub async fn clear_pending_operation(
    ctx: &ApiContext,
    env: CommandEnvelope<ClearPendingOperationPayload>,
) -> Result<CommandResult<()>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_PROTOCOL_VERSION: protocol_version must be 1".to_string());
    }

    if env.payload.reason != "resolved" && env.payload.reason != "dismissed" {
        return Err("VALIDATION_FAILED: reason must be resolved or dismissed".to_string());
    }

    let op_id = uuid::Uuid::parse_str(&env.payload.operation_id)
        .map_err(|_| "VALIDATION_FAILED: operation_id must be UUID".to_string())?;
    let expected_req = uuid::Uuid::parse_str(&env.payload.expected_message_request_id)
        .map_err(|_| "VALIDATION_FAILED: expected_message_request_id must be UUID".to_string())?;

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    SqliteEventStore::clear_pending_operation_tx(
        &mut tx,
        &op_id.to_string(),
        &expected_req.to_string(),
        &env.payload.reason,
    )
    .await
    .map_err(|e| match e {
        DomainError::Validation(msg) => format!("VALIDATION_FAILED: {msg}"),
        DomainError::RequestIdConflict(msg) => format!("REQUEST_ID_CONFLICT: {msg}"),
        DomainError::Storage(msg) => format!("STORAGE_UNAVAILABLE: {msg}"),
        other => format!("STORAGE_UNAVAILABLE: {other}"),
    })?;

    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: uuid::Uuid::now_v7().to_string(),
        data: (),
    })
}
