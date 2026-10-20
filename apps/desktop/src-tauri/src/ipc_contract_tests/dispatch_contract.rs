use super::common::*;
use super::*;
use adham_core_types::*;
use adham_provider::domain::model::{CapabilityStatus, ModelId, ThinkingControl};
use adham_provider::domain::request::ThinkValue;
use serde_json::{Value, json};
use std::sync::Arc;
use tauri::Manager;

/// T4c. Budgets honor evidenced limits: the assembler trims to the input
/// budget (effective context ∩ output reserve) and the reserve is pinned at
/// the provider via num_predict, so generation cannot silently evict the
/// prompt. Every drop is counted in the response.
#[test]
fn context_assembly_trims_to_the_evidenced_budget_and_reserves_output() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        None,
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("ok"), ndjson_done(1, 1)]),
    );
    // Evidenced limits: min(1024, 1024) → budget 1024, reserve 512.
    let account_id = runtime.block_on(async {
        let account = local_account_for(&base_url);
        ctx.registry
            .upsert_account(&account)
            .await
            .expect("seed account");
        let mut descriptor = model_descriptor("m:latest");
        descriptor.context_limit = Some(1024);
        descriptor.configured_context = Some(1024);
        ctx.registry
            .replace_models(
                &account.account_id,
                &[(
                    ModelId("m:latest".to_string()),
                    "sha256:seeded".to_string(),
                    descriptor,
                )],
            )
            .await
            .expect("seed models");
        account.account_id.0.clone()
    });

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    // Three ~609-byte rows ≈ 153 estimated tokens each; with the submitted
    // row (~152) the estimate lands above the 512 input budget.
    for index in 0..3 {
        seed_history_row(
            &runtime,
            &ctx,
            &ws,
            &proj,
            &sess,
            true,
            None,
            &format!("marker-{index} {}", "x".repeat(600)),
        );
    }

    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id,
            model_id: "m:latest".to_string(),
            text: format!("newest {}", "y".repeat(600)),
            mode: None,
            think: None,
            reference: None,
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
    assert!(messages.len() < 4, "trimmed: {}", messages.len());
    let rendered = bodies[0].clone();
    assert!(!rendered.contains("marker-0"), "oldest dropped first");
    assert!(rendered.contains("newest"), "newest survives");
    assert_eq!(
        body["options"]["num_predict"],
        json!(512),
        "output reserve pinned at the provider"
    );

    let assembly = result.data.context.expect("assembly summary");
    assert_eq!(assembly.input_budget_tokens, Some(512));
    assert!(assembly.dropped_messages >= 1, "drops reported");
    assert!(
        assembly.estimated_input_tokens <= 512,
        "estimate fits: {}",
        assembly.estimated_input_tokens
    );
}

/// T4d. Thinking controls are documented-value-gated: `/api/show`
/// `thinking.values` is the only authority for what may be sent, so an
/// undocumented value (or a model with no documented values) is refused
/// before any socket, and a documented value reaches the provider request.
#[test]
fn thinking_control_requires_documented_values_and_reaches_the_provider_request() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        None,
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("ok"), ndjson_done(1, 1)]),
    );
    let account_id = runtime.block_on(async {
        let account = local_account_for(&base_url);
        ctx.registry
            .upsert_account(&account)
            .await
            .expect("seed account");
        let mut thinking = model_descriptor("t:latest");
        thinking.capabilities.thinking = CapabilityStatus::Supported;
        // /api/show documents the values a model accepts; Ollama silently
        // falls back to the default for anything else.
        thinking.capabilities.thinking_control = Some(ThinkingControl {
            values: vec!["true".to_string(), "false".to_string(), "high".to_string()],
            default_value: Some("true".to_string()),
        });
        ctx.registry
            .replace_models(
                &account.account_id,
                &[
                    (
                        ModelId("t:latest".to_string()),
                        "sha256:t".to_string(),
                        thinking,
                    ),
                    (
                        ModelId("m:latest".to_string()),
                        "sha256:m".to_string(),
                        model_descriptor("m:latest"),
                    ),
                ],
            )
            .await
            .expect("seed models");
        account.account_id.0.clone()
    });

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    // No documented values: refused before the socket.
    let refused = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "hello".to_string(),
            mode: None,
            think: Some(ThinkValue::Bool(false)),
            reference: None,
        },
    );
    let sink = CollectSink(collector());
    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, refused, &sink).await
        })
        .expect_err("thinking refused without documented values");
    assert!(err.contains("THINKING_UNSUPPORTED"), "{err}");
    assert!(
        captures.request_bodies().is_empty(),
        "no socket before the refusal"
    );

    // A value outside the documented list is refused too: the server would
    // silently use its default, so the app must not claim it was applied.
    let refused = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "t:latest".to_string(),
            text: "hello".to_string(),
            mode: None,
            think: Some(ThinkValue::Level("max".to_string())),
            reference: None,
        },
    );
    let sink = CollectSink(collector());
    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, refused, &sink).await
        })
        .expect_err("undocumented level refused");
    assert!(err.contains("THINKING_VALUE_UNSUPPORTED"), "{err}");
    assert!(
        captures.request_bodies().is_empty(),
        "no socket before the refusal"
    );

    // Evidenced support: documented values are forwarded exactly as
    // documented — a boolean and a named level.
    for value in [
        ThinkValue::Bool(false),
        ThinkValue::Level("high".to_string()),
    ] {
        let env = typed_envelope(
            (&ws, &proj, &sess),
            CompleteOncePayload {
                attachment_ids: Vec::new(),
                account_id: account_id.clone(),
                model_id: "t:latest".to_string(),
                text: "hello".to_string(),
                mode: None,
                think: Some(value),
                reference: None,
            },
        );
        let sink = CollectSink(collector());
        runtime
            .block_on(async {
                adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
            })
            .expect("completion ok");
    }
    let bodies = captures.request_bodies();
    assert_eq!(bodies.len(), 2, "two chat requests");
    let off: Value = serde_json::from_str(&bodies[0]).expect("chat body json");
    assert_eq!(off["think"], json!(false), "boolean documented value");
    let level: Value = serde_json::from_str(&bodies[1]).expect("chat body json");
    assert_eq!(
        level["think"],
        json!("high"),
        "named level documented value"
    );
}

/// T4b. Modes are declarations with real semantics: the instruction reaches
/// the provider request only (the persisted user text stays exactly what the
/// user wrote) and "execute" is refused before any socket because no policy or
/// tool runtime exists to execute under.
#[test]
fn mode_instruction_is_request_only_and_execute_is_refused() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        None,
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("answer"), ndjson_done(4, 2)]),
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    // code mode: dispatched as a leading system instruction
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "write the handler".to_string(),
            mode: Some("code".to_string()),
            think: None,
            reference: None,
        },
    );
    let sink = CollectSink(collector());
    runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect("completion ok");
    let bodies = captures.request_bodies();
    assert_eq!(bodies.len(), 1, "one chat request");
    let body: Value = serde_json::from_str(&bodies[0]).expect("chat body json");
    let messages = body["messages"].as_array().expect("messages");
    assert_eq!(
        messages[0]["role"],
        json!("system"),
        "mode instruction first"
    );
    assert!(
        messages[0]["content"]
            .as_str()
            .expect("content")
            .contains("Mode: Code"),
        "code instruction dispatched"
    );
    assert_eq!(
        messages.last().expect("last")["content"],
        json!("write the handler"),
        "user text unchanged by the instruction"
    );

    // the instruction is request-only: history holds exactly the user text
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
        let submitted = rows.iter().find(|r| r.role == "user").expect("user row");
        assert_eq!(submitted.content, "write the handler");
        assert!(
            rows.iter().all(|r| !r.content.contains("Mode: Code")),
            "instructions never persist"
        );
    });

    // execute: refused before any socket — capability is not authorization
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "run the tests".to_string(),
            mode: Some("execute".to_string()),
            think: None,
            reference: None,
        },
    );
    let sink = CollectSink(collector());
    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect_err("execute must be refused");
    assert!(err.contains("EXECUTE_UNAVAILABLE"), "{err}");

    // unknown modes never dispatch either
    let env = typed_envelope(
        (&ws, &proj, &sess),
        CompleteOncePayload {
            attachment_ids: Vec::new(),
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "hi".to_string(),
            mode: Some("yolo".to_string()),
            think: None,
            reference: None,
        },
    );
    let sink = CollectSink(collector());
    let err = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
        })
        .expect_err("unknown mode must be refused");
    assert!(err.contains("VALIDATION_FAILED"), "{err}");

    assert_eq!(
        captures.request_bodies().len(),
        1,
        "refusals never reach the provider"
    );
}

/// C1.1 regression, two sequential dispatches in one session: the second
/// request carries the first assistant answer in its bounded history (newest
/// user turn last) and both turns persist with their own resolved op.
#[test]
fn two_dispatches_carry_prior_turn_and_persist_both() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(
        &runtime,
        Some(ctx.pool.clone()),
        captures.clone(),
        ChatProgram::once(vec![ndjson_delta("answer one"), ndjson_done(5, 2)]),
    );
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let ctx = app.state::<ApiContext>().inner().clone();

    let dispatch = |text: &str| -> adham_desktop_api::CompletionStartDto {
        let env = typed_envelope(
            (&ws, &proj, &sess),
            CompleteOncePayload {
                attachment_ids: Vec::new(),
                account_id: account_id.clone(),
                model_id: "m:latest".to_string(),
                text: text.to_string(),
                mode: None,
                think: None,
                reference: None,
            },
        );
        let sink = CollectSink(collector());
        runtime
            .block_on(async {
                adham_desktop_api::handle_complete_once_streaming(&ctx, env, &sink).await
            })
            .expect("dispatch ok")
            .data
    };

    let first = dispatch("question one");
    let second = dispatch("question two");
    assert_ne!(first.op_id, second.op_id, "each turn gets its own op");

    let bodies = captures.request_bodies();
    assert_eq!(bodies.len(), 2, "two dispatches hit the stub: {bodies:?}");
    let body: Value = serde_json::from_str(&bodies[1]).expect("second chat body json");
    let messages = body["messages"].as_array().expect("messages");
    assert_eq!(
        messages.last().expect("last")["content"],
        json!("question two"),
        "newest user turn last: {messages:?}"
    );
    assert!(
        messages
            .iter()
            .any(|m| m["role"] == json!("user") && m["content"] == json!("question one")),
        "turn 1 user survives in turn 2 history: {messages:?}"
    );
    assert!(
        messages
            .iter()
            .any(|m| m["role"] == json!("assistant") && m["content"] == json!("answer one")),
        "turn 1 answer carries into turn 2: {messages:?}"
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
        assert_eq!(rows.len(), 4, "both turns persisted once: {rows:?}");
        assert_eq!(rows[0].content, "question one");
        assert_eq!(rows[1].role, "assistant");
        assert_eq!(rows[1].content, "answer one");
        assert_eq!(
            rows[1].completion,
            Some(MessageCompletionV1::Completed { truncated: false })
        );
        assert_eq!(rows[2].content, "question two");
        assert_eq!(rows[3].role, "assistant");
        assert_eq!(rows[3].content, "answer one");
        assert_eq!(
            rows[3].completion,
            Some(MessageCompletionV1::Completed { truncated: false })
        );

        let resolved: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM pending_operations WHERE kind = 'provider-completion' \
             AND status = 'resolved' AND operation_id IN (?, ?)",
        )
        .bind(&first.op_id)
        .bind(&second.op_id)
        .fetch_one(&ctx.pool)
        .await
        .expect("pending rows");
        assert_eq!(resolved, 2, "both ops resolved");
    });
}
