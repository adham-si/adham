//! A3: Ollama HTTP adapter — discovery (`/api/tags` + `/api/show`) and the
//! streaming `/api/chat` path, over the shared transport. Fixtures are local
//! listener stubs; no real Ollama daemon is contacted in these tests.

use adham_provider::adapters::ollama_http::OllamaHttpAdapter;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::error::ProviderError;
use adham_provider::domain::model::{CapabilityStatus, ModelId, ModelSelectionSnapshot};
use adham_provider::domain::request::{ChatMessage, MessageRole, ProviderRequestV1};
use adham_provider::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use adham_provider::registry::PinnedModel;
use adham_provider::transport::HttpTransport;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// Request head+body as read by a stub server.
struct StubRequest {
    path: String,
    #[allow(dead_code)] // kept: future discovery routing may match on body
    body: String,
}

/// Reads one full request (headers + Content-Length body) and returns its
/// path and body; `None` at a clean end of stream.
async fn read_request(stream: &mut TcpStream) -> Option<StubRequest> {
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
                return Some(StubRequest { path, body });
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
            let Some(req) = read_request(&mut stream).await else {
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

fn ndjson_response(lines: &[&str]) -> Vec<u8> {
    let body = lines.join("\n") + "\n";
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes()
}

fn http_200_json(body: &serde_json::Value) -> Vec<u8> {
    let body = body.to_string();
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes()
}

fn http_500() -> Vec<u8> {
    b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".to_vec()
}

fn adapter(base: &str) -> OllamaHttpAdapter {
    OllamaHttpAdapter::new(HttpTransport::default(), base).expect("adapter builds")
}

fn pinned(model_id: &str, digest: &str) -> PinnedModel {
    use adham_provider::domain::model::{ModelCapabilities, ModelDescriptor};
    PinnedModel {
        model_id: ModelId::new(model_id),
        digest: digest.into(),
        descriptor: ModelDescriptor {
            model_id: ModelId::new(model_id),
            human_label: model_id.into(),
            privacy_class: PrivacyClass::LocalOnly,
            capabilities: ModelCapabilities::default(),
        },
    }
}

fn request(model: &str) -> ProviderRequestV1 {
    ProviderRequestV1 {
        operation_id: "op-1".into(),
        model_selection: ModelSelectionSnapshot {
            account_id: ProviderAccountId::new("acct"),
            endpoint_id: EndpointId::new("ep-ollama"),
            model_id: ModelId::new(model),
            privacy_class: PrivacyClass::LocalOnly,
        },
        messages: vec![ChatMessage {
            role: MessageRole::User,
            content: "Hello".into(),
        }],
        max_output_tokens: Some(64),
        temperature: Some(0.7),
    }
}

// --- 1. discovery pins digests and maps /api/show capabilities ------------------

#[tokio::test]
async fn discover_pins_digests_and_maps_show_capabilities() {
    let base = spawn_routed(|req| match req.path.as_str() {
        "/api/tags" => Some(http_200_json(&json!({
            "models": [
                {"name": "llama3.2:latest", "digest": "sha256:aaa", "size": 100},
                {"name": "smol:latest", "digest": "sha256:bbb", "size": 50}
            ]
        }))),
        "/api/show" => Some(http_200_json(&json!({
            "capabilities": ["completion", "tools"]
        }))),
        _ => None,
    })
    .await;

    let models = adapter(&base).discover().await.expect("discover");
    assert_eq!(models.len(), 2);
    assert_eq!(models[0].model_id, ModelId::new("llama3.2:latest"));
    assert_eq!(models[0].digest, "sha256:aaa");
    assert_eq!(models[1].digest, "sha256:bbb");
    // /api/show evidence maps "tools" to a known tri-state
    assert_eq!(
        models[0].descriptor.capabilities.tool_proposals,
        CapabilityStatus::Supported
    );
    assert_eq!(
        models[0].descriptor.capabilities.streaming,
        CapabilityStatus::Supported
    );
}

#[tokio::test]
async fn discover_marks_capabilities_unknown_when_show_fails() {
    let base = spawn_routed(|req| match req.path.as_str() {
        "/api/tags" => Some(http_200_json(&json!({
            "models": [{"name": "llama3.2:latest", "digest": "sha256:aaa", "size": 100}]
        }))),
        "/api/show" => Some(http_500()),
        _ => None,
    })
    .await;

    let models = adapter(&base).discover().await.expect("discover");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].digest, "sha256:aaa");
    // unverified capability tri-state: unknown (and unknown still blocks use)
    assert_eq!(
        models[0].descriptor.capabilities.tool_proposals,
        CapabilityStatus::Unknown
    );
}

// --- 2. chat stream: deltas in order, StreamStarted first, usage on final ------

#[tokio::test]
async fn chat_streams_deltas_in_order_with_final_usage() {
    let base = spawn_routed(|req| {
        if req.path == "/api/chat" {
            Some(ndjson_response(&[
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":"Hello"},"done":false}"#,
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":" world"},"done":false}"#,
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":""},"done":true,"prompt_eval_count":10,"eval_count":5}"#,
            ]))
        } else {
            None
        }
    })
    .await;

    let adapter = adapter(&base);
    let mut stream = adapter
        .stream_chat(
            &pinned("llama3.2:latest", "sha256:aaa"),
            &request("llama3.2:latest"),
        )
        .await
        .expect("chat started");

    let mut got = Vec::new();
    while let Some(event) = stream.next_event().await {
        match event {
            Ok(e) => got.push(e),
            Err(e) => panic!("unexpected error: {e:?}"),
        }
    }

    assert_eq!(
        got.first(),
        Some(&NormalizedStreamEvent::StreamStarted),
        "first event must be StreamStarted"
    );
    assert_eq!(
        got,
        vec![
            NormalizedStreamEvent::StreamStarted,
            NormalizedStreamEvent::TextDelta("Hello".into()),
            NormalizedStreamEvent::TextDelta(" world".into()),
            NormalizedStreamEvent::Progress(StreamUsage {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
            }),
            NormalizedStreamEvent::StreamCompleted(StreamCompletionOutcome::Stop),
        ]
    );
}

// --- 3. done_reason "length" completes with truncated --------------------------

#[tokio::test]
async fn done_reason_length_maps_to_truncated() {
    let base = spawn_routed(|req| {
        if req.path == "/api/chat" {
            Some(ndjson_response(&[
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":"part"},"done":false}"#,
                r#"{"model":"llama3.2:latest","message":{"role":"assistant","content":""},"done":true,"done_reason":"length","prompt_eval_count":10,"eval_count":5}"#,
            ]))
        } else {
            None
        }
    })
    .await;

    let adapter = adapter(&base);
    let mut stream = adapter
        .stream_chat(
            &pinned("llama3.2:latest", "sha256:aaa"),
            &request("llama3.2:latest"),
        )
        .await
        .expect("chat started");

    let mut got = Vec::new();
    while let Some(Ok(e)) = stream.next_event().await {
        got.push(e);
    }
    assert_eq!(
        got.last(),
        Some(&NormalizedStreamEvent::StreamCompleted(
            StreamCompletionOutcome::LengthExceeded
        )),
        "done_reason length must surface as LengthExceeded, got {got:?}"
    );
}

// --- 4. connection refused → transport error -----------------------------------

#[tokio::test]
async fn connection_refused_maps_to_transport_error() {
    // port 9: nothing listens there
    let adapter = OllamaHttpAdapter::new(HttpTransport::default(), "http://127.0.0.1:9")
        .expect("adapter builds");
    let err = adapter
        .stream_chat(
            &pinned("llama3.2:latest", "sha256:aaa"),
            &request("llama3.2:latest"),
        )
        .await
        .expect_err("connection must be refused");
    assert!(
        matches!(err, ProviderError::TransportError(_)),
        "got {err:?}"
    );
}

// --- 5. mid-stream abort ends without completion -------------------------------

#[tokio::test]
async fn midstream_abort_never_completes() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind");
    let addr = listener.local_addr().expect("addr");
    tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept");
        let _ = read_request(&mut stream).await;
        // send one full line plus a partial line, then close abruptly
        let _ = stream
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/x-ndjson\r\nContent-Length: 100000\r\n\r\n{}",
                    r#"{"model":"m","message":{"role":"assistant","content":"hi"},"done":false}"#
                )
                .as_bytes(),
            )
            .await;
        let _ = stream
            .write_all(br##"{"model":"m","message":{"role":"as"##)
            .await;
        let _ = stream.flush().await;
        drop(stream);
    });

    let adapter = OllamaHttpAdapter::new(HttpTransport::default(), &format!("http://{addr}"))
        .expect("adapter builds");
    let mut stream = adapter
        .stream_chat(&pinned("m", "sha256:x"), &request("m"))
        .await
        .expect("chat started");

    let mut got = Vec::new();
    let mut error = None;
    while let Some(event) = stream.next_event().await {
        match event {
            Ok(e) => got.push(e),
            Err(e) => {
                error = Some(e);
                break;
            }
        }
    }
    assert!(
        error.is_some(),
        "aborted stream must end in an error, got {got:?}"
    );
    assert!(
        !got.iter()
            .any(|e| matches!(e, NormalizedStreamEvent::StreamCompleted(_))),
        "an aborted stream must never be reported as completed"
    );
}

// --- 6. local-only dispatch blocked without digest evidence --------------------

#[tokio::test]
async fn local_only_without_digest_blocks_before_socket() {
    // nothing listens on port 9: if the gate lets a request through, the
    // error would become a TransportError — so a capability/authority error
    // proves the block happened before any socket attempt.
    let adapter = OllamaHttpAdapter::new(HttpTransport::default(), "http://127.0.0.1:9")
        .expect("adapter builds");
    let evidence_free = PinnedModel {
        digest: String::new(),
        ..pinned("m", "")
    };
    let err = adapter
        .stream_chat(&evidence_free, &request("m"))
        .await
        .expect_err("unknown evidence must block local-only dispatch");
    assert!(
        matches!(err, ProviderError::ModelCapabilityMismatch(_)),
        "got {err:?}"
    );
}
