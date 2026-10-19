//! Provider command payloads/results and streaming DTOs (Delivery A5+G).
//!
//! Split out of `dtos.rs` for the file-size policy; identical types are
//! re-exported from `crate::dtos`, so every consumer path is unchanged.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use adham_core_types::MessageUsageV1;
use adham_provider::domain::request::ThinkValue;

use super::MessageReferenceDto;

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
    /// Additive (Delivery G1): adapter family of the account — the frontend
    /// must branch on this kind, never on URLs or model names.
    pub kind: String,
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

/// G2: Google account configuration. Write-only: the API key is sealed into
/// the credential vault at storage level and echoed back to nobody. Rotation
/// targets an existing Google account via `accountId`; `acknowledgeCloudTransfer`
/// must be true before anything is persisted.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConfigureGoogleAccountPayload {
    pub account_id: Option<String>,
    pub alias: Option<String>,
    pub api_key: String,
    pub acknowledge_cloud_transfer: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DisconnectGoogleAccountPayload {
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GoogleAccountDisconnected {
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DisconnectOllamaAccountPayload {
    pub account_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct OllamaAccountDisconnected {
    pub account_id: String,
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
    /// Optional durable reference this submission records: a reply quote
    /// anchor ("replied") or an edit alternative ("edited-from"). Validated
    /// against persisted history before anything is written — the target must
    /// be a message of this session, and only a user message can be edited.
    /// An "edited-from" branch is answered against the context its original
    /// had (everything before the edited message, plus this text): the
    /// original and whatever followed it stay persisted and visible, but are
    /// never fed back to the model.
    pub reference: Option<MessageReferenceDto>,
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
