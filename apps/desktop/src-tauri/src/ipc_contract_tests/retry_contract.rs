use super::common::*;
use super::*;
use adham_core_types::*;
use adham_desktop_api::{RetryCompletionPayload, StreamEventPayloadDto};
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::Manager;

/// T5. Retry/regenerate is a NEW attempt for the SAME user turn: the user row
/// is never duplicated, the replaced attempt stays in history, the retried
/// request carries the context up to that turn (the previous attempt is not
/// fed back), and the attempt is an explicit durable op with its own terminal.
#[test]
fn retry_appends_a_new_attempt_and_keeps_the_original_turn() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        None,
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("second attempt"), ndjson_done(5, 2)]),
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    // Earlier turn (user + completed answer), then the failed turn to retry.
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        true,
        None,
        "earlier question",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        Some(MessageCompletionV1::Completed { truncated: false }),
        "first answer",
    );
    seed_history_row(&runtime, &ctx, &ws, &proj, &sess, true, None, "retry me");
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        Some(MessageCompletionV1::Failed),
        "FAILED ATTEMPT MARKER",
    );

    let target_id = runtime.block_on(async {
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("rows");
        rows.iter()
            .find(|r| r.role == "user" && r.content == "retry me")
            .expect("target row")
            .message_id
            .clone()
    });

    let events = collector();
    let sink = CollectSink(events.clone());
    let env = typed_envelope(
        (&ws, &proj, &sess),
        RetryCompletionPayload {
            account_id,
            model_id: "m:latest".to_string(),
            reply_to_message_id: target_id.clone(),
            mode: None,
            think: None,
        },
    );
    let response = runtime
        .block_on(async {
            adham_desktop_api::handle_retry_completion_streaming(&ctx, env, &sink).await
        })
        .expect("retry ok");

    // The response names the retried turn: no new user message exists.
    assert_eq!(response.data.message_id, target_id);

    let got = events.lock().expect("collector").clone();
    assert!(
        matches!(
            got.last().expect("terminal").event,
            StreamEventPayloadDto::Completed { .. }
        ),
        "events: {got:?}"
    );

    // One socket, and its context ends at the retried user turn: the replaced
    // attempt is not sent back, the earlier answered turn is.
    let bodies = captures.request_bodies();
    assert_eq!(bodies.len(), 1, "exactly one socket for one retry");
    let body: Value = serde_json::from_str(&bodies[0]).expect("chat body json");
    let messages = body["messages"].as_array().expect("messages");
    assert_eq!(
        messages.last().expect("last")["content"],
        json!("retry me"),
        "the retried turn is the last assembled message"
    );
    assert!(bodies[0].contains("earlier question"), "prior turn kept");
    assert!(bodies[0].contains("first answer"), "prior answer kept");
    assert!(
        !bodies[0].contains("FAILED ATTEMPT MARKER"),
        "the replaced attempt never re-enters the model context"
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
        assert_eq!(rows.len(), 5, "rows: {rows:?}");
        assert_eq!(rows[2].content, "retry me");
        assert_eq!(
            rows[3].completion,
            Some(MessageCompletionV1::Failed),
            "the original failed attempt is preserved"
        );
        assert_eq!(rows[4].content, "second attempt");
        assert_eq!(
            rows[4].completion,
            Some(MessageCompletionV1::Completed { truncated: false })
        );
        let user_rows = rows.iter().filter(|r| r.role == "user").count();
        assert_eq!(user_rows, 2, "the user turn is never duplicated");

        let status: String =
            sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
                .bind(&response.data.op_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("pending row");
        assert_eq!(status, "resolved");
    });
}

/// T5b. Retry refusals are explicit and pre-socket: an older turn, a non-user
/// target and an unknown target are all refused with no socket and no op.
#[test]
fn retry_refuses_older_turns_and_non_user_targets() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        None,
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("unused")]),
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    seed_history_row(&runtime, &ctx, &ws, &proj, &sess, true, None, "older turn");
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        Some(MessageCompletionV1::Completed { truncated: false }),
        "older answer",
    );
    seed_history_row(&runtime, &ctx, &ws, &proj, &sess, true, None, "latest turn");

    let (older_user_id, assistant_id) = runtime.block_on(async {
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("rows");
        let older = rows
            .iter()
            .find(|r| r.role == "user" && r.content == "older turn")
            .expect("older row")
            .message_id
            .clone();
        let assistant = rows
            .iter()
            .find(|r| r.role == "assistant")
            .expect("assistant row")
            .message_id
            .clone();
        (older, assistant)
    });

    let retry = |reply: &str| {
        typed_envelope(
            (&ws, &proj, &sess),
            RetryCompletionPayload {
                account_id: account_id.clone(),
                model_id: "m:latest".to_string(),
                reply_to_message_id: reply.to_string(),
                mode: None,
                think: None,
            },
        )
    };
    let sink = CollectSink(collector());

    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_retry_completion_streaming(&ctx, retry(&older_user_id), &sink)
                .await
        })
        .expect_err("an older turn cannot be retried");
    assert!(err.contains("RETRY_NOT_LATEST_TURN"), "{err}");

    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_retry_completion_streaming(&ctx, retry(&assistant_id), &sink)
                .await
        })
        .expect_err("an assistant turn cannot be retried");
    assert!(err.contains("only a user turn"), "{err}");

    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_retry_completion_streaming(&ctx, retry("no-such-row"), &sink)
                .await
        })
        .expect_err("an unknown target is refused");
    assert!(err.contains("reply target"), "{err}");

    assert_eq!(captures.accepts(), 0, "refusals never open a socket");
    runtime.block_on(async {
        let ops: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pending_operations WHERE kind = 'provider-completion'",
        )
        .fetch_one(&ctx.pool)
        .await
        .expect("pending count");
        assert_eq!(ops, 0, "a refused retry records no op");
    });
}
