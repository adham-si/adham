use crate::dtos::*;
use adham_projections::ConversationProjection;
use sqlx::Row;

pub async fn handle_get_bootstrap_state(ctx: &super::ApiContext) -> Result<BootstrapState, String> {
    let row = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE workspace_id IS NOT NULL ORDER BY global_position ASC LIMIT 1"
    )
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| e.to_string())?;

    match row {
        Some(r) => {
            let ws_id: Option<String> = r.get("workspace_id");
            let proj_id: Option<String> = r.get("project_id");
            Ok(BootstrapState {
                is_initialized: ws_id.is_some(),
                active_workspace_id: ws_id,
                active_project_id: proj_id,
            })
        }
        None => Ok(BootstrapState {
            is_initialized: false,
            active_workspace_id: None,
            active_project_id: None,
        }),
    }
}

pub async fn handle_get_storage_status(ctx: &super::ApiContext) -> Result<StorageStatus, String> {
    let row = sqlx::query("PRAGMA journal_mode")
        .fetch_one(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;

    let journal_mode: String = row.get(0);

    Ok(StorageStatus {
        status: "ready".to_string(),
        journal_mode,
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
