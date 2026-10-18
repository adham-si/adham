use adham_core_types::{MessageCompletionV1, MessageUsageV1};
use adham_provider::domain::request::ThinkValue;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommandContext {
    pub workspace_id: Option<String>,
    pub project_id: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommandEnvelope<T> {
    pub protocol_version: u32,
    pub request_id: String,
    pub context: CommandContext,
    pub payload: T,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CommandResult<T> {
    pub protocol_version: u32,
    pub request_id: String,
    pub correlation_id: String,
    pub data: T,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct BootstrapState {
    pub is_initialized: bool,
    pub active_workspace_id: Option<String>,
    pub active_project_id: Option<String>,
    #[ts(optional = nullable)]
    #[serde(default)]
    pub installation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PlatformInfo {
    pub os: String,
    pub arch: String,
    pub has_native_titlebar_controls: bool,
    /// Workspace `version`: the shipped application version.
    pub app_version: String,
    /// `debug` or `release`: which pipeline produced this binary.
    pub build_profile: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreateWorkspacePayload {
    pub name: String,
    pub kind: String,
    pub preferred_language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorkspaceSummary {
    pub workspace_id: String,
    pub name: String,
    pub kind: String,
    pub preferred_language: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreateProjectPayload {
    pub name: String,
    pub storage_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectSummary {
    pub project_id: String,
    pub workspace_id: String,
    pub name: String,
    pub storage_kind: String,
    pub created_at: String,
}

/// Selection target. The owning workspace travels in the command context
/// (like `create_project`); no creation command or receipt replay may
/// substitute for this explicit selection.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SelectProjectPayload {
    pub project_id: String,
}

/// Bounded workspace listing. `truncated` discloses a clamped tail;
/// cursor pagination arrives with its own contract when lists outgrow this.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WorkspaceList {
    pub workspaces: Vec<WorkspaceSummary>,
    pub truncated: bool,
}

/// Bounded per-workspace project listing with the same truncation disclosure.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProjectList {
    pub workspace_id: String,
    pub projects: Vec<ProjectSummary>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CreateSessionPayload {
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionSummary {
    pub session_id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionList {
    pub project_id: String,
    pub sessions: Vec<SessionSummary>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SubmitMessagePayload {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SubmittedMessage {
    pub message_id: String,
    pub session_id: String,
    pub text: String,
    pub created_at: String,
    pub stream_sequence: String,
    pub projection_position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConversationMessageDto {
    pub message_id: String,
    pub role: String,
    pub text: String,
    pub created_at: String,
    pub source_event_id: String,
    /// Terminal lifecycle of assistant turns (None for user turns). The UI
    /// labels failed/interrupted/truncated turns from this, never from text.
    pub completion: Option<MessageCompletionV1>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConversationPage {
    pub items: Vec<ConversationMessageDto>,
    pub next_cursor: Option<String>,
    pub projection_position: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StorageStatus {
    pub status: String,
    pub journal_mode: String,
    pub schema_version: u32,
    /// Resolved installation data directory (platform policy). Resolution
    /// failure is an error, never a guessed path.
    pub data_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RebuildProjectionsResponse {
    pub replayed_count: u32,
}

/// Installation-scoped presentation preferences (SETTINGS-01 Pillar 1).
/// Presentation only: no secrets, no operational/security policy.
/// Every string field is a closed allowlist validated by
/// `AppPreferences::validate`; unknown values are rejected, never stored.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AppPreferences {
    /// `system` | `light` | `dark`
    pub appearance: String,
    /// `en` | `ar` | `zh-CN` | `ru`
    pub language: String,
    /// `default` | `system` | `serif` | `mono`
    pub font_family: String,
    /// `sm` | `md` | `lg`
    pub font_size: String,
    /// `system` | `enabled` | `disabled`
    pub high_contrast: String,
    /// `system` | `reduce` | `no-preference`
    pub reduced_motion: String,
    pub enter_to_send: bool,
}

impl AppPreferences {
    pub fn defaults() -> Self {
        Self {
            appearance: "system".to_string(),
            language: "en".to_string(),
            font_family: "default".to_string(),
            font_size: "md".to_string(),
            high_contrast: "system".to_string(),
            reduced_motion: "system".to_string(),
            enter_to_send: true,
        }
    }

    fn check_one(field: &str, value: &str, allowed: &[&str]) -> Result<(), String> {
        if allowed.contains(&value) {
            Ok(())
        } else {
            Err(format!("VALIDATION_FAILED:{field}={value}"))
        }
    }

    pub fn validate(&self) -> Result<(), String> {
        Self::check_one("appearance", &self.appearance, &["system", "light", "dark"])?;
        Self::check_one("language", &self.language, &["en", "ar", "zh-CN", "ru"])?;
        Self::check_one(
            "fontFamily",
            &self.font_family,
            &["default", "system", "serif", "mono"],
        )?;
        Self::check_one("fontSize", &self.font_size, &["sm", "md", "lg"])?;
        Self::check_one(
            "highContrast",
            &self.high_contrast,
            &["system", "enabled", "disabled"],
        )?;
        Self::check_one(
            "reducedMotion",
            &self.reduced_motion,
            &["system", "reduce", "no-preference"],
        )?;
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GetPreferencesResponse {
    pub preferences: AppPreferences,
    pub revision: u32,
}

/// Plain payload (no idempotency envelope): the revision guard in
/// `base_revision` is the ordering mechanism. A stale base conflicts
/// instead of overwriting.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdatePreferencesPayload {
    pub preferences: AppPreferences,
    pub base_revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdatePreferencesResponse {
    pub preferences: AppPreferences,
    pub revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ResetPreferencesResponse {
    pub preferences: AppPreferences,
    pub revision: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct FieldError {
    pub field: String,
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ErrorEnvelope {
    pub protocol_version: u16,
    pub code: adham_core_types::PublicErrorCode,
    pub message_key: String,
    pub retryable: bool,
    pub correlation_id: String,
    pub field_errors: Vec<FieldError>,
    pub retry_after_ms: Option<u32>,
}

impl ErrorEnvelope {
    pub fn from_error_str(err: &str) -> Self {
        use adham_core_types::PublicErrorCode;
        let (code, msg_key, retryable) = if err.starts_with("INVALID_COMMAND_VERSION") {
            (
                PublicErrorCode::InvalidProtocolVersion,
                "error.invalidProtocolVersion",
                false,
            )
        } else if err.starts_with("VALIDATION_FAILED") {
            (
                PublicErrorCode::InvalidRequest,
                "error.validationFailed",
                false,
            )
        } else if err.starts_with("WORKSPACE_NOT_FOUND") {
            (
                PublicErrorCode::WorkspaceNotFound,
                "error.workspaceNotFound",
                false,
            )
        } else if err.starts_with("PROJECT_NOT_FOUND") {
            (
                PublicErrorCode::ProjectNotFound,
                "error.projectNotFound",
                false,
            )
        } else if err.starts_with("SESSION_NOT_FOUND") {
            (
                PublicErrorCode::SessionNotFound,
                "error.sessionNotFound",
                false,
            )
        } else if err.starts_with("CONTEXT_MISMATCH") {
            (
                PublicErrorCode::ContextMismatch,
                "error.contextMismatch",
                false,
            )
        } else if err.starts_with("REQUEST_ID_CONFLICT") {
            (
                PublicErrorCode::RequestIdConflict,
                "error.requestIdConflict",
                false,
            )
        } else if err.starts_with("PREFERENCE_REVISION_CONFLICT") {
            (
                PublicErrorCode::ConcurrencyConflict,
                "error.preferencesConflict",
                true,
            )
        } else {
            (PublicErrorCode::InternalError, "error.internalError", true)
        };

        Self {
            protocol_version: 1,
            code,
            message_key: msg_key.to_string(),
            retryable,
            correlation_id: uuid::Uuid::now_v7().to_string(),
            field_errors: Vec::new(),
            retry_after_ms: None,
        }
    }
}

// ===== A5: provider commands + streaming =====

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderCapabilitiesDto {
    pub streaming: String,
    pub structured_output: String,
    pub tool_proposals: String,
    pub thinking: String,
    /// Image input (vision); unknown never renders as unsupported.
    pub image_input: String,
    /// Documented `think` values from `/api/show` (`thinking.values`):
    /// "true"/"false" and/or named levels. None = no documented metadata.
    pub thinking_values: Option<Vec<String>>,
    /// The value Ollama uses when `think` is absent, when documented.
    pub thinking_default: Option<String>,
}

/// Where a model descriptor's claims came from; empty source = legacy row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderModelEvidenceDto {
    pub source: String,
    pub server_version: Option<String>,
    /// RFC3339 UTC when discovery observed this descriptor; None means never
    /// observed (legacy stored row) and must render as unknown, not fresh.
    pub observed_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderModelDto {
    pub model_id: String,
    pub digest: String,
    pub human_label: String,
    pub privacy_class: String,
    pub capabilities: ProviderCapabilitiesDto,
    /// Model maximum context in tokens (model metadata), when evidenced.
    pub context_limit: Option<u32>,
    /// Endpoint-configured context (e.g. Modelfile num_ctx), when reported.
    pub configured_context: Option<u32>,
    /// Model max ∩ configured context; None when either bound is unknown.
    pub effective_context_budget: Option<u32>,
    pub evidence: ProviderModelEvidenceDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderModelsList {
    pub models: Vec<ProviderModelDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderAccountDto {
    pub account_id: String,
    pub alias: String,
    pub endpoint_url: String,
    pub privacy_class: String,
}

/// Metadata-only health: reachable + tag count. No prompt is ever sent and
/// no billable generation is run (P0-08 discovery/health authorization).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderHealthResponse {
    pub reachable: bool,
    pub model_tag_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TestProviderConnectionPayload {
    pub account_id: String,
    /// When set (with an empty `accountId`), probe this URL without saving
    /// anything ("failed test saves nothing").
    #[serde(default)]
    pub endpoint_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DiscoverOllamaModelsPayload {
    pub account_id: String,
}

/// `account_id: null` mints a new local account; a present id updates alias
/// and endpoint only (an endpoint change wipes the account's model rows).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateProviderAccountPayload {
    pub account_id: Option<String>,
    pub alias: Option<String>,
    pub endpoint_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompleteOncePayload {
    pub account_id: String,
    pub model_id: String,
    pub text: String,
    /// Turn mode ("ask" | "plan" | "code"): dispatched as a system instruction
    /// for this request only, never persisted to history. Absent = no
    /// instruction. "execute" is refused: no policy/tool runtime exists.
    pub mode: Option<String>,
    /// Documented Ollama `think` value for this request only: false disables
    /// reasoning, true requests it, a string selects a documented level.
    /// Absent = model default. Refused (THINKING_UNSUPPORTED / value not in
    /// `thinking_values`) unless the model documents that exact value —
    /// capability and parameter values are never assumed from a request.
    #[ts(type = "boolean | string | null")]
    pub think: Option<ThinkValue>,
}

/// Retry / regenerate: one NEW assistant attempt for an existing user turn.
/// `reply_to_message_id` is the user message whose turn is answered again —
/// the user row is never duplicated and previous attempts stay persisted.
/// Only the session's latest user turn may be retried, so an answer can never
/// be appended out of order. The original history is preserved; `mode` and
/// `think` follow the same rules as `CompleteOncePayload`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RetryCompletionPayload {
    pub account_id: String,
    pub model_id: String,
    pub reply_to_message_id: String,
    pub mode: Option<String>,
    #[ts(type = "boolean | string | null")]
    pub think: Option<ThinkValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompletionStartDto {
    pub op_id: String,
    pub message_id: String,
    /// Assembly summary for this dispatch (#[serde] None only when a legacy
    /// receipt is replayed: fresh dispatches always carry it).
    #[serde(default)]
    pub context: Option<ContextAssemblyDto>,
}

/// What was actually assembled for one dispatch. Token figures are estimates
/// (no tokenizer is embedded) and are labeled as such in the UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ContextAssemblyDto {
    pub estimated_input_tokens: u32,
    /// Evidenced input budget (model max ∩ configured num_ctx, minus the
    /// output reserve). None when either bound is unevidenced.
    pub input_budget_tokens: Option<u32>,
    /// Older messages dropped to fit caps/budget. Reported so history loss is
    /// never silent.
    pub dropped_messages: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StopCompletionPayload {
    pub op_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ListProviderModelsPayload {
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ListProviderModelsResponse {
    pub models: Vec<ProviderModelDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ListProviderAccountsResponse {
    pub accounts: Vec<ProviderAccountDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StopCompletionResponse {
    pub op_id: String,
    pub status: String,
}

/// One earlier-op-scoped event over the Channel; `sequence` starts at 1 and
/// increases in order per operation.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct StreamEventDto {
    pub op_id: String,
    #[ts(as = "u32")]
    pub sequence: u64,
    pub event: StreamEventPayloadDto,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "kebab-case")]
#[ts(export)]
pub enum StreamEventPayloadDto {
    Started,
    /// Reasoning activity marker: the reasoning text itself never crosses
    /// this boundary (no text, nothing to persist or display).
    Thinking,
    Delta {
        text: String,
    },
    Completed {
        /// "completed" | "interrupted" | "failed"
        completion: String,
        truncated: bool,
        usage: Option<MessageUsageV1>,
    },
}
