//! G3: Gemini HTTP adapter (Google Gemini), wire-only — discovery
//! (`GET /v1beta/models`) and the streaming `:streamGenerateContent?alt=sse`
//! path over the shared transport.
//!
//! Policy: the official endpoint is the only production base URL (exact host +
//! scheme allowlist before any socket is opened); the API key travels
//! exclusively in `x-goog-api-key`, never as a query parameter (keyed URLs
//! leak into logs, history, and previews); a non-Cloud model selection never
//! reaches the socket; capability evidence comes from
//! `supportedGenerationMethods` alone — everything the wire did not say stays
//! unknown. Terminal semantics fail closed: unknown finish reasons,
//! `promptFeedback` blocks, safety families, and `MALFORMED_FUNCTION_CALL`
//! all mean "not a completed answer" (Interrupted / ContentFilter), never a
//! fabricated completion.

use crate::domain::account::PrivacyClass;
use crate::domain::endpoint::EndpointDescriptor;
use crate::domain::error::ProviderError;
use crate::domain::model::{CapabilityStatus, ModelCapabilities, ModelId};
use crate::domain::request::{MessageRole, ProviderRequestV1};
use crate::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use crate::registry::PinnedModel;
use crate::transport::{HttpTransport, MAX_FRAME_BYTES};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::VecDeque;
use std::fmt;

pub struct GoogleApiKey(String);

impl GoogleApiKey {
    pub fn new(raw: &str) -> Result<Self, ProviderError> {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(ProviderError::EndpointPolicyViolation(
                "refusing an empty Google API key".into(),
            ));
        }
        Ok(Self(trimmed.to_string()))
    }

    fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for GoogleApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // never echo key material into logs or error reports
        write!(f, "GoogleApiKey([redacted])")
    }
}

impl fmt::Debug for GeminiHttpAdapter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // the key must never reach a Debug render — only structural fields show
        f.debug_struct("GeminiHttpAdapter")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

pub struct GeminiHttpAdapter {
    transport: HttpTransport,
    base_url: String,
    api_key: GoogleApiKey,
}

impl GeminiHttpAdapter {
    /// The single production endpoint. Hard allowlist: exact scheme + host,
    /// no ports, no mirrors, no proxies.
    pub const OFFICIAL_BASE_URL: &'static str = "https://generativelanguage.googleapis.com";

    pub fn new(
        transport: HttpTransport,
        base_url: &str,
        api_key: GoogleApiKey,
    ) -> Result<Self, ProviderError> {
        if base_url.trim_end_matches('/') != Self::OFFICIAL_BASE_URL {
            return Err(ProviderError::EndpointPolicyViolation(format!(
                "Gemini adapter only accepts the official Google endpoint, got '{base_url}'"
            )));
        }
        Ok(Self {
            transport,
            base_url: Self::OFFICIAL_BASE_URL.to_string(),
            api_key,
        })
    }

    /// TEST SEAM — integration fixtures hit a local listener stub; production
    /// construction must use `new` (the official-endpoint allowlist). This is
    /// never called from production dispatch paths.
    #[doc(hidden)]
    pub fn new_for_test(
        transport: HttpTransport,
        base_url: &str,
        api_key: GoogleApiKey,
    ) -> Result<Self, ProviderError> {
        EndpointDescriptor::validate_url(base_url)
            .map_err(|e| ProviderError::EndpointPolicyViolation(e.to_string()))?;
        Ok(Self {
            transport,
            base_url: base_url.trim_end_matches('/').to_string(),
            api_key,
        })
    }

    fn auth_headers(&self) -> Vec<(String, String)> {
        vec![("x-goog-api-key".into(), self.api_key.expose().into())]
    }

    /// Metadata-only connection probe: `GET /v1beta/models` carries no prompt
    /// and runs no billable generation. Returns the row count for the UI.
    pub async fn connection_test(&self) -> Result<usize, ProviderError> {
        let doc = self
            .transport
            .get_json_with_headers(
                &format!("{}/v1beta/models", self.base_url),
                &self.auth_headers(),
            )
            .await
            .map_err(|e| e.into_provider_error())?;
        Ok(doc
            .get("models")
            .and_then(Value::as_array)
            .map(|a| a.len())
            .unwrap_or(0))
    }

    /// Discovery maps the models list into registry rows. `models/gemini-*`
    /// resource names strip their `models/` prefix; `displayName` is the human
    /// label; cloud rows carry no digest (cloud models have no local blob).
    pub async fn discover(&self) -> Result<Vec<PinnedModel>, ProviderError> {
        let doc = self
            .transport
            .get_json_with_headers(
                &format!("{}/v1beta/models", self.base_url),
                &self.auth_headers(),
            )
            .await
            .map_err(|e| e.into_provider_error())?;

        let mut out = Vec::new();
        let entries = doc
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for entry in entries {
            let Some(name) = entry.get("name").and_then(Value::as_str) else {
                continue;
            };
            let model_id = name.strip_prefix("models/").unwrap_or(name);
            if model_id.is_empty() {
                continue;
            }
            let display_name = entry
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(model_id);
            out.push(PinnedModel {
                model_id: ModelId::new(model_id),
                digest: String::new(),
                descriptor: crate::domain::model::ModelDescriptor {
                    model_id: ModelId::new(model_id),
                    human_label: display_name.to_string(),
                    privacy_class: PrivacyClass::CloudStandard,
                    capabilities: map_discovery_capabilities(&entry),
                },
            });
        }
        Ok(out)
    }

    /// Start a streaming generation. Only a CloudStandard selection dispatches
    /// to Google — a local-only selection is refused before any socket.
    pub async fn stream_chat(
        &self,
        pinned: &PinnedModel,
        request: &ProviderRequestV1,
    ) -> Result<GeminiChatStream, ProviderError> {
        if request.model_selection.privacy_class != PrivacyClass::CloudStandard {
            return Err(ProviderError::ModelCapabilityMismatch(
                "unsupported required capability: Google Gemini dispatch requires a CloudStandard model selection"
                    .into(),
            ));
        }
        let url = format!(
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
            self.base_url, pinned.model_id.0
        );
        let bytes = self
            .transport
            .post_json_with_headers(&url, &stream_request_body(request), &self.auth_headers())
            .await
            .map_err(|e| e.into_provider_error())?;
        Ok(GeminiChatStream::new(bytes))
    }
}

/// `supportedGenerationMethods` is the only capability source at discovery:
/// `generateContent` present ⇒ streaming Supported; everything else stays
/// unknown until the wire proves it during a generation.
fn map_discovery_capabilities(entry: &Value) -> ModelCapabilities {
    let methods: Vec<&str> = entry
        .get("supportedGenerationMethods")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    ModelCapabilities {
        streaming: if methods.contains(&"generateContent") {
            CapabilityStatus::Supported
        } else {
            CapabilityStatus::Unknown
        },
        structured_output: CapabilityStatus::Unknown,
        tool_proposals: CapabilityStatus::Unknown,
        thinking: CapabilityStatus::Unknown,
    }
}

/// v1beta `GenerateContentResponse` (streamData frame). Typed for the fields
/// we normalize; everything else passes through untouched by serde defaults.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct GenerateContentFrame {
    #[serde(default)]
    pub candidates: Option<Vec<GenerateCandidate>>,
    #[serde(rename = "promptFeedback", default)]
    pub prompt_feedback: Option<PromptFeedback>,
    #[serde(rename = "usageMetadata", default)]
    pub usage_metadata: Option<UsageMetadata>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct GenerateCandidate {
    #[serde(default)]
    pub content: Option<GenerateContentPayload>,
    #[serde(rename = "finishReason")]
    pub finish_reason: Option<String>,
    #[serde(default)]
    pub index: i32,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct GenerateContentPayload {
    #[serde(default)]
    pub parts: Option<Vec<GeneratePart>>,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct GeneratePart {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub thought: Option<bool>,
    #[serde(rename = "functionCall", default)]
    pub function_call: Option<Value>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct PromptFeedback {
    #[serde(rename = "blockReason")]
    pub block_reason: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct UsageMetadata {
    #[serde(rename = "promptTokenCount")]
    pub prompt_token_count: Option<u32>,
    #[serde(rename = "candidatesTokenCount")]
    pub candidates_token_count: Option<u32>,
    #[serde(rename = "thoughtsTokenCount")]
    pub thoughts_token_count: Option<u32>,
    #[serde(rename = "totalTokenCount")]
    pub total_token_count: Option<u32>,
}

/// SSE → normalized events for ONE `data:` JSON payload.
///
/// Fail-closed terminal mapping (authoritative wire field, never guessed):
/// `STOP`→Stop; `MAX_TOKENS`→LengthExceeded; the safety/block family
/// (SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII)→ContentFilter;
/// everything else — including unknown strings and `MALFORMED_FUNCTION_CALL`
/// —→Interrupted. `promptFeedback.blockReason` (any value)→ContentFilter:
/// a blocked prompt never produced an answer. Thinking parts land as
/// `ThinkingDelta`; thought tokens bill inside completion usage.
pub struct GeminiStreamParser;

impl GeminiStreamParser {
    pub fn parse_payload(payload: &str) -> Result<Vec<NormalizedStreamEvent>, ProviderError> {
        let frame: GenerateContentFrame = serde_json::from_str(payload).map_err(|e| {
            ProviderError::ProtocolParseError(format!("Invalid Gemini SSE frame: {e}"))
        })?;

        let mut events = Vec::new();

        // a prompt-level block kills the turn: no answer was ever produced
        if let Some(block_reason) = frame.prompt_feedback.and_then(|p| p.block_reason) {
            if !block_reason.is_empty() {
                events.push(NormalizedStreamEvent::StreamCompleted(
                    StreamCompletionOutcome::ContentFilter,
                ));
                return Ok(events);
            }
        }

        if let Some(candidates) = &frame.candidates {
            // candidates[0] only: multi-candidate responses were never requested;
            // extra candidates are not our answer
            if let Some(candidate) = candidates.iter().find(|c| c.index == 0) {
                if let Some(content) = &candidate.content {
                    for part in content.parts.iter().flatten() {
                        let Some(text) = part.text.as_deref() else {
                            continue;
                        };
                        if text.is_empty() {
                            continue;
                        }
                        if part.thought == Some(true) {
                            events.push(NormalizedStreamEvent::ThinkingDelta(text.into()));
                        } else {
                            events.push(NormalizedStreamEvent::TextDelta(text.into()));
                        }
                    }
                }
                if let Some(outcome) = candidate.finish_reason.as_deref().map(map_finish_reason) {
                    if let Some(usage) = usage_event(&frame.usage_metadata) {
                        events.push(usage);
                    }
                    events.push(NormalizedStreamEvent::StreamCompleted(outcome));
                }
            }
        }

        // a frame without a terminal emits deltas/usage only; a frame without
        // any recognized content emits nothing (keep-alives stay silent)
        Ok(events)
    }
}

fn map_finish_reason(reason: &str) -> StreamCompletionOutcome {
    match reason {
        "STOP" => StreamCompletionOutcome::Stop,
        "MAX_TOKENS" => StreamCompletionOutcome::LengthExceeded,
        "SAFETY" | "RECITATION" | "BLOCKLIST" | "PROHIBITED_CONTENT" | "SPII" => {
            StreamCompletionOutcome::ContentFilter
        }
        // MALFORMED_FUNCTION_CALL + LANGUAGE + OTHER + future unknowns:
        // fail closed — the turn did not produce a trustworthy answer.
        // (Contract note for #32: a visible failure message needs an additive
        // contract delta; Interrupted is the honest terminal available today.)
        _ => StreamCompletionOutcome::Interrupted,
    }
}

/// Usage passes field-for-field into the three-bucket contract: thought
/// tokens bill as completion tokens; `totalTokenCount` is authoritative when
/// present (never recomputed).
fn usage_event(usage: &Option<UsageMetadata>) -> Option<NormalizedStreamEvent> {
    let usage = usage.as_ref()?;
    let prompt_tokens = usage.prompt_token_count.unwrap_or(0);
    let completion_tokens =
        usage.candidates_token_count.unwrap_or(0) + usage.thoughts_token_count.unwrap_or(0);
    if prompt_tokens == 0 && completion_tokens == 0 {
        return None;
    }
    let total_tokens = usage
        .total_token_count
        .unwrap_or(prompt_tokens + completion_tokens);
    Some(NormalizedStreamEvent::Progress(StreamUsage {
        prompt_tokens,
        completion_tokens,
        total_tokens,
    }))
}

fn stream_request_body(request: &ProviderRequestV1) -> Value {
    // system messages fold into `systemInstruction`; user/assistant map to
    // the two roles Gemini understands (user/model)
    let mut system_texts = Vec::new();
    let mut contents = Vec::new();
    for message in &request.messages {
        match message.role {
            MessageRole::System => system_texts.push(message.content.clone()),
            MessageRole::User => contents.push(json!({
                "role": "user",
                "parts": [{ "text": message.content }],
            })),
            MessageRole::Assistant => contents.push(json!({
                "role": "model",
                "parts": [{ "text": message.content }],
            })),
        }
    }
    let mut config = Map::new();
    if let Some(max_output_tokens) = request.max_output_tokens {
        config.insert("maxOutputTokens".into(), json!(max_output_tokens));
    }
    if let Some(temperature) = request.temperature {
        config.insert("temperature".into(), json!(temperature));
    }
    let mut body = json!({
        "contents": contents,
        "generationConfig": Value::Object(config),
    });
    if !system_texts.is_empty() {
        body["systemInstruction"] = json!({ "parts": [{ "text": system_texts.join("\n\n") }] });
    }
    body
}

/// Normalized SSE stream: `StreamStarted` first, parser events in order, then
/// the parser's terminal event. A clean EOF without a terminal frame is an
/// error — truncation is never reported as completion. Late frames after the
/// first terminal stay streamed (their text keeps the record) but can never
/// introduce a second terminal or usage billing.
pub struct GeminiChatStream {
    bytes: crate::transport::ByteStream,
    queue: VecDeque<NormalizedStreamEvent>,
    started: bool,
    terminal_done: bool,
    finished: bool,
}

impl std::fmt::Debug for GeminiChatStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GeminiChatStream")
            .field("started", &self.started)
            .field("terminal_done", &self.terminal_done)
            .field("finished", &self.finished)
            .finish()
    }
}

impl GeminiChatStream {
    fn new(bytes: crate::transport::ByteStream) -> Self {
        Self {
            bytes,
            queue: VecDeque::new(),
            started: false,
            terminal_done: false,
            finished: false,
        }
    }

    pub async fn next_event(&mut self) -> Option<Result<NormalizedStreamEvent, ProviderError>> {
        if let Some(event) = self.queue.pop_front() {
            return Some(Ok(event));
        }
        if self.finished {
            return None;
        }
        if !self.started {
            self.started = true;
            return Some(Ok(NormalizedStreamEvent::StreamStarted));
        }

        loop {
            match self.bytes.next_line().await {
                Ok(Some(line)) => {
                    let line = line.trim();
                    if line.is_empty() || line.starts_with(':') || !line.starts_with("data:") {
                        // SSE comment/keep-alive or a non-data field — skip
                        continue;
                    }
                    if line.len() > MAX_FRAME_BYTES {
                        self.finished = true;
                        return Some(Err(ProviderError::ProtocolParseError(format!(
                            "frame exceeded {MAX_FRAME_BYTES} bytes"
                        ))));
                    }
                    let payload = line["data:".len()..].trim();
                    if payload.is_empty() {
                        continue;
                    }
                    match GeminiStreamParser::parse_payload(payload) {
                        Ok(events) => {
                            let terminal = events
                                .iter()
                                .any(|e| matches!(e, NormalizedStreamEvent::StreamCompleted(_)));
                            // post-terminal frames: their text may keep the
                            // record, but a first terminal is authoritative —
                            // no second completion, no post-terminal billing
                            let emit: Vec<NormalizedStreamEvent> = if self.terminal_done {
                                events
                                    .into_iter()
                                    .filter(|e| {
                                        !matches!(e, NormalizedStreamEvent::StreamCompleted(_))
                                    })
                                    .collect()
                            } else {
                                self.terminal_done = terminal;
                                events
                            };
                            if !self.terminal_done || !emit.is_empty() {
                                self.queue.extend(emit);
                            }
                            match self.queue.pop_front() {
                                Some(event) => return Some(Ok(event)),
                                None if self.terminal_done => {
                                    self.finished = true;
                                    return None;
                                }
                                None => continue,
                            }
                        }
                        Err(e) => {
                            self.finished = true;
                            return Some(Err(e));
                        }
                    }
                }
                Ok(None) => {
                    self.finished = true;
                    if self.terminal_done {
                        return None;
                    }
                    // clean end without a terminal frame = truncated stream
                    return Some(Err(ProviderError::TransportError(
                        "stream ended without terminal frame".into(),
                    )));
                }
                Err(e) => {
                    self.finished = true;
                    return Some(Err(e.into_provider_error()));
                }
            }
        }
    }
}
