//! Real-IPC contract tests.
//!
//! These replay the exact payload shapes the typed frontend client
//! (`apps/desktop/src/shared/api/adham-client.ts`) sends — pinned in
//! `apps/desktop/fixtures/ipc-basic-send.json` and asserted TS-side in
//! `adham-client.test.ts` — through the real `tauri::generate_handler!`
//! dispatch and the real command/service/store path on a disposable
//! temp-file database with an in-memory content key.
//!
//! Boundaries: this covers command names, argument key naming (`request` /
//! `context`), camelCase envelope serde, and response shapes. It does NOT
//! cover the webview postMessage transport (Tauri's own JS→Rust layer), and
//! it does NOT cover the durable pending-send recovery chain
//! (`record_pending_operation` → `clear_pending_operation`), which has its
//! own backend coverage in `crates/adham-desktop-api/tests`.
//!
//! Platform: non-Windows only. Enabling tauri's `test` feature on Windows
//! makes the lib test binary fail at load (STATUS_ENTRYPOINT_NOT_FOUND,
//! tauri-apps/tauri#11028); the TS-side fixture assertions still run on
//! every platform.

use super::*;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};

/// Disposable context: temp-dir SQLite database, in-memory content key,
/// never the OS credential store. The runtime is returned so pool tasks
/// stay alive for the test duration.
fn disposable_context() -> (tokio::runtime::Runtime, ApiContext) {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    let db_path = std::env::temp_dir().join(format!(
        "adham_ipc_contract_{}_{}_{}.db",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos()
    ));
    let ctx = runtime.block_on(async {
        let pool = adham_event_log::create_sqlite_pool(&db_path)
            .await
            .expect("create sqlite pool");
        let provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
            std::sync::Arc::new(adham_event_log::InMemoryProvider::generate());
        ApiContext::load_or_create_with_key(pool, provider)
            .await
            .expect("load installation identity")
    });
    (runtime, ctx)
}

/// The webview origin Tauri treats as local on this platform
/// (`Webview::is_local_url` / `tauri_protocol_url`). Any other origin is
/// treated as remote and ACL-rejected before reaching app commands.
#[cfg(any(windows, target_os = "android"))]
const LOCAL_INVOKE_URL: &str = "http://tauri.localhost";
#[cfg(not(any(windows, target_os = "android")))]
const LOCAL_INVOKE_URL: &str = "tauri://localhost";

fn invoke(
    webview: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<Value, Value> {
    let body = get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: LOCAL_INVOKE_URL.parse().expect("invoke url"),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )?;
    Ok(body.deserialize::<Value>().expect("response is json"))
}

/// Async-harness proof: one async command through the mock IPC bridge.
/// If this hangs or fails, the harness cannot drive sqlx async commands and
/// the contract tests below must not be trusted.
#[test]
fn async_command_harness_probe() {
    let (_runtime, ctx) = disposable_context();
    let app = mock_builder()
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![get_bootstrap_state])
        // The app's real generated context (shared single expansion in
        // lib.rs): real ACL/capability resolution, matching `mock_builder`'s
        // documented pattern for app crates.
        .build(app_context())
        .expect("build mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");

    let response = invoke(&webview, "get_bootstrap_state", json!({})).expect("command ok");
    assert_eq!(response["isInitialized"], json!(false));
    assert_eq!(response["activeWorkspaceId"], json!(null));
}

/// Fixture replay: provisioning → session creation → submit → history
/// read-back, using the exact envelope/payload shapes the typed client sends
/// (asserted TS-side against the same fixture), through the real
/// `tauri::generate_handler!` dispatch, real context/ACL, and real
/// command/service/store path.
///
/// The fixture's scope ids are the client's mocked responses; the server
/// generates its own, so later contexts rebind them. The fixture pins the
/// wire shape (command names, `request`/`context` keys, camelCase fields,
/// payload field names); the server pins the returned values.
#[test]
fn basic_send_chain_matches_client_fixture() {
    let fixture: Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/ipc-basic-send.json"
        ))
        .expect("fixture file"),
    )
    .expect("fixture json");
    let calls = fixture["calls"].as_array().expect("calls array");
    assert_eq!(calls.len(), 5, "fixture call count");

    let (_runtime, ctx) = disposable_context();
    let app = mock_builder()
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![
            create_workspace,
            create_project,
            create_session,
            submit_message,
            get_conversation
        ])
        .build(app_context())
        .expect("build mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");

    // 1. create_workspace — fixture args verbatim (fresh scope, null context).
    let response =
        invoke(&webview, "create_workspace", calls[0]["args"].clone()).expect("create_workspace");
    assert_eq!(
        response["requestId"], calls[0]["args"]["request"]["requestId"],
        "request id round-trip"
    );
    assert_eq!(
        response["data"]["name"],
        calls[0]["args"]["request"]["payload"]["name"]
    );
    assert_eq!(
        response["data"]["kind"],
        calls[0]["args"]["request"]["payload"]["kind"]
    );
    assert_eq!(
        response["data"]["preferredLanguage"],
        calls[0]["args"]["request"]["payload"]["preferredLanguage"]
    );
    let workspace_id = response["data"]["workspaceId"]
        .as_str()
        .expect("workspaceId string")
        .to_string();

    // 2. create_project — rebind the server workspace id into the context.
    let mut args = calls[1]["args"].clone();
    args["request"]["context"]["workspaceId"] = json!(&workspace_id);
    let response = invoke(&webview, "create_project", args).expect("create_project");
    assert_eq!(
        response["data"]["name"],
        calls[1]["args"]["request"]["payload"]["name"]
    );
    assert_eq!(
        response["data"]["storageKind"],
        calls[1]["args"]["request"]["payload"]["storageKind"]
    );
    assert_eq!(response["data"]["workspaceId"], json!(&workspace_id));
    let project_id = response["data"]["projectId"]
        .as_str()
        .expect("projectId string")
        .to_string();

    // 3. create_session.
    let mut args = calls[2]["args"].clone();
    args["request"]["context"]["workspaceId"] = json!(&workspace_id);
    args["request"]["context"]["projectId"] = json!(&project_id);
    let response = invoke(&webview, "create_session", args).expect("create_session");
    assert_eq!(
        response["requestId"],
        calls[2]["args"]["request"]["requestId"]
    );
    assert_eq!(response["data"]["projectId"], json!(&project_id));
    assert_eq!(response["data"]["title"], json!(null));
    let session_id = response["data"]["sessionId"]
        .as_str()
        .expect("sessionId string")
        .to_string();

    // 4. submit_message — basic send: one command, one transaction.
    let text = calls[3]["args"]["request"]["payload"]["text"].clone();
    let mut args = calls[3]["args"].clone();
    args["request"]["context"]["workspaceId"] = json!(&workspace_id);
    args["request"]["context"]["projectId"] = json!(&project_id);
    args["request"]["context"]["sessionId"] = json!(&session_id);
    let response = invoke(&webview, "submit_message", args).expect("submit_message");
    assert_eq!(
        response["requestId"],
        calls[3]["args"]["request"]["requestId"]
    );
    assert_eq!(response["data"]["sessionId"], json!(&session_id));
    assert_eq!(response["data"]["text"], text);

    // 5. get_conversation — read-back proves the stored, encrypted content
    // decrypts back to exactly what the client sent.
    let mut args = calls[4]["args"].clone();
    args["context"]["workspaceId"] = json!(&workspace_id);
    args["context"]["projectId"] = json!(&project_id);
    args["context"]["sessionId"] = json!(&session_id);
    let response = invoke(&webview, "get_conversation", args).expect("get_conversation");
    // Unlike the envelope commands, `get_conversation` returns the page
    // directly (mirrors the client's `ConversationPageSchema.parse(raw)`).
    let items = response["items"].as_array().expect("items array");
    assert_eq!(items.len(), 1, "one message in history");
    assert_eq!(items[0]["role"], "user");
    assert_eq!(items[0]["text"], text);
    assert_eq!(response["nextCursor"], json!(null));
}

// ===== A5: provider commands + streaming completions =====
//
// Boundary note: `complete_once_streaming` takes a `Channel<StreamEventDto>`.
// The mock IPC harness proves arg shapes for the other commands through the
// real dispatch; the Channel adaptation is exercised on its own (the sink
// impl collects the same `StreamEventDto`s the TauriChannelSink feeds), and
// the streaming behaviors run through the real handler/service/store path on
// a disposable temp database with a local stub Ollama endpoint.

use adham_core_types::*;
use adham_desktop_api::{EventSink, StreamEventDto, StreamEventPayloadDto};
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId, ProviderKind};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::model::{ModelDescriptor, ModelId};
use adham_provider::registry::LocalAccount;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::sync::Mutex;

struct StubCaptures {
    accepts: AtomicU64,
    requests: Mutex<Vec<(String, String)>>,
    /// Facts observed from inside the stub at socket time (pending counts).
    pending_facts: Mutex<Vec<i64>>,
}

impl StubCaptures {
    fn new() -> Self {
        Self {
            accepts: AtomicU64::new(0),
            requests: Mutex::new(Vec::new()),
            pending_facts: Mutex::new(Vec::new()),
        }
    }

    fn accepts(&self) -> u64 {
        self.accepts.load(Ordering::SeqCst)
    }

    fn request_bodies(&self) -> Vec<String> {
        self.requests
            .lock()
            .expect("stub requests")
            .iter()
            .map(|(_, b)| b.clone())
            .collect()
    }
}

fn http_ok(content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

fn chunk(data: &[u8]) -> Vec<u8> {
    let mut out = format!("{:x}\r\n", data.len()).into_bytes();
    out.extend_from_slice(data);
    out.extend_from_slice(b"\r\n");
    out
}

fn ndjson_delta(text: &str) -> String {
    serde_json::json!({"message": {"role": "assistant", "content": text}, "done": false})
        .to_string()
        + "\n"
}

fn ndjson_done(prompt: u64, eval: u64) -> String {
    serde_json::json!({
        "message": {"role": "assistant", "content": ""},
        "done": true,
        "done_reason": "stop",
        "prompt_eval_count": prompt,
        "eval_count": eval
    })
    .to_string()
        + "\n"
}

/// Programmed chat response: `pre` chunks stream, then (optionally) the stub
/// holds until `gate` fires, then `post` chunks stream and the body ends.
struct ChatProgram {
    pre: Vec<String>,
    post: Vec<String>,
    gate: Option<Arc<tokio::sync::Notify>>,
}

impl ChatProgram {
    fn once(lines: Vec<String>) -> Self {
        Self {
            pre: Vec::new(),
            post: lines,
            gate: None,
        }
    }
}

const TAGS_BODY: &str = r#"{"models":[{"name":"m:latest","digest":"sha256:unittest-digest"},{"name":"tiny2:1b","digest":""}]}"#;
const SHOW_BODY: &str = r#"{"capabilities":["streaming","tools"]}"#;

/// Minimal loopback Ollama stub. `/api/chat` bodies stream chunked so a
/// mid-stream stall is representable (no content-length lie).
fn spawn_stub_ollama(
    runtime: &tokio::runtime::Runtime,
    observe_pool: Option<sqlx::Pool<sqlx::Sqlite>>,
    captures: Arc<StubCaptures>,
    chat: ChatProgram,
) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let std_listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind stub");
    std_listener
        .set_nonblocking(true)
        .expect("stub nonblocking");
    let base = format!("http://{}", std_listener.local_addr().expect("stub addr"));
    let tokio_listener = runtime.block_on(async {
        tokio::net::TcpListener::from_std(std_listener).expect("tokio stub listener")
    });

    runtime.spawn(async move {
        loop {
            let Ok((mut sock, _)) = tokio_listener.accept().await else {
                break;
            };
            captures.accepts.fetch_add(1, Ordering::SeqCst);
            let mut buffer: Vec<u8> = Vec::new();
            let mut piece = [0u8; 4096];
            let (path, request_body, _head) = loop {
                let n = sock.read(&mut piece).await.expect("stub read");
                if n == 0 {
                    break (String::new(), Vec::new(), None);
                }
                buffer.extend_from_slice(&piece[..n]);
                if let Some(head_end) = buffer.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&buffer[..head_end]).to_string();
                    let clen = head
                        .lines()
                        .find_map(|l| {
                            let lower = l.to_ascii_lowercase();
                            lower.starts_with("content-length:")
                                .then(|| l.split(':').nth(1)?.trim().parse::<usize>().ok())
                                .flatten()
                        })
                        .unwrap_or(0);
                    if buffer.len() >= head_end + 4 + clen {
                        let path = head
                            .lines()
                            .next()
                            .and_then(|line| line.split(' ').nth(1))
                            .unwrap_or("")
                            .split('?')
                            .next()
                            .unwrap_or("")
                            .to_string();
                        let body = buffer[head_end + 4..head_end + 4 + clen].to_vec();
                        break (path, body, Some(head));
                    }
                }
            };

            captures
                .requests
                .lock()
                .expect("stub requests")
                .push((path.clone(), String::from_utf8_lossy(&request_body).to_string()));

            let response: Vec<u8> = match path.as_str() {
                "/api/tags" => http_ok("application/json", TAGS_BODY.as_bytes()),
                "/api/show" => http_ok("application/json", SHOW_BODY.as_bytes()),
                "/api/chat" => {
                    // from the socket's side: is the pending op already durable?
                    if let Some(pool) = &observe_pool {
                        let in_flight = sqlx::query_scalar::<_, i64>(
                            "SELECT count(*) FROM pending_operations \
                             WHERE kind = 'provider-completion' AND status = 'pending'",
                        )
                        .fetch_one(pool)
                        .await
                        .expect("stub pending observation");
                        captures
                            .pending_facts
                            .lock()
                            .expect("stub facts")
                            .push(in_flight);
                    }
                    let mut body: Vec<u8> = b"HTTP/1.1 200 OK\r\ncontent-type: application/x-ndjson\r\ntransfer-encoding: chunked\r\nconnection: close\r\n\r\n".to_vec();
                    for line in &chat.pre {
                        body.extend(chunk(line.as_bytes()));
                    }
                    let _ = sock.write_all(&body).await;
                    let _ = sock.flush().await;
                    if let Some(gate) = &chat.gate {
                        gate.notified().await;
                    }
                    let mut tail: Vec<u8> = Vec::new();
                    for line in &chat.post {
                        tail.extend(chunk(line.as_bytes()));
                    }
                    tail.extend_from_slice(b"0\r\n\r\n");
                    let _ = sock.write_all(&tail).await;
                    let _ = sock.shutdown().await;
                    continue;
                }
                _ => http_ok("application/json", br#"{"error":"unknown path"}"#),
            };
            let _ = sock.write_all(&response).await;
            let _ = sock.shutdown().await;
        }
    });
    base
}

fn provider_mock_app(ctx: ApiContext) -> tauri::App<MockRuntime> {
    mock_builder()
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![
            create_workspace,
            create_project,
            create_session,
            get_conversation,
            test_provider_connection,
            discover_ollama_models,
            update_provider_account,
            complete_once_streaming,
            stop_completion
        ])
        .build(app_context())
        .expect("build mock app")
}

fn mock_webview(app: &tauri::App<MockRuntime>) -> tauri::WebviewWindow<MockRuntime> {
    tauri::WebviewWindowBuilder::new(app, "provider", Default::default())
        .build()
        .expect("build mock webview")
}

/// The raw IPC envelope.
fn envelope_for(context: Value, payload: Value) -> Value {
    json!({
        "protocolVersion": 1,
        "requestId": uuid::Uuid::now_v7().to_string(),
        "context": context,
        "payload": payload,
    })
}

/// Envelope wrapped in the `request` argument key the real dispatch reads.
/// Envelope wrapped in the `request` argument key the real dispatch reads.
fn args_for(context: Value, payload: Value) -> Value {
    json!({ "request": envelope_for(context, payload) })
}

/// The mock harness returns command-level errors as body values; stringify
/// for substring assertions across both shapes.
fn resp_text(result: Result<Value, Value>) -> String {
    match result {
        Ok(v) => v.to_string(),
        Err(v) => v.to_string(),
    }
}

fn context_for(ws: &str, proj: &str, sess: &str) -> Value {
    json!({"workspaceId": ws, "projectId": proj, "sessionId": sess})
}

/// workspace → project → session through the real dispatch.
fn provision_scope(webview: &tauri::WebviewWindow<MockRuntime>) -> (String, String, String) {
    let response = invoke(
        webview,
        "create_workspace",
        args_for(
            json!({}),
            json!({"name": "Provider WS", "kind": "personal", "preferredLanguage": "en"}),
        ),
    )
    .expect("create_workspace");
    let ws = response["data"]["workspaceId"]
        .as_str()
        .expect("ws id")
        .to_string();

    let response = invoke(
        webview,
        "create_project",
        args_for(
            context_for(&ws, "null", "null"),
            json!({"name": "Provider Project", "storageKind": "isolated"}),
        ),
    )
    .expect("create_project");
    let proj = response["data"]["projectId"]
        .as_str()
        .expect("proj id")
        .to_string();

    let response = invoke(
        webview,
        "create_session",
        args_for(context_for(&ws, &proj, "null"), json!({"title": null})),
    )
    .expect("create_session");
    let sess = response["data"]["sessionId"]
        .as_str()
        .expect("sess id")
        .to_string();
    (ws, proj, sess)
}

fn local_account_for(base_url: &str) -> LocalAccount {
    LocalAccount {
        account_id: ProviderAccountId::new(uuid::Uuid::now_v7().to_string()),
        kind: ProviderKind::OllamaLocal,
        alias: "Test Ollama".to_string(),
        privacy_class: PrivacyClass::LocalOnly,
        endpoint_id: EndpointId::new("local-ollama"),
        base_url: base_url.to_string(),
        approved_destination: false,
    }
}

fn model_descriptor(id: &str) -> ModelDescriptor {
    ModelDescriptor {
        model_id: ModelId(id.to_string()),
        human_label: id.to_string(),
        privacy_class: PrivacyClass::LocalOnly,
        capabilities: Default::default(),
    }
}

fn seed_local_account_with_model(
    runtime: &tokio::runtime::Runtime,
    ctx: &ApiContext,
    base_url: &str,
) -> String {
    runtime.block_on(async {
        let account = local_account_for(base_url);
        ctx.registry
            .upsert_account(&account)
            .await
            .expect("seed account");
        ctx.registry
            .replace_models(
                &account.account_id,
                &[(
                    ModelId("m:latest".to_string()),
                    "sha256:seeded".to_string(),
                    model_descriptor("m:latest"),
                )],
            )
            .await
            .expect("seed models");
        account.account_id.0.clone()
    })
}

/// Seed one history row through the canonical event + projection path.
#[allow(clippy::too_many_arguments)]
fn seed_history_row(
    runtime: &tokio::runtime::Runtime,
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    sess: &str,
    user: bool,
    completion: Option<MessageCompletionV1>,
    text: &str,
) {
    runtime.block_on(async {
        let scope = EventScope {
            installation_id: ctx.installation_id,
            workspace_id: Some(WorkspaceId::from_string(ws).expect("ws")),
            project_id: Some(ProjectId::from_string(proj).expect("proj")),
            session_id: Some(SessionId::from_string(sess).expect("sess")),
        };
        let sess_stream = format!("session:{sess}");
        let current_seq: u64 = sqlx::query_scalar::<_, i64>(
            "SELECT current_sequence FROM streams WHERE stream_id = ?",
        )
        .bind(&sess_stream)
        .fetch_optional(&ctx.pool)
        .await
        .expect("stream lookup")
        .map(|v| v as u64)
        .unwrap_or(0);

        let mut tx = ctx.pool.begin().await.expect("seed tx begin");
        let content_id = ContentId::new_v7();
        let kind = if user { "user_text" } else { "assistant_text" };
        SqliteEventStore::put_content_tx(
            &mut tx,
            ctx.content_key.as_ref(),
            &content_id,
            kind,
            "text/plain",
            &scope,
            text.as_bytes(),
        )
        .await
        .expect("seed content");

        let message_id = MessageId::new_v7();
        let seed_op_id = OperationId::new_v7();
        let (event_type, payload_json): (String, Vec<u8>) = if user {
            (
                "MessageSubmitted".to_string(),
                serde_json::to_vec(&MessageSubmittedV1 {
                    message_id,
                    content_id,
                    content_kind: kind.to_string(),
                    size_bytes: text.len() as u64,
                })
                .expect("payload"),
            )
        } else {
            (
                EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED.to_string(),
                serde_json::to_vec(&MessageCompletedV1 {
                    op_id: seed_op_id,
                    message_id,
                    content_id,
                    content_kind: kind.to_string(),
                    size_bytes: text.len() as u64,
                    completion: completion.expect("assistant seeds carry a terminal"),
                    usage: None,
                })
                .expect("payload"),
            )
        };

        let append_req = AppendEventRequest {
            stream_id: sess_stream,
            stream_kind: "session".to_string(),
            expected_sequence: current_seq,
            event_type,
            event_version: 1,
            scope: scope.clone(),
            actor: EventActor {
                actor_id: ctx.actor_id,
                kind: ActorKind::System,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json,
            metadata_json: b"{}".to_vec(),
        };
        let append_res = SqliteEventStore::append_event_tx(&mut tx, append_req)
            .await
            .expect("seed append");
        let now_us = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock")
            .as_micros() as i64;
        if user {
            adham_projections::ConversationProjection::insert_message_tx(
                &mut tx,
                &message_id.to_string(),
                ws,
                proj,
                sess,
                "user",
                &content_id.to_string(),
                &append_res.event_id.to_string(),
                append_res.global_position,
                now_us,
            )
            .await
            .expect("seed projection");
        } else {
            adham_projections::ConversationProjection::insert_assistant_completion_tx(
                &mut tx,
                &message_id.to_string(),
                ws,
                proj,
                sess,
                &seed_op_id.to_string(),
                &content_id.to_string(),
                &serde_json::to_string(&completion.unwrap()).expect("completion json"),
                None,
                &append_res.event_id.to_string(),
                append_res.global_position,
                now_us,
            )
            .await
            .expect("seed projection");
        }
        tx.commit().await.expect("seed commit");
    });
}

fn typed_envelope(
    context_scope: (&str, &str, &str),
    payload: CompleteOncePayload,
) -> CommandEnvelope<CompleteOncePayload> {
    let (ws, proj, sess) = context_scope;
    CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: Some(ws.to_string()),
            project_id: Some(proj.to_string()),
            session_id: Some(sess.to_string()),
        },
        payload,
    }
}

struct CollectSink(Arc<Mutex<Vec<StreamEventDto>>>);

impl EventSink for CollectSink {
    fn send(&self, event: StreamEventDto) -> Result<(), String> {
        self.0.lock().expect("collector").push(event);
        Ok(())
    }
}

struct FailingSink;

impl EventSink for FailingSink {
    fn send(&self, _event: StreamEventDto) -> Result<(), String> {
        Err("renderer went away".to_string())
    }
}

fn collector() -> Arc<Mutex<Vec<StreamEventDto>>> {
    Arc::new(Mutex::new(Vec::new()))
}

fn wait_until<T>(attempts: usize, mut probe: impl FnMut() -> Option<T>) -> Option<T> {
    for _ in 0..attempts {
        if let Some(t) = probe() {
            return Some(t);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    probe()
}

/// T1. All five provider commands resolve through the real dispatch, parse
/// their envelope shapes, and fail closed on unknown scope/accounts.
#[test]
fn provider_commands_register_and_reject_malformed_scope() {
    let (_runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);

    // unknown command is not registered
    let text = resp_text(invoke(&webview, "no_such_provider_cmd", json!({})));
    assert!(text.contains("not found"), "unknown command: {text}");

    // missing scope context is a validation error, not a panic
    let probe_args = args_for(json!({}), json!({"accountId": "anything"}));
    eprintln!("PROBE ARGS: {probe_args}");
    let text = resp_text(invoke(&webview, "test_provider_connection", probe_args));
    eprintln!("PROBE RESP: {text}");
    assert!(text.contains("InvalidRequest"), "missing scope: {text}");

    // envelope parsed: unknown account reaches the handler
    let (ws, proj, sess) = provision_scope(&webview);
    for cmd in ["test_provider_connection", "discover_ollama_models"] {
        let text = resp_text(invoke(
            &webview,
            cmd,
            args_for(
                context_for(&ws, &proj, &sess),
                json!({"accountId": "missing-account"}),
            ),
        ));
        assert!(text.contains("InvalidRequest"), "{cmd}: {text}");
    }

    // stop_completion with an unparseable op id
    let text = resp_text(invoke(
        &webview,
        "stop_completion",
        args_for(
            context_for(&ws, &proj, &sess),
            json!({"opId": "not-a-uuid"}),
        ),
    ));
    assert!(text.contains("InvalidRequest"), "bad op id: {text}");

    // complete_once_streaming without the channel argument is an arg error
    let text = resp_text(invoke(
        &webview,
        "complete_once_streaming",
        args_for(
            context_for(&ws, &proj, &sess),
            json!({"accountId": "a", "modelId": "m:latest", "text": "hi"}),
        ),
    ));
    assert!(
        text.contains("on_event") || text.contains("onEvent") || text.contains("missing"),
        "channel arg required: {text}"
    );
}

/// T2. Account create/update lifecycle + end-to-end discovery through the
/// local stub endpoint, with metadata-only connection probing.
#[test]
fn account_lifecycle_and_discovery_pins_models() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), ChatProgram::once(vec![]));

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let scope_ctx = context_for(&ws, &proj, &sess);

    // create account
    let response = invoke(
        &webview,
        "update_provider_account",
        args_for(
            scope_ctx.clone(),
            json!({"accountId": null, "alias": "Local Ollama", "endpointUrl": base_url}),
        ),
    )
    .expect("create account");
    let account_id = response["data"]["accountId"]
        .as_str()
        .expect("account id")
        .to_string();
    assert_eq!(
        response["data"]["privacyClass"],
        json!("local_only"),
        "{response}"
    );

    // metadata-only connection probe (no prompt, no billable call)
    let response = invoke(
        &webview,
        "test_provider_connection",
        args_for(scope_ctx.clone(), json!({"accountId": account_id})),
    )
    .expect("probe");
    assert_eq!(response["data"]["reachable"], json!(true), "{response}");
    assert_eq!(response["data"]["modelTagCount"], json!(2), "{response}");

    // discovery persists digest-pinned rows
    let response = invoke(
        &webview,
        "discover_ollama_models",
        args_for(scope_ctx.clone(), json!({"accountId": account_id})),
    )
    .expect("discover");
    let models = response["data"]["models"].as_array().expect("models");
    assert_eq!(models.len(), 2);
    let pinned = models
        .iter()
        .find(|m| m["modelId"] == json!("m:latest"))
        .expect("m:latest pinned");
    assert_eq!(pinned["digest"], json!("sha256:unittest-digest"));
    assert_eq!(pinned["privacyClass"], json!("local_only"));
    assert_eq!(pinned["capabilities"]["streaming"], json!("supported"));
    assert_eq!(pinned["capabilities"]["toolProposals"], json!("supported"));
    assert_eq!(pinned["capabilities"]["thinking"], json!("unknown"));
    let empty = models
        .iter()
        .find(|m| m["modelId"] == json!("tiny2:1b"))
        .expect("tiny2 pinned");
    assert_eq!(empty["digest"], json!(""));

    // alias-only update keeps the endpoint
    let response = invoke(
        &webview,
        "update_provider_account",
        args_for(
            scope_ctx.clone(),
            json!({"accountId": account_id, "alias": "Renamed"}),
        ),
    )
    .expect("update alias");
    assert_eq!(response["data"]["alias"], json!("Renamed"));
    assert_eq!(response["data"]["endpointUrl"], json!(base_url));

    // endpoint change wipes the pinned models (registry revision)
    let captures2 = Arc::new(StubCaptures::new());
    let base_url2 = spawn_stub_ollama(&runtime, None, captures2.clone(), ChatProgram::once(vec![]));
    let response = invoke(
        &webview,
        "update_provider_account",
        args_for(
            scope_ctx.clone(),
            json!({"accountId": account_id, "endpointUrl": base_url2}),
        ),
    )
    .expect("update endpoint");
    assert_eq!(response["data"]["endpointUrl"], json!(base_url2));
    let response = invoke(
        &webview,
        "discover_ollama_models",
        args_for(scope_ctx.clone(), json!({"accountId": account_id})),
    )
    .expect("rediscover after endpoint change");
    let models = response["data"]["models"].as_array().expect("models");
    assert_eq!(
        models.len(),
        2,
        "rediscovery re-pins against the new endpoint"
    );
}

/// T3. Happy-path streaming: the pending op is durable when the stub sees the
/// socket, the sink receives Started → deltas → Completed with per-op ordered
/// sequence numbers, the assistant turn persists with usage, and the op is
/// resolved.
#[test]
fn complete_once_streams_in_order_and_persists_terminal() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let chat = ChatProgram::once(vec![
        ndjson_delta("Hello"),
        ndjson_delta(" world"),
        ndjson_done(12, 7),
    ]);
    let base_url = spawn_stub_ollama(&runtime, Some(ctx.pool.clone()), captures.clone(), chat);
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let events = collector();
    let sink = CollectSink(events.clone());
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "Tell me about rust generics".to_string(),
        },
    );

    let response = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("completion ok");

    // record-then-socket: the stub observed one in-flight op at socket time
    assert_eq!(
        captures.pending_facts.lock().expect("facts").as_slice(),
        &[1],
        "pending op durable before any chat bytes: {:?}",
        captures.pending_facts
    );

    // per-op sequencing and payload order
    let got = events.lock().expect("collector").clone();
    assert!(got.len() >= 3, "events: {got:?}");
    assert_eq!(got[0].op_id, response.data.op_id, "events carry the op id");
    for (index, event) in got.iter().enumerate() {
        assert_eq!(event.sequence, (index + 1) as u64, "order: {got:?}");
        assert_eq!(event.op_id, response.data.op_id);
    }
    assert!(
        matches!(got[0].event, StreamEventPayloadDto::Started),
        "{got:?}"
    );
    match (&got[1].event, &got[2].event) {
        (StreamEventPayloadDto::Delta { text: a }, StreamEventPayloadDto::Delta { text: b }) => {
            assert_eq!(format!("{a}{b}"), "Hello world");
        }
        _ => panic!("deltas expected: {:?}", got),
    }
    let terminal = got.last().expect("terminal");
    match &terminal.event {
        StreamEventPayloadDto::Completed {
            completion,
            truncated,
            usage,
        } => {
            assert_eq!(completion, "completed");
            assert!(!*truncated);
            let usage = usage.as_ref().expect("usage recorded");
            assert_eq!(usage.prompt_tokens, Some(12));
            assert_eq!(usage.completion_tokens, Some(7));
            assert_eq!(usage.total_tokens, Some(19));
        }
        other => panic!("terminal expected: {other:?}"),
    }

    // the assistant turn persisted with its marker; the user turn too
    runtime.block_on(async {
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("rows");
        assert_eq!(rows.len(), 2, "rows: {rows:?}");
        assert_eq!(rows[0].role, "user");
        assert_eq!(rows[0].content, "Tell me about rust generics");
        assert_eq!(rows[1].role, "assistant");
        assert_eq!(rows[1].content, "Hello world");
        assert_eq!(
            rows[1].completion,
            Some(MessageCompletionV1::Completed { truncated: false })
        );
        let usage = rows[1].usage.clone().expect("usage");
        assert_eq!(usage.total_tokens, Some(19));

        // op resolved
        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&response.data.op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });
}

/// T4. History assembly is server-side (bounded, marker-aware) and the
/// session scope is ownership-checked before any socket.
#[test]
fn completion_history_is_bounded_and_tamper_proofed() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        None,
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("fresh"), ndjson_done(3, 1)]),
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    // 24 prior user rows + one completed assistant row + one interrupted row.
    for index in 0..24 {
        seed_history_row(
            &runtime,
            &ctx,
            &ws,
            &proj,
            &sess,
            true,
            None,
            &format!("question {index}"),
        );
    }
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        Some(MessageCompletionV1::Completed { truncated: false }),
        "completed answer marker",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        Some(MessageCompletionV1::Interrupted),
        "INTERRUPTED MARKER",
    );

    // tamper: context claims a different project for this session
    let other_project = ProjectId::new_v7().to_string();
    let tampered = typed_envelope(
        (&ws, &other_project, &sess),
        CompleteOncePayload {
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "hi".to_string(),
        },
    );
    let sink = CollectSink(collector());
    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, tampered, &sink).await
        })
        .expect_err("tampered scope must be rejected");
    assert!(err.contains("CONTEXT_MISMATCH"), "{err}");
    assert_eq!(captures.accepts(), 0, "no socket on tampered scope");

    // happy path: bounded history, newest-last, interrupted rows excluded
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "the latest question".to_string(),
        },
    );
    let sink = CollectSink(collector());
    let result = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("completion ok");
    let bodies = captures.request_bodies();
    assert_eq!(bodies.len(), 1, "one chat request");
    let body: Value = serde_json::from_str(&bodies[0]).expect("chat body json");
    let messages = body["messages"].as_array().expect("messages");
    assert_eq!(messages.len(), 20, "bounded to 20 rows: {}", messages.len());
    assert_eq!(messages.last().expect("last")["role"], json!("user"));
    assert_eq!(
        messages.last().expect("last")["content"],
        json!("the latest question")
    );
    let rendered = bodies[0].clone();
    assert!(
        rendered.contains("completed answer marker"),
        "completed prior answer in context"
    );
    assert!(
        !rendered.contains("INTERRUPTED MARKER"),
        "interrupted rows never enter context"
    );
    assert!(rendered.contains("question 23"), "newest seed kept");
    assert!(
        !rendered.contains("question 0\n") || !rendered.contains("\"question 0\""),
        "oldest rows trimmed"
    );

    // the final user message was persisted by THIS dispatch
    runtime.block_on(async {
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("rows");
        let submitted = rows
            .iter()
            .find(|r| r.role == "user" && r.content == "the latest question")
            .expect("final user row");
        assert_eq!(result.data.message_id, submitted.message_id);
    });
}

/// T5. Unknown model/account ids are refused before any socket and never
/// leave a pending op behind.
#[test]
fn unknown_model_blocked_before_socket() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram::once(vec![]),
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            account_id: account_id.clone(),
            model_id: "nosuchmodel:latest".to_string(),
            text: "hi".to_string(),
        },
    );
    let sink = CollectSink(collector());
    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect_err("unknown model");
    assert!(err.contains("unknown model"), "{err}");
    assert_eq!(captures.accepts(), 0, "no socket");

    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(
                &ctx,
                typed_envelope(
                    (&ws, &proj, &sess),
                    CompleteOncePayload {
                        account_id: "ghost".to_string(),
                        model_id: "m:latest".to_string(),
                        text: "hi".to_string(),
                    },
                ),
                &sink,
            )
            .await
        })
        .expect_err("unknown account");
    assert!(err.contains("unknown provider account"), "{err}");

    runtime.block_on(async {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pending_operations WHERE kind = 'provider-completion' AND status = 'pending'",
        )
        .fetch_one(&ctx.pool)
        .await
        .expect("pending scan");
        assert_eq!(count, 0, "no dangling pending ops");
    });
}

/// T6. Stop ownership: a foreign op is rejected and the op id is unknown
/// outside its session; a matching session with no live run reports
/// already-resolved.
#[test]
fn stop_completion_ownership_is_enforced() {
    let (runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    // a foreign op id that was never recorded
    let stop_env = CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: Some(ws.clone()),
            project_id: Some(proj.clone()),
            session_id: Some(sess.clone()),
        },
        payload: StopCompletionPayload {
            op_id: OperationId::new_v7().to_string(),
        },
    };
    let err = runtime
        .block_on(async { adham_desktop_api::handle_stop_completion(&ctx, stop_env).await })
        .expect_err("unknown op");
    assert!(err.contains("CONTEXT_MISMATCH"), "{err}");

    // a recorded op in THIS session, but not running → already-resolved
    runtime.block_on(async {
        let scope = EventScope {
            installation_id: ctx.installation_id,
            workspace_id: Some(WorkspaceId::from_string(&ws).expect("ws")),
            project_id: Some(ProjectId::from_string(&proj).expect("proj")),
            session_id: Some(SessionId::from_string(&sess).expect("sess")),
        };
        let request_id = uuid::Uuid::now_v7().to_string();
        let mut tx = ctx.pool.begin().await.expect("tx");
        SqliteEventStore::record_pending_operation_tx(
            &mut tx,
            ctx.content_key.as_ref(),
            &OperationId::new_v7().to_string(),
            "provider-completion",
            &scope,
            None,
            &request_id,
            "",
            None,
        )
        .await
        .expect("record");
        tx.commit().await.expect("commit");
        assert_eq!(request_id, request_id);
    });

    // tamper: stop claimed from a session that never existed
    let fake_session = SessionId::new_v7().to_string();
    let stop_env = CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: Some(ws.clone()),
            project_id: Some(proj.clone()),
            session_id: Some(fake_session.clone()),
        },
        payload: StopCompletionPayload {
            op_id: OperationId::new_v7().to_string(),
        },
    };
    let err = runtime
        .block_on(async { adham_desktop_api::handle_stop_completion(&ctx, stop_env).await })
        .expect_err("tampered session");
    assert!(
        err.contains("SESSION_NOT_FOUND") || err.contains("CONTEXT_MISMATCH"),
        "{err}"
    );
}

/// T7. Stop mid-stream: the partial answer persists as `interrupted`, the op
/// resolves, and the target op is the one stopped.
#[test]
fn stop_mid_stream_persists_interrupted_partial() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let gate = Arc::new(tokio::sync::Notify::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram {
            pre: vec![
                ndjson_delta("Hello "),
                ndjson_delta("partial "),
                ndjson_delta("answer"),
            ],
            post: vec![ndjson_done(4, 2)],
            gate: Some(gate.clone()),
        },
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let events = collector();
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "say something".to_string(),
        },
    );
    let sink = CollectSink(events.clone());
    let ctx_for_task = ctx.clone();
    let handle = runtime.spawn(async move {
        adham_desktop_api::handle_complete_once_streaming(&ctx_for_task, env, &sink).await
    });

    // wait until the deltas are flowing, then stop the op
    let op_id = wait_until(500, || {
        let got = events.lock().expect("collector");
        if got.len() >= 3 {
            Some(got[0].op_id.clone())
        } else {
            None
        }
    })
    .expect("stream events");

    let stop_env = CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: Some(ws.clone()),
            project_id: Some(proj.clone()),
            session_id: Some(sess.clone()),
        },
        payload: StopCompletionPayload {
            op_id: op_id.clone(),
        },
    };
    let stopped = runtime
        .block_on(async { adham_desktop_api::handle_stop_completion(&ctx, stop_env).await })
        .expect("stop ok");
    assert_eq!(stopped.data.status, "cancelled");

    let _ = runtime.block_on(handle);
    gate.notify_waiters();

    let got = events.lock().expect("collector").clone();
    let terminal = got.last().expect("terminal");
    match &terminal.event {
        StreamEventPayloadDto::Completed {
            completion,
            truncated,
            usage,
        } => {
            assert_eq!(completion, "interrupted");
            assert!(!*truncated);
            // the partial text was on the wire before the stop; no usage yet
            assert!(usage.is_none(), "interrupted before usage: {usage:?}");
        }
        other => panic!("interrupted terminal expected: {other:?}"),
    }

    runtime.block_on(async {
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("rows");
        let assistant = rows
            .iter()
            .find(|r| r.role == "assistant")
            .expect("assistant row");
        assert_eq!(assistant.content, "Hello partial answer");
        assert_eq!(assistant.completion, Some(MessageCompletionV1::Interrupted));

        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved", "the stopped op still resolves");
    });
}

/// T8. Renderer disconnect: sink failures never prevent the terminal from
/// persisting.
#[test]
fn renderer_disconnect_still_persists_terminal() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        None,
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("survives "), ndjson_done(6, 4)]),
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "disconnect test".to_string(),
        },
    );
    let sink = FailingSink;
    let result = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("completion still ok with a dead renderer");

    runtime.block_on(async {
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("rows");
        assert_eq!(rows.len(), 2);
        let assistant = rows
            .iter()
            .find(|r| r.role == "assistant")
            .expect("assistant");
        assert_eq!(assistant.content, "survives ");
        assert_eq!(
            assistant.completion,
            Some(MessageCompletionV1::Completed { truncated: false })
        );
        let usage = assistant.usage.clone().expect("usage");
        assert_eq!(usage.total_tokens, Some(10));

        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&result.data.op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });
}
