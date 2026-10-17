//! A3: Ollama HTTP adapter (Ollama Local), wire-only — discovery and the
//! streaming `/api/chat` path over the shared transport.
//!
//! Policy: loopback-only base URLs, digest-pinned model evidence required for
//! a local-only dispatch (the pinned digest is the local-blob evidence; an
//! unpinnable/unknown model dispatches NOTHING), and `/api/show` evidence
//! mapped to the capability tri-state (`/api/show` failure ⇒ unknown still
//! unknown; unknown never upgrades). A stream that ends without a terminal
//! frame is an error — truncation is never reported as completion.

use crate::adapters::ollama::OllamaStreamParser;
use crate::domain::account::PrivacyClass;
use crate::domain::endpoint::EndpointDescriptor;
use crate::domain::error::ProviderError;
use crate::domain::model::{CapabilityStatus, ModelCapabilities, ModelDescriptor, ModelId};
use crate::domain::request::{MessageRole, ProviderRequestV1};
use crate::domain::stream::NormalizedStreamEvent;
use crate::registry::PinnedModel;
use crate::transport::{HttpTransport, TransportError, MAX_FRAME_BYTES};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;

pub struct OllamaHttpAdapter {
    transport: HttpTransport,
    base_url: String,
}

impl OllamaHttpAdapter {
    /// Loopback-only: Ollama Local is a local workload; a non-loopback base
    /// URLs is a policy violation before any socket is opened.
    pub fn new(transport: HttpTransport, base_url: &str) -> Result<Self, ProviderError> {
        EndpointDescriptor::validate_url(base_url)?;
        if !is_loopback_base(base_url) {
            return Err(ProviderError::EndpointPolicyViolation(format!(
                "Ollama Local adapter only accepts loopback endpoints: '{base_url}'"
            )));
        }
        Ok(Self {
            transport,
            base_url: base_url.trim_end_matches('/').to_string(),
        })
    }

    /// `GET /api/tags` + `POST /api/show` per model: digest pins the local
    /// blob; `/api/show` capabilities become the tri-state. A model whose
    /// `/api/show` call fails is still listed, with unknown capabilities
    /// (unverifiable stays unverifiable — never claimed as present).
    pub async fn discover(&self) -> Result<Vec<PinnedModel>, ProviderError> {
        let tags = self
            .transport
            .get_json(&format!("{}/api/tags", self.base_url))
            .await
            .map_err(transport_err)?;

        let mut out = Vec::new();
        let entries = tags
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for entry in entries {
            let Some(name) = entry.get("name").and_then(Value::as_str) else {
                continue;
            };
            // unpinnable (missing digest) stays pinned-empty: local-only
            // dispatch is blocked for it rather than guessed.
            let digest = entry
                .get("digest")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let capabilities = match self
                .transport
                .post_json_document(
                    &format!("{}/api/show", self.base_url),
                    &json!({ "model": name }),
                )
                .await
            {
                Ok(show) => map_show_capabilities(&show),
                Err(TransportError::Status(_, _)) => ModelCapabilities::default(),
                Err(e) => return Err(transport_err(e)),
            };
            out.push(PinnedModel {
                model_id: ModelId::new(name),
                digest,
                descriptor: ModelDescriptor {
                    model_id: ModelId::new(name),
                    human_label: name.to_string(),
                    privacy_class: PrivacyClass::LocalOnly,
                    capabilities,
                },
            });
        }
        Ok(out)
    }

    /// Start a streaming chat. Local-only requests require digest-pinned
    /// evidence; anything else is refused before the socket.
    pub async fn stream_chat(
        &self,
        pinned: &PinnedModel,
        request: &ProviderRequestV1,
    ) -> Result<OllamaChatStream, ProviderError> {
        if request.model_selection.privacy_class == PrivacyClass::LocalOnly
            && pinned.digest.is_empty()
        {
            return Err(ProviderError::ModelCapabilityMismatch(
                "unknown required capability: local-only dispatch requires digest-pinned model evidence"
                    .into(),
            ));
        }

        let body = chat_request_body(pinned, request);
        let bytes = self
            .transport
            .post_json(&format!("{}/api/chat", self.base_url), &body)
            .await
            .map_err(transport_err)?;
        Ok(OllamaChatStream::new(bytes))
    }
}

fn is_loopback_base(url: &str) -> bool {
    let lower = url.to_lowercase();
    let Some(rest) = lower
        .strip_prefix("http://")
        .or_else(|| lower.strip_prefix("https://"))
    else {
        return false;
    };
    // same host treatment as `EndpointDescriptor::validate_url` (cuts the
    // port for v4/named hosts; bracketed v6 follows validate_url's behavior)
    matches!(
        rest.split(['/', ':']).next().unwrap_or(""),
        "localhost" | "127.0.0.1" | "0.0.0.0" | "[::1]" | "::1"
    )
}

/// wire → tri-state. `streaming` is protocol-structural for `/api/chat`
/// (Ollama's only transport); the rest come from the `capabilities` list,
/// with anything absent left unknown — unknown never upgrades itself.
fn map_show_capabilities(show: &Value) -> ModelCapabilities {
    let caps: Vec<&str> = show
        .get("capabilities")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let has = |name: &str| caps.contains(&name);
    let truth = |present: bool| {
        if present {
            CapabilityStatus::Supported
        } else {
            CapabilityStatus::Unsupported
        }
    };
    ModelCapabilities {
        streaming: CapabilityStatus::Supported,
        // no wire evidence in /api/show for structured output — stays unknown
        structured_output: CapabilityStatus::Unknown,
        tool_proposals: truth(has("tools")),
        // `thinking` capability absent ⇒ not evidenced (could be true on some
        // models); unknown blocks feature use rather than guessing
        thinking: if has("thinking") {
            CapabilityStatus::Supported
        } else {
            CapabilityStatus::Unknown
        },
    }
}

fn chat_request_body(pinned: &PinnedModel, request: &ProviderRequestV1) -> Value {
    let mut options = Map::new();
    if let Some(num_predict) = request.max_output_tokens {
        options.insert("num_predict".into(), json!(num_predict));
    }
    if let Some(temperature) = request.temperature {
        options.insert("temperature".into(), json!(temperature));
    }
    let mut body = json!({
        "model": pinned.model_id.0,
        "messages": request
            .messages
            .iter()
            .map(|m| json!({
                "role": match m.role {
                    MessageRole::System => "system",
                    MessageRole::User => "user",
                    MessageRole::Assistant => "assistant",
                },
                "content": m.content,
            }))
            .collect::<Vec<_>>(),
        "stream": true,
    });
    if !options.is_empty() {
        body["options"] = Value::Object(options);
    }
    body
}

fn transport_err(e: TransportError) -> ProviderError {
    e.into_provider_error()
}

/// Normalized chat stream: emits `StreamStarted` first, then parser events in
/// order, terminating with the parser's terminal event. A clean EOF without
/// a terminal frame is an error — a truncated stream is never completed.
pub struct OllamaChatStream {
    bytes: crate::transport::ByteStream,
    queue: VecDeque<NormalizedStreamEvent>,
    started: bool,
    done: bool,
}

impl std::fmt::Debug for OllamaChatStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("OllamaChatStream")
            .field("started", &self.started)
            .field("done", &self.done)
            .field("queued", &self.queue.len())
            .finish()
    }
}

impl OllamaChatStream {
    fn new(bytes: crate::transport::ByteStream) -> Self {
        Self {
            bytes,
            queue: VecDeque::new(),
            started: false,
            done: false,
        }
    }

    /// Next normalized event; `None` only after a terminal event. Frame caps
    /// and deadlines come from the transport (`MAX_FRAME_BYTES` ≈ 1 MiB).
    pub async fn next_event(&mut self) -> Option<Result<NormalizedStreamEvent, ProviderError>> {
        // queued events (e.g. Progress paired with the terminal frame) drain
        // first — `done` must not swallow them
        if let Some(event) = self.queue.pop_front() {
            return Some(Ok(event));
        }
        if self.done {
            return None;
        }
        if !self.started {
            self.started = true;
            return Some(Ok(NormalizedStreamEvent::StreamStarted));
        }

        match self.bytes.next_line().await {
            Ok(Some(line)) => {
                if line.len() > MAX_FRAME_BYTES {
                    self.done = true;
                    return Some(Err(ProviderError::ProtocolParseError(format!(
                        "frame exceeded {MAX_FRAME_BYTES} bytes"
                    ))));
                }
                match OllamaStreamParser::parse_line(&line) {
                    Ok(events) => {
                        self.done = events
                            .iter()
                            .any(|e| matches!(e, NormalizedStreamEvent::StreamCompleted(_)));
                        self.queue.extend(events);
                        Some(Ok(self.queue.pop_front().expect("events queued")))
                    }
                    Err(e) => {
                        self.done = true;
                        Some(Err(e))
                    }
                }
            }
            Ok(None) => {
                // clean end without a terminal frame = truncated stream
                self.done = true;
                Some(Err(ProviderError::TransportError(
                    "stream ended without terminal frame".into(),
                )))
            }
            Err(e) => {
                self.done = true;
                Some(Err(e.into_provider_error()))
            }
        }
    }
}
