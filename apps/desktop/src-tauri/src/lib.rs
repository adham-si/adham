use adham_desktop_api::{
    ApiContext, BootstrapState, CommandContext, CommandEnvelope, CommandResult, ConversationPage,
    CreateProjectPayload, CreateSessionPayload, CreateWorkspacePayload, ErrorEnvelope,
    PlatformInfo, ProjectList, ProjectSummary, RebuildProjectionsResponse, SelectProjectPayload,
    SessionSummary, StorageStatus, SubmitMessagePayload, SubmittedMessage, WorkspaceList,
    WorkspaceSummary,
};
#[cfg(target_os = "macos")]
use tauri::Manager;

#[tauri::command]
fn get_platform_info() -> PlatformInfo {
    adham_desktop_api::handle_get_platform_info()
}

#[tauri::command]
async fn get_bootstrap_state(
    state: tauri::State<'_, ApiContext>,
) -> Result<BootstrapState, ErrorEnvelope> {
    adham_desktop_api::handle_get_bootstrap_state(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn get_storage_status(
    state: tauri::State<'_, ApiContext>,
) -> Result<StorageStatus, ErrorEnvelope> {
    adham_desktop_api::handle_get_storage_status(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn create_workspace(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<CreateWorkspacePayload>,
) -> Result<CommandResult<WorkspaceSummary>, ErrorEnvelope> {
    adham_desktop_api::handle_create_workspace(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn create_project(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<CreateProjectPayload>,
) -> Result<CommandResult<ProjectSummary>, ErrorEnvelope> {
    adham_desktop_api::handle_create_project(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn list_workspaces(
    state: tauri::State<'_, ApiContext>,
) -> Result<WorkspaceList, ErrorEnvelope> {
    adham_desktop_api::handle_list_workspaces(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn list_projects(
    state: tauri::State<'_, ApiContext>,
    context: CommandContext,
) -> Result<ProjectList, ErrorEnvelope> {
    adham_desktop_api::handle_list_projects(&state, context)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn select_project(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<SelectProjectPayload>,
) -> Result<CommandResult<BootstrapState>, ErrorEnvelope> {
    adham_desktop_api::handle_select_project(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn create_session(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<CreateSessionPayload>,
) -> Result<CommandResult<SessionSummary>, ErrorEnvelope> {
    adham_desktop_api::handle_create_session(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn submit_message(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<SubmitMessagePayload>,
) -> Result<CommandResult<SubmittedMessage>, ErrorEnvelope> {
    adham_desktop_api::handle_submit_message(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn get_conversation(
    state: tauri::State<'_, ApiContext>,
    context: CommandContext,
) -> Result<ConversationPage, ErrorEnvelope> {
    adham_desktop_api::handle_get_conversation(&state, context)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn admin_rebuild_projections(
    state: tauri::State<'_, ApiContext>,
) -> Result<RebuildProjectionsResponse, ErrorEnvelope> {
    adham_desktop_api::handle_admin_rebuild_projections(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

pub fn run() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("info,sqlx=warn")
        .try_init();

    let storage_policy = adham_platform::PlatformStoragePolicy::resolve()
        .expect("Failed to initialize storage directories: platform data dir missing or invalid");
    storage_policy
        .ensure_directories()
        .expect("Failed to initialize storage directories");

    let runtime = tokio::runtime::Runtime::new().expect("Failed to initialize Tokio runtime");
    let pool = runtime.block_on(async {
        adham_event_log::create_sqlite_pool(&storage_policy.sqlite_database_path)
            .await
            .expect("Failed to initialize SQLite pool and migrations")
    });

    let api_ctx = runtime.block_on(async {
        adham_desktop_api::ApiContext::load_or_create(pool)
            .await
            .expect("Failed to load installation identity")
    });

    let builder = tauri::Builder::default()
        .manage(api_ctx)
        .setup(|app| {
            let mut window_config = app
                .config()
                .app
                .windows
                .first()
                .cloned()
                .unwrap_or_default();

            #[cfg(target_os = "macos")]
            {
                window_config.decorations = true;
                window_config.title_bar_style = tauri::TitleBarStyle::Overlay;
                window_config.hidden_title = true;
            }

            #[cfg(not(target_os = "macos"))]
            {
                window_config.decorations = false;
            }

            let _window =
                tauri::WebviewWindowBuilder::from_config(app.handle(), &window_config)?.build()?;

            Ok(())
        })
        .on_window_event(|_window, _event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = _event {
                api.prevent_close();
                let _ = _window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_bootstrap_state,
            get_storage_status,
            get_platform_info,
            create_workspace,
            create_project,
            list_workspaces,
            list_projects,
            select_project,
            create_session,
            submit_message,
            get_conversation,
            admin_rebuild_projections,
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|_app_handle, _event| {
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            if let Some(window) = _app_handle.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
}
