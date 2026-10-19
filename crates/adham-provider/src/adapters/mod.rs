pub mod gemini_http;
pub mod mock;
pub mod ollama;
pub mod ollama_http;

pub use gemini_http::*;
pub use mock::*;
pub use ollama::*;
pub use ollama_http::*;

use crate::domain::error::ProviderError;
use crate::domain::request::ProviderRequestV1;
use crate::domain::stream::NormalizedStreamEvent;
use crate::registry::PinnedModel;

/// Kind-routed adapter set: dispatch sites branch on the account kind ONCE,
/// here. Adding a kind grows this enum and it alone — no call-site change.
pub enum AnyAdapter {
    Ollama(OllamaHttpAdapter),
    Gemini(GeminiHttpAdapter),
}

impl AnyAdapter {
    pub async fn stream_chat(
        &self,
        pinned: &PinnedModel,
        request: &ProviderRequestV1,
    ) -> Result<AnyStream, ProviderError> {
        match self {
            Self::Ollama(a) => Ok(AnyStream::Ollama(a.stream_chat(pinned, request).await?)),
            Self::Gemini(a) => Ok(AnyStream::Gemini(a.stream_chat(pinned, request).await?)),
        }
    }

    pub async fn discover(&self) -> Result<Vec<PinnedModel>, ProviderError> {
        match self {
            Self::Ollama(a) => a.discover().await,
            Self::Gemini(a) => a.discover().await,
        }
    }

    /// Metadata-only health probe; returns the model count for the UI.
    pub async fn connection_test(&self) -> Result<usize, ProviderError> {
        match self {
            Self::Ollama(a) => a.connection_test().await,
            Self::Gemini(a) => a.connection_test().await,
        }
    }
}

/// Shared event plumbing: both wire parsers normalize into the same stream
/// contract, so orchestration (run_stream) stays byte-identical per kind.
pub enum AnyStream {
    Ollama(OllamaChatStream),
    Gemini(GeminiChatStream),
}

impl AnyStream {
    pub async fn next_event(&mut self) -> Option<Result<NormalizedStreamEvent, ProviderError>> {
        match self {
            Self::Ollama(s) => s.next_event().await,
            Self::Gemini(s) => s.next_event().await,
        }
    }
}
