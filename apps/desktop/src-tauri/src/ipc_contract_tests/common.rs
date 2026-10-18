use super::*;
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

pub struct StubCaptures {
    accepts: AtomicU64,
    requests: Mutex<Vec<(String, String)>>,
    /// Facts observed from inside the stub at socket time (pending counts).
    pub pending_facts: Mutex<Vec<i64>>,
}

impl StubCaptures {
    pub fn new() -> Self {
        Self {
            accepts: AtomicU64::new(0),
            requests: Mutex::new(Vec::new()),
            pending_facts: Mutex::new(Vec::new()),
        }
    }

    pub fn accepts(&self) -> u64 {
        self.accepts.load(Ordering::SeqCst)
    }

    pub fn request_bodies(&self) -> Vec<String> {
        self.requests
            .lock()
            .expect("stub requests")
            .iter()
            .map(|(_, b)| b.clone())
            .collect()
    }
}

pub fn http_ok(content_type: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

pub fn chunk(data: &[u8]) -> Vec<u8> {
    let mut out = format!("{:x}\r\n", data.len()).into_bytes();
    out.extend_from_slice(data);
    out.extend_from_slice(b"\r\n");
    out
}

pub fn ndjson_delta(text: &str) -> String {
    serde_json::json!({"message": {"role": "assistant", "content": text}, "done": false})
        .to_string()
        + "\n"
}

pub fn ndjson_done(prompt: u64, eval: u64) -> String {
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
pub struct ChatProgram {
    pub pre: Vec<String>,
    pub post: Vec<String>,
    pub gate: Option<Arc<tokio::sync::Notify>>,
}

impl ChatProgram {
    pub fn once(lines: Vec<String>) -> Self {
        Self {
            pre: Vec::new(),
            post: lines,
            gate: None,
        }
    }
}

pub const TAGS_BODY: &str = r#"{"models":[{"name":"m:latest","digest":"sha256:unittest-digest"},{"name":"tiny2:1b","digest":""}]}"#;
pub const SHOW_BODY: &str = r#"{"capabilities":["streaming","tools"]}"#;

/// Minimal loopback Ollama stub. `/api/chat` bodies stream chunked so a
/// mid-stream stall is representable (no content-length lie).
pub fn spawn_stub_ollama(
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

pub fn provider_mock_app(ctx: ApiContext) -> tauri::App<MockRuntime> {
    mock_builder()
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![
            create_workspace,
            create_project,
            create_session,
            get_conversation,
            list_provider_accounts,
            test_provider_connection,
            list_provider_models,
            discover_ollama_models,
            update_provider_account,
            configure_google_account,
            disconnect_google_account,
            disconnect_ollama_account,
            complete_once_streaming,
            stop_completion
        ])
        .build(app_context())
        .expect("build mock app")
}

pub fn mock_webview(app: &tauri::App<MockRuntime>) -> tauri::WebviewWindow<MockRuntime> {
    tauri::WebviewWindowBuilder::new(app, "provider", Default::default())
        .build()
        .expect("build mock webview")
}

/// The raw IPC envelope.
pub fn envelope_for(context: Value, payload: Value) -> Value {
    json!({
        "protocolVersion": 1,
        "requestId": uuid::Uuid::now_v7().to_string(),
        "context": context,
        "payload": payload,
    })
}

/// Envelope wrapped in the `request` argument key the real dispatch reads.
/// Envelope wrapped in the `request` argument key the real dispatch reads.
pub fn args_for(context: Value, payload: Value) -> Value {
    json!({ "request": envelope_for(context, payload) })
}

/// The mock harness returns command-level errors as body values; stringify
/// for substring assertions across both shapes.
pub fn resp_text(result: Result<Value, Value>) -> String {
    match result {
        Ok(v) => v.to_string(),
        Err(v) => v.to_string(),
    }
}

pub fn context_for(ws: &str, proj: &str, sess: &str) -> Value {
    json!({"workspaceId": ws, "projectId": proj, "sessionId": sess})
}

/// workspace → project → session through the real dispatch.
pub fn provision_scope(webview: &tauri::WebviewWindow<MockRuntime>) -> (String, String, String) {
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

pub fn local_account_for(base_url: &str) -> LocalAccount {
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

pub fn model_descriptor(id: &str) -> ModelDescriptor {
    ModelDescriptor {
        model_id: ModelId(id.to_string()),
        human_label: id.to_string(),
        privacy_class: PrivacyClass::LocalOnly,
        capabilities: Default::default(),
    }
}

pub fn seed_local_account_with_model(
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
pub fn seed_history_row(
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

pub fn typed_envelope(
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

pub struct CollectSink(pub Arc<Mutex<Vec<StreamEventDto>>>);

impl EventSink for CollectSink {
    fn send(&self, event: StreamEventDto) -> Result<(), String> {
        self.0.lock().expect("collector").push(event);
        Ok(())
    }
}

pub struct FailingSink;

impl EventSink for FailingSink {
    fn send(&self, _event: StreamEventDto) -> Result<(), String> {
        Err("renderer went away".to_string())
    }
}

pub fn collector() -> Arc<Mutex<Vec<StreamEventDto>>> {
    Arc::new(Mutex::new(Vec::new()))
}

pub fn wait_until<T>(attempts: usize, mut probe: impl FnMut() -> Option<T>) -> Option<T> {
    for _ in 0..attempts {
        if let Some(t) = probe() {
            return Some(t);
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    probe()
}
