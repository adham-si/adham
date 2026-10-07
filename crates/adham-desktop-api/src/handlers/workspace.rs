use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::AppendEventRequest;
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

pub async fn handle_create_workspace(
    ctx: &super::ApiContext,
    env: CommandEnvelope<CreateWorkspacePayload>,
) -> Result<CommandResult<WorkspaceSummary>, String> {
    let workspace_id = WorkspaceId::new_v7();
    let stream_id = format!("workspace:{}", workspace_id);
    let now = OffsetDateTime::now_utc();
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();

    let payload = WorkspaceCreatedV1 {
        workspace_id: workspace_id.clone(),
        name: env.payload.name.clone(),
        kind: env.payload.kind.clone(),
        preferred_language: env.payload.preferred_language.clone(),
    };
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let correlation_id = CorrelationId::new_v7();
    let request_id = RequestId::from_client_str(&env.request_id);

    let req = AppendEventRequest {
        stream_id,
        stream_kind: "workspace".to_string(),
        expected_sequence: 0,
        event_type: "WorkspaceCreated".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: ctx.installation_id.clone(),
            workspace_id: Some(workspace_id.clone()),
            project_id: None,
            session_id: None,
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

    let summary = WorkspaceSummary {
        workspace_id: workspace_id.to_string(),
        name: env.payload.name,
        kind: env.payload.kind,
        preferred_language: env.payload.preferred_language,
        created_at: created_at_iso,
    };

    let response_json = serde_json::to_vec(&summary).unwrap_or_default();
    let _ = ctx
        .store
        .record_receipt(
            &request_id,
            "create_workspace",
            1,
            &workspace_id.to_string(),
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

pub async fn handle_create_project(
    ctx: &super::ApiContext,
    env: CommandEnvelope<CreateProjectPayload>,
) -> Result<CommandResult<ProjectSummary>, String> {
    let ws_id_str = env
        .context
        .workspace_id
        .as_deref()
        .ok_or("workspaceId context required")?;
    let workspace_id = WorkspaceId::from_string(ws_id_str).map_err(|e| e.to_string())?;

    let project_id = ProjectId::new_v7();
    let stream_id = format!("project:{}", project_id);
    let now = OffsetDateTime::now_utc();
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();

    let payload = ProjectCreatedV1 {
        project_id: project_id.clone(),
        workspace_id: workspace_id.clone(),
        name: env.payload.name.clone(),
        storage_kind: env.payload.storage_kind.clone(),
    };
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;

    let correlation_id = CorrelationId::new_v7();
    let request_id = RequestId::from_client_str(&env.request_id);

    let req = AppendEventRequest {
        stream_id,
        stream_kind: "project".to_string(),
        expected_sequence: 0,
        event_type: "ProjectCreated".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: ctx.installation_id.clone(),
            workspace_id: Some(workspace_id.clone()),
            project_id: Some(project_id.clone()),
            session_id: None,
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

    let summary = ProjectSummary {
        project_id: project_id.to_string(),
        workspace_id: workspace_id.to_string(),
        name: env.payload.name,
        storage_kind: env.payload.storage_kind,
        created_at: created_at_iso,
    };

    let response_json = serde_json::to_vec(&summary).unwrap_or_default();
    let _ = ctx
        .store
        .record_receipt(
            &request_id,
            "create_project",
            1,
            &project_id.to_string(),
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
