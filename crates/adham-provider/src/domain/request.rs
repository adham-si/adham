use crate::domain::model::ModelSelectionSnapshot;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageRole {
    System,
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: MessageRole,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderRequestV1 {
    pub operation_id: String,
    pub model_selection: ModelSelectionSnapshot,
    pub messages: Vec<ChatMessage>,
    pub max_output_tokens: Option<u32>,
    pub temperature: Option<f32>,
    /// Documented Ollama `think` parameter; None = model default. The caller
    /// validates the value against the model's documented `thinking.values`
    /// before dispatch — an undocumented value is refused, never sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub think: Option<ThinkValue>,
}

/// A documented `think` value: `false`/`true` for on/off models, or a named
/// level exactly as `/api/show` `thinking.values` states it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ThinkValue {
    Bool(bool),
    Level(String),
}

impl ThinkValue {
    /// The wire form, matching how `/api/show` states documented values
    /// (JSON booleans compare as "true"/"false").
    pub fn as_documented(&self) -> String {
        match self {
            Self::Bool(value) => value.to_string(),
            Self::Level(level) => level.clone(),
        }
    }
}

impl ProviderRequestV1 {
    pub fn simple_prompt(
        operation_id: impl Into<String>,
        model_selection: ModelSelectionSnapshot,
        prompt: impl Into<String>,
    ) -> Self {
        Self {
            operation_id: operation_id.into(),
            model_selection,
            messages: vec![ChatMessage {
                role: MessageRole::User,
                content: prompt.into(),
            }],
            max_output_tokens: Some(4096),
            temperature: Some(0.7),
            think: None,
        }
    }
}
