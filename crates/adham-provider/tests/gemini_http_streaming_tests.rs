//! G3: Gemini HTTP adapter — the streaming `:streamGenerateContent?alt=sse`
//! path over the shared transport. Discovery/health/endpoint-policy
//! connection-level coverage lives in `gemini_http_tests.rs`. Fixtures are
//! local listener stubs; Google's real API is never contacted in these tests
//! (no cloud calls, no live keys).

use adham_provider::adapters::gemini_http::{GeminiHttpAdapter, GoogleApiKey};
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::error::ProviderError;
use adham_provider::domain::model::{
    ModelCapabilities, ModelDescriptor, ModelId, ModelSelectionSnapshot,
};
use adham_provider::domain::request::{ChatMessage, MessageRole, ProviderRequestV1};
use adham_provider::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use adham_provider::registry::PinnedModel;
use adham_provider::transport::HttpTransport;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
const FIXTURE_KEY: &str = "AIza-fixture-key";

struct StubRequest {
    path: String,
    headers: String,
    #[allow(dead_code)] // kept: future fixture routing may match on body
    body: String,
}

async fn read_full_request(stream: &mut TcpStream) -> Option<StubRequest> {
    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
    loop {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 {
            return None;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(head_end) = buf.windows(4).position(|w| w == b"\r\n\r\n").map(|p| p + 4) {
            let head = String::from_utf8_lossy(&buf[..head_end]).into_owned();
            let cl = head
                .lines()
                .find_map(|l| {
                    let (k, v) = l.split_once(':')?;
                    k.eq_ignore_ascii_case("content-length")
                        .then(|| v.trim().parse::<usize>().ok())
                        .flatten()
                })
                .unwrap_or(0);
            if buf.len() >= head_end + cl {
                let path = head.lines().next()?.split_whitespace().nth(1)?.to_string();
                let body = String::from_utf8_lossy(&buf[head_end..head_end + cl]).into_owned();
                return Some(StubRequest {
                    path,
                    headers: head,
                    body,
                });
            }
        }
    }
}

async fn spawn_routed<F>(mut route: F) -> String
where
    F: FnMut(&StubRequest) -> Option<Vec<u8>> + Send + 'static,
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let Some(req) = read_full_request(&mut stream).await else {
                break;
            };
            let Some(response) = route(&req) else { break };
            if stream.write_all(&response).await.is_err() {
                break;
            }
            let _ = stream.flush().await;
        }
    });
    format!("http://{addr}")
}

fn sse_response(frames: &[&str]) -> Vec<u8> {
    let body = frames.join("\n") + "\n";
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes()
}

fn http_status(status: u16) -> Vec<u8> {
    let phrase = match status {
        429 => "Too Many Requests",
        401 => "Unauthorized",
        403 => "Forbidden",
        _ => "Internal Server Error",
    };
    format!("HTTP/1.1 {status} {phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n")
        .into_bytes()
}

fn adapter_for(base: &str) -> GeminiHttpAdapter {
    GeminiHttpAdapter::new_unchecked(
        HttpTransport::default(),
        base,
        GoogleApiKey::new(FIXTURE_KEY).expect("key"),
    )
    .expect("adapter builds")
}

fn model(model_id: &str, privacy: PrivacyClass) -> PinnedModel {
    PinnedModel {
        model_id: ModelId::new(model_id),
        digest: String::new(),
        descriptor: ModelDescriptor {
            model_id: ModelId::new(model_id),
            human_label: model_id.into(),
            privacy_class: privacy,
            capabilities: ModelCapabilities::default(),
        },
    }
}

fn cloud_request(model_id: &str) -> ProviderRequestV1 {
    ProviderRequestV1 {
        operation_id: "op-1".into(),
        model_selection: ModelSelectionSnapshot {
            account_id: ProviderAccountId::new("acct"),
            endpoint_id: EndpointId::new("google-gemini-cloud"),
            model_id: ModelId::new(model_id),
            privacy_class: PrivacyClass::CloudStandard,
        },
        messages: vec![ChatMessage {
            role: MessageRole::User,
            content: "Hello".into(),
        }],
        max_output_tokens: Some(64),
        temperature: Some(0.7),
    }
}

async fn collect(
    mut stream: adham_provider::adapters::gemini_http::GeminiChatStream,
) -> Vec<NormalizedStreamEvent> {
    let mut got = Vec::new();
    while let Some(event) = stream.next_event().await {
        match event {
            Ok(e) => got.push(e),
            Err(e) => panic!("unexpected stream error: {e:?}"),
        }
    }
    got
}

// --- 1. SSE happy path ----------------------------------------------------------

#[tokio::test]
async fn stream_emits_deltas_usage_and_stop_in_order() {
    let base = spawn_routed(|req| {
        if req.path == "/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse" {
            Some(sse_response(&[
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hi\"}],\"role\":\"model\"},\"index\":0}]}",
                "",
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" there\"}],\"role\":\"model\"},\"index\":0}]}",
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"\"}],\"role\":\"model\"},\"index\":0,\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":8,\"candidatesTokenCount\":5,\"totalTokenCount\":13},\"modelVersion\":\"gemini-2.5-flash\"}",
            ]))
        } else {
            None
        }
    })
    .await;

    let stream = adapter_for(&base)
        .stream_chat(
            &model("gemini-2.5-flash", PrivacyClass::CloudStandard),
            &cloud_request("gemini-2.5-flash"),
        )
        .await
        .expect("stream starts");

    assert_eq!(
        collect(stream).await,
        vec![
            NormalizedStreamEvent::StreamStarted,
            NormalizedStreamEvent::TextDelta("Hi".into()),
            NormalizedStreamEvent::TextDelta(" there".into()),
            NormalizedStreamEvent::Progress(StreamUsage {
                prompt_tokens: 8,
                completion_tokens: 5,
                total_tokens: 13,
            }),
            NormalizedStreamEvent::StreamCompleted(StreamCompletionOutcome::Stop),
        ]
    );
}

// --- 2. thought parts → ThinkingDelta; thoughts count into completion usage ----

#[tokio::test]
async fn thought_parts_surface_as_thinking_deltas() {
    let base = spawn_routed(|req| {
        if req.path.contains(":streamGenerateContent") {
            Some(sse_response(&[
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"thinking it out\",\"thought\":true}],\"role\":\"model\"},\"index\":0}]}",
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"the answer\"}],\"role\":\"model\"},\"index\":0}]}",
                "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"\"}],\"role\":\"model\"},\"index\":0,\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":7,\"thoughtsTokenCount\":2,\"totalTokenCount\":10}}",
            ]))
        } else {
            None
        }
    })
    .await;

    let stream = adapter_for(&base)
        .stream_chat(
            &model("gemini-2.5-flash", PrivacyClass::CloudStandard),
            &cloud_request("gemini-2.5-flash"),
        )
        .await
        .expect("stream starts");
    assert_eq!(
        collect(stream).await,
        vec![
            NormalizedStreamEvent::StreamStarted,
            NormalizedStreamEvent::ThinkingDelta("thinking it out".into()),
            NormalizedStreamEvent::TextDelta("the answer".into()),
            // thoughtsTokenCount bills as completion tokens; totalTokenCount is
            // authoritative when present ("field-for-field", never recomputed)
            NormalizedStreamEvent::Progress(StreamUsage {
                prompt_tokens: 3,
                completion_tokens: 9,
                total_tokens: 10,
            }),
            NormalizedStreamEvent::StreamCompleted(StreamCompletionOutcome::Stop),
        ]
    );
}

// --- 3. finishReason matrix + promptFeedback block + fail-closed defaults -------

async fn outcome_for_terminal(final_frame: &str) -> Result<StreamCompletionOutcome, ProviderError> {
    let frame_owned = final_frame.to_string();
    let base = spawn_routed(move |req| {
        if req.path.contains(":streamGenerateContent") {
            Some(sse_response(&[&frame_owned]))
        } else {
            None
        }
    })
    .await;
    let mut stream = adapter_for(&base)
        .stream_chat(
            &model("g", PrivacyClass::CloudStandard),
            &cloud_request("g"),
        )
        .await
        .expect("stream starts");
    let mut outcome: Option<StreamCompletionOutcome> = None;
    while let Some(event) = stream.next_event().await {
        match event {
            Ok(NormalizedStreamEvent::StreamCompleted(o)) => outcome = Some(o),
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    outcome.ok_or(ProviderError::TransportError(
        "stream ended without terminal frame".into(),
    ))
}

#[tokio::test]
async fn finish_reason_matrix_maps_fail_closed() {
    // mapped family
    assert_eq!(
        outcome_for_terminal("data: {\"candidates\":[{\"index\":0,\"finishReason\":\"STOP\"}]}",)
            .await
            .expect("outcome"),
        StreamCompletionOutcome::Stop
    );
    assert_eq!(
        outcome_for_terminal(
            "data: {\"candidates\":[{\"index\":0,\"finishReason\":\"MAX_TOKENS\"}]}",
        )
        .await
        .expect("outcome"),
        StreamCompletionOutcome::LengthExceeded
    );
    for reason in [
        "SAFETY",
        "RECITATION",
        "BLOCKLIST",
        "PROHIBITED_CONTENT",
        "SPII",
    ] {
        let frame =
            format!("data: {{\"candidates\":[{{\"index\":0,\"finishReason\":\"{reason}\"}}]}}");
        assert_eq!(
            outcome_for_terminal(&frame).await.expect("outcome"),
            StreamCompletionOutcome::ContentFilter,
            "{reason} must map to ContentFilter"
        );
    }
    // unknown & malformed function call → fail closed to Interrupted; the
    // answer text (arrived before the terminal) is kept, nothing is fabricated
    assert_eq!(
        outcome_for_terminal(
            "data: {\"candidates\":[{\"index\":0,\"finishReason\":\"NEW_REASON_2027\"}]}",
        )
        .await
        .expect("outcome"),
        StreamCompletionOutcome::Interrupted
    );
    assert_eq!(
        outcome_for_terminal(
            "data: {\"candidates\":[{\"index\":0,\"finishReason\":\"MALFORMED_FUNCTION_CALL\"}]}",
        )
        .await
        .expect("outcome"),
        StreamCompletionOutcome::Interrupted
    );
    // prompt-level block (no candidate content) → ContentFilter
    assert_eq!(
        outcome_for_terminal("data: {\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}",)
            .await
            .expect("outcome"),
        StreamCompletionOutcome::ContentFilter
    );
    assert_eq!(
        outcome_for_terminal("data: {\"promptFeedback\":{\"blockReason\":\"NEW_BLOCK\"}}",)
            .await
            .expect("outcome"),
        StreamCompletionOutcome::ContentFilter
    );
}

// --- 4. HTTP status taxonomy -----------------------------------------------------

#[tokio::test]
async fn http_status_errors_map_to_taxonomy() {
    for (status, expected) in [
        (429, "rate limit"),
        (401, "authentication"),
        (500, "transport"),
    ] {
        let base = spawn_routed(move |_| Some(http_status(status))).await;
        let err = adapter_for(&base)
            .stream_chat(
                &model("g", PrivacyClass::CloudStandard),
                &cloud_request("g"),
            )
            .await
            .expect_err("must error");
        let message = format!("{err:?}");
        assert!(
            message.to_lowercase().contains(expected),
            "status {status} must surface as {expected}: {message}"
        );
    }
}

// --- 5. malformed / truncated frames never panic ---------------------------------

#[tokio::test]
async fn malformed_and_truncated_frames_error_without_panicking() {
    // malformed data line → protocol error (stream ends with Err)
    let base = spawn_routed(|_| {
        Some(sse_response(&[
            "data: {\"candidates\":[",
            "data: not json at all",
        ]))
    })
    .await;
    let mut stream = adapter_for(&base)
        .stream_chat(
            &model("g", PrivacyClass::CloudStandard),
            &cloud_request("g"),
        )
        .await
        .expect("stream starts");
    let mut saw_parse_error = false;
    while let Some(event) = stream.next_event().await {
        match event {
            Err(ProviderError::ProtocolParseError(_)) => saw_parse_error = true,
            Err(e) => panic!("wrong error kind: {e:?}"),
            Ok(_) => {}
        }
    }
    assert!(
        saw_parse_error,
        "malformed JSON must surface as parse error"
    );
}

#[tokio::test]
async fn clean_eof_without_terminal_is_an_error() {
    let base = spawn_routed(|_| {
        Some(sse_response(&[
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"partial\"}],\"role\":\"model\"},\"index\":0}]}",
        ]))
    })
    .await;
    let mut stream = adapter_for(&base)
        .stream_chat(
            &model("g", PrivacyClass::CloudStandard),
            &cloud_request("g"),
        )
        .await
        .expect("stream starts");
    let mut last = None;
    while let Some(event) = stream.next_event().await {
        last = Some(event);
    }
    let last = last.expect("some event");
    assert!(
        matches!(last, Err(ProviderError::TransportError(ref m))
            if m.contains("stream ended without terminal frame")),
        "truncated stream must not complete: {last:?}"
    );
}

#[tokio::test]
async fn mid_stream_connection_drop_surfaces_transport_error() {
    // Content-Length promises more bytes than the stub sends; the connection
    // then dies. The adapter must surface a transport error — never complete.
    let base = spawn_routed(|_| {
        Some(
            b"HTTP/1.1 200 OK\r\nContent-Length: 500\r\n\r\ndata: {\"candidates\":[]}\r\n".to_vec(),
        )
    })
    .await;
    let mut stream = adapter_for(&base)
        .stream_chat(
            &model("g", PrivacyClass::CloudStandard),
            &cloud_request("g"),
        )
        .await
        .expect("stream starts");
    let mut saw_completion = false;
    while let Some(event) = stream.next_event().await {
        if let Ok(NormalizedStreamEvent::StreamCompleted(_)) = event {
            saw_completion = true;
        }
    }
    assert!(!saw_completion, "dropped connection must never complete");
}

// --- 6. authorization transport: header only, never a query parameter ------------

#[tokio::test]
async fn api_key_travels_in_header_never_in_query() {
    let base = spawn_routed(|req| {
        assert_eq!(
            req.path,
            "/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
        );
        // federation rule: key in x-goog-api-key ONLY — never echoed into the URL
        assert!(
            !req.path.contains("key="),
            "key must never be a query param"
        );
        assert!(
            req.headers
                .contains(&format!("x-goog-api-key: {FIXTURE_KEY}")),
            "request must carry the key header: {}",
            req.headers
        );
        Some(sse_response(&[
            "data: {\"candidates\":[{\"index\":0,\"finishReason\":\"STOP\"}]}",
        ]))
    })
    .await;
    let stream = adapter_for(&base)
        .stream_chat(
            &model("gemini-2.5-flash", PrivacyClass::CloudStandard),
            &cloud_request("gemini-2.5-flash"),
        )
        .await
        .expect("stream starts");
    collect(stream).await;
}

// --- 7. privacy boundary: only CloudStandard selections dispatch to Google -------

#[tokio::test]
async fn non_cloud_selection_refused_before_socket() {
    let hits = Arc::new(AtomicUsize::new(0));
    let counted = hits.clone();
    let base = spawn_routed(move |_req| {
        counted.fetch_add(1, Ordering::SeqCst);
        Some(sse_response(&[
            "data: {\"candidates\":[{\"index\":0,\"finishReason\":\"STOP\"}]}",
        ]))
    })
    .await;
    let mut local_request = cloud_request("g");
    local_request.model_selection.privacy_class = PrivacyClass::LocalOnly;
    let err = adapter_for(&base)
        .stream_chat(&model("g", PrivacyClass::CloudStandard), &local_request)
        .await
        .expect_err("local-only selection must be refused");
    assert!(
        matches!(err, ProviderError::ModelCapabilityMismatch(_)),
        "{err:?}"
    );
    assert_eq!(hits.load(Ordering::SeqCst), 0, "no socket may be opened");
}
