use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ProviderAccountId(pub String);

impl ProviderAccountId {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
}

impl fmt::Display for ProviderAccountId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    OllamaLocal,
    OllamaCloud,
    OpenAiCompatible,
    Anthropic,
    CustomLoopback,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyClass {
    LocalOnly,
    CloudConfidential,
    CloudStandard,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProviderAccountDescriptor {
    pub account_id: ProviderAccountId,
    pub kind: ProviderKind,
    pub alias: String,
    pub privacy_class: PrivacyClass,
    pub endpoint_id: String,
}
