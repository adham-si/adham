//! Atomic workspace/project creation services. ID newtypes are `Copy`.
#![allow(clippy::clone_on_copy)]
use super::common::conflict_msg;
use crate::dtos::*;
use crate::handlers::ApiContext;
use adham_core_types::*;
use adham_event_log::{set_active_scope, AppendEventRequest, SqliteEventStore};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

fn replay(
    request_id: String,
    receipt: adham_event_log::CommandReceiptRecord,
) -> Result<CommandResult<WorkspaceSummary>, String> {
    match serde_json::from_slice::<WorkspaceSummary>(&receipt.response_json) {
        Ok(data) => Ok(CommandResult {
            protocol_version: 1,
            request_id,
            correlation_id: receipt.correlation_id,
            data,
        }),
        Err(_) => Err("STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string()),
    }
}

fn replay_project(
    request_id: String,
    receipt: adham_event_log::CommandReceiptRecord,
) -> Result<CommandResult<ProjectSummary>, String> {
    match serde_json::from_slice::<ProjectSummary>(&receipt.response_json) {
        Ok(data) => Ok(CommandResult {
            protocol_version: 1,
            request_id,
            correlation_id: receipt.correlation_id,
            data,
        }),
        Err(_) => Err("STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string()),
    }
}

/// Atomic workspace creation: event + stream + receipt in one tx.
pub async fn create_workspace(
    ctx: &ApiContext,
    env: CommandEnvelope<CreateWorkspacePayload>,
) -> Result<CommandResult<WorkspaceSummary>, String> {
    let trimmed = env.payload.name.trim().to_string();
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    let request_fp = adham_event_log::request_fingerprint("create_workspace", 1, &trimmed);
    let scope_fp = adham_event_log::scope_fingerprint(
        "create_workspace",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        None,
        None,
        None,
    );

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        let matches = receipt.command_type == "create_workspace"
            && receipt.command_version == 1
            && receipt.actor_id == ctx.actor_id.to_string()
            && receipt.scope_fingerprint == scope_fp
            && receipt.request_fingerprint == request_fp;
        tx.rollback()
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        if matches {
            let out = replay(env.request_id, receipt)?;
            let ws = WorkspaceId::from_string(&out.data.workspace_id).map_err(|e| e.to_string())?;
            // Converge selection: the first execution may have committed
            // before recording it.
            set_active_scope(&ctx.pool, Some(&ws), None)
                .await
                .map_err(|e| e.to_string())?;
            return Ok(out);
        }
        return Err(conflict_msg());
    }

    let workspace_id = WorkspaceId::new_v7();
    let stream_id = format!("workspace:{}", workspace_id);
    let now = OffsetDateTime::now_utc();
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();
    let payload = WorkspaceCreatedV1 {
        workspace_id: workspace_id.clone(),
        name: trimmed.clone(),
        kind: env.payload.kind.clone(),
        preferred_language: env.payload.preferred_language.clone(),
    };
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let correlation_id = CorrelationId::new_v7();
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
            actor_id: ctx.actor_id.clone(),
            kind: ActorKind::LocalHuman,
        },
        request_id: request_id.clone(),
        correlation_id: correlation_id.clone(),
        causation_id: None,
        payload_json: payload_bytes,
        metadata_json: b"{}".to_vec(),
    };
    let append_res = match SqliteEventStore::append_event_tx(&mut tx, req).await {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.rollback().await;
            return Err(e.to_string());
        }
    };

    let summary = WorkspaceSummary {
        workspace_id: workspace_id.to_string(),
        name: trimmed,
        kind: env.payload.kind.clone(),
        preferred_language: env.payload.preferred_language.clone(),
        created_at: created_at_iso,
    };
    let response_json = serde_json::to_vec(&summary).unwrap_or_default();
    if let Err(e) = SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "create_workspace",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "success",
        &response_json,
        append_res.global_position,
    )
    .await
    {
        let _ = tx.rollback().await;
        return Err(format!(
            "STORAGE_UNAVAILABLE: failed to record receipt: {e}"
        ));
    }
    if let Err(e) = tx.commit().await {
        // Reconcile: winner's receipt decides replay vs conflict.
        match ctx.store.check_receipt(&request_id).await {
            Ok(Some(receipt)) => {
                let matches = receipt.command_type == "create_workspace"
                    && receipt.request_fingerprint == request_fp
                    && receipt.scope_fingerprint == scope_fp;
                if matches {
                    let out = replay(env.request_id, receipt)?;
                    let ws = WorkspaceId::from_string(&out.data.workspace_id)
                        .map_err(|e| e.to_string())?;
                    set_active_scope(&ctx.pool, Some(&ws), None)
                        .await
                        .map_err(|e| e.to_string())?;
                    return Ok(out);
                }
                return Err(conflict_msg());
            }
            _ => return Err(format!("STORAGE_UNAVAILABLE: commit failed: {e}")),
        }
    }
    // Explicit authorized selection: creating a workspace makes it active
    // and clears any project selection from another workspace. Recorded
    // after commit; a failure here surfaces so retry converges via replay.
    set_active_scope(&ctx.pool, Some(&workspace_id), None)
        .await
        .map_err(|e| e.to_string())?;
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: summary,
    })
}

/// Atomic project creation: event + stream + receipt in one tx.
pub async fn create_project(
    ctx: &ApiContext,
    env: CommandEnvelope<CreateProjectPayload>,
) -> Result<CommandResult<ProjectSummary>, String> {
    let trimmed = env.payload.name.trim().to_string();
    let ws_id = WorkspaceId::from_string(
        env.context
            .workspace_id
            .as_deref()
            .ok_or("workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    let request_fp = adham_event_log::request_fingerprint("create_project", 1, &trimmed);
    let scope_fp = adham_event_log::scope_fingerprint(
        "create_project",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ws_id),
        None,
        None,
    );

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let ws_stream = format!("workspace:{}", ws_id);
    let ws_row = sqlx::query("SELECT current_sequence FROM streams WHERE stream_id = ?")
        .bind(&ws_stream)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    if ws_row.is_none() {
        return Err("WORKSPACE_NOT_FOUND: workspace stream does not exist".to_string());
    }

    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        let matches = receipt.command_type == "create_project"
            && receipt.command_version == 1
            && receipt.actor_id == ctx.actor_id.to_string()
            && receipt.scope_fingerprint == scope_fp
            && receipt.request_fingerprint == request_fp;
        tx.rollback()
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        if matches {
            let out = replay_project(env.request_id, receipt)?;
            let ws = WorkspaceId::from_string(&out.data.workspace_id).map_err(|e| e.to_string())?;
            let proj = ProjectId::from_string(&out.data.project_id).map_err(|e| e.to_string())?;
            set_active_scope(&ctx.pool, Some(&ws), Some(&proj))
                .await
                .map_err(|e| e.to_string())?;
            return Ok(out);
        }
        return Err(conflict_msg());
    }

    let project_id = ProjectId::new_v7();
    let stream_id = format!("project:{}", project_id);
    let now = OffsetDateTime::now_utc();
    let created_at_iso = now.format(&Rfc3339).unwrap_or_default();
    let payload = ProjectCreatedV1 {
        project_id: project_id.clone(),
        workspace_id: ws_id.clone(),
        name: trimmed.clone(),
        storage_kind: env.payload.storage_kind.clone(),
    };
    let payload_bytes = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
    let correlation_id = CorrelationId::new_v7();
    let req = AppendEventRequest {
        stream_id,
        stream_kind: "project".to_string(),
        expected_sequence: 0,
        event_type: "ProjectCreated".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: ctx.installation_id.clone(),
            workspace_id: Some(ws_id.clone()),
            project_id: Some(project_id.clone()),
            session_id: None,
        },
        actor: EventActor {
            actor_id: ctx.actor_id.clone(),
            kind: ActorKind::LocalHuman,
        },
        request_id: request_id.clone(),
        correlation_id: correlation_id.clone(),
        causation_id: None,
        payload_json: payload_bytes,
        metadata_json: b"{}".to_vec(),
    };
    let append_res = match SqliteEventStore::append_event_tx(&mut tx, req).await {
        Ok(r) => r,
        Err(e) => {
            let _ = tx.rollback().await;
            return Err(e.to_string());
        }
    };
    let summary = ProjectSummary {
        project_id: project_id.to_string(),
        workspace_id: ws_id.to_string(),
        name: trimmed,
        storage_kind: env.payload.storage_kind.clone(),
        created_at: created_at_iso,
    };
    let response_json = serde_json::to_vec(&summary).unwrap_or_default();
    if let Err(e) = SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "create_project",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "success",
        &response_json,
        append_res.global_position,
    )
    .await
    {
        let _ = tx.rollback().await;
        return Err(format!(
            "STORAGE_UNAVAILABLE: failed to record receipt: {e}"
        ));
    }
    if let Err(e) = tx.commit().await {
        match ctx.store.check_receipt(&request_id).await {
            Ok(Some(receipt)) => {
                let matches = receipt.command_type == "create_project"
                    && receipt.request_fingerprint == request_fp
                    && receipt.scope_fingerprint == scope_fp;
                if matches {
                    let out = replay_project(env.request_id, receipt)?;
                    let ws = WorkspaceId::from_string(&out.data.workspace_id)
                        .map_err(|e| e.to_string())?;
                    let proj =
                        ProjectId::from_string(&out.data.project_id).map_err(|e| e.to_string())?;
                    set_active_scope(&ctx.pool, Some(&ws), Some(&proj))
                        .await
                        .map_err(|e| e.to_string())?;
                    return Ok(out);
                }
                return Err(conflict_msg());
            }
            _ => return Err(format!("STORAGE_UNAVAILABLE: commit failed: {e}")),
        }
    }
    // Explicit authorized selection: the created project becomes active in
    // its workspace. Recorded after commit; failures surface for retry.
    set_active_scope(&ctx.pool, Some(&ws_id), Some(&project_id))
        .await
        .map_err(|e| e.to_string())?;
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: summary,
    })
}
