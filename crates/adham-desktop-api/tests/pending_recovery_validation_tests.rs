mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

#[tokio::test]
async fn test_single_message_requires_session_and_forbids_first_send_fields() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    // 1. Missing session_id must be rejected
    let res_missing_sess = handle_record_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: None,
            },
            payload: RecordPendingOperationPayload {
                operation_id: uuid::Uuid::now_v7().to_string(),
                kind: "single_message".to_string(),
                message_request_id: uuid::Uuid::now_v7().to_string(),
                create_request_id: None,
                text: "Hello".to_string(),
                title: None,
            },
        },
    )
    .await;
    assert!(res_missing_sess.is_err());
    assert!(
        res_missing_sess
            .unwrap_err()
            .contains("session_id context required for single_message")
    );

    // 2. create_request_id present on single_message must be rejected
    let res_with_create_id = handle_record_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: RecordPendingOperationPayload {
                operation_id: uuid::Uuid::now_v7().to_string(),
                kind: "single_message".to_string(),
                message_request_id: uuid::Uuid::now_v7().to_string(),
                create_request_id: Some(uuid::Uuid::now_v7().to_string()),
                text: "Hello".to_string(),
                title: None,
            },
        },
    )
    .await;
    assert!(res_with_create_id.is_err());
    assert!(
        res_with_create_id
            .unwrap_err()
            .contains("create_request_id prohibited for single_message")
    );

    // 3. title present on single_message must be rejected
    let res_with_title = handle_record_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id),
                project_id: Some(proj_id),
                session_id: Some(sess_id),
            },
            payload: RecordPendingOperationPayload {
                operation_id: uuid::Uuid::now_v7().to_string(),
                kind: "single_message".to_string(),
                message_request_id: uuid::Uuid::now_v7().to_string(),
                create_request_id: None,
                text: "Hello".to_string(),
                title: Some("Forbidden Title".to_string()),
            },
        },
    )
    .await;
    assert!(res_with_title.is_err());
    assert!(
        res_with_title
            .unwrap_err()
            .contains("title prohibited for single_message")
    );

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_first_send_requires_create_request_id() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;

    let res = handle_record_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id),
                project_id: Some(proj_id),
                session_id: None,
            },
            payload: RecordPendingOperationPayload {
                operation_id: uuid::Uuid::now_v7().to_string(),
                kind: "first_send".to_string(),
                message_request_id: uuid::Uuid::now_v7().to_string(),
                create_request_id: None,
                text: "First".to_string(),
                title: Some("Session Title".to_string()),
            },
        },
    )
    .await;
    assert!(res.is_err());
    assert!(
        res.unwrap_err()
            .contains("create_request_id required for first_send")
    );

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_clear_reason_validation() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let res_invalid_reason = handle_clear_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: None,
                project_id: None,
                session_id: None,
            },
            payload: ClearPendingOperationPayload {
                operation_id: uuid::Uuid::now_v7().to_string(),
                expected_message_request_id: uuid::Uuid::now_v7().to_string(),
                reason: "invalid_reason".to_string(),
            },
        },
    )
    .await;
    assert!(res_invalid_reason.is_err());
    assert!(
        res_invalid_reason
            .unwrap_err()
            .contains("reason must be resolved or dismissed")
    );

    let _ = std::fs::remove_file(db_path);
}
