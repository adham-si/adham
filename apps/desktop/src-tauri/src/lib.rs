use adham_desktop_api::{
    AnswerFeedbackDto, ApiContext, AttachmentDto, BootstrapState, BranchSelectionDto,
    ClearPendingOperationPayload, CommandContext, CommandEnvelope, CommandResult,
    CompleteOncePayload, CompletionStartDto, ConfigureGoogleAccountPayload, ConversationPage,
    CreateProjectPayload, CreateSessionPayload, CreateWorkspacePayload,
    DisconnectGoogleAccountPayload, DisconnectOllamaAccountPayload, DiscoverOllamaModelsPayload,
    ErrorEnvelope, GetPreferencesResponse, GoogleAccountDisconnected, IngestAttachmentPathPayload,
    IngestAttachmentPayload, ListProviderAccountsResponse, ListProviderModelsPayload,
    ListProviderModelsResponse, ListSessionsOptions, MarkCompletionInterruptedPayload,
    MarkCompletionInterruptedResponse, OllamaAccountDisconnected, PendingOperationDto,
    PendingOperationList, PlatformInfo, ProjectList, ProjectSummary, ProviderAccountDto,
    ProviderHealthResponse, ProviderModelsList, ReadAttachmentPayload, RebuildProjectionsResponse,
    RecordPendingOperationPayload, RenameSessionPayload, ResetPreferencesResponse,
    RetryCompletionPayload, SelectProjectPayload, SessionList, SessionMetadata, SessionSummary,
    SetActiveAlternativePayload, SetAnswerFeedbackPayload, SetMessageBookmarkPayload,
    SetSessionArchivedPayload, SetSessionPinnedPayload, SetSessionSummaryPayload,
    StopCompletionPayload, StopCompletionResponse, StorageStatus, StreamEventDto,
    SubmitMessagePayload, SubmittedMessage, TestProviderConnectionPayload,
    UpdatePreferencesPayload, UpdatePreferencesResponse, UpdateProviderAccountPayload,
    WorkspaceList, WorkspaceSummary,
};
#[cfg(target_os = "macos")]
use tauri::Manager;

#[cfg(all(test, not(windows)))]
mod ipc_contract_tests;

/// Single `generate_context!` expansion shared by `run()` and the IPC contract
/// tests: the macro embeds one set of static symbols per binary.
fn app_context<R: tauri::Runtime>() -> tauri::Context<R> {
    tauri::generate_context!()
}

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
async fn list_sessions(
    state: tauri::State<'_, ApiContext>,
    context: CommandContext,
    options: Option<ListSessionsOptions>,
) -> Result<SessionList, ErrorEnvelope> {
    adham_desktop_api::handle_list_sessions(&state, context, options)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn rename_session(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<RenameSessionPayload>,
) -> Result<CommandResult<SessionMetadata>, ErrorEnvelope> {
    adham_desktop_api::handle_rename_session(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn set_session_pinned(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<SetSessionPinnedPayload>,
) -> Result<CommandResult<SessionMetadata>, ErrorEnvelope> {
    adham_desktop_api::handle_set_session_pinned(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn set_session_archived(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<SetSessionArchivedPayload>,
) -> Result<CommandResult<SessionMetadata>, ErrorEnvelope> {
    adham_desktop_api::handle_set_session_archived(&state, request)
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
async fn ingest_attachment(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<IngestAttachmentPayload>,
) -> Result<CommandResult<AttachmentDto>, ErrorEnvelope> {
    adham_desktop_api::handle_ingest_attachment(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn ingest_attachment_path(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<IngestAttachmentPathPayload>,
) -> Result<CommandResult<AttachmentDto>, ErrorEnvelope> {
    adham_desktop_api::handle_ingest_attachment_path(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn read_attachment_text(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<ReadAttachmentPayload>,
) -> Result<CommandResult<AttachmentDto>, ErrorEnvelope> {
    adham_desktop_api::handle_read_attachment_text(&state, request)
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
async fn set_active_alternative(
    state: tauri::State<'_, ApiContext>,
    context: CommandContext,
    payload: SetActiveAlternativePayload,
) -> Result<Vec<BranchSelectionDto>, ErrorEnvelope> {
    adham_desktop_api::handle_set_active_alternative(&state, context, payload)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn set_answer_feedback(
    state: tauri::State<'_, ApiContext>,
    context: CommandContext,
    payload: SetAnswerFeedbackPayload,
) -> Result<Vec<AnswerFeedbackDto>, ErrorEnvelope> {
    adham_desktop_api::handle_set_answer_feedback(&state, context, payload)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

// ===== Delivery A: local provider commands =====

struct TauriEventSink {
    channel: tauri::ipc::Channel<StreamEventDto>,
}

impl adham_desktop_api::EventSink for TauriEventSink {
    fn send(&self, event: StreamEventDto) -> Result<(), String> {
        self.channel.send(event).map_err(|e| e.to_string())
    }
}

#[tauri::command]
async fn list_provider_accounts(
    state: tauri::State<'_, ApiContext>,
) -> Result<CommandResult<ListProviderAccountsResponse>, ErrorEnvelope> {
    adham_desktop_api::handle_list_provider_accounts(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn test_provider_connection(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<TestProviderConnectionPayload>,
) -> Result<CommandResult<ProviderHealthResponse>, ErrorEnvelope> {
    adham_desktop_api::handle_test_provider_connection(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn list_provider_models(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<ListProviderModelsPayload>,
) -> Result<CommandResult<ListProviderModelsResponse>, ErrorEnvelope> {
    adham_desktop_api::handle_list_provider_models(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn discover_ollama_models(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<DiscoverOllamaModelsPayload>,
) -> Result<CommandResult<ProviderModelsList>, ErrorEnvelope> {
    adham_desktop_api::handle_discover_ollama_models(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn update_provider_account(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<UpdateProviderAccountPayload>,
) -> Result<CommandResult<ProviderAccountDto>, ErrorEnvelope> {
    adham_desktop_api::handle_update_provider_account(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn configure_google_account(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<ConfigureGoogleAccountPayload>,
) -> Result<CommandResult<ProviderAccountDto>, ErrorEnvelope> {
    adham_desktop_api::handle_configure_google_account(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn disconnect_google_account(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<DisconnectGoogleAccountPayload>,
) -> Result<CommandResult<GoogleAccountDisconnected>, ErrorEnvelope> {
    adham_desktop_api::handle_disconnect_google_account(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn disconnect_ollama_account(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<DisconnectOllamaAccountPayload>,
) -> Result<CommandResult<OllamaAccountDisconnected>, ErrorEnvelope> {
    adham_desktop_api::handle_disconnect_ollama_account(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn complete_once_streaming(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<CompleteOncePayload>,
    on_event: tauri::ipc::Channel<StreamEventDto>,
) -> Result<CommandResult<CompletionStartDto>, ErrorEnvelope> {
    let sink = TauriEventSink { channel: on_event };
    adham_desktop_api::handle_complete_once_streaming(&state, request, &sink)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn retry_completion_streaming(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<RetryCompletionPayload>,
    on_event: tauri::ipc::Channel<StreamEventDto>,
) -> Result<CommandResult<CompletionStartDto>, ErrorEnvelope> {
    let sink = TauriEventSink { channel: on_event };
    adham_desktop_api::handle_retry_completion_streaming(&state, request, &sink)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn stop_completion(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<StopCompletionPayload>,
) -> Result<CommandResult<StopCompletionResponse>, ErrorEnvelope> {
    adham_desktop_api::handle_stop_completion(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn mark_completion_interrupted(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<MarkCompletionInterruptedPayload>,
) -> Result<CommandResult<MarkCompletionInterruptedResponse>, ErrorEnvelope> {
    adham_desktop_api::handle_mark_completion_interrupted(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn set_session_summary(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<SetSessionSummaryPayload>,
) -> Result<CommandResult<SessionMetadata>, ErrorEnvelope> {
    adham_desktop_api::handle_set_session_summary(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn set_message_bookmark(
    state: tauri::State<'_, ApiContext>,
    context: CommandContext,
    payload: SetMessageBookmarkPayload,
) -> Result<Vec<String>, ErrorEnvelope> {
    adham_desktop_api::handle_set_message_bookmark(&state, context, payload)
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

#[tauri::command]
async fn get_app_preferences(
    state: tauri::State<'_, ApiContext>,
) -> Result<GetPreferencesResponse, ErrorEnvelope> {
    adham_desktop_api::handle_get_app_preferences(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn update_app_preferences(
    state: tauri::State<'_, ApiContext>,
    payload: UpdatePreferencesPayload,
) -> Result<UpdatePreferencesResponse, ErrorEnvelope> {
    adham_desktop_api::handle_update_app_preferences(&state, payload)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn reset_app_preferences(
    state: tauri::State<'_, ApiContext>,
) -> Result<ResetPreferencesResponse, ErrorEnvelope> {
    adham_desktop_api::handle_reset_app_preferences(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn record_pending_operation(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<RecordPendingOperationPayload>,
) -> Result<CommandResult<PendingOperationDto>, ErrorEnvelope> {
    adham_desktop_api::handle_record_pending_operation(&state, request)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn list_pending_operations(
    state: tauri::State<'_, ApiContext>,
) -> Result<PendingOperationList, ErrorEnvelope> {
    adham_desktop_api::handle_list_pending_operations(&state)
        .await
        .map_err(|e| ErrorEnvelope::from_error_str(&e))
}

#[tauri::command]
async fn clear_pending_operation(
    state: tauri::State<'_, ApiContext>,
    request: CommandEnvelope<ClearPendingOperationPayload>,
) -> Result<CommandResult<()>, ErrorEnvelope> {
    adham_desktop_api::handle_clear_pending_operation(&state, request)
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
            get_app_preferences,
            update_app_preferences,
            reset_app_preferences,
            create_workspace,
            create_project,
            list_workspaces,
            list_projects,
            select_project,
            create_session,
            list_sessions,
            rename_session,
            set_session_pinned,
            set_session_archived,
            set_session_summary,
            submit_message,
            ingest_attachment,
            ingest_attachment_path,
            read_attachment_text,
            get_conversation,
            set_active_alternative,
            set_answer_feedback,
            set_message_bookmark,
            admin_rebuild_projections,
            record_pending_operation,
            list_pending_operations,
            clear_pending_operation,
            list_provider_accounts,
            test_provider_connection,
            discover_ollama_models,
            list_provider_models,
            update_provider_account,
            configure_google_account,
            disconnect_google_account,
            disconnect_ollama_account,
            complete_once_streaming,
            retry_completion_streaming,
            stop_completion,
            mark_completion_interrupted,
        ]);

    let app = builder
        .build(app_context())
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
