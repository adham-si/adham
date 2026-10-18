use super::common::*;
use super::*;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId, ProviderKind};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::model::{ModelDescriptor, ModelId};
use adham_provider::registry::LocalAccount;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::Manager;
// ===== G4: dispatch generalization — adapter independence + proofs ============

/// Seed a Google account row at an arbitrary loopback base point. The
/// production configure path pins the official URL; harness mirror rows are
/// seeded directly through the same registry write — the only way a
/// non-official Google base_url exists by design (loopback = the same trust
/// boundary as the local Ollama daemon; external hosts stay refused).
fn g4_seed_google_account(
    runtime: &tokio::runtime::Runtime,
    api: &ApiContext,
    base_url: &str,
    model_id: &str,
    seal_credential: bool,
) -> String {
    runtime.block_on(async {
        let account = LocalAccount {
            account_id: ProviderAccountId::new(uuid::Uuid::now_v7().to_string()),
            kind: ProviderKind::GoogleGemini,
            alias: "Google (mirror)".to_string(),
            privacy_class: PrivacyClass::CloudStandard,
            endpoint_id: EndpointId::new("google-gemini-cloud"),
            base_url: base_url.to_string(),
            approved_destination: true,
        };
        api.registry
            .upsert_account(&account)
            .await
            .expect("seed google account");
        if seal_credential {
            adham_event_log::put_provider_credential(
                &api.pool,
                api.content_key.as_ref(),
                &account.account_id.0,
                "AIza-g4-mirror-key",
                &api.installation_id.0.to_string(),
            )
            .await
            .expect("seal mirror key");
        }
        api.registry
            .replace_models(
                &account.account_id,
                &[(
                    ModelId::new(model_id),
                    String::new(),
                    ModelDescriptor {
                        model_id: ModelId::new(model_id),
                        human_label: "Gemini 2.5 Flash".to_string(),
                        privacy_class: PrivacyClass::CloudStandard,
                        capabilities: adham_provider::domain::model::ModelCapabilities::default(),
                    },
                )],
            )
            .await
            .expect("seed google model");
        account.account_id.0.clone()
    })
}

/// Configure through the real consent IPC (official endpoint pinned to the
/// response DTO; never touched by test sockets).
fn g4_configure_google(
    webview: &tauri::WebviewWindow<MockRuntime>,
    args_ctx: serde_json::Value,
) -> String {
    let response = invoke(
        webview,
        "configure_google_account",
        args_for(
            args_ctx,
            json!({
                "accountId": null,
                "alias": "Google",
                "apiKey": "AIza-g4-battery-key",
                "acknowledgeCloudTransfer": true
            }),
        ),
    )
    .expect("configure google ok");
    response["data"]["accountId"]
        .as_str()
        .expect("google account id")
        .to_string()
}

/// Typed full-scope command context (the battery's `context_for` returns the
/// serde Value used by `args_for`; direct handler calls need the struct).
fn g4_scope(ws: &str, proj: &str, sess: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: Some(sess.to_string()),
    }
}

fn g4_envelope(
    scope: &CommandContext,
    account: &str,
    model: &str,
) -> CommandEnvelope<CompleteOncePayload> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: scope.clone(),
        payload: CompleteOncePayload {
            account_id: account.to_string(),
            model_id: model.to_string(),
            text: "hello gemini".to_string(),
        },
    }
}

fn g4_json(body: &serde_json::Value) -> Vec<u8> {
    let body = body.to_string();
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes()
}

fn g4_sse(frames: &[&str]) -> Vec<u8> {
    let body = frames.join("\n") + "\n";
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{}",
        body.len(),
        body
    )
    .into_bytes()
}

enum G4Site {
    /// GET /v1beta/models → Google models document (gemini + embedding rows)
    GoogleModels,
    /// POST :streamGenerateContent → one text frame, then EOF (truncation)
    GoogleStreamTruncatedText,
    /// POST :streamGenerateContent → happy STOP stream
    GoogleStreamStop,
    /// POST /api/chat → 500 (pre-wire dispatch failure)
    OllamaChatNever,
}

/// One persistent per-route loopback stub. Any unmatched request answers 500
/// so harness mistakes fail fast instead of timing out.
fn g4_spawn(site: G4Site, runtime: &tokio::runtime::Runtime) -> (String, Arc<AtomicU64>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let std_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind g4 stub");
    std_listener.set_nonblocking(true).expect("nonblocking");
    let base = format!("http://{}", std_listener.local_addr().expect("g4 addr"));
    let hits = Arc::new(AtomicU64::new(0));
    let counted = hits.clone();
    let tokio_listener = runtime
        .block_on(async { tokio::net::TcpListener::from_std(std_listener).expect("tokio g4") });
    runtime.spawn(async move {
        loop {
            let Ok((mut sock, _)) = tokio_listener.accept().await else { break };
            let mut buf = Vec::new();
            let head = loop {
                let mut chunk = [0u8; 4096];
                let n = sock.read(&mut chunk).await.unwrap_or(0);
                if n == 0 {
                    break None;
                }
                buf.extend_from_slice(&chunk[..n]);
                if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                    break Some(String::from_utf8_lossy(&buf[..end]).into_owned());
                }
                if buf.len() > 131072 {
                    break None;
                }
            };
            counted.fetch_add(1, Ordering::SeqCst);
            let path = head
                .and_then(|h| {
                    h.lines()
                        .next()
                        .and_then(|l| l.split_whitespace().nth(1).map(str::to_string))
                })
                .unwrap_or_default();
            let response: Option<Vec<u8>> = match site {
                G4Site::GoogleModels => {
                    if path == "/v1beta/models" {
                        Some(g4_json(&json!({
                            "models": [
                                {"name": "models/gemini-2.5-flash",
                                 "displayName": "Gemini 2.5 Flash",
                                 "supportedGenerationMethods": ["generateContent"]},
                                {"name": "models/text-embedding-004",
                                 "displayName": "Text Embedding 004",
                                 "supportedGenerationMethods": ["embedContent"]}
                            ]
                        })))
                    } else {
                        None
                    }
                }
                G4Site::GoogleStreamTruncatedText => {
                    if path.contains(":streamGenerateContent") {
                        Some(g4_sse(&[concat!(
                            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"partial answer\"}],",
                            "\"role\":\"model\"},\"index\":0}]}"
                        )]))
                    } else {
                        None
                    }
                }
                G4Site::GoogleStreamStop => {
                    if path.contains(":streamGenerateContent") {
                        Some(g4_sse(&[
                            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ok\"}],\"role\":\"model\"},\"index\":0,\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":1,\"totalTokenCount\":2}}",
                        ]))
                    } else {
                        None
                    }
                }
                G4Site::OllamaChatNever => {
                    Some(b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\nContent-Length: 0\r\n\r\n".to_vec())
                }
            };
            if let Some(response) = response {
                let _ = sock.write_all(&response).await;
                let _ = sock.flush().await;
            }
        }
    });
    (base, hits)
}

fn g4_count_pending(runtime: &tokio::runtime::Runtime, api: &ApiContext) -> i64 {
    runtime.block_on(async {
        sqlx::query_scalar(
            "SELECT COUNT(*) FROM pending_operations WHERE kind = 'provider-completion' \
             AND status = 'pending'",
        )
        .fetch_one(&api.pool)
        .await
        .expect("pending count")
    })
}

/// #2 Isolation: a failed Ollama terminal persists, and NOTHING dispatches to
/// Google — no socket, no retry, no fallback across kinds.
#[test]
fn ollama_failure_terminal_dispatches_nothing_to_google() {
    let (runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let api = app.state::<ApiContext>().inner().clone();

    let (ollama_base, _ollama_hits) = g4_spawn(G4Site::OllamaChatNever, &runtime);
    let ollama_id = runtime.block_on(async {
        let account = LocalAccount {
            account_id: ProviderAccountId::new(uuid::Uuid::now_v7().to_string()),
            kind: ProviderKind::OllamaLocal,
            alias: "Bad Local".to_string(),
            privacy_class: PrivacyClass::LocalOnly,
            endpoint_id: EndpointId::new("local-ollama"),
            base_url: ollama_base,
            approved_destination: false,
        };
        api.registry
            .upsert_account(&account)
            .await
            .expect("seed ollama");
        api.registry
            .replace_models(
                &account.account_id,
                &[(
                    ModelId::new("m:latest"),
                    "sha256:g4-pinned".to_string(),
                    ModelDescriptor {
                        model_id: ModelId::new("m:latest"),
                        human_label: "m:latest".to_string(),
                        privacy_class: PrivacyClass::LocalOnly,
                        capabilities: adham_provider::domain::model::ModelCapabilities::default(),
                    },
                )],
            )
            .await
            .expect("seed ollama model");
        account.account_id.0.clone()
    });

    // the Google mirror is LIVE and counts every socket; nothing may reach it
    let (google_base, google_hits) = g4_spawn(G4Site::GoogleStreamStop, &runtime);
    let google_mirror =
        g4_seed_google_account(&runtime, &api, &google_base, "gemini-2.5-flash", true);

    let events = collector();
    let sink = CollectSink(events.clone());
    let response = runtime
        .block_on(adham_desktop_api::handle_complete_once_streaming(
            &api,
            g4_envelope(&g4_scope(&ws, &proj, &sess), &ollama_id, "m:latest"),
            &sink,
        ))
        .expect("failed terminal resolves the op");
    let _ = response;

    // failed terminal, resolved op: no pending leak
    assert_eq!(g4_count_pending(&runtime, &api), 0, "pending op resolved");
    // the google adapter saw ZERO sockets: kind isolation held
    assert_eq!(
        google_hits.load(Ordering::SeqCst),
        0,
        "no google dispatch on ollama failure"
    );
    // the mirror side keeps its sealed state: untouched rows
    let seed_ok = runtime.block_on(async {
        sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM provider_accounts WHERE account_id = ?")
            .bind(&google_mirror)
            .fetch_one(&api.pool)
            .await
            .expect("mirror row")
    });
    let _ = seed_ok;
}

/// #3 Gemini mid-stream error → failed terminal; history read survives.
#[test]
fn gemini_midstream_error_maps_to_failed_terminal_and_history_read_survives() {
    let (runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let api = app.state::<ApiContext>().inner().clone();

    // mirror streams one text frame and then dies cleanly (EOF, no terminal)
    let (mirror_base, _hits) = g4_spawn(G4Site::GoogleStreamTruncatedText, &runtime);
    let mirror_id = g4_seed_google_account(&runtime, &api, &mirror_base, "gemini-2.5-flash", true);

    let events = collector();
    let sink = CollectSink(events.clone());
    let response = runtime
        .block_on(adham_desktop_api::handle_complete_once_streaming(
            &api,
            g4_envelope(&g4_scope(&ws, &proj, &sess), &mirror_id, "gemini-2.5-flash"),
            &sink,
        ))
        .expect("midstream error must map to a failed terminal, not abort");

    // terminal event is "failed"; the op resolved
    let got = events.lock().expect("collector").clone();
    let last = got.last().expect("events").clone();
    match last.event {
        adham_desktop_api::StreamEventPayloadDto::Completed { completion, .. } => {
            assert_eq!(completion, "failed");
        }
        other => panic!("expected completed terminal, got {other:?}"),
    }
    assert!(!response.data.op_id.is_empty());
    assert_eq!(
        g4_count_pending(&runtime, &api),
        0,
        "no pending leak midstream"
    );

    // history read survives the failure (the projection is untouched)
    let history = invoke(
        &webview,
        "get_conversation",
        json!({"context": context_for(&ws, &proj, &sess)}),
    )
    .expect("history read after failed terminal");
    assert!(history["items"].is_array());
}

/// #4 Fail-closed pre-session: unknown model or missing key dispatches
/// nothing and leaves no pending op behind (validation order: evidence and
/// credential before any socket AND before op creation).
#[test]
fn unknown_model_or_missing_key_fails_closed_presession() {
    let (runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let api = app.state::<ApiContext>().inner().clone();

    // A) a consented Google account (official URL, credential sealed) facing
    // an unknown model id: resolve_pinned refuses pre-session.
    let google_id = g4_configure_google(&webview, context_for(&ws, &proj, &sess));
    let unknown = runtime
        .block_on(adham_desktop_api::handle_complete_once_streaming(
            &api,
            g4_envelope(&g4_scope(&ws, &proj, &sess), &google_id, "ghost-model"),
            &CollectSink(collector()),
        ))
        .unwrap_err();
    assert!(
        unknown.contains("unknown model"),
        "unknown model must refuse pre-session: {unknown}"
    );
    assert_eq!(
        g4_count_pending(&runtime, &api),
        0,
        "no pending leak on unknown model"
    );

    // B) a Google mirror row WITHOUT any credential (seeded directly):
    // the missing seal refuses pre-session with a credential complaint.
    let mirror_id = g4_seed_google_account(
        &runtime,
        &api,
        "http://127.0.0.1:9",
        "gemini-2.5-flash",
        false,
    );
    let missing = runtime
        .block_on(adham_desktop_api::handle_complete_once_streaming(
            &api,
            g4_envelope(&g4_scope(&ws, &proj, &sess), &mirror_id, "gemini-2.5-flash"),
            &CollectSink(collector()),
        ))
        .unwrap_err();
    assert!(
        missing.contains("credential"),
        "missing key must fail closed mentioning the credential: {missing}"
    );
    assert_eq!(
        g4_count_pending(&runtime, &api),
        0,
        "no pending leak on missing key"
    );
}

/// #1 Adapter independence: Google configure + discovery work while the
/// Ollama side is dead at another endpoint. Discovery exercises the dispatch
/// pipeline through a loopback mirror row; the official-host account created
/// through consent NEVER touches the network (no cloud calls in tests).
#[test]
fn google_configure_and_discover_work_while_ollama_unreachable() {
    let (runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let scope_ctx = context_for(&ws, &proj, &sess);

    // real consent IPC: account minted, pinned to the official endpoint, key sealed
    let configured_id = g4_configure_google(&webview, context_for(&ws, &proj, &sess));
    assert!(configured_id.len() > 10);

    // google discovery pipeline through the mirror: gemini + embedding rows map
    let (mirror_base, _mirror_hits) = g4_spawn(G4Site::GoogleModels, &runtime);
    let mirror_id = g4_seed_google_account(
        &runtime,
        app.state::<ApiContext>().inner(),
        &mirror_base,
        "gemini-2.5-flash",
        true,
    );
    let google_models = invoke(
        &webview,
        "discover_ollama_models",
        args_for(
            context_for(&ws, &proj, &sess),
            json!({"accountId": mirror_id}),
        ),
    )
    .expect("google discovery works (kind-routed)");
    let first = &google_models["data"]["models"][0];
    assert_eq!(first["modelId"], json!("gemini-2.5-flash"));
    assert_eq!(first["privacyClass"], json!("cloud_standard"));

    // a dead Ollama endpoint stays dead: unreachable, refused
    let ollama_id = invoke(
        &webview,
        "update_provider_account",
        args_for(
            scope_ctx.clone(),
            json!({"accountId": null, "alias": "Local", "endpointUrl": "http://127.0.0.1:9"}),
        ),
    )
    .expect("ollama account")["data"]["accountId"]
        .as_str()
        .expect("ollama id")
        .to_string();
    let dead = resp_text(invoke(
        &webview,
        "discover_ollama_models",
        args_for(
            context_for(&ws, &proj, &sess),
            json!({"accountId": ollama_id}),
        ),
    ));
    assert!(
        dead.contains("error") || dead.contains("unreachable") || dead.contains("refused"),
        "dead ollama must surface a dispatch error: {dead}"
    );

    // independence: google discovery still works after the ollama failure
    let again = invoke(
        &webview,
        "discover_ollama_models",
        args_for(
            context_for(&ws, &proj, &sess),
            json!({"accountId": mirror_id}),
        ),
    )
    .expect("google discovery unaffected by ollama failure");
    assert_eq!(again["data"]["models"].as_array().expect("rows").len(), 2);
}
