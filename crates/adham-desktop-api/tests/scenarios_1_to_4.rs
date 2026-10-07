mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

#[tokio::test]
async fn test_scenario_1_create_and_display() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    // 1. Create Workspace
    let ws_id = create_test_workspace(&ctx, "Personal Workspace").await;

    // 2. Create Project
    let proj_id = create_test_project(&ctx, &ws_id, "Test Project").await;

    // 3. Create Session
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, Some("Initial Session")).await;

    // 4. Submit Message "Hello Adham"
    let msg_res = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload {
                text: "Hello Adham".to_string(),
            },
        },
    )
    .await
    .expect("submit message");
    assert_eq!(msg_res.data.text, "Hello Adham");

    // 5. Query Conversation Projection
    let conv = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        },
    )
    .await
    .expect("get conversation");
    assert_eq!(conv.items.len(), 1);
    assert_eq!(conv.items[0].text, "Hello Adham");
    assert_eq!(conv.items[0].role, "user");

    // 6. Verify 4 events exist in SQLite events table
    let event_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(event_count, 4);
}

#[tokio::test]
async fn test_scenario_2_restart_and_replay() {
    let db_path = test_db_path();
    let ws_id: String;
    let proj_id: String;
    let sess_id: String;
    let msg_id: String;

    {
        let ctx = setup_ctx(&db_path).await;
        ws_id = create_test_workspace(&ctx, "WS").await;
        proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
        sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

        let msg = handle_submit_message(
            &ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: CommandContext {
                    workspace_id: Some(ws_id.clone()),
                    project_id: Some(proj_id.clone()),
                    session_id: Some(sess_id.clone()),
                },
                payload: SubmitMessagePayload {
                    text: "Persistent text".to_string(),
                },
            },
        )
        .await
        .unwrap();
        msg_id = msg.data.message_id;
    } // Pool closed and dropped here

    // Simulate Restart: Reopen database connection
    let restarted_ctx = setup_ctx(&db_path).await;
    let conv = handle_get_conversation(
        &restarted_ctx,
        CommandContext {
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        },
    )
    .await
    .unwrap();

    assert_eq!(conv.items.len(), 1);
    assert_eq!(conv.items[0].message_id, msg_id);
    assert_eq!(conv.items[0].text, "Persistent text");
}

#[tokio::test]
async fn test_scenario_3_projection_rebuild() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let ws_id = create_test_workspace(&ctx, "Rebuild WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Rebuild Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload {
                text: "Original message to rebuild".to_string(),
            },
        },
    )
    .await
    .unwrap();

    // Wipe conversation projection table completely
    sqlx::query("DELETE FROM conversation_messages")
        .execute(&ctx.pool)
        .await
        .unwrap();

    // Verify projection is empty
    let empty_conv = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_id.clone()),
            session_id: Some(sess_id.clone()),
        },
    )
    .await
    .unwrap();
    assert_eq!(empty_conv.items.len(), 0);

    // Execute deterministic rebuild
    let rebuild_res = handle_admin_rebuild_projections(&ctx).await.unwrap();
    assert!(rebuild_res.replayed_count >= 1);

    // Verify projection is restored with fidelity
    let restored_conv = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        },
    )
    .await
    .unwrap();
    assert_eq!(restored_conv.items.len(), 1);
    assert_eq!(restored_conv.items[0].text, "Original message to rebuild");
}

#[tokio::test]
async fn test_scenario_4_duplicate_request_idempotency() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;

    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    let shared_req_id = RequestId::new_v7().to_string();

    let call1 = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: shared_req_id.clone(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload {
                text: "Same content".to_string(),
            },
        },
    )
    .await
    .unwrap();

    // Retry identically with same request_id and payload
    let call2 = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: shared_req_id,
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload {
                text: "Same content".to_string(),
            },
        },
    )
    .await
    .unwrap();

    assert_eq!(call1.data.message_id, call2.data.message_id);

    // Assert only 1 conversation message exists
    let conv = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        },
    )
    .await
    .unwrap();
    assert_eq!(conv.items.len(), 1);
}
