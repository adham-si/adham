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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CapabilityStatus {
    Supported,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelCapabilities {
    pub streaming: CapabilityStatus,
    pub structured_output: CapabilityStatus,
    pub tool_proposals: CapabilityStatus,
    pub thinking: CapabilityStatus,
}

impl Default for ModelCapabilities {
    fn default() -> Self {
        Self {
            streaming: CapabilityStatus::Supported,
            structured_output: CapabilityStatus::Unknown,
            tool_proposals: CapabilityStatus::Unknown,
            thinking: CapabilityStatus::Unknown,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelDescriptor {
    pub model_id: ModelId,
    pub human_label: String,
    pub privacy_class: PrivacyClass,
    pub capabilities: ModelCapabilities,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ModelSelectionSnapshot {
    pub account_id: ProviderAccountId,
    pub endpoint_id: EndpointId,
    pub model_id: ModelId,
    pub privacy_class: PrivacyClass,
}
