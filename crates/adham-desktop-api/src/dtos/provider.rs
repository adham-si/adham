//! Provider command payloads/results and streaming DTOs (Delivery A5+G).
//!
//! Split out of `dtos.rs` for the file-size policy; identical types are
//! re-exported from `crate::dtos`, so every consumer path is unchanged.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use adham_core_types::MessageUsageV1;

// ===== A5: provider commands + streaming =====

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ProviderCapabilitiesDto {
    pub streaming: String,
    pub structured_output: String,
    pub tool_proposals: String,
    pub thinking: String,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CompletionStartDto {
    pub op_id: String,
    pub message_id: String,
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
