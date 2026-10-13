mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

#[tokio::test]
async fn test_persistent_db_reopen_preserves_and_decrypts_pending_operations() {
    let db_path = test_db_path();
    let key_provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
        std::sync::Arc::new(adham_event_log::InMemoryProvider::generate());

    let op_id = uuid::Uuid::now_v7().to_string();
    let msg_req_id = uuid::Uuid::now_v7().to_string();
    let create_req_id = uuid::Uuid::now_v7().to_string();
    let secret_text = "Sensitive user prompt text to preserve across restarts";
    let secret_title = "Secret Session Title";

    let (ws_id, proj_id) = {
        let ctx = setup_ctx_with_key(&db_path, key_provider.clone()).await;
        let ws = create_test_workspace(&ctx, "WS").await;
        let proj = create_test_project(&ctx, &ws, "Proj").await;

        handle_record_pending_operation(
            &ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: CommandContext {
                    workspace_id: Some(ws.clone()),
                    project_id: Some(proj.clone()),
                    session_id: None,
                },
                payload: RecordPendingOperationPayload {
                    operation_id: op_id.clone(),
                    kind: "first_send".to_string(),
                    message_request_id: msg_req_id.clone(),
                    create_request_id: Some(create_req_id.clone()),
                    text: secret_text.to_string(),
                    title: Some(secret_title.to_string()),
                },
            },
        )
        .await
        .expect("record pending op");

        // Verify it exists in initial context
        let list = handle_list_pending_operations(&ctx)
            .await
            .expect("list pending ops");
        assert_eq!(list.operations.len(), 1);
        assert_eq!(list.operations[0].text, secret_text);
        assert_eq!(list.operations[0].title.as_deref(), Some(secret_title));

        (ws, proj)
        // ctx is dropped here, closing database pool
    };

    // 2. Reopen new ApiContext from disk with the same encryption key provider
    {
        let reopened_ctx = setup_ctx_with_key(&db_path, key_provider).await;

        let list = handle_list_pending_operations(&reopened_ctx)
            .await
            .expect("list pending ops after reopen");

        assert_eq!(
            list.operations.len(),
            1,
            "pending operation must persist across persistent database reopen"
        );
        let recovered = &list.operations[0];
        assert_eq!(recovered.operation_id, op_id);
        assert_eq!(recovered.workspace_id, ws_id);
        assert_eq!(recovered.project_id, proj_id);
        assert_eq!(
            recovered.create_request_id.as_deref(),
            Some(create_req_id.as_str())
        );
        assert_eq!(recovered.message_request_id, msg_req_id);
        assert_eq!(
            recovered.text, secret_text,
            "reopened database must decrypt pending text accurately"
        );
        assert_eq!(
            recovered.title.as_deref(),
            Some(secret_title),
            "reopened database must decrypt pending title accurately"
        );

        // Resolve and clear the operation on the reopened instance
        handle_clear_pending_operation(
            &reopened_ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: CommandContext {
                    workspace_id: Some(ws_id),
                    project_id: Some(proj_id),
                    session_id: None,
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

        let list_empty = handle_list_pending_operations(&reopened_ctx)
            .await
            .expect("list empty");
        assert!(list_empty.operations.is_empty());
    }

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_cleanup_does_not_tombstone_saved_message_content() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    // 1. Submit and save an actual conversation message
    let saved_submit = handle_submit_message(
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
                text: "Authoritative saved message".to_string(),
            },
        },
    )
    .await
    .expect("submit saved message");

    let saved_msg_id = saved_submit.data.message_id;

    // 2. Record a pending operation
    let op_id = uuid::Uuid::now_v7().to_string();
    let pending_msg_req = uuid::Uuid::now_v7().to_string();
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
                message_request_id: pending_msg_req.clone(),
                create_request_id: None,
                text: "Ephemeral pending draft".to_string(),
                title: None,
            },
        },
    )
    .await
    .expect("record pending operation");

    // 3. Clear/dismiss the pending operation
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
                expected_message_request_id: pending_msg_req,
                reason: "dismissed".to_string(),
            },
        },
    )
    .await
    .expect("clear pending op");

    // 4. Verify conversation messages are STILL readable and intact!
    let history = handle_get_conversation(
        &ctx,
        CommandContext {
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        },
    )
    .await
    .expect("get conversation");

    assert_eq!(history.items.len(), 1);
    assert_eq!(history.items[0].message_id, saved_msg_id);
    assert_eq!(history.items[0].text, "Authoritative saved message");

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_native_quit_relaunch_recovery_journey_zero_duplicates() {
    let db_path = test_db_path();
    let key_provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
        std::sync::Arc::new(adham_event_log::InMemoryProvider::generate());

    let op_id = uuid::Uuid::now_v7().to_string();
    let original_create_req_id = uuid::Uuid::now_v7().to_string();
    let original_msg_req_id = uuid::Uuid::now_v7().to_string();
    let test_text = "Native recovery verification prompt";
    let test_title = "Native Recovery Title";

    // 1. Initial process: user sends first-send, record_pending_operation commits to SQLite
    let (ws_id, proj_id) = {
        let ctx = setup_ctx_with_key(&db_path, key_provider.clone()).await;
        let ws = create_test_workspace(&ctx, "WS-Recovery").await;
        let proj = create_test_project(&ctx, &ws, "Proj-Recovery").await;

        handle_record_pending_operation(
            &ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: CommandContext {
                    workspace_id: Some(ws.clone()),
                    project_id: Some(proj.clone()),
                    session_id: None,
                },
                payload: RecordPendingOperationPayload {
                    operation_id: op_id.clone(),
                    kind: "first_send".to_string(),
                    message_request_id: original_msg_req_id.clone(),
                    create_request_id: Some(original_create_req_id.clone()),
                    text: test_text.to_string(),
                    title: Some(test_title.to_string()),
                },
            },
        )
        .await
        .expect("record pending op before simulated quit");

        (ws, proj)
        // IPC Boundary: ctx is dropped here, simulating hard native app quit / SIGKILL before submit completed
    };

    // 2. Relaunch: app restarts, opens DB with same key provider
    {
        let relaunch_ctx = setup_ctx_with_key(&db_path, key_provider).await;

        // Startup recovery check
        let list = handle_list_pending_operations(&relaunch_ctx)
            .await
            .expect("list pending ops on relaunch");

        assert_eq!(
            list.operations.len(),
            1,
            "must discover unresolved operation on relaunch"
        );
        let op = &list.operations[0];
        assert_eq!(op.operation_id, op_id);
        assert_eq!(op.workspace_id, ws_id);
        assert_eq!(op.project_id, proj_id);
        assert_eq!(
            op.create_request_id.as_deref(),
            Some(original_create_req_id.as_str())
        );
        assert_eq!(op.message_request_id, original_msg_req_id);
        assert_eq!(op.text, test_text);
        assert_eq!(op.title.as_deref(), Some(test_title));

        let scope_ctx = CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_id.clone()),
            session_id: None,
        };

        // 3. User performs explicit resend: replays with original request identities
        let create_res = handle_create_session(
            &relaunch_ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: original_create_req_id.clone(),
                context: scope_ctx.clone(),
                payload: CreateSessionPayload {
                    title: Some(test_title.to_string()),
                },
            },
        )
        .await
        .expect("replay create session on resend");

        let recovered_session_id = create_res.data.session_id;
        let session_ctx = CommandContext {
            session_id: Some(recovered_session_id.clone()),
            ..scope_ctx.clone()
        };

        let submit_res = handle_submit_message(
            &relaunch_ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: original_msg_req_id.clone(),
                context: session_ctx.clone(),
                payload: SubmitMessagePayload {
                    text: test_text.to_string(),
                },
            },
        )
        .await
        .expect("replay submit message on resend");

        assert_eq!(submit_res.data.session_id, recovered_session_id);

        // Clear the pending marker now that resend succeeded
        handle_clear_pending_operation(
            &relaunch_ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: session_ctx.clone(),
                payload: ClearPendingOperationPayload {
                    operation_id: op_id,
                    expected_message_request_id: original_msg_req_id,
                    reason: "resolved".to_string(),
                },
            },
        )
        .await
        .expect("clear resolved pending operation");

        // 4. Verify ZERO duplicates: re-invoking create_session returns existing receipt
        let dup = handle_create_session(
            &relaunch_ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: original_create_req_id,
                context: scope_ctx,
                payload: CreateSessionPayload {
                    title: Some(test_title.to_string()),
                },
            },
        )
        .await
        .expect("idempotent create session call");

        assert_eq!(dup.data.session_id, recovered_session_id);

        // Verify conversation history has exactly 1 message
        let conv = handle_get_conversation(
            &relaunch_ctx,
            CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(recovered_session_id),
            },
        )
        .await
        .expect("get conversation");

        assert_eq!(
            conv.items.len(),
            1,
            "exactly one message must exist, zero duplicates"
        );
        assert_eq!(conv.items[0].text, test_text);

        // Verify pending operations list is empty
        let empty_list = handle_list_pending_operations(&relaunch_ctx)
            .await
            .expect("list pending ops after resolution");
        assert!(
            empty_list.operations.is_empty(),
            "pending operations must be empty"
        );
    }

    let _ = std::fs::remove_file(db_path);
}
