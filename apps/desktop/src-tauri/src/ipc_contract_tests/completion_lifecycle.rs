use super::common::*;
use super::*;
use adham_core_types::*;
use adham_desktop_api::StreamEventPayloadDto;
use adham_event_log::SqliteEventStore;
use serde_json::json;
use std::sync::Arc;
use tauri::Manager;

/// C1.1. Stop during connect: the op handle must reach the renderer before
/// the socket responds so cancellation works with no frame at all. The user
/// cancellation stays `interrupted` (never failed/empty) and the op resolves.
#[test]
fn stop_during_connect_persists_interrupted_and_resolves() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let header_gate = Arc::new(tokio::sync::Notify::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram {
            pre: vec![],
            post: vec![ndjson_delta("late answer")],
            gate: None,
            // never notified: the stub stays in connect for the whole test
            header_gate: Some(header_gate.clone()),
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
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "slow one".to_string(),
            mode: None,
            think: None,
            reference: None,
        },
    );
    let sink = CollectSink(events.clone());
    let ctx_for_task = ctx.clone();
    let handle = runtime.spawn(async move {
        adham_desktop_api::handle_complete_once_streaming(&ctx_for_task, env, &sink).await
    });

    // the op handle is on the wire while the socket has produced nothing
    let op_id = wait_until(500, || {
        let got = events.lock().expect("collector");
        got.first().map(|e| e.op_id.clone())
    })
    .expect("started event while connecting");
    {
        let got = events.lock().expect("collector");
        assert!(matches!(got[0].event, StreamEventPayloadDto::Started));
        assert_eq!(got.len(), 1, "no frame before connect finished: {got:?}");
    }

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

    let terminal = runtime.block_on(handle).expect("completion task joins");
    assert!(
        terminal.is_ok(),
        "interrupted completion still returns its op: {terminal:?}"
    );

    let got = events.lock().expect("collector").clone();
    match &got.last().expect("terminal").event {
        StreamEventPayloadDto::Completed {
            completion,
            truncated,
            usage,
        } => {
            assert_eq!(completion, "interrupted");
            assert!(!*truncated);
            assert!(usage.is_none(), "no usage before any frame: {usage:?}");
        }
        other => panic!("interrupted terminal expected: {other:?}"),
    }
    let terminal_count = got
        .iter()
        .filter(|e| matches!(e.event, StreamEventPayloadDto::Completed { .. }))
        .count();
    assert_eq!(terminal_count, 1, "one terminal only: {got:?}");
    assert!(
        !got.iter()
            .any(|e| matches!(e.event, StreamEventPayloadDto::Delta { .. })),
        "cancellation never needed an answer frame: {got:?}"
    );

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
        assert_eq!(rows.len(), 2, "user + cancelled assistant: {rows:?}");
        let assistant = rows
            .iter()
            .find(|r| r.role == "assistant")
            .expect("assistant row");
        assert_eq!(assistant.content, "");
        assert_eq!(assistant.completion, Some(MessageCompletionV1::Interrupted));

        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });

    header_gate.notify_waiters();
}

/// C1.1. Stop after real reasoning activity but before any answer text: the
/// turn stays `interrupted` (never failed as an empty answer), the reasoning
/// stays hidden, and the op resolves.
#[test]
fn stop_after_thinking_activity_stays_interrupted() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let gate = Arc::new(tokio::sync::Notify::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram {
            pre: vec![
                r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":"","thinking":"internal reasoning"},"done":false}"#.to_string() + "\n",
            ],
            post: vec![ndjson_delta("late answer"), ndjson_done(4, 2)],
            gate: Some(gate.clone()),
            header_gate: None,
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
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "think then answer".to_string(),
            mode: None,
            think: None,
            reference: None,
        },
    );
    let sink = CollectSink(events.clone());
    let ctx_for_task = ctx.clone();
    let handle = runtime.spawn(async move {
        adham_desktop_api::handle_complete_once_streaming(&ctx_for_task, env, &sink).await
    });

    // wait until the thinking marker arrived; answer frames stay gated
    let op_id = wait_until(500, || {
        let got = events.lock().expect("collector");
        got.iter()
            .any(|e| matches!(e.event, StreamEventPayloadDto::Thinking))
            .then(|| got[0].op_id.clone())
    })
    .expect("thinking marker event");

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

    let terminal = runtime.block_on(handle).expect("completion task joins");
    assert!(
        terminal.is_ok(),
        "interrupted completion still returns its op: {terminal:?}"
    );
    gate.notify_waiters();

    let got = events.lock().expect("collector").clone();
    let thinking_count = got
        .iter()
        .filter(|e| matches!(e.event, StreamEventPayloadDto::Thinking))
        .count();
    assert_eq!(thinking_count, 1, "one marker, then cancelled: {got:?}");
    assert!(
        !format!("{got:?}").contains("internal reasoning"),
        "reasoning text never reaches the wire: {got:?}"
    );
    match &got.last().expect("terminal").event {
        StreamEventPayloadDto::Completed { completion, .. } => {
            assert_eq!(
                completion, "interrupted",
                "a cancelled thinking run is interrupted, not an empty failure: {got:?}"
            );
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
        assert_eq!(assistant.content, "");
        assert_eq!(assistant.completion, Some(MessageCompletionV1::Interrupted));

        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });
}

/// C1.1. A text-only completion that ends with a normal stop and produced no
/// answer text at all fails visibly: failed row, failed wire terminal, and
/// the op resolves — never an empty success.
#[test]
fn empty_stop_persists_failed_terminal_and_resolves() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram::once(vec![
            r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":""},"done":false}"#
                .to_string()
                + "\n",
            ndjson_done(7, 0),
        ]),
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
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "say nothing".to_string(),
            mode: None,
            think: None,
            reference: None,
        },
    );
    let sink = CollectSink(events.clone());
    let response = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("empty completion returns a terminal, not an error");

    let got = events.lock().expect("collector").clone();
    assert!(matches!(got[0].event, StreamEventPayloadDto::Started));
    match &got.last().expect("terminal").event {
        StreamEventPayloadDto::Completed {
            completion,
            truncated,
            ..
        } => {
            assert_eq!(
                completion, "failed",
                "zero answer text with a normal stop fails visibly: {got:?}"
            );
            assert!(!*truncated);
        }
        other => panic!("failed terminal expected: {other:?}"),
    }
    let terminal_count = got
        .iter()
        .filter(|e| matches!(e.event, StreamEventPayloadDto::Completed { .. }))
        .count();
    assert_eq!(terminal_count, 1, "single terminal: {got:?}");

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
        assert_eq!(rows.len(), 2, "user + failed assistant: {rows:?}");
        let assistant = rows
            .iter()
            .find(|r| r.role == "assistant")
            .expect("assistant row");
        assert_eq!(assistant.content, "");
        assert_eq!(assistant.completion, Some(MessageCompletionV1::Failed));

        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&response.data.op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });
}

/// C1.1. A tool-only outcome (structured output, no text) with a normal stop
/// must not complete as an empty success either: recorded failed, never
/// mislabelled as a plain empty-answer path.
#[test]
fn tool_only_stop_persists_failed_not_completed() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram::once(vec![
            r#"{"model":"m","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"lookup","arguments":{"q":"private needle"}}}]},"done":false}"#.to_string() + "\n",
            ndjson_done(5, 1),
        ]),
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
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "use a tool".to_string(),
            mode: None,
            think: None,
            reference: None,
        },
    );
    let sink = CollectSink(events.clone());
    let response = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("tool-only completion returns a terminal, not an error");

    let got = events.lock().expect("collector").clone();
    assert!(
        !format!("{got:?}").contains("private needle"),
        "tool arguments never reach the wire: {got:?}"
    );
    match &got.last().expect("terminal").event {
        StreamEventPayloadDto::Completed { completion, .. } => {
            assert_eq!(
                completion, "failed",
                "tool-only output is unsupported, not a successful empty answer: {got:?}"
            );
        }
        other => panic!("failed terminal expected: {other:?}"),
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
        assert_eq!(assistant.content, "");
        assert_eq!(assistant.completion, Some(MessageCompletionV1::Failed));

        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&response.data.op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });
}

/// T8. Provider-op recovery through the typed IPC command: command name,
/// camelCase payload, session context envelope, and a canonical interrupted
/// terminal that closes the op exactly once (replay is idempotent).
#[test]
fn mark_completion_interrupted_closes_a_stale_provider_op_once() {
    let (runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let op_id = OperationId::new_v7().to_string();
    let request_id = uuid::Uuid::now_v7().to_string();
    runtime.block_on(async {
        let scope = EventScope {
            installation_id: ctx.installation_id,
            workspace_id: Some(WorkspaceId::from_string(&ws).expect("ws")),
            project_id: Some(ProjectId::from_string(&proj).expect("proj")),
            session_id: Some(SessionId::from_string(&sess).expect("sess")),
        };
        let mut tx = ctx.pool.begin().await.expect("tx");
        SqliteEventStore::record_pending_operation_tx(
            &mut tx,
            ctx.content_key.as_ref(),
            &op_id,
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
    });

    let response = invoke(
        &webview,
        "mark_completion_interrupted",
        args_for(
            json!({ "workspaceId": ws, "projectId": proj, "sessionId": sess }),
            json!({ "operationId": &op_id, "expectedMessageRequestId": &request_id }),
        ),
    )
    .expect("mark_completion_interrupted");
    assert_eq!(response["data"]["status"], json!("interrupted"));

    let replay = invoke(
        &webview,
        "mark_completion_interrupted",
        args_for(
            json!({ "workspaceId": ws, "projectId": proj, "sessionId": sess }),
            json!({ "operationId": &op_id, "expectedMessageRequestId": &request_id }),
        ),
    )
    .expect("mark_completion_interrupted replay");
    assert_eq!(replay["data"]["status"], json!("already-resolved"));

    runtime.block_on(async {
        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
        let assistant_rows: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM conversation_messages WHERE session_id = ? AND role = 'assistant'",
        )
        .bind(&sess)
        .fetch_one(&ctx.pool)
        .await
        .expect("assistant rows");
        assert_eq!(assistant_rows, 1, "one canonical terminal per op");
    });
}
