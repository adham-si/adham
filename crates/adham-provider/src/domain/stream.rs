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
    /// Normal terminal that produced no answer text: thinking-only runs and
    /// silent refusals are failures, never empty successes.
    EmptyAnswer,
    /// The model produced only non-text structured output (e.g. tool calls).
    /// This build executes nothing, so the turn has no text answer; it is
    /// not an "empty answer" error either.
    StructuredOnly,
    /// Explicit provider terminal reason this build does not recognize.
    /// Never maps to a successful stop.
    Unknown {
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "snake_case")]
pub enum NormalizedStreamEvent {
    StreamStarted,
    TextDelta(String),
    /// Provider reasoning activity. The reasoning text is withheld at the
    /// adapter boundary: only the activity marker crosses.
    ThinkingActivity,
    /// Legacy variant kept for adapter parity; consumers treat it exactly
    /// like `ThinkingActivity` (activity only, text never crosses).
    ThinkingDelta(String),
    /// Non-text structured output observed (e.g. tool calls). The payload is
    /// withheld: this build neither executes nor displays it.
    StructuredActivity,
    Progress(StreamUsage),
    StreamCompleted(StreamCompletionOutcome),
}
