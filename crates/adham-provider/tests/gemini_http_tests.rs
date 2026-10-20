//! G3: Gemini HTTP adapter — discovery (`GET /v1beta/models`), metadata-only
//! health, and endpoint-policy construction. Connection-level coverage; the
//! streaming `:streamGenerateContent?alt=sse` path lives in
//! `gemini_http_streaming_tests.rs`. Fixtures are local listener stubs;
//! Google's real API is never contacted in these tests (no cloud calls, no
//! live keys).

use adham_provider::adapters::gemini_http::{GeminiHttpAdapter, GoogleApiKey};
use adham_provider::domain::account::PrivacyClass;
use adham_provider::domain::error::ProviderError;
use adham_provider::domain::model::{CapabilityStatus, ModelId};
use adham_provider::transport::HttpTransport;
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
const FIXTURE_KEY: &str = "AIza-fixture-key";

// headers/body are constructed for future fixture routing; path is matched today
#[allow(dead_code)]
struct StubRequest {
    path: String,
    headers: String,
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

fn http_200_json(body: &Value) -> Vec<u8> {
    let body = body.to_string();
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
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

fn production_adapter() -> GeminiHttpAdapter {
    GeminiHttpAdapter::new(
        HttpTransport::default(),
        GeminiHttpAdapter::OFFICIAL_BASE_URL,
        GoogleApiKey::new("AIza-prod").expect("key"),
    )
    .expect("official URL accepted")
}

// --- 1. discovery: generative + embedding rows, methods-only capabilities ------

#[tokio::test]
async fn discover_lists_generative_and_embedding_rows() {
    let base = spawn_routed(|req| {
        assert_eq!(req.path, "/v1beta/models", "metadata-only models list");
        Some(http_200_json(&json!({
            "models": [
                {
                    "name": "models/gemini-2.5-flash",
                    "displayName": "Gemini 2.5 Flash",
                    "supportedGenerationMethods": ["generateContent", "countTokens"]
                },
                {
                    "name": "models/text-embedding-004",
                    "displayName": "Text Embedding 004",
                    "supportedGenerationMethods": ["embedContent", "countTokens"]
                }
            ]
        })))
    })
    .await;

    let models = adapter_for(&base).discover().await.expect("discover");
    assert_eq!(models.len(), 2);
    let generative = models
        .iter()
        .find(|m| m.model_id == ModelId::new("gemini-2.5-flash"))
        .expect("generative row (models/ prefix stripped)");
    // displayName is the human label; nothing else is claimed
    assert_eq!(generative.descriptor.human_label, "Gemini 2.5 Flash");
    assert_eq!(
        generative.descriptor.privacy_class,
        PrivacyClass::CloudStandard
    );
    // cloud evidence: no digest pin exists for generated rows
    assert!(generative.digest.is_empty());
    // supportedGenerationMethods is the only capability source:
    // generateContent ⇒ streamable; everything the wire did not say stays unknown
    assert_eq!(
        generative.descriptor.capabilities.streaming,
        CapabilityStatus::Supported
    );
    assert_eq!(
        generative.descriptor.capabilities.tool_proposals,
        CapabilityStatus::Unknown
    );
    assert_eq!(
        generative.descriptor.capabilities.thinking,
        CapabilityStatus::Unknown
    );
    assert_eq!(
        generative.descriptor.capabilities.structured_output,
        CapabilityStatus::Unknown
    );
    let embedding = models
        .iter()
        .find(|m| m.model_id == ModelId::new("text-embedding-004"))
        .expect("embedding row");
    // embedding-only model cannot streamGenerateContent on this evidence
    assert_eq!(
        embedding.descriptor.capabilities.streaming,
        CapabilityStatus::Unknown
    );
}

// --- 2. health: metadata-only model count --------------------------------------

#[tokio::test]
async fn connection_test_counts_models_metadata_only() {
    let base = spawn_routed(|_req| {
        Some(http_200_json(&json!({
            "models": [ {"name": "models/a", "supportedGenerationMethods": []},
                        {"name": "models/b", "supportedGenerationMethods": []} ]
        })))
    })
    .await;
    let count = adapter_for(&base).connection_test().await.expect("count");
    assert_eq!(count, 2);
}

// --- 3. endpoint policy: official HTTPS host only --------------------------------

#[tokio::test]
async fn non_official_hosts_are_refused_without_a_socket() {
    for url in [
        "https://generativelanguage.googleapis.com.evil.test",
        "http://generativelanguage.googleapis.com", // scheme downgrade
        "https://example.com",
        "https://api.example-gemini.com",
    ] {
        let err = GeminiHttpAdapter::new(
            HttpTransport::default(),
            url,
            GoogleApiKey::new("AIza-x").expect("key"),
        )
        .expect_err("must refuse non-official host");
        assert!(
            matches!(err, ProviderError::EndpointPolicyViolation(_)),
            "{url}: {err:?}"
        );
    }
    // the official URL is the ONLY production construction
    let _ = production_adapter();
}
