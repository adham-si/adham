use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct StreamUsage {
    pub prompt_tokens: u32,
    pub completion_tokens: u32,
    pub total_tokens: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StreamCompletionOutcome {
    Stop,
    LengthExceeded,
    ContentFilter,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum NormalizedStreamEvent {
    StreamStarted,
    TextDelta(String),
    ThinkingDelta(String),
    Progress(StreamUsage),
    StreamCompleted(StreamCompletionOutcome),
}
