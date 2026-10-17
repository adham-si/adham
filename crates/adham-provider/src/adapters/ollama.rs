use crate::domain::error::ProviderError;
use crate::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OllamaChatMessage {
    pub role: Option<String>,
    pub content: Option<String>,
    /// Reasoning-model chain-of-thought; never leaves the parser as text.
    pub thinking: Option<String>,
    /// Tool/structured output; only presence is observed (never content).
    pub tool_calls: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OllamaStreamChunk {
    pub model: Option<String>,
    pub message: Option<OllamaChatMessage>,
    pub done: bool,
    /// Terminal reason on the final frame; missing on progress chunks.
    /// Ollama uses `load`, `length`, `stop` etc.
    #[serde(default)]
    pub done_reason: Option<String>,
    pub prompt_eval_count: Option<u32>,
    pub eval_count: Option<u32>,
}

pub struct OllamaStreamParser;

impl OllamaStreamParser {
    pub fn parse_line(line: &str) -> Result<Vec<NormalizedStreamEvent>, ProviderError> {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let chunk: OllamaStreamChunk = serde_json::from_str(trimmed).map_err(|e| {
            ProviderError::ProtocolParseError(format!("Invalid Ollama NDJSON: {e}"))
        })?;

        let mut events = Vec::new();

        if let Some(msg) = chunk.message {
            if msg.thinking.as_deref().is_some_and(|t| !t.is_empty()) {
                // activity marker only: the reasoning text itself is dropped here
                events.push(NormalizedStreamEvent::ThinkingActivity);
            }
            if msg
                .tool_calls
                .as_deref()
                .is_some_and(|calls| !calls.is_empty())
            {
                // presence only: call payloads are neither logged nor stored
                events.push(NormalizedStreamEvent::StructuredActivity);
            }
            if let Some(content) = msg.content {
                if !content.is_empty() {
                    events.push(NormalizedStreamEvent::TextDelta(content));
                }
            }
        }

        if let (Some(prompt_tokens), Some(completion_tokens)) =
            (chunk.prompt_eval_count, chunk.eval_count)
        {
            events.push(NormalizedStreamEvent::Progress(StreamUsage {
                prompt_tokens,
                completion_tokens,
                total_tokens: prompt_tokens + completion_tokens,
            }));
        }

        if chunk.done {
            // done_reason is authoritative on a valid terminal (done:true)
            // frame: `length` means num_predict truncated the answer. A
            // missing reason keeps legacy compatibility for older daemons,
            // but an explicit reason this build does not know is never a
            // successful stop.
            let outcome = match chunk.done_reason.as_deref() {
                Some("stop") | None => StreamCompletionOutcome::Stop,
                Some("length") => StreamCompletionOutcome::LengthExceeded,
                Some(reason) => StreamCompletionOutcome::Unknown {
                    // bounded: provider-controlled metadata, never reasoning text
                    reason: reason.chars().take(64).collect(),
                },
            };
            events.push(NormalizedStreamEvent::StreamCompleted(outcome));
        }

        Ok(events)
    }
}
