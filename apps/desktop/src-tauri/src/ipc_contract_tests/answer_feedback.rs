use super::common::*;
use super::*;
use adham_core_types::*;
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::Manager;

/// CONVERSATION-01 lines 66-67: local like/dislike keyed to the exact answer
/// row. The verdict survives the page read-back, switches and removes, and a
/// refused write (wrong row, unknown row, overlong reason) changes nothing.
/// Feedback never opens a provider socket.
#[test]
fn answer_feedback_is_keyed_to_the_answer_row_and_never_touches_the_provider() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let chat = ChatProgram::once(vec![ndjson_delta("unused"), ndjson_done(3, 2)]);
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), chat);
    let _account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let completed = Some(MessageCompletionV1::Completed { truncated: false });
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        true,
        None,
        "rate my question",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        completed,
        "rate my answer",
    );

    let row_id = |text: &str| -> String {
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
            rows.iter()
                .find(|r| r.content == text)
                .unwrap_or_else(|| panic!("no row {text:?}"))
                .message_id
                .clone()
        })
    };
    let question_id = row_id("rate my question");
    let answer_id = row_id("rate my answer");

    let feedback = |payload: Value| {
        invoke(
            &webview,
            "set_answer_feedback",
            json!({ "context": context_for(&ws, &proj, &sess), "payload": payload }),
        )
    };

    // Like with a reason: stored trimmed.
    let stored = feedback(json!({
        "messageId": answer_id,
        "verdict": "like",
        "reason": "  too generic  ",
    }))
    .expect("like ok");
    assert_eq!(
        stored,
        json!([{ "messageId": answer_id, "verdict": "like", "reason": "too generic" }]),
        "stored: {stored}"
    );

    // The page read-back carries the verdict for the timeline.
    let page = invoke(
        &webview,
        "get_conversation",
        json!({ "context": context_for(&ws, &proj, &sess) }),
    )
    .expect("conversation ok");
    assert_eq!(
        page["feedback"],
        json!([{ "messageId": answer_id, "verdict": "like", "reason": "too generic" }]),
        "read-back: {page}"
    );

    // Switching the verdict replaces the row; the reason can be dropped.
    let stored = feedback(json!({ "messageId": answer_id, "verdict": "dislike", "reason": null }))
        .expect("switch ok");
    assert_eq!(
        stored,
        json!([{ "messageId": answer_id, "verdict": "dislike", "reason": null }]),
        "switched: {stored}"
    );

    // Refusals write nothing: a user row is not an answer, an unknown row
    // cannot be rated, and a wild reason is refused at the limit.
    let overlong = "x".repeat(501);
    for payload in [
        json!({ "messageId": question_id, "verdict": "like", "reason": null }),
        json!({ "messageId": MessageId::new_v7().to_string(), "verdict": "like", "reason": null }),
        json!({ "messageId": answer_id, "verdict": "dislike", "reason": overlong }),
    ] {
        let text = resp_text(feedback(payload));
        assert!(
            text.contains("InvalidRequest") && text.contains("validationFailed"),
            "refusal: {text}"
        );
    }
    let page = invoke(
        &webview,
        "get_conversation",
        json!({ "context": context_for(&ws, &proj, &sess) }),
    )
    .expect("conversation ok");
    assert_eq!(
        page["feedback"],
        json!([{ "messageId": answer_id, "verdict": "dislike", "reason": null }]),
        "refusals left the stored verdict alone: {page}"
    );

    // Removal is explicit and leaves nothing behind.
    let stored = feedback(json!({ "messageId": answer_id, "verdict": null, "reason": null }))
        .expect("removal ok");
    assert_eq!(stored, json!([]), "removed: {stored}");

    // Each attempt carries its own verdict: a retry's new answer row starts
    // unrated, and rating it never touches the earlier attempt's row.
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        Some(MessageCompletionV1::Completed { truncated: false }),
        "a second attempt answer",
    );
    let second_id = row_id("a second attempt answer");
    assert_ne!(second_id, answer_id, "a retry appends a new row");

    let stored = feedback(json!({ "messageId": second_id, "verdict": "like", "reason": null }))
        .expect("rate second attempt ok");
    assert_eq!(
        stored,
        json!([{ "messageId": second_id, "verdict": "like", "reason": null }]),
        "the new attempt starts unrated: {stored}"
    );

    let stored = feedback(json!({ "messageId": answer_id, "verdict": "dislike", "reason": null }))
        .expect("rate first attempt ok");
    assert_eq!(
        stored,
        json!([
            { "messageId": answer_id, "verdict": "dislike", "reason": null },
            { "messageId": second_id, "verdict": "like", "reason": null }
        ]),
        "both attempts keep their own verdict: {stored}"
    );

    assert_eq!(
        captures.accepts(),
        0,
        "feedback never opens a provider socket"
    );
}
