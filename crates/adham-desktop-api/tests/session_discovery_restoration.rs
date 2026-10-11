mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

#[tokio::test]
async fn test_list_sessions_returns_chronological_order_and_project_scoped() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let ws_id = create_test_workspace(&ctx, "WS 1").await;
    let proj_a = create_test_project(&ctx, &ws_id, "Project A").await;
    let proj_b = create_test_project(&ctx, &ws_id, "Project B").await;

    // Initially project A has no sessions
    let list_empty = handle_list_sessions(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_a.clone()),
            session_id: None,
        },
    )
    .await
    .expect("list sessions empty");
    assert_eq!(list_empty.project_id, proj_a);
    assert!(list_empty.sessions.is_empty());

    // Create session 1 in Project A
    let sess_a1 = create_test_session(&ctx, &ws_id, &proj_a, Some("Session A1")).await;
    // Create session in Project B
    let sess_b1 = create_test_session(&ctx, &ws_id, &proj_b, Some("Session B1")).await;
    // Create session 2 in Project A
    let sess_a2 = create_test_session(&ctx, &ws_id, &proj_a, Some("Session A2")).await;

    // List sessions for Project A: should contain sess_a2 (first / newest) then sess_a1, not sess_b1
    let list_a = handle_list_sessions(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_a.clone()),
            session_id: None,
        },
    )
    .await
    .expect("list sessions A");
    assert_eq!(list_a.project_id, proj_a);
    assert_eq!(list_a.sessions.len(), 2);
    assert_eq!(list_a.sessions[0].session_id, sess_a2);
    assert_eq!(list_a.sessions[0].title.as_deref(), Some("Session A2"));
    assert_eq!(list_a.sessions[1].session_id, sess_a1);
    assert_eq!(list_a.sessions[1].title.as_deref(), Some("Session A1"));

    // List sessions for Project B: should only contain sess_b1
    let list_b = handle_list_sessions(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_b.clone()),
            session_id: None,
        },
    )
    .await
    .expect("list sessions B");
    assert_eq!(list_b.project_id, proj_b);
    assert_eq!(list_b.sessions.len(), 1);
    assert_eq!(list_b.sessions[0].session_id, sess_b1);
    assert_eq!(list_b.sessions[0].title.as_deref(), Some("Session B1"));
}

#[tokio::test]
async fn test_conversation_ownership_and_existence_validation() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let ws_1 = create_test_workspace(&ctx, "Workspace 1").await;
    let ws_2 = create_test_workspace(&ctx, "Workspace 2").await;
    let proj_1 = create_test_project(&ctx, &ws_1, "Project 1").await;
    let proj_2 = create_test_project(&ctx, &ws_2, "Project 2").await;

    let sess_1 = create_test_session(&ctx, &ws_1, &proj_1, Some("Session 1")).await;

    // 1. Valid context succeeds
    let valid = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_1.clone()),
            project_id: Some(proj_1.clone()),
            session_id: Some(sess_1.clone()),
        },
    )
    .await;
    assert!(valid.is_ok(), "Valid context should load conversation");

    // 2. Non-existent session returns SESSION_NOT_FOUND error
    let fake_session = SessionId::new_v7().to_string();
    let not_found = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_1.clone()),
            project_id: Some(proj_1.clone()),
            session_id: Some(fake_session),
        },
    )
    .await;
    assert!(not_found.is_err());
    let err_str = not_found.unwrap_err();
    assert!(
        err_str.contains("SESSION_NOT_FOUND"),
        "Expected SESSION_NOT_FOUND error, got: {}",
        err_str
    );

    // 3. Mismatched project returns CONTEXT_MISMATCH error
    let wrong_project = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_1.clone()),
            project_id: Some(proj_2.clone()), // wrong project
            session_id: Some(sess_1.clone()),
        },
    )
    .await;
    assert!(wrong_project.is_err());
    let err_str = wrong_project.unwrap_err();
    assert!(
        err_str.contains("CONTEXT_MISMATCH"),
        "Expected CONTEXT_MISMATCH error, got: {}",
        err_str
    );

    // 4. Mismatched workspace returns CONTEXT_MISMATCH error
    let wrong_workspace = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_2.clone()), // wrong workspace
            project_id: Some(proj_1.clone()),
            session_id: Some(sess_1.clone()),
        },
    )
    .await;
    assert!(wrong_workspace.is_err());
    let err_str = wrong_workspace.unwrap_err();
    assert!(
        err_str.contains("CONTEXT_MISMATCH"),
        "Expected CONTEXT_MISMATCH error, got: {}",
        err_str
    );
}

#[tokio::test]
async fn test_list_sessions_rejects_mismatched_workspace() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let ws_1 = create_test_workspace(&ctx, "Workspace 1").await;
    let ws_2 = create_test_workspace(&ctx, "Workspace 2").await;
    let proj_1 = create_test_project(&ctx, &ws_1, "Project 1").await;

    // List sessions with mismatched workspace
    let mismatch = handle_list_sessions(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_2.clone()), // wrong workspace
            project_id: Some(proj_1.clone()),
            session_id: None,
        },
    )
    .await;

    assert!(mismatch.is_err(), "Mismatched workspace must be rejected");
    let err = mismatch.unwrap_err();
    assert!(
        err.contains("CONTEXT_MISMATCH"),
        "Expected CONTEXT_MISMATCH error, got: {}",
        err
    );

    // List sessions for non-existent project returns PROJECT_NOT_FOUND
    let not_found = handle_list_sessions(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_1.clone()),
            project_id: Some(ProjectId::new_v7().to_string()),
            session_id: None,
        },
    )
    .await;

    assert!(not_found.is_err());
    let err = not_found.unwrap_err();
    assert!(
        err.contains("PROJECT_NOT_FOUND"),
        "Expected PROJECT_NOT_FOUND error, got: {}",
        err
    );
}
