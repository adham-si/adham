mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

#[tokio::test]
async fn test_scenario_5_conflicting_request_reuse() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    let reused_req_id = RequestId::new_v7().to_string();

    let _ = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: reused_req_id.clone(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload {
                text: "Original Text".to_string(),
            },
        },
    )
    .await
    .unwrap();

    // Reuse same request_id with differing text -> REQUEST_ID_CONFLICT
    let conflict_res = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: reused_req_id,
            context: CommandContext {
                workspace_id: Some(ws_id),
                project_id: Some(proj_id),
                session_id: Some(sess_id),
            },
            payload: SubmitMessagePayload {
                text: "Completely Different Text".to_string(),
            },
        },
    )
    .await;

    assert!(conflict_res.is_err());
    let err_msg = conflict_res.unwrap_err();
    assert!(err_msg.contains("REQUEST_ID_CONFLICT"));
}

#[tokio::test]
async fn test_scenario_6_malformed_request_validation() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    // 1. Invalid protocol version
    let ver_err = handle_create_workspace(
        &ctx,
        CommandEnvelope {
            protocol_version: 99,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext::default(),
            payload: CreateWorkspacePayload {
                name: "Bad Version WS".to_string(),
                kind: "personal".to_string(),
                preferred_language: "en".to_string(),
            },
        },
    )
    .await;
    assert!(ver_err.is_err());
    assert!(ver_err.unwrap_err().contains("INVALID_COMMAND_VERSION"));

    // 2. Empty name validation
    let empty_err = handle_create_workspace(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext::default(),
            payload: CreateWorkspacePayload {
                name: "   ".to_string(),
                kind: "personal".to_string(),
                preferred_language: "en".to_string(),
            },
        },
    )
    .await;
    assert!(empty_err.is_err());
    assert!(empty_err.unwrap_err().contains("VALIDATION_FAILED"));
}

#[tokio::test]
async fn test_scenario_7_wrong_project_context_mismatch() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_a = create_test_project(&ctx, &ws_id, "Project A").await;
    let proj_b = create_test_project(&ctx, &ws_id, "Project B").await;

    // Session created under Project A
    let sess_a = create_test_session(&ctx, &ws_id, &proj_a, None).await;

    // Attempt to submit message to Session A under Project B context -> CONTEXT_MISMATCH
    let mismatch_res = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id),
                project_id: Some(proj_b),
                session_id: Some(sess_a),
            },
            payload: SubmitMessagePayload {
                text: "Should fail with mismatch".to_string(),
            },
        },
    )
    .await;

    assert!(mismatch_res.is_err());
    let err_msg = mismatch_res.unwrap_err();
    assert!(err_msg.contains("CONTEXT_MISMATCH"));
}

#[tokio::test]
async fn test_scenario_8_interrupted_transaction_atomicity() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    // Direct transaction test: rollback leaves zero rows
    let mut tx = ctx.pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO content_records (content_id, content_kind, media_type, encoding, protection_scheme, protected_bytes, plaintext_size, created_at_us) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(ContentId::new_v7().to_string())
    .bind("temp")
    .bind("text/plain")
    .bind("identity")
    .bind("none")
    .bind(b"aborted" as &[u8])
    .bind(7)
    .bind(100)
    .execute(&mut *tx)
    .await
    .unwrap();

    // Rollback the transaction explicitly
    tx.rollback().await.unwrap();

    // Verify zero rows in content_records
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM content_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
}
