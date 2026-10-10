mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

fn select_envelope(
    request_id: &str,
    ws_id: &str,
    proj_id: &str,
) -> CommandEnvelope<SelectProjectPayload> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: request_id.to_string(),
        context: CommandContext {
            workspace_id: Some(ws_id.to_string()),
            project_id: None,
            session_id: None,
        },
        payload: SelectProjectPayload {
            project_id: proj_id.to_string(),
        },
    }
}

async fn bootstrap_scope(ctx: &ApiContext) -> (bool, Option<String>, Option<String>) {
    let s = handle_get_bootstrap_state(ctx).await.expect("bootstrap");
    (s.is_initialized, s.active_workspace_id, s.active_project_id)
}

fn same_scope(a: &BootstrapState, b: &BootstrapState) -> bool {
    a.is_initialized == b.is_initialized
        && a.active_workspace_id == b.active_workspace_id
        && a.active_project_id == b.active_project_id
}

async fn event_count(ctx: &ApiContext) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM events")
        .fetch_one(&ctx.pool)
        .await
        .unwrap()
}

async fn receipt_count(ctx: &ApiContext, request_id: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM command_receipts WHERE request_id = ?")
        .bind(request_id)
        .fetch_one(&ctx.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn lists_start_empty_and_show_created_scopes_in_order() {
    let ctx = setup_ctx(&test_db_path()).await;
    assert!(handle_list_workspaces(&ctx).await.expect("list").is_empty());

    let ws_a = create_test_workspace(&ctx, "WS-A").await;
    let ws_b = create_test_workspace(&ctx, "WS-B").await;
    let proj_a = create_test_project(&ctx, &ws_a, "Proj-A").await;
    // Creation selects the newest scope; lists are independent of selection.
    let workspaces = handle_list_workspaces(&ctx).await.expect("list ws");
    assert_eq!(
        workspaces
            .iter()
            .map(|w| w.workspace_id.clone())
            .collect::<Vec<_>>(),
        vec![ws_a.clone(), ws_b.clone()]
    );
    assert_eq!(workspaces[0].name, "WS-A");
    let projects = handle_list_projects(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_a.clone()),
            project_id: None,
            session_id: None,
        },
    )
    .await
    .expect("list proj");
    assert_eq!(projects.len(), 1);
    assert_eq!(projects[0].project_id, proj_a);
    assert_eq!(projects[0].workspace_id, ws_a);
    let other = handle_list_projects(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_b.clone()),
            project_id: None,
            session_id: None,
        },
    )
    .await
    .expect("list proj b");
    assert!(other.is_empty());
}

#[tokio::test]
async fn list_projects_rejects_unknown_or_malformed_workspace() {
    let ctx = setup_ctx(&test_db_path()).await;
    let err = handle_list_projects(
        &ctx,
        CommandContext {
            workspace_id: Some(RequestId::new_v7().to_string()),
            project_id: None,
            session_id: None,
        },
    )
    .await
    .expect_err("unknown workspace must be rejected");
    assert!(err.contains("WORKSPACE_NOT_FOUND"), "{err}");

    let err = handle_list_projects(
        &ctx,
        CommandContext {
            workspace_id: Some("not-a-uuid".to_string()),
            project_id: None,
            session_id: None,
        },
    )
    .await
    .expect_err("malformed workspace must be rejected");
    assert!(err.contains("VALIDATION_FAILED"), "{err}");

    let err = handle_list_projects(&ctx, CommandContext::default())
        .await
        .expect_err("missing workspace must be rejected");
    assert!(err.contains("workspaceId context required"), "{err}");
}

#[tokio::test]
async fn valid_selection_persists_and_writes_no_events() {
    let ctx = setup_ctx(&test_db_path()).await;
    let ws_a = create_test_workspace(&ctx, "WS-A").await;
    let proj_a = create_test_project(&ctx, &ws_a, "Proj-A").await;
    let ws_b = create_test_workspace(&ctx, "WS-B").await;
    let proj_b = create_test_project(&ctx, &ws_b, "Proj-B").await;
    assert_eq!(
        bootstrap_scope(&ctx).await.2.as_deref(),
        Some(proj_b.as_str())
    );

    // Back to A by explicit selection (creation is never reused to select).
    let before = event_count(&ctx).await;
    let req = RequestId::new_v7().to_string();
    let out = handle_select_project(&ctx, select_envelope(&req, &ws_a, &proj_a))
        .await
        .expect("select");
    assert!(out.data.is_initialized);
    assert_eq!(out.data.active_workspace_id.as_deref(), Some(ws_a.as_str()));
    assert_eq!(out.data.active_project_id.as_deref(), Some(proj_a.as_str()));
    assert_eq!(out.request_id, req);
    assert_eq!(
        event_count(&ctx).await,
        before,
        "selection appends no events"
    );
    assert_eq!(receipt_count(&ctx, &req).await, 1);
    let scope = bootstrap_scope(&ctx).await;
    assert_eq!(scope, (true, Some(ws_a), Some(proj_a)));
}

#[tokio::test]
async fn invalid_selection_rejects_without_changing_prior_scope() {
    let ctx = setup_ctx(&test_db_path()).await;
    let ws_a = create_test_workspace(&ctx, "WS-A").await;
    let proj_a = create_test_project(&ctx, &ws_a, "Proj-A").await;
    let ws_b = create_test_workspace(&ctx, "WS-B").await;
    let prior = bootstrap_scope(&ctx).await;

    // Unknown project.
    let bad_req = RequestId::new_v7().to_string();
    let err = handle_select_project(
        &ctx,
        select_envelope(&bad_req, &ws_a, &RequestId::new_v7().to_string()),
    )
    .await
    .expect_err("unknown project must be rejected");
    assert!(err.contains("PROJECT_NOT_FOUND"), "{err}");
    // Cross-workspace pair.
    let cross_req = RequestId::new_v7().to_string();
    let err = handle_select_project(&ctx, select_envelope(&cross_req, &ws_b, &proj_a))
        .await
        .expect_err("cross-workspace pair must be rejected");
    assert!(err.contains("CONTEXT_MISMATCH"), "{err}");
    // Unknown workspace.
    let ws_req = RequestId::new_v7().to_string();
    let err = handle_select_project(
        &ctx,
        select_envelope(&ws_req, &RequestId::new_v7().to_string(), &proj_a),
    )
    .await
    .expect_err("unknown workspace must be rejected");
    assert!(err.contains("WORKSPACE_NOT_FOUND"), "{err}");

    assert_eq!(bootstrap_scope(&ctx).await, prior, "prior scope intact");
    for req in [&bad_req, &cross_req, &ws_req] {
        assert_eq!(receipt_count(&ctx, req).await, 0, "no partial receipt");
    }
}

#[tokio::test]
async fn malformed_selection_is_definite_without_writes() {
    let ctx = setup_ctx(&test_db_path()).await;
    let before = event_count(&ctx).await;
    let mut env = select_envelope(
        &RequestId::new_v7().to_string(),
        &RequestId::new_v7().to_string(),
        &RequestId::new_v7().to_string(),
    );
    env.protocol_version = 2;
    let err = handle_select_project(&ctx, env).await.expect_err("version");
    assert!(err.contains("INVALID_COMMAND_VERSION"), "{err}");

    let err = handle_select_project(
        &ctx,
        select_envelope(
            "not-a-uuid",
            &RequestId::new_v7().to_string(),
            &RequestId::new_v7().to_string(),
        ),
    )
    .await
    .expect_err("request id");
    assert!(err.contains("VALIDATION_FAILED"), "{err}");
    assert_eq!(event_count(&ctx).await, before);
}

#[tokio::test]
async fn same_identity_replays_without_reselecting() {
    let ctx = setup_ctx(&test_db_path()).await;
    let ws_a = create_test_workspace(&ctx, "WS-A").await;
    let proj_a = create_test_project(&ctx, &ws_a, "Proj-A").await;

    let req = RequestId::new_v7().to_string();
    let first = handle_select_project(&ctx, select_envelope(&req, &ws_a, &proj_a))
        .await
        .expect("select");
    let replay = handle_select_project(&ctx, select_envelope(&req, &ws_a, &proj_a))
        .await
        .expect("replay");
    assert!(same_scope(&first.data, &replay.data));
    assert_eq!(first.correlation_id, replay.correlation_id);
    assert_eq!(receipt_count(&ctx, &req).await, 1);

    // Same identity, different target conflicts instead of switching.
    let ws_b = create_test_workspace(&ctx, "WS-B").await;
    let proj_b = create_test_project(&ctx, &ws_b, "Proj-B").await;
    let err = handle_select_project(&ctx, select_envelope(&req, &ws_b, &proj_b))
        .await
        .expect_err("conflict");
    assert!(err.contains("REQUEST_ID_CONFLICT"), "{err}");
    let scope = bootstrap_scope(&ctx).await;
    assert_eq!(scope.2.as_deref(), Some(proj_b.as_str()));
}

#[tokio::test]
async fn late_original_replays_without_overwriting_newer_selection() {
    let ctx = setup_ctx(&test_db_path()).await;
    let ws_a = create_test_workspace(&ctx, "WS-A").await;
    let proj_a = create_test_project(&ctx, &ws_a, "Proj-A").await;
    let ws_b = create_test_workspace(&ctx, "WS-B").await;
    let proj_b = create_test_project(&ctx, &ws_b, "Proj-B").await;

    // Original A commits, then B wins. The delayed original A arriving now
    // replays its recorded scope but must not reselect: scope stays B.
    let req_a = RequestId::new_v7().to_string();
    let recorded = handle_select_project(&ctx, select_envelope(&req_a, &ws_a, &proj_a))
        .await
        .expect("select A");
    let req_b = RequestId::new_v7().to_string();
    handle_select_project(&ctx, select_envelope(&req_b, &ws_b, &proj_b))
        .await
        .expect("select B");
    assert_eq!(
        bootstrap_scope(&ctx).await.2.as_deref(),
        Some(proj_b.as_str())
    );

    let late = handle_select_project(&ctx, select_envelope(&req_a, &ws_a, &proj_a))
        .await
        .expect("late original replays");
    assert!(
        same_scope(&late.data, &recorded.data),
        "replay returns the recorded scope"
    );
    assert_eq!(
        bootstrap_scope(&ctx).await,
        (true, Some(ws_b), Some(proj_b)),
        "newer selection stands"
    );
    assert_eq!(receipt_count(&ctx, &req_a).await, 1);
}

#[tokio::test]
async fn restart_restores_confirmed_selection() {
    let db_path = test_db_path();
    let provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
        std::sync::Arc::new(adham_event_log::InMemoryProvider::generate());
    let ctx = setup_ctx_with_key(&db_path, provider.clone()).await;
    let ws_a = create_test_workspace(&ctx, "WS-A").await;
    let proj_a = create_test_project(&ctx, &ws_a, "Proj-A").await;
    let ws_b = create_test_workspace(&ctx, "WS-B").await;
    let _proj_b = create_test_project(&ctx, &ws_b, "Proj-B").await;
    handle_select_project(
        &ctx,
        select_envelope(&RequestId::new_v7().to_string(), &ws_a, &proj_a),
    )
    .await
    .expect("select");
    drop(ctx);

    let reopened = setup_ctx_with_key(&db_path, provider).await;
    assert_eq!(
        bootstrap_scope(&reopened).await,
        (true, Some(ws_a), Some(proj_a))
    );
}
