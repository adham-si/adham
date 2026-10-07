use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::AppendEventRequest;
use sqlx::Row;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub async fn handle_submit_message(
    ctx: &super::ApiContext,
    env: CommandEnvelope<SubmitMessagePayload>,
) -> Result<CommandResult<SubmittedMessage>, String> {
    if env.protocol_version != 1 {
        return Err("INVALID_COMMAND_VERSION: protocol_version must be 1".to_string());
    }
    let trimmed_text = env.payload.text.trim();
    if trimmed_text.is_empty() {
        return Err("VALIDATION_FAILED: message text cannot be empty".to_string());
    }
    if env.payload.text.len() > 65536 {
        return Err("VALIDATION_FAILED: message text exceeds 64KB limit".to_string());
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
    let sess_id_str = env
        .context
        .session_id
        .as_deref()
        .ok_or("sessionId context required")?;
    let workspace_id = WorkspaceId::from_string(ws_id_str).map_err(|e| e.to_string())?;
    let project_id = ProjectId::from_string(proj_id_str).map_err(|e| e.to_string())?;
    let session_id = SessionId::from_string(sess_id_str).map_err(|e| e.to_string())?;

    // Verify session belongs to project AND workspace
    let sess_stream = format!("session:{}", session_id);
    let sess_row = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(&sess_stream)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| e.to_string())?;

    match sess_row {
        Some(row) => {
            let row_ws: Option<String> = row.get("workspace_id");
            let row_proj: Option<String> = row.get("project_id");
            if row_ws.as_deref() != Some(&workspace_id.to_string())
                || row_proj.as_deref() != Some(&project_id.to_string())
            {
                return Err(
                    "CONTEXT_MISMATCH: session does not belong to specified project or workspace"
                        .to_string(),
                );
            }
        }
        None => {
            return Err("SESSION_NOT_FOUND: session stream does not exist".to_string());
        }
    }

    let request_id = RequestId::from_client_str(&env.request_id);
    let mut hasher = blake3::Hasher::new();
    hasher.update(b"submit_message:v1:");
    hasher.update(trimmed_text.as_bytes());
    let current_fingerprint = hasher.finalize().to_hex().to_string();

    // 1. Check idempotency receipt
    if let Ok(Some(receipt)) = ctx.store.check_receipt(&request_id).await {
        if receipt.request_fingerprint == current_fingerprint {
            if let Ok(data) = serde_json::from_slice::<SubmittedMessage>(&receipt.response_json) {
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

    // 2. Put sensitive content into segregated content store
    let content_id = ContentId::new_v7();
    let content_bytes = env.payload.text.as_bytes();
    ctx.store
        .put_content(
            &content_id,
            "user_text",
            "text/plain",
            "identity",
            "none",
            content_bytes,
        )
        .await
        .map_err(|e| e.to_string())?;

    // 3. Query current sequence of session stream
    let seq_row = sqlx::query("SELECT current_sequence FROM streams WHERE stream_id = ?")
        .bind(&sess_stream)
        .fetch_optional(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;
    let current_seq = seq_row
        .map(|r| r.get::<i64, _>("current_sequence") as u64)
        .unwrap_or(0);

    let message_id = MessageId::new_v7();
    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();
    let correlation_id = CorrelationId::new_v7();

    let event_payload = MessageSubmittedV1 {
        message_id: message_id.clone(),
        content_id: content_id.clone(),
        content_kind: "user_text".to_string(),
        size_bytes: content_bytes.len() as u64,
    };
    let payload_bytes = serde_json::to_vec(&event_payload).map_err(|e| e.to_string())?;

    // 4. Append canonical event
    let req = AppendEventRequest {
        stream_id: sess_stream,
        stream_kind: "session".to_string(),
        expected_sequence: current_seq,
        event_type: "MessageSubmitted".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: ctx.installation_id.clone(),
            workspace_id: Some(workspace_id.clone()),
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

    // 5. Update synchronous projection
    adham_projections::ConversationProjection::insert_message(
        &ctx.pool,
        &message_id.to_string(),
        &workspace_id.to_string(),
        &project_id.to_string(),
        &session_id.to_string(),
        "user",
        &content_id.to_string(),
        &result.event_id.to_string(),
        result.global_position,
        now_us,
    )
    .await
    .map_err(|e| e.to_string())?;

    let submitted = SubmittedMessage {
        message_id: message_id.to_string(),
        session_id: session_id.to_string(),
        text: env.payload.text,
        created_at: created_at_iso,
        stream_sequence: result.stream_sequence.to_string(),
        projection_position: result.global_position.to_string(),
    };

    let response_json = serde_json::to_vec(&submitted).unwrap_or_default();
    let _ = ctx
        .store
        .record_receipt(
            &request_id,
            "submit_message",
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
        data: submitted,
    })
}
