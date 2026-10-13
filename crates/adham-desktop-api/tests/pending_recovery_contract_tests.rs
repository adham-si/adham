mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

#[tokio::test]
async fn test_record_pending_operation_idempotency_and_conflict_rejection() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    let op_id = uuid::Uuid::now_v7().to_string();
    let msg_req_id = uuid::Uuid::now_v7().to_string();

    let record_env = |text: String, ws: String, proj: String| CommandEnvelope {
        protocol_version: 1,
        request_id: RequestId::new_v7().to_string(),
        context: CommandContext {
            workspace_id: Some(ws),
            project_id: Some(proj),
            session_id: Some(sess_id.clone()),
        },
        payload: RecordPendingOperationPayload {
            operation_id: op_id.clone(),
            kind: "single_message".to_string(),
            message_request_id: msg_req_id.clone(),
            create_request_id: None,
            text,
            title: None,
        },
    };

    // 1. Initial record succeeds
    let first = handle_record_pending_operation(
        &ctx,
        record_env("Hello world".to_string(), ws_id.clone(), proj_id.clone()),
    )
    .await
    .expect("first record should succeed");

    assert_eq!(first.data.operation_id, op_id);
    assert_eq!(first.data.text, "Hello world");
    assert_eq!(first.data.status, "pending");

    // 2. Repeating exact same record request returns existing record idempotently
    let repeated = handle_record_pending_operation(
        &ctx,
        record_env("Hello world".to_string(), ws_id.clone(), proj_id.clone()),
    )
    .await
    .expect("idempotent replay should succeed");

    assert_eq!(repeated.data.operation_id, op_id);
    assert_eq!(repeated.data.text, "Hello world");

    // 3. Changed payload with same operation_id fails closed
    let changed_payload = handle_record_pending_operation(
        &ctx,
        record_env("Tampered text".to_string(), ws_id.clone(), proj_id.clone()),
    )
    .await;

    assert!(
        changed_payload.is_err(),
        "changed payload on same operation_id must fail closed"
    );

    // 4. Changed scope target with same operation_id fails closed
    let changed_scope = handle_record_pending_operation(
        &ctx,
        record_env(
            "Hello world".to_string(),
            uuid::Uuid::now_v7().to_string(),
            proj_id.clone(),
        ),
    )
    .await;

    assert!(
        changed_scope.is_err(),
        "changed target scope on same operation_id must fail closed"
    );

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_lost_response_receipt_replay_zero_duplicate_events() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    let op_id = uuid::Uuid::now_v7().to_string();
    let msg_req_id = uuid::Uuid::now_v7().to_string();

    // 1. Record pending operation before dispatch
    handle_record_pending_operation(
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
                operation_id: op_id.clone(),
                kind: "single_message".to_string(),
                message_request_id: msg_req_id.clone(),
                create_request_id: None,
                text: "Original message".to_string(),
                title: None,
            },
        },
    )
    .await
    .expect("record pending op");

    // 2. Dispatch original message send
    let submit_env = CommandEnvelope {
        protocol_version: 1,
        request_id: msg_req_id.clone(),
        context: CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_id.clone()),
            session_id: Some(sess_id.clone()),
        },
        payload: SubmitMessagePayload {
            text: "Original message".to_string(),
        },
    };

    let first_submit = handle_submit_message(&ctx, submit_env.clone())
        .await
        .expect("submit message");

    let count_events = || async {
        let row: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM events")
            .fetch_one(&ctx.pool)
            .await
            .expect("count events");
        row.0
    };

    let event_count_before = count_events().await;

    // 3. Replay with the same frozen request_id (simulating client retry after lost response)
    let replayed_submit = handle_submit_message(&ctx, submit_env)
        .await
        .expect("receipt replay submit");

    assert_eq!(
        first_submit.data.message_id, replayed_submit.data.message_id,
        "replayed message ID must match original receipt"
    );

    let event_count_after = count_events().await;
    assert_eq!(
        event_count_before, event_count_after,
        "receipt replay must generate zero duplicate events in the event log"
    );

    // 4. Clear pending operation
    handle_clear_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id),
                project_id: Some(proj_id),
                session_id: Some(sess_id),
            },
            payload: ClearPendingOperationPayload {
                operation_id: op_id,
                expected_message_request_id: msg_req_id,
                reason: "resolved".to_string(),
            },
        },
    )
    .await
    .expect("clear pending op");

    let list = handle_list_pending_operations(&ctx)
        .await
        .expect("list pending ops");
    assert!(list.operations.is_empty());

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_first_send_replay_creation_and_submit_zero_duplicates() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;

    let op_id = uuid::Uuid::now_v7().to_string();
    let create_req_id = uuid::Uuid::now_v7().to_string();
    let msg_req_id = uuid::Uuid::now_v7().to_string();

    // 1. Record first_send pending operation
    handle_record_pending_operation(
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
                operation_id: op_id.clone(),
                kind: "first_send".to_string(),
                message_request_id: msg_req_id.clone(),
                create_request_id: Some(create_req_id.clone()),
                text: "First message in lazy session".to_string(),
                title: Some("My Topic".to_string()),
            },
        },
    )
    .await
    .expect("record first_send");

    // 2. Initial create_session commits
    let create_env = CommandEnvelope {
        protocol_version: 1,
        request_id: create_req_id.clone(),
        context: CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_id.clone()),
            session_id: None,
        },
        payload: CreateSessionPayload {
            title: Some("My Topic".to_string()),
        },
    };
    let created = handle_create_session(&ctx, create_env.clone())
        .await
        .expect("create session");
    let sess_id = created.data.session_id.clone();

    // 3. Recovery replays create_session with create_req_id: returns same session
    let replayed_create = handle_create_session(&ctx, create_env)
        .await
        .expect("replay create session");
    assert_eq!(
        created.data.session_id, replayed_create.data.session_id,
        "replayed session creation must match original receipt"
    );

    // 4. Submit message into recovered session
    let submit_res = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: msg_req_id.clone(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload {
                text: "First message in lazy session".to_string(),
            },
        },
    )
    .await
    .expect("submit message");
    assert!(!submit_res.data.message_id.is_empty());

    // 5. Clear pending operation
    handle_clear_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: ClearPendingOperationPayload {
                operation_id: op_id,
                expected_message_request_id: msg_req_id,
                reason: "resolved".to_string(),
            },
        },
    )
    .await
    .expect("clear pending op");

    // Verify session count is exactly 1
    let sessions_row: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM events WHERE event_type = 'SessionCreated' AND stream_id = $1",
    )
    .bind(format!("session:{}", sess_id))
    .fetch_one(&ctx.pool)
    .await
    .expect("count sessions");
    assert_eq!(sessions_row.0, 1);

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_bounded_discovery_and_truncation_disclosure() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    // Insert 55 pending operations
    for i in 0..55 {
        handle_record_pending_operation(
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
                    create_request_id: None,
                    text: format!("Message {}", i),
                    title: None,
                },
            },
        )
        .await
        .expect("record op");
    }

    let list = handle_list_pending_operations(&ctx)
        .await
        .expect("list pending operations");

    assert_eq!(list.operations.len(), 50, "default limit is 50");
    assert!(
        list.truncated,
        "truncation must be explicitly disclosed when more than limit exist"
    );

    let _ = std::fs::remove_file(db_path);
}
