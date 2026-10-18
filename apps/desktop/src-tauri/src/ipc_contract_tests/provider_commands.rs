use super::common::*;
use super::*;

/// T1. All five provider commands resolve through the real dispatch, parse
/// their envelope shapes, and fail closed on unknown scope/accounts.
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

    let app = provider_mock_app(ctx.clone());
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

    // disconnect requires the Ollama kind guard on non-local accounts first
    let refused = invoke(
        &webview,
        "disconnect_ollama_account",
        args_for(scope_ctx.clone(), json!({"accountId": "acc-google-style"})),
    )
    .unwrap_err()
    .to_string();
    assert!(
        refused.contains("error.validationFailed"),
        "unknown account refused: {refused}"
    );

    // disconnect cascades the account row and its pinned models
    let response = invoke(
        &webview,
        "disconnect_ollama_account",
        args_for(scope_ctx.clone(), json!({"accountId": account_id})),
    )
    .expect("disconnect");
    assert_eq!(
        response["data"]["accountId"],
        json!(account_id),
        "{response}"
    );
    runtime.block_on(async {
        let account_rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM provider_accounts WHERE account_id = ?")
                .bind(&account_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("accounts after disconnect");
        assert_eq!(account_rows, 0, "the account row is gone");
        let model_rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM provider_models WHERE account_id = ?")
                .bind(&account_id)
                .fetch_one(&ctx.pool)
                .await
                .expect("models after disconnect");
        assert_eq!(model_rows, 0, "pinned models cascade with the account");
    });
}

/// T3. Happy-path streaming: the pending op is durable when the stub sees the
/// socket, the sink receives Started → deltas → Completed with per-op ordered

/// A6 support: saved Ollama accounts are listing-reachable (reload survives),
/// and probing an unsaved URL persists nothing ("failed test saves nothing").
#[test]
fn provider_accounts_are_listable_and_unsaved_probe_persists_nothing() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let dead_base = "http://127.0.0.1:9";
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), ChatProgram::once(vec![]));
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let _ctx = app.state::<ApiContext>().inner().clone();

    // listing includes the seeded local account
    let response = invoke(&webview, "list_provider_accounts", json!({})).expect("list");
    let accounts = response["data"]["accounts"].as_array().expect("accounts");
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0]["accountId"], json!(account_id));
    assert_eq!(accounts[0]["privacyClass"], json!("local_only"));
    assert_eq!(accounts[0]["kind"], json!("ollama_local"));

    // URL probe of an unsaved endpoint: hits the wire, persists nothing
    let response = invoke(
        &webview,
        "test_provider_connection",
        args_for(
            context_for(&ws, &proj, &sess),
            json!({"accountId": "", "endpointUrl": base_url}),
        ),
    )
    .expect("transient probe");
    assert_eq!(response["data"]["reachable"], json!(true));
    assert_eq!(
        captures.accepts(),
        1,
        "probe went to the wire with no account row"
    );

    // the dead endpoint probe reports unreachable, still no row written
    let response = invoke(
        &webview,
        "test_provider_connection",
        args_for(
            context_for(&ws, &proj, &sess),
            json!({"accountId": "", "endpointUrl": dead_base}),
        ),
    )
    .expect("dead probe");
    assert_eq!(response["data"]["reachable"], json!(false));

    let response = invoke(&webview, "list_provider_accounts", json!({})).expect("list again");
    let accounts = response["data"]["accounts"].as_array().expect("accounts");
    assert_eq!(accounts.len(), 1, "probes never persisted an account row");
}

/// A6 support: persisted registry models are listing-reachable without any
/// network round-trip.
#[test]
fn provider_models_are_listable_from_the_pinned_registry() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), ChatProgram::once(vec![]));
    let account_id = seed_local_account_with_model(&runtime, &ctx, &base_url);

    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);

    let response = invoke(
        &webview,
        "list_provider_models",
        args_for(json!({}), json!({"accountId": account_id})),
    )
    .expect("list models");
    let models = response["data"]["models"].as_array().expect("models");
    assert_eq!(models.len(), 1, "seeded m:latest via pinned registry");
    assert_eq!(models[0]["modelId"], json!("m:latest"));
    assert_eq!(
        models[0]["digest"],
        json!("sha256:seeded"),
        "digest pin kept"
    );
    assert_eq!(
        captures.accepts(),
        0,
        "registry read never touches the wire"
    );

    // unknown account blocked without a network round-trip
    let text = resp_text(invoke(
        &webview,
        "list_provider_models",
        args_for(json!({}), json!({"accountId": "ghost"})),
    ));
    assert!(text.contains("InvalidRequest"), "{text}");
    assert_eq!(captures.accepts(), 0);
}

/// Provider management is app-level: the settings surface runs with no
/// conversation session. Test/discover/create work with an empty context;
/// streaming keeps its full-scope requirement.
#[test]
fn provider_management_runs_app_level_without_a_session() {
    let (runtime, ctx) = disposable_context();
    let captures = Arc::new(StubCaptures::new());
    let base_url = spawn_stub_ollama(&runtime, None, captures.clone(), ChatProgram::once(vec![]));
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let empty = json!({});

    let response = invoke(
        &webview,
        "test_provider_connection",
        args_for(
            empty.clone(),
            json!({"accountId": "", "endpointUrl": base_url}),
        ),
    )
    .expect("app-level probe");
    assert_eq!(response["data"]["reachable"], json!(true));

    let response = invoke(
        &webview,
        "update_provider_account",
        args_for(
            empty.clone(),
            json!({"accountId": null, "alias": "Settings Ollama", "endpointUrl": base_url}),
        ),
    )
    .expect("app-level mint");
    let account_id = response["data"]["accountId"]
        .as_str()
        .expect("minted")
        .to_string();

    let response = invoke(
        &webview,
        "discover_ollama_models",
        args_for(empty, json!({"accountId": account_id})),
    )
    .expect("app-level discover");
    assert!(
        response["data"]["models"].is_array(),
        "discovery is app-level too"
    );

    // boundary: streaming keeps the full-scope requirement (pinned at the
    // handler level — the mock dispatch cannot carry a Channel; see A5 note)
    let ctx_direct = app.state::<ApiContext>().inner().clone();
    let sink = CollectSink(collector());
    let accepts_before = captures.accepts();
    let envelope = CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: None,
            project_id: None,
            session_id: None,
        },
        payload: CompleteOncePayload {
            account_id: account_id.clone(),
            model_id: "m:latest".to_string(),
            text: "hi".to_string(),
        },
    };
    let message = runtime
        .block_on(async {
            adham_desktop_api::handle_complete_once_streaming(&ctx_direct, envelope, &sink).await
        })
        .unwrap_err();
    assert!(
        message.contains("VALIDATION_FAILED"),
        "streaming still requires the full session scope: {message}"
    );
    assert_eq!(captures.accepts(), accepts_before, "no socket was opened");

    // boundary: stop keeps the full-scope requirement too — an app-level
    // (session-less) caller cannot cancel another session's run.
    let stop_envelope = CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: None,
            project_id: None,
            session_id: None,
        },
        payload: StopCompletionPayload {
            op_id: OperationId::new_v7().to_string(),
        },
    };
    let message = runtime
        .block_on(async {
            adham_desktop_api::handle_stop_completion(&ctx_direct, stop_envelope).await
        })
        .unwrap_err();
    assert!(
        message.contains("VALIDATION_FAILED"),
        "stop still requires the full session scope: {message}"
    );
}
