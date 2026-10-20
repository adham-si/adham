use super::common::*;
use super::*;
use adham_core_types::*;
use adham_desktop_api::MessageReferenceDto;
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::Manager;

/// C3: an "edited-from" branch is answered against the context its original
/// had: everything before the edited message plus the edited text. The
/// original, its answers, and later turns stay persisted and visible but never
/// reach the model.
#[test]
fn complete_once_answers_an_edited_branch_without_its_original() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let chat = ChatProgram::once(vec![ndjson_delta("branch answer"), ndjson_done(3, 2)]);
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), chat);
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

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
        "preamble question",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        completed,
        "preamble answer",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        true,
        None,
        "original prompt",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        completed,
        "original answer",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        true,
        None,
        "later question",
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
            .find(|r| r.content == "original prompt")
            .expect("target row")
            .message_id
            .clone()
    });

    let sink = CollectSink(collector());
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id,
            model_id: "m:latest".to_string(),
            text: "edited prompt".to_string(),
            mode: None,
            think: None,
            reference: Some(MessageReferenceDto {
                refers_to_message_id: target_id.clone(),
                relation: "edited-from".to_string(),
            }),
        },
    );
    runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("branch completion ok");

    // What the model received: pre-original history + the edited text.
    let bodies = captures.request_bodies();
    assert_eq!(bodies.len(), 1, "one chat request");
    let body: Value = serde_json::from_str(&bodies[0]).expect("chat body json");
    let contents: Vec<&str> = body["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .map(|m| m["content"].as_str().expect("content"))
        .collect();
    assert_eq!(
        contents,
        vec!["preamble question", "preamble answer", "edited prompt"],
        "branch context: {contents:?}"
    );

    // Everything stays persisted: the branch row carries its lineage, and the
    // original and the later turn are untouched.
    runtime.block_on(async {
        let sess_id = SessionId::from_string(&sess).expect("sess");
        let messages = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &sess_id,
        )
        .await
        .expect("messages");
        assert_eq!(messages.len(), 7, "messages: {messages:?}");
        assert_eq!(messages[2].content, "original prompt");
        assert_eq!(messages[2].refers_to_message_id, None);
        assert_eq!(messages[4].content, "later question");
        let branch = messages
            .iter()
            .find(|m| m.content == "edited prompt")
            .expect("branch row");
        assert_eq!(
            branch.refers_to_message_id.as_deref(),
            Some(target_id.as_str())
        );
        assert_eq!(branch.refers_to_relation.as_deref(), Some("edited-from"));
    });
}

/// CONVERSATION-01 line 65: the active-alternative choice is local state. It
/// survives the page read-back, steers what the next fresh send is answered
/// against (the superseded branch is not fed back), and a refused selection
/// writes nothing — the previous selection stands.
#[test]
fn active_alternative_selection_steers_the_next_send_and_survives_read_back() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let chat = ChatProgram::once(vec![ndjson_delta("branch answer"), ndjson_done(3, 2)]);
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), chat);
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

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
        "original prompt",
    );
    seed_history_row(
        &runtime,
        &ctx,
        &ws,
        &proj,
        &sess,
        false,
        completed,
        "original answer",
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

    let original_id = row_id("original prompt");
    let answer_id = row_id("original answer");

    // An edit appends an alternative branch; the original stays persisted.
    let sink = CollectSink(collector());
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "edited prompt".to_string(),
            mode: None,
            think: None,
            reference: Some(MessageReferenceDto {
                refers_to_message_id: original_id.clone(),
                relation: "edited-from".to_string(),
            }),
        },
    );
    runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("branch completion ok");
    let edited_id = row_id("edited prompt");

    // Choose the original branch through the real command path.
    let selections = invoke(
        &webview,
        "set_active_alternative",
        json!({
            "context": context_for(&ws, &proj, &sess),
            "payload": { "rootMessageId": original_id, "activeMessageId": original_id },
        }),
    )
    .expect("selection ok");
    assert_eq!(
        selections,
        json!([{ "rootMessageId": original_id, "activeMessageId": original_id }]),
        "selections: {selections}"
    );

    // The next fresh send is answered against the selected branch: the
    // superseded edit and its answer are not fed back; the original and its
    // answer are.
    let sink = CollectSink(collector());
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "follow-up".to_string(),
            mode: None,
            think: None,
            reference: None,
        },
    );
    runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("follow-up completion ok");

    let bodies = captures.request_bodies();
    assert_eq!(bodies.len(), 2, "two chat requests");
    let body: Value = serde_json::from_str(&bodies[1]).expect("follow-up body json");
    let contents: Vec<&str> = body["messages"]
        .as_array()
        .expect("messages")
        .iter()
        .map(|m| m["content"].as_str().expect("content"))
        .collect();
    assert_eq!(
        contents,
        vec!["original prompt", "original answer", "follow-up"],
        "selected branch context: {contents:?}"
    );

    // Refusals are visible and write nothing: wrong root, wrong active member,
    // unknown active member, and a root without alternatives.
    for payload in [
        json!({ "rootMessageId": answer_id, "activeMessageId": original_id }),
        json!({ "rootMessageId": original_id, "activeMessageId": answer_id }),
        json!({ "rootMessageId": original_id, "activeMessageId": MessageId::new_v7().to_string() }),
        json!({ "rootMessageId": edited_id, "activeMessageId": edited_id }),
    ] {
        let text = resp_text(invoke(
            &webview,
            "set_active_alternative",
            json!({ "context": context_for(&ws, &proj, &sess), "payload": payload }),
        ));
        assert!(
            text.contains("InvalidRequest") && text.contains("validationFailed"),
            "refusal: {text}"
        );
    }

    // The page read-back carries the selection for the timeline to label, and
    // the refusals did not overwrite it.
    let page = invoke(
        &webview,
        "get_conversation",
        json!({ "context": context_for(&ws, &proj, &sess) }),
    )
    .expect("conversation ok");
    assert_eq!(
        page["branchSelections"],
        json!([{ "rootMessageId": original_id, "activeMessageId": original_id }]),
        "read-back: {page}"
    );
}
