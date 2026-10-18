use super::common::*;
use super::*;
use adham_core_types::*;
use adham_desktop_api::StreamEventPayloadDto;
use adham_event_log::SqliteEventStore;
use std::sync::Arc;
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
    // exactly one canonical terminal event reached the renderer
    let terminal_count = got
        .iter()
        .filter(|e| matches!(e.event, StreamEventPayloadDto::Completed { .. }))
        .count();
    assert_eq!(terminal_count, 1, "stop must not broadcast twice: {got:?}");

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

    // double-stop idempotency: the second stop is already-resolved, emits
    // no second terminal, and leaves exactly one Interrupted row.
    let stop_env2 = CommandEnvelope {
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
    let again = runtime
        .block_on(async { adham_desktop_api::handle_stop_completion(&ctx, stop_env2).await })
        .expect("second stop is observed idempotently");
    assert_eq!(again.data.status, "already-resolved", "{again:?}");
    let terminal_count2 = events
        .lock()
        .expect("collector")
        .iter()
        .filter(|e| matches!(e.event, StreamEventPayloadDto::Completed { .. }))
        .count();
    assert_eq!(terminal_count2, 1, "no second terminal on replay stop");
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
        let interrupted_rows = rows
            .iter()
            .filter(|r| r.completion == Some(MessageCompletionV1::Interrupted))
            .count();
        assert_eq!(interrupted_rows, 1, "single canonical Interrupted row");
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

/// A7 acceptance #1. Premature EOF: the stub streams deltas and ends the
/// body without a terminal frame. The handler must broadcast exactly one
/// `failed` terminal (never a completion), resolve the op (no dangling
/// pending), and the replay must hold the partial exactly once.
#[test]
fn premature_eof_persists_failed_terminal_once() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram {
            pre: vec![ndjson_delta("before the line went "), ndjson_delta("dead")],
            post: vec![],
            gate: None,
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
            text: "stream until you die".to_string(),
        },
    );
    let sink = CollectSink(events.clone());
    let result = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("EOF still resolves the handler with a failed terminal");

    let got = events.lock().expect("collector").clone();
    let terminal_count = got
        .iter()
        .filter(|e| matches!(e.event, StreamEventPayloadDto::Completed { .. }))
        .count();
    assert_eq!(terminal_count, 1, "exactly one terminal broadcast: {got:?}");
    match &got.last().expect("terminal").event {
        StreamEventPayloadDto::Completed { completion, .. } => {
            assert_eq!(
                completion, "failed",
                "EOF is a failed terminal, never a completion"
            );
        }
        other => panic!("terminal expected: {other:?}"),
    }

    runtime.block_on(async {
        assert_eq!(
            result.data.message_id.len(),
            usize::try_from(36).expect("uuid len"),
            "failed terminal still produced a durable assistant row"
        );
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("rows");
        assert_eq!(rows.len(), 2, "user turn + failed-tail assistant: {rows:?}");
        assert_eq!(
            rows.iter().filter(|r| r.role == "assistant").count(),
            1,
            "the partial persists exactly once"
        );
        let assistant = rows.iter().find(|r| r.role == "assistant").expect("assistant");
        assert_eq!(assistant.content, "before the line went dead");
        assert_eq!(
            assistant.completion,
            Some(MessageCompletionV1::Failed),
            "EOF maps to the failed taxonomy, not completed"
        );

        // no dangling unresolved op: the wire failure resolved it
        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&result.data.op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved", "EOF resolved the op");

        // at rest: the partial lives only in protected bytes
        let protected_hits: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM content_records \
             WHERE plaintext_size > 0 AND CAST(protected_bytes AS TEXT) LIKE '%before the line went%'",
        )
        .fetch_one(&ctx.pool)
        .await
        .expect("content scan");
        assert_eq!(protected_hits, 0, "no plaintext at rest");
    });
}

/// A7 acceptance #2. Crash/unresolved-op recovery: an op recorded durable at
/// socket time but never resolved (the process died before the terminal) must
/// surface as unresolved, never auto-complete, and leave history without the
/// tail.
#[test]
fn unresolved_pending_operation_surfaces_and_never_autocompletes() {
    let (runtime, ctx) = disposable_context();
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let op_id = OperationId::new_v7().to_string();
    // the user turn persisted before the crash; the assistant tail never happened
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        true,
        None,
        "the message that was streaming",
    );
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
            &uuid::Uuid::now_v7().to_string(),
            "",
            None,
        )
        .await
        .expect("record crash-time op");
        tx.commit().await.expect("commit");
    });

    // reopen: the pending list surfaces the op as unresolved
    let list = runtime
        .block_on(async { adham_desktop_api::handle_list_pending_operations(&ctx).await })
        .expect("pending list");
    let unresolved = list
        .operations
        .iter()
        .find(|o| o.operation_id == op_id)
        .expect("the crash-time op survives restart");
    assert_eq!(unresolved.status, "pending", "{unresolved:?}");

    // replay: history has the user turn but NO assistant tail for the op
    let page = runtime
        .block_on(async {
            adham_desktop_api::handle_get_conversation(
                &ctx,
                CommandContext {
                    workspace_id: Some(ws.clone()),
                    project_id: Some(proj.clone()),
                    session_id: Some(sess.clone()),
                },
            )
            .await
        })
        .expect("replay read");
    let assistant_tails = page.items.iter().filter(|m| m.role == "assistant").count();
    assert_eq!(
        assistant_tails, 0,
        "history must have no tail for the crashed op: {:?}",
        page.items
    );
    assert_eq!(
        page.items.len(),
        1,
        "the user turn is there: {:?}",
        page.items
    );

    // reads never auto-resolve: the op stays unresolved until explicit
    // reconciliation (clear/recovery), never a phantom completion.
    let still: String = runtime
        .block_on(async {
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&op_id)
                .fetch_one(&ctx.pool)
                .await
        })
        .expect("pending row");
    assert_eq!(still, "pending", "no automatic resolution on read");
}
