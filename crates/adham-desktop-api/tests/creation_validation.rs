mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

fn ws_envelope(
    request_id: &str,
    name: &str,
    kind: &str,
) -> CommandEnvelope<CreateWorkspacePayload> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: request_id.to_string(),
        context: CommandContext::default(),
        payload: CreateWorkspacePayload {
            name: name.to_string(),
            kind: kind.to_string(),
            preferred_language: "en".to_string(),
        },
    }
}

fn proj_envelope(
    request_id: &str,
    ws_id: &str,
    name: &str,
    storage_kind: &str,
) -> CommandEnvelope<CreateProjectPayload> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: request_id.to_string(),
        context: CommandContext {
            workspace_id: Some(ws_id.to_string()),
            project_id: None,
            session_id: None,
        },
        payload: CreateProjectPayload {
            name: name.to_string(),
            storage_kind: storage_kind.to_string(),
        },
    }
}

async fn event_count(ctx: &ApiContext) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM events")
        .fetch_one(&ctx.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn unsupported_kinds_rejected_without_writes() {
    let ctx = setup_ctx(&test_db_path()).await;
    let before = event_count(&ctx).await;

    let err = handle_create_workspace(
        &ctx,
        ws_envelope(&RequestId::new_v7().to_string(), "WS", "team"),
    )
    .await
    .expect_err("non-personal kind must be rejected");
    assert!(
        err.contains("VALIDATION_FAILED") && err.contains("workspace kind"),
        "{err}"
    );

    let ws = handle_create_workspace(
        &ctx,
        ws_envelope(&RequestId::new_v7().to_string(), "WS", "personal"),
    )
    .await
    .expect("personal workspace");
    let err = handle_create_project(
        &ctx,
        proj_envelope(
            &RequestId::new_v7().to_string(),
            &ws.data.workspace_id,
            "Proj",
            "cloud",
        ),
    )
    .await
    .expect_err("non-isolated storage kind must be rejected");
    assert!(
        err.contains("VALIDATION_FAILED") && err.contains("storage kind"),
        "{err}"
    );

    assert_eq!(
        event_count(&ctx).await,
        before + 1,
        "only the valid workspace wrote"
    );
}

#[tokio::test]
async fn empty_and_overlong_names_rejected_without_writes() {
    let ctx = setup_ctx(&test_db_path()).await;
    let before = event_count(&ctx).await;
    let long = "n".repeat(121);

    for name in ["", "   ", long.as_str()] {
        let err = handle_create_workspace(
            &ctx,
            ws_envelope(&RequestId::new_v7().to_string(), name, "personal"),
        )
        .await
        .expect_err("bad workspace name must be rejected");
        assert!(err.contains("VALIDATION_FAILED"), "{err}");
    }
    // Exactly 120 scalars is accepted.
    let ws_id = create_test_workspace(&ctx, &"n".repeat(120)).await;

    for name in ["", "   ", long.as_str()] {
        let err = handle_create_project(
            &ctx,
            proj_envelope(&RequestId::new_v7().to_string(), &ws_id, name, "isolated"),
        )
        .await
        .expect_err("bad project name must be rejected");
        assert!(err.contains("VALIDATION_FAILED"), "{err}");
    }
    assert_eq!(
        event_count(&ctx).await,
        before + 1,
        "only the valid workspace wrote"
    );
}

#[tokio::test]
async fn validated_scope_still_creates_sessions() {
    let ctx = setup_ctx(&test_db_path()).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;
    assert!(!sess_id.is_empty());
    assert_eq!(event_count(&ctx).await, 3);
}

#[tokio::test]
async fn retry_replays_without_duplicates_and_resumes_at_project() {
    let ctx = setup_ctx(&test_db_path()).await;
    let ws_req = RequestId::new_v7().to_string();
    let first = handle_create_workspace(&ctx, ws_envelope(&ws_req, "WS", "personal"))
        .await
        .expect("create");
    // Uncertain retry with the same ID and payload replays the original.
    let replay = handle_create_workspace(&ctx, ws_envelope(&ws_req, "WS", "personal"))
        .await
        .expect("replay");
    assert_eq!(first.data.workspace_id, replay.data.workspace_id);
    assert_eq!(event_count(&ctx).await, 1);

    let ws_id = first.data.workspace_id;
    // Project creation fails uncertainly; resume reuses the same workspace
    // and the same project request ID instead of forking either.
    let proj_req = RequestId::new_v7().to_string();
    let proj = handle_create_project(&ctx, proj_envelope(&proj_req, &ws_id, "Proj", "isolated"))
        .await
        .expect("create project");
    let proj_replay =
        handle_create_project(&ctx, proj_envelope(&proj_req, &ws_id, "Proj", "isolated"))
            .await
            .expect("replay project");
    assert_eq!(proj.data.project_id, proj_replay.data.project_id);
    assert_eq!(
        event_count(&ctx).await,
        2,
        "one workspace + one project event"
    );
}
