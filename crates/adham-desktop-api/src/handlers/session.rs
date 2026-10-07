use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::AppendEventRequest;
use sqlx::Row;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub async fn handle_create_session(
    ctx: &super::ApiContext,
    env: CommandEnvelope<CreateSessionPayload>,
) -> Result<CommandResult<SessionSummary>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    let ws_id_str = env
        .context
        .workspace_id
        .as_deref()
        .ok_or("workspaceId context required")?;
    let proj_id_str = env
        .context
        .project_id
        .as_deref()
        .ok_or("projectId context required")?;
    let workspace_id = WorkspaceId::from_string(ws_id_str).map_err(|e| e.to_string())?;
    let project_id = ProjectId::from_string(proj_id_str).map_err(|e| e.to_string())?;

    // Verify project belongs to workspace
    let proj_stream = format!("project:{}", project_id);
    let proj_row = sqlx::query(
        "SELECT workspace_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(&proj_stream)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| e.to_string())?;

    match proj_row {
        Some(row) => {
            let row_ws: Option<String> = row.get("workspace_id");
            if row_ws.as_deref() != Some(&workspace_id.to_string()) {
                return Err(
                    "CONTEXT_MISMATCH: project does not belong to specified workspace".to_string(),
                );
            }
        }
        None => {
            return Err("PROJECT_NOT_FOUND: project stream does not exist".to_string());
        }
    }

    let request_id = RequestId::from_client_str(&env.request_id);
    let title_str = env.payload.title.as_deref().unwrap_or("").trim();
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"create_session:v1:");
    hasher.update(title_str.as_bytes());
    let current_fingerprint = hasher.finalize().to_hex().to_string();

    if let Ok(Some(receipt)) = ctx.store.check_receipt(&request_id).await {
        if receipt.request_fingerprint == current_fingerprint {
            if let Ok(data) = serde_json::from_slice::<SessionSummary>(&receipt.response_json) {
                return Ok(CommandResult {
                    protocol_version: 1,
                    request_id: env.request_id,
                    correlation_id: receipt.correlation_id,
                    data,
                });
            }
        } else {
            return Err(
                "REQUEST_ID_CONFLICT: request_id reused with differing payload".to_string(),
            );
        }
    }

    let session_id = SessionId::new_v7();
    let stream_id = format!("session:{}", session_id);
    let now = OffsetDateTime::now_utc();
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();

    let payload = SessionCreatedV1 {
        session_id: session_id.clone(),
        project_id: project_id.clone(),
        title: env.payload.title.clone(),
    };
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let correlation_id = CorrelationId::new_v7();

    let req = AppendEventRequest {
        stream_id,
        stream_kind: "session".to_string(),
        expected_sequence: 0,
        event_type: "SessionCreated".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: ctx.installation_id.clone(),
            workspace_id: Some(workspace_id),
            project_id: Some(project_id.clone()),
            session_id: Some(session_id.clone()),
        },
        actor: EventActor {
            actor_id: ActorId::new_v7(),
            kind: ActorKind::LocalHuman,
        },
        request_id: request_id.clone(),
        correlation_id: correlation_id.clone(),
        causation_id: None,
        payload_json: payload_bytes,
        metadata_json: b"{}".to_vec(),
    };

    let result = ctx
        .store
        .append_event(req)
        .await
        .map_err(|e| e.to_string())?;

    let summary = SessionSummary {
        session_id: session_id.to_string(),
        project_id: project_id.to_string(),
        title: env.payload.title,
        created_at: created_at_iso,
    };

    let response_json = serde_json::to_vec(&summary).unwrap_or_default();
    let _ = ctx
        .store
        .record_receipt(
            &request_id,
            "create_session",
            1,
            &session_id.to_string(),
            &current_fingerprint,
            &correlation_id,
            "success",
            &response_json,
            result.global_position,
        )
        .await;

    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: summary,
    })
}
