use super::common::*;
use super::*;
use adham_core_types::*;
use adham_desktop_api::MessageReferenceDto;
use serde_json::Value;
use std::sync::Arc;
use tauri::Manager;

/// C3: a reply records its durable anchor — the canonical event is written at
/// version 2 with the reference, and the read path returns it.
#[test]
fn complete_once_records_a_reply_reference_and_reads_it_back() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let chat = ChatProgram::once(vec![ndjson_delta("anchored answer"), ndjson_done(4, 2)]);
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), chat);
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        true,
        None,
        "quoted question",
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
            .find(|r| r.content == "quoted question")
            .expect("target row")
            .message_id
            .clone()
    });

    let events = collector();
    let sink = CollectSink(events.clone());
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id,
            model_id: "m:latest".to_string(),
            text: "answering the quote".to_string(),
            mode: None,
            think: None,
            reference: Some(MessageReferenceDto {
                refers_to_message_id: target_id.clone(),
                relation: "replied".to_string(),
            }),
        },
    );
    runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("anchored completion ok");

    runtime.block_on(async {
        // New submissions are version 2 and carry the reference in the payload;
        // the seeded history stays version 1 and is never rewritten.
        let latest_version: i64 = sqlx::query_scalar(
            "SELECT event_version FROM events WHERE event_type = 'MessageSubmitted' \
             ORDER BY global_position DESC LIMIT 1",
        )
        .fetch_one(&ctx.pool)
        .await
        .expect("latest version");
        assert_eq!(latest_version, 2);
        let payload_text: String = sqlx::query_scalar(
            "SELECT CAST(payload_json AS TEXT) FROM events WHERE event_type = 'MessageSubmitted' \
             ORDER BY global_position DESC LIMIT 1",
        )
        .fetch_one(&ctx.pool)
        .await
        .expect("latest payload");
        let payload: Value = serde_json::from_str(&payload_text).expect("payload json");
        assert_eq!(
            payload["reference"]["refers_to_message_id"],
            target_id.as_str()
        );
        assert_eq!(payload["reference"]["relation"], "replied");

        // The read path returns the anchor; the target carries none.
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let messages = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("messages");
        assert_eq!(messages.len(), 3, "messages: {messages:?}");
        assert_eq!(messages[0].content, "quoted question");
        assert_eq!(messages[0].refers_to_message_id, None);
        assert_eq!(messages[0].refers_to_relation, None);
        let reply = messages
            .iter()
            .find(|m| m.content == "answering the quote")
            .expect("reply row");
        assert_eq!(
            reply.refers_to_message_id.as_deref(),
            Some(target_id.as_str())
        );
        assert_eq!(reply.refers_to_relation.as_deref(), Some("replied"));
    });
}

/// C3: a reference that cannot be anchored refuses the whole send before any
/// provider socket and before anything is appended.
#[test]
fn complete_once_refuses_a_reference_that_cannot_be_anchored() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let chat = ChatProgram::once(vec![ndjson_delta("never used"), ndjson_done(1, 1)]);
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), chat);
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        true,
        None,
        "existing question",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        Some(MessageCompletionV1::Completed { truncated: false }),
        "existing answer",
    );

    let assistant_id = runtime.block_on(async {
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
            .find(|r| r.role == "assistant")
            .expect("assistant row")
            .message_id
            .clone()
    });

    let payload = |reference: Option<MessageReferenceDto>| CompleteOncePayload {
        account_id: account_id.clone(),
        model_id: "m:latest".to_string(),
        text: "refused".to_string(),
        mode: None,
        think: None,
        reference,
        attachment_ids: Vec::new(),
    };

    let cases: Vec<(MessageReferenceDto, &str)> = vec![
        (
            MessageReferenceDto {
                refers_to_message_id: MessageId::new_v7().to_string(),
                relation: "replied".to_string(),
            },
            "reference target is not in this session",
        ),
        (
            MessageReferenceDto {
                refers_to_message_id: assistant_id.clone(),
                relation: "edited-from".to_string(),
            },
            "only a user message can be edited",
        ),
        (
            MessageReferenceDto {
                refers_to_message_id: assistant_id.clone(),
                relation: "rewritten".to_string(),
            },
            "relation must be replied or edited-from",
        ),
    ];

    for (reference, expected) in cases {
        let sink = CollectSink(collector());
        let env = typed_envelope((&ws, &proj, &sess), payload(Some(reference)));
        let err = runtime
            .block_on(async {
                adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
            })
            .expect_err("an unanchorable reference must refuse the send");
        assert!(err.contains(expected), "{err}");
    }

    assert_eq!(captures.accepts(), 0, "refusals never open a socket");
    runtime.block_on(async {
        let submitted: i64 =
            sqlx::query_scalar("SELECT count(*) FROM events WHERE event_type = 'MessageSubmitted'")
                .fetch_one(&ctx.pool)
                .await
                .expect("submitted count");
        assert_eq!(submitted, 1, "only the seeded row was appended");

        let sess_id = SessionId::from_string(&sess).expect("sess");
        let messages = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("messages");
        assert_eq!(messages.len(), 2, "no refused row was projected");
        let ops: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pending_operations WHERE kind = 'provider-completion'",
        )
        .fetch_one(&ctx.pool)
        .await
        .expect("pending count");
        assert_eq!(ops, 0, "a refused send records no op");
    });
}
