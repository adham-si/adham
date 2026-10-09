mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

// P0-AUDIT-03 gap 2: after creating a workspace AND a project, bootstrap
// must report a usable project scope. Active selection is explicit —
// creation updates the installation record and bootstrap reads it, never
// a historical first event. Synthetic disposable DB.
#[tokio::test]
async fn test_bootstrap_reports_created_project_scope() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    // A session event also carries workspace scope; selection must still
    // resolve the project rather than the earliest workspace-only event.
    let _ = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state");
    assert!(state.is_initialized);
    assert_eq!(state.active_workspace_id.as_deref(), Some(ws_id.as_str()));
    assert_eq!(
        state.active_project_id.as_deref(),
        Some(proj_id.as_str()),
        "bootstrap must report the created project, not the project-less workspace event"
    );
}

#[tokio::test]
async fn test_fresh_database_reports_unavailable_scope() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state");
    assert!(!state.is_initialized);
    assert_eq!(state.active_workspace_id, None);
    assert_eq!(state.active_project_id, None);
}

#[tokio::test]
async fn test_latest_project_creation_wins_active_selection() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let first_proj = create_test_project(&ctx, &ws_id, "Proj-One").await;
    assert_ne!(first_proj, String::new());

    // A new workspace resets the project selection: the old project does
    // not belong to it, so reporting it would scope sessions wrongly.
    let ws_two = create_test_workspace(&ctx, "WS-Two").await;
    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state");
    assert_eq!(state.active_workspace_id.as_deref(), Some(ws_two.as_str()));
    assert_eq!(state.active_project_id, None);

    let second_proj = create_test_project(&ctx, &ws_two, "Proj-Two").await;
    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state");
    assert_eq!(state.active_workspace_id.as_deref(), Some(ws_two.as_str()));
    assert_eq!(
        state.active_project_id.as_deref(),
        Some(second_proj.as_str())
    );
}

// P0-AUDIT-03 review: the selection update lives in the same owned unit
// of work as creation. If it fails, everything rolls back — no durable
// event/receipt paired with a caller-visible failure.
#[tokio::test]
async fn test_selection_update_failure_rolls_back_entire_creation() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let request_id = RequestId::new_v7();

    // Make the selection UPDATE match zero rows: the installation row is
    // the only row it may touch.
    sqlx::query("DELETE FROM installation WHERE id = 1")
        .execute(&ctx.pool)
        .await
        .expect("delete installation row");

    let res = handle_create_workspace(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: request_id.to_string(),
            context: CommandContext::default(),
            payload: CreateWorkspacePayload {
                name: "Doomed".to_string(),
                kind: "personal".to_string(),
                preferred_language: "en".to_string(),
            },
        },
    )
    .await;
    let err = res.expect_err("zero-row selection update must fail the creation");
    assert!(!err.is_empty());
    // No partial creation: no receipt, no workspace stream, no event.
    let receipt = ctx
        .store
        .check_receipt(&request_id)
        .await
        .expect("receipt check");
    assert!(receipt.is_none(), "no receipt may survive the rollback");
    let stream_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM streams")
        .fetch_one(&ctx.pool)
        .await
        .expect("stream count");
    assert_eq!(stream_count, 0, "no stream row may survive the rollback");
    let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
        .fetch_one(&ctx.pool)
        .await
        .expect("event count");
    assert_eq!(event_count, 0, "no event may survive the rollback");
}

// P0-AUDIT-03 review: replaying an old create_workspace receipt after a
// project was created must not clear the project selection. Replay is
// not a selection command.
#[tokio::test]
async fn test_workspace_replay_retains_project_selection() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_request_id = RequestId::new_v7();
    let ws_envelope = CommandEnvelope {
        protocol_version: 1,
        request_id: ws_request_id.to_string(),
        context: CommandContext::default(),
        payload: CreateWorkspacePayload {
            name: "WS".to_string(),
            kind: "personal".to_string(),
            preferred_language: "en".to_string(),
        },
    };
    let created = handle_create_workspace(&ctx, ws_envelope.clone())
        .await
        .expect("create workspace");
    let ws_id = created.data.workspace_id.clone();
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;

    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state");
    assert_eq!(
        state.active_project_id.as_deref(),
        Some(proj_id.as_str()),
        "precondition: project is selected"
    );

    // Replay the original create_workspace command with its exact
    // identity and payload.
    let replayed = handle_create_workspace(&ctx, ws_envelope)
        .await
        .expect("replayed workspace creation");
    assert_eq!(replayed.data.workspace_id, ws_id);

    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state after replay");
    assert_eq!(state.active_workspace_id.as_deref(), Some(ws_id.as_str()));
    assert_eq!(
        state.active_project_id.as_deref(),
        Some(proj_id.as_str()),
        "workspace replay must not clear the newer project selection"
    );
}

// P0-AUDIT-03 review: replaying an old create_project receipt (P1) after
// selecting a newer project (P2) must not overwrite P2.
#[tokio::test]
async fn test_project_replay_retains_newer_project_selection() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let p1_request_id = RequestId::new_v7();
    let p1_envelope = CommandEnvelope {
        protocol_version: 1,
        request_id: p1_request_id.to_string(),
        context: CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: None,
            session_id: None,
        },
        payload: CreateProjectPayload {
            name: "Proj-One".to_string(),
            storage_kind: "isolated".to_string(),
        },
    };
    let p1 = handle_create_project(&ctx, p1_envelope.clone())
        .await
        .expect("create project one");
    let p1_id = p1.data.project_id.clone();
    let p2_id = create_test_project(&ctx, &ws_id, "Proj-Two").await;

    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state");
    assert_eq!(
        state.active_project_id.as_deref(),
        Some(p2_id.as_str()),
        "precondition: newer project is selected"
    );

    // Replay the P1 creation with its original identity and payload.
    let replayed = handle_create_project(&ctx, p1_envelope)
        .await
        .expect("replayed project creation");
    assert_eq!(replayed.data.project_id, p1_id);

    let state = handle_get_bootstrap_state(&ctx)
        .await
        .expect("bootstrap state after replay");
    assert_eq!(
        state.active_project_id.as_deref(),
        Some(p2_id.as_str()),
        "project replay must not overwrite the newer selection"
    );
}
