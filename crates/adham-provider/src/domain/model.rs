use crate::domain::account::{PrivacyClass, ProviderAccountId};
use crate::domain::endpoint::EndpointId;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ModelId(pub String);

impl ModelId {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
}

impl fmt::Display for ModelId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Supported,
    Unsupported,
    /// No evidence is no claim: a missing field never reads as a support
    /// claim, so stored rows from older schemas deserialize as unknown.
    #[default]
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub streaming: CapabilityStatus,
    pub structured_output: CapabilityStatus,
    pub tool_proposals: CapabilityStatus,
    pub thinking: CapabilityStatus,
    /// Image input (vision), evidenced by endpoint/model metadata. Model-name
    /// guesses and adapter field support do not prove it.
    #[serde(default)]
    pub image_input: CapabilityStatus,
}

impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            // Every capability starts Unknown; only a specific wire/metadata
            // source may raise one to Supported or Unsupported.
            streaming: CapabilityStatus::Unknown,
            structured_output: CapabilityStatus::Unknown,
            tool_proposals: CapabilityStatus::Unknown,
            thinking: CapabilityStatus::Unknown,
            image_input: CapabilityStatus::Unknown,
        }
    }
}

/// Where a descriptor's claims came from and when. Legacy rows deserialize
/// with empty evidence, which must render as unknown — never as fresh data.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct ModelEvidence {
    /// Short wire-metadata label, e.g. "ollama /api/show".
    #[serde(default)]
    pub source: String,
    /// Endpoint/daemon revision, when the endpoint reports one.
    #[serde(default)]
    pub server_version: Option<String>,
    /// Unix microseconds when discovery observed this descriptor.
    #[serde(default)]
    pub observed_at_us: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelDescriptor {
    pub model_id: ModelId,
    pub human_label: String,
    pub privacy_class: PrivacyClass,
    pub capabilities: ModelCapabilities,
    /// Evidence for the capability/limit claims above (empty = legacy row).
    #[serde(default)]
    pub evidence: ModelEvidence,
    /// Model maximum context in tokens, as reported by model metadata.
    #[serde(default)]
    pub context_limit: Option<u32>,
    /// Context configured for this model on the endpoint (e.g. Modelfile
    /// `num_ctx`), when reported. The server-wide default is not queryable
    /// and stays unknown rather than guessed.
    #[serde(default)]
    pub configured_context: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelSelectionSnapshot {
    pub account_id: ProviderAccountId,
    pub endpoint_id: EndpointId,
    pub model_id: ModelId,
    pub privacy_class: PrivacyClass,
}
