use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::AppendEventRequest;
use adham_projections::ConversationProjection;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub async fn handle_create_session(
    ctx: &super::ApiContext,
    env: CommandEnvelope<CreateSessionPayload>,
) -> Result<CommandResult<SessionSummary>, String> {
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
    let request_id = RequestId::from_client_str(&env.request_id);

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

    let result = ctx.store.append_event(req).await.map_err(|e| e.to_string())?;

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
            &env.request_id,
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

pub async fn handle_submit_message(
    ctx: &super::ApiContext,
    env: CommandEnvelope<SubmitMessagePayload>,
) -> Result<CommandResult<SubmittedMessage>, String> {
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

    let request_id = RequestId::from_client_str(&env.request_id);

    // 1. Check idempotency receipt
    if let Ok(Some(cached_bytes)) = ctx.store.check_receipt(&request_id).await {
        if let Ok(data) = serde_json::from_slice::<SubmittedMessage>(&cached_bytes) {
            return Ok(CommandResult {
                protocol_version: 1,
                request_id: env.request_id,
                correlation_id: CorrelationId::new_v7().to_string(),
                data,
            });
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
    let stream_id = format!("session:{}", session_id);
    use sqlx::Row;
    let seq_row = sqlx::query("SELECT current_sequence FROM streams WHERE stream_id = ?")
        .bind(&stream_id)
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
        stream_id,
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

    let result = ctx.store.append_event(req).await.map_err(|e| e.to_string())?;

    // 5. Update synchronous projection
    ConversationProjection::insert_message(
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

    // 6. Record receipt
    let response_json = serde_json::to_vec(&submitted).unwrap_or_default();
    let _ = ctx
        .store
        .record_receipt(
            &request_id,
            "submit_message",
            1,
            &session_id.to_string(),
            &env.request_id,
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

pub async fn handle_get_conversation(
    ctx: &super::ApiContext,
    context: CommandContext,
) -> Result<ConversationPage, String> {
    let sess_id_str = context
        .session_id
        .as_deref()
        .ok_or("sessionId context required")?;
    let session_id = SessionId::from_string(sess_id_str).map_err(|e| e.to_string())?;

    let messages = ConversationProjection::get_session_messages(&ctx.pool, &session_id)
        .await
        .map_err(|e| e.to_string())?;

    let mut dtos = Vec::with_capacity(messages.len());
    let mut max_pos: i64 = 0;

    for m in messages {
        let dt = OffsetDateTime::from_unix_timestamp_nanos((m.created_at_us * 1_000) as i128)
            .unwrap_or(OffsetDateTime::now_utc());
        dtos.push(ConversationMessageDto {
            message_id: m.message_id,
            role: m.role,
            text: m.content,
            created_at: dt.format(&Rfc3339).unwrap_or_default(),
            source_event_id: String::new(),
        });
        max_pos += 1;
    }

    Ok(ConversationPage {
        items: dtos,
        next_cursor: None,
        projection_position: max_pos.to_string(),
    })
}
