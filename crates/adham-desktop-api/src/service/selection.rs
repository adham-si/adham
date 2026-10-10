//! Workspace/project discovery (list projections) and explicit selection.
//!
//! Lists are rebuildable views over canonical created-events (P0-02), never
//! new events. Selection persists the authorized scope on the installation
//! record; it appends nothing. Selection shares the receipt machinery with
//! creation under its own `select_project` fingerprint domain: an uncertain
//! request retried with the same identity replays the recorded scope
//! without selecting again, so a delayed original can never silently
//! overwrite a newer selection. Creation fingerprints are untouched.
use super::common::conflict_msg;
use crate::dtos::*;
use crate::handlers::ApiContext;
use adham_core_types::*;
use adham_event_log::{set_active_scope_tx, SqliteEventStore};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;

/// Bounded reads: deterministic creation order, no cursor pagination at P0
/// scale. Pagination arrives with its own contract when lists outgrow this.
const LIST_LIMIT: i64 = 100;

fn storage_unavailable(e: impl std::fmt::Display) -> String {
    format!("STORAGE_UNAVAILABLE: {e}")
}

fn occurred_iso(occurred_at_us: i64) -> String {
    OffsetDateTime::from_unix_timestamp_nanos(occurred_at_us as i128 * 1_000)
        .ok()
        .and_then(|dt| dt.format(&Rfc3339).ok())
        .unwrap_or_default()
}

/// All personal workspaces in creation order. Reads only; empty when the
/// installation is fresh (provisioning, not selection, owns that case).
pub async fn list_workspaces(ctx: &ApiContext) -> Result<Vec<WorkspaceSummary>, String> {
    let rows: Vec<(Vec<u8>, i64)> = sqlx::query_as(
        "SELECT payload_json, occurred_at_us FROM events
         WHERE event_type = 'WorkspaceCreated' ORDER BY global_position LIMIT ?",
    )
    .bind(LIST_LIMIT)
    .fetch_all(&ctx.pool)
    .await
    .map_err(storage_unavailable)?;
    let mut out = Vec::with_capacity(rows.len());
    for (payload_json, occurred_at_us) in rows {
        let created: WorkspaceCreatedV1 = serde_json::from_slice(&payload_json)
            .map_err(|_| "STORAGE_REPAIR_REQUIRED: workspace record unparseable".to_string())?;
        out.push(WorkspaceSummary {
            workspace_id: created.workspace_id.to_string(),
            name: created.name,
            kind: created.kind,
            preferred_language: created.preferred_language,
            created_at: occurred_iso(occurred_at_us),
        });
    }
    Ok(out)
}

/// Projects strictly inside one workspace, in creation order. The workspace
/// must exist; an unknown workspace is rejected, never silently empty.
pub async fn list_projects(
    ctx: &ApiContext,
    workspace_id: &str,
) -> Result<Vec<ProjectSummary>, String> {
    let ws_id = WorkspaceId::from_string(workspace_id)
        .map_err(|_| "VALIDATION_FAILED: workspace_id must be UUID".to_string())?;
    let ws_stream = format!("workspace:{ws_id}");
    let ws_row: Option<(i64,)> =
        sqlx::query_as("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&ws_stream)
            .fetch_optional(&ctx.pool)
            .await
            .map_err(storage_unavailable)?;
    if ws_row.is_none() {
        return Err("WORKSPACE_NOT_FOUND: workspace stream does not exist".to_string());
    }
    let rows: Vec<(Vec<u8>, i64)> = sqlx::query_as(
        "SELECT payload_json, occurred_at_us FROM events
         WHERE event_type = 'ProjectCreated' AND workspace_id = ?
         ORDER BY global_position LIMIT ?",
    )
    .bind(ws_id.to_string())
    .bind(LIST_LIMIT)
    .fetch_all(&ctx.pool)
    .await
    .map_err(storage_unavailable)?;
    let mut out = Vec::with_capacity(rows.len());
    for (payload_json, occurred_at_us) in rows {
        let created: ProjectCreatedV1 = serde_json::from_slice(&payload_json)
            .map_err(|_| "STORAGE_REPAIR_REQUIRED: project record unparseable".to_string())?;
        out.push(ProjectSummary {
            project_id: created.project_id.to_string(),
            workspace_id: created.workspace_id.to_string(),
            name: created.name,
            storage_kind: created.storage_kind,
            created_at: occurred_iso(occurred_at_us),
        });
    }
    Ok(out)
}

fn replay_bootstrap(
    request_id: String,
    receipt: adham_event_log::CommandReceiptRecord,
) -> Result<CommandResult<BootstrapState>, String> {
    match serde_json::from_slice::<BootstrapState>(&receipt.response_json) {
        Ok(data) => Ok(CommandResult {
            protocol_version: 1,
            request_id,
            correlation_id: receipt.correlation_id,
            data,
        }),
        Err(_) => Err("STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string()),
    }
}

/// Explicit selection of an existing project in its owning workspace.
/// Validates everything before writing; a failed selection never touches
/// the durable scope, so the prior selection stays intact. Scope update +
/// receipt commit atomically in one transaction: the first committer wins
/// and any delayed duplicate replays the recorded scope without selecting
/// again. Returns the authoritative scope for the UI to follow.
pub async fn select_project(
    ctx: &ApiContext,
    env: CommandEnvelope<SelectProjectPayload>,
) -> Result<CommandResult<BootstrapState>, String> {
    let ws_id = WorkspaceId::from_string(
        env.context
            .workspace_id
            .as_deref()
            .ok_or("workspaceId context required")?,
    )
    .map_err(|_| "VALIDATION_FAILED: workspace_id must be UUID".to_string())?;
    let project_id = ProjectId::from_string(&env.payload.project_id)
        .map_err(|_| "VALIDATION_FAILED: project_id must be UUID".to_string())?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    let request_fp =
        adham_event_log::request_fingerprint("select_project", 1, &format!("{ws_id}:{project_id}"));
    let scope_fp = adham_event_log::scope_fingerprint(
        "select_project",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ws_id),
        Some(&project_id),
        None,
    );

    let mut tx = ctx.pool.begin().await.map_err(storage_unavailable)?;

    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| storage_unavailable(e.to_string()))?
    {
        let matches = receipt.command_type == "select_project"
            && receipt.command_version == 1
            && receipt.actor_id == ctx.actor_id.to_string()
            && receipt.scope_fingerprint == scope_fp
            && receipt.request_fingerprint == request_fp;
        tx.rollback()
            .await
            .map_err(|e| storage_unavailable(e.to_string()))?;
        if matches {
            // Replay returns the recorded scope only. A delayed original
            // arriving after a newer selection must never re-select.
            let out = replay_bootstrap(env.request_id, receipt)?;
            return Ok(out);
        }
        return Err(conflict_msg());
    }

    // Ownership first: workspace stream, then project membership. Nothing
    // is written until both prove out, so failures keep prior selection.
    let ws_stream = format!("workspace:{ws_id}");
    let ws_row: Option<(i64,)> =
        sqlx::query_as("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&ws_stream)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| storage_unavailable(e.to_string()))?;
    if ws_row.is_none() {
        return Err("WORKSPACE_NOT_FOUND: workspace stream does not exist".to_string());
    }
    let proj_payload: Option<(Vec<u8>,)> = sqlx::query_as(
        "SELECT payload_json FROM events WHERE event_type = 'ProjectCreated' AND project_id = ?",
    )
    .bind(project_id.to_string())
    .fetch_optional(&mut *tx)
    .await
    .map_err(|e| storage_unavailable(e.to_string()))?;
    let Some((payload_json,)) = proj_payload else {
        return Err("PROJECT_NOT_FOUND: project stream does not exist".to_string());
    };
    let created: ProjectCreatedV1 = serde_json::from_slice(&payload_json)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: project record unparseable".to_string())?;
    if created.workspace_id != ws_id {
        return Err("CONTEXT_MISMATCH: project does not belong to workspace".to_string());
    }

    let state = BootstrapState {
        is_initialized: true,
        active_workspace_id: Some(ws_id.to_string()),
        active_project_id: Some(project_id.to_string()),
    };
    let response_json = serde_json::to_vec(&state).unwrap_or_default();
    let correlation_id = CorrelationId::new_v7();
    // Anchor for the receipt: current tip (no event is appended here).
    let anchor: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(global_position), 0) FROM events")
        .fetch_one(&mut *tx)
        .await
        .map_err(|e| storage_unavailable(e.to_string()))?;
    if let Err(e) = set_active_scope_tx(&mut tx, Some(&ws_id), Some(&project_id)).await {
        let _ = tx.rollback().await;
        return Err(e.to_string());
    }
    if let Err(e) = SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "select_project",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "success",
        &response_json,
        anchor,
    )
    .await
    {
        let _ = tx.rollback().await;
        return Err(storage_unavailable(format!(
            "failed to record receipt: {e}"
        )));
    }
    // Commit failure stays uncertain: the same identity safely retries and
    // replays the recorded scope instead of selecting twice.
    if let Err(e) = tx.commit().await {
        return Err(storage_unavailable(format!("commit failed: {e}")));
    }
    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: state,
    })
}
