use crate::domain::error::ProviderError;
use crate::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OllamaChatMessage {
    pub role: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct OllamaStreamChunk {
    pub model: Option<String>,
    pub message: Option<OllamaChatMessage>,
    pub done: bool,
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
            events.push(NormalizedStreamEvent::StreamCompleted(
                StreamCompletionOutcome::Stop,
            ));
        }

        Ok(events)
    }
}
