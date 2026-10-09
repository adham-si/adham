mod common;
use common::*;

use adham_desktop_api::*;

// P0-AUDIT-03 gap 2 proof: after creating a workspace AND a project,
// bootstrap must report a usable project scope. Synthetic disposable DB.
// Currently ignored: fails against the first-event selection query.
// Enable after the narrow bootstrap-selection proposal is approved;
// do not silently reinterpret the historical event before then.
#[tokio::test]
#[ignore = "pending bootstrap-selection proposal approval (P0-AUDIT-03 review 1, gap 2)"]
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
