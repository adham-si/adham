mod common;
use common::*;

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
