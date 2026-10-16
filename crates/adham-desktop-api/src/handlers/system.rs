use crate::dtos::*;
use adham_projections::ConversationProjection;

pub async fn handle_get_bootstrap_state(ctx: &super::ApiContext) -> Result<BootstrapState, String> {
    // Explicit authorized selection: the installation record carries the
    // active workspace/project written by creation commands. History is
    // never mined for an active scope — the earliest workspace event has
    // no project and must not stand in for one.
    let init = adham_event_log::load_or_create_installation(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;
    let active_workspace_id = init.record.active_workspace_id.map(|w| w.to_string());
    let active_project_id = init.record.active_project_id.map(|p| p.to_string());
    Ok(BootstrapState {
        is_initialized: active_workspace_id.is_some(),
        active_workspace_id,
        active_project_id,
        installation_id: Some(init.record.installation_id.to_string()),
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

    // Authoritative location from the platform policy (the same resolution
    // the startup path uses). Unresolvable roots fail the call so the UI
    // shows unavailable instead of a fabricated path.
    let data_dir = adham_platform::PlatformStoragePolicy::resolve()
        .map_err(|e| e.to_string())?
        .data_dir
        .to_string_lossy()
        .into_owned();

    Ok(StorageStatus {
        status,
        journal_mode: health.journal_mode,
        schema_version: 1,
        data_dir,
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

fn stored_to_preferences(
    stored: Option<adham_event_log::StoredPreferences>,
) -> Result<(AppPreferences, u32), String> {
    match stored {
        None => Ok((AppPreferences::defaults(), 0)),
        Some(row) => {
            if row.schema_version != adham_event_log::PREFERENCES_SCHEMA_VERSION {
                return Err(format!(
                    "PREFERENCES_SCHEMA_MISMATCH:stored={} supported={}",
                    row.schema_version,
                    adham_event_log::PREFERENCES_SCHEMA_VERSION
                ));
            }
            let prefs: AppPreferences = serde_json::from_str(&row.prefs_json)
                .map_err(|e| format!("PREFERENCES_CORRUPT:invalid stored document: {e}"))?;
            // Stored rows were validated on write; re-validate so a corrupt
            // row can never surface as live configuration.
            prefs
                .validate()
                .map_err(|e| format!("PREFERENCES_CORRUPT:{e}"))?;
            let revision = u32::try_from(row.revision)
                .map_err(|_| "PREFERENCES_CORRUPT:revision out of range".to_string())?;
            Ok((prefs, revision))
        }
    }
}

pub async fn handle_get_app_preferences(
    ctx: &super::ApiContext,
) -> Result<GetPreferencesResponse, String> {
    let stored = adham_event_log::read_preferences(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;
    let (preferences, revision) = stored_to_preferences(stored)?;
    Ok(GetPreferencesResponse {
        preferences,
        revision,
    })
}

pub async fn handle_update_app_preferences(
    ctx: &super::ApiContext,
    payload: UpdatePreferencesPayload,
) -> Result<UpdatePreferencesResponse, String> {
    payload.preferences.validate()?;
    let stored = adham_event_log::write_preferences(
        &ctx.pool,
        adham_event_log::PREFERENCES_SCHEMA_VERSION,
        &serde_json::to_string(&payload.preferences).map_err(|e| e.to_string())?,
        i64::from(payload.base_revision),
    )
    .await
    .map_err(|e| match e {
        adham_event_log::PreferenceWriteError::Conflict(current) => {
            format!(
                "PREFERENCE_REVISION_CONFLICT:current_revision={}",
                current.revision
            )
        }
        adham_event_log::PreferenceWriteError::Storage(inner) => inner.to_string(),
    })?;
    let (preferences, revision) = stored_to_preferences(Some(stored))?;
    Ok(UpdatePreferencesResponse {
        preferences,
        revision,
    })
}

pub async fn handle_reset_app_preferences(
    ctx: &super::ApiContext,
) -> Result<ResetPreferencesResponse, String> {
    adham_event_log::reset_preferences(&ctx.pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ResetPreferencesResponse {
        preferences: AppPreferences::defaults(),
        revision: 0,
    })
}

pub fn handle_get_platform_info() -> PlatformInfo {
    PlatformInfo {
        os: if cfg!(target_os = "macos") {
            "macos".to_string()
        } else if cfg!(target_os = "windows") {
            "windows".to_string()
        } else if cfg!(target_os = "linux") {
            "linux".to_string()
        } else {
            "unknown".to_string()
        },
        arch: std::env::consts::ARCH.to_string(),
        has_native_titlebar_controls: cfg!(target_os = "macos"),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        build_profile: if cfg!(debug_assertions) {
            "debug".to_string()
        } else {
            "release".to_string()
        },
    }
}
