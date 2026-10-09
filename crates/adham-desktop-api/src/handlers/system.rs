use crate::dtos::*;
use adham_projections::ConversationProjection;

pub async fn handle_get_bootstrap_state(ctx: &super::ApiContext) -> Result<BootstrapState, String> {
    // Explicit authorized selection: the installation record carries the
    // active workspace/project written by creation commands. History is
    // never mined for an active scope — the earliest workspace event has
    // no project and must not stand in for one.
    let record = adham_event_log::load_or_create_installation(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;
    let active_workspace_id = record.active_workspace_id.map(|w| w.to_string());
    let active_project_id = record.active_project_id.map(|p| p.to_string());
    Ok(BootstrapState {
        is_initialized: active_workspace_id.is_some(),
        active_workspace_id,
        active_project_id,
    })
}

pub async fn handle_get_storage_status(ctx: &super::ApiContext) -> Result<StorageStatus, String> {
    let health = adham_event_log::verify_storage_health(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;

    let status = if health.is_healthy {
        "ready".to_string()
    } else {
        "degraded".to_string()
    };

    Ok(StorageStatus {
        status,
        journal_mode: health.journal_mode,
        schema_version: 1,
    })
}

pub async fn handle_admin_rebuild_projections(
    ctx: &super::ApiContext,
) -> Result<RebuildProjectionsResponse, String> {
    let replayed = ConversationProjection::rebuild(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(RebuildProjectionsResponse {
        replayed_count: replayed,
    })
}
