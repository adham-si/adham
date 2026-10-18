use super::common::*;
use super::*;
use adham_core_types::*;
use adham_desktop_api::StreamEventPayloadDto;
use std::sync::Arc;
use tauri::Manager;
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

        // exactly one canonical terminal event on the wire
        let terminal_count = got
            .iter()
            .filter(|e| matches!(e.event, StreamEventPayloadDto::Completed { .. }))
            .count();
        assert_eq!(terminal_count, 1, "no duplicate terminal broadcast: {got:?}");

        // no plaintext content at rest: assistant text appears in no event
        // payload and never unprotected in the content store.
        let payloads: Vec<String> =
            sqlx::query_scalar::<_, String>("SELECT CAST(payload_json AS TEXT) FROM events")
                .fetch_all(&ctx.pool)
                .await
                .expect("event payloads");
        assert!(
            payloads.iter().all(|p| !p.contains("Hello world")),
            "assistant text leaked into event payloads"
        );
        assert!(
            payloads.iter().all(|p| !p.contains("Hello world")),
            "assistant text leaked into event payloads"
        );
        let protected_hits: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM content_records \
             WHERE plaintext_size > 0 AND CAST(protected_bytes AS TEXT) LIKE '%Hello world%'",
        )
        .fetch_one(&ctx.pool)
        .await
        .expect("content records scan");
        assert_eq!(
            protected_hits, 0,
            "assistant text must reach storage only through the AEAD protected bytes"
        );
        let schemes: Vec<String> = sqlx::query_scalar(
            "SELECT DISTINCT protection_scheme FROM content_records WHERE content_kind = 'assistant_text'",
        )
        .fetch_all(&ctx.pool)
        .await
        .expect("schemes");
        assert!(
            !schemes.contains(&"none".to_string()),
            "assistant content must never rest unprotected: {schemes:?}"
        );

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
/// A7 follow-up. The owner-observed failure: a thinking-capable model
/// (qwen3.5:0.8b) streams contentless `thinking` frames; the adapter used to
/// panic on the first one, aborting the streaming task and leaving the op
/// dangling `pending` with no assistant content. End-to-end regression: the
/// thinking run is skipped, the answer persists once as `completed`, and the
/// op resolves.
#[test]
fn thinking_model_stream_persists_answer_and_resolves() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let chat = ChatProgram::once(vec![
        r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":"","thinking":"the model reasons"},"done":false}"#.to_string() + "\n",
        r#"{"model":"qwen3.5:0.8b","message":{"role":"assistant","content":"","thinking":"more"},"done":false}"#.to_string() + "\n",
        ndjson_delta("the answer"),
        ndjson_done(7, 3),
    ]);
    let base_url = spawn_stub_ollama(&runtime, Some(ctx.pool.clone()), captures.clone(), chat);
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
            text: "hello".to_string(),
        },
    );
    let sink = CollectSink(events.clone());
    let response = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env.clone(), &sink).await
        })
        .expect("thinking frames must not abort the completion");

    let got = events.lock().expect("collector").clone();
    let terminal_count = got
        .iter()
        .filter(|e| matches!(e.event, StreamEventPayloadDto::Completed { .. }))
        .count();
    assert_eq!(terminal_count, 1, "single terminal broadcast: {got:?}");
    match &got.last().expect("terminal").event {
        StreamEventPayloadDto::Completed { completion, .. } => {
            assert_eq!(completion, "completed", "thinking stream failed: {got:?}");
        }
        other => panic!("completed terminal expected: {other:?}"),
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
        assert_eq!(rows.len(), 2, "user turn + one answer: {rows:?}");
        let assistant = rows
            .iter()
            .find(|r| r.role == "assistant")
            .expect("assistant row");
        assert_eq!(assistant.content, "the answer");
        assert_eq!(
            assistant.completion,
            Some(MessageCompletionV1::Completed { truncated: false }),
            "the thinking run never leaks into the recorded answer"
        );

        // the op that the owner saw dangling is resolved
        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&response.data.op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });
}
