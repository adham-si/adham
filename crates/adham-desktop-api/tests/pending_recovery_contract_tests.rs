mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;
use adham_event_log::SqliteEventStore;
use tokio_util::sync::CancellationToken;

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
            attachment_ids: Vec::new(),
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
                attachment_ids: Vec::new(),
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

/// Provider dispatch handles have their own recovery lifecycle: resolved
/// audit rows and live runs never reach the recovery surface, and closing a
/// stale op writes exactly one canonical interrupted terminal.
#[tokio::test]
async fn provider_completion_recovery_filters_live_and_resolved_and_closes_once() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws_id = create_test_workspace(&ctx, "WS").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(WorkspaceId::from_string(&ws_id).expect("ws")),
        project_id: Some(ProjectId::from_string(&proj_id).expect("proj")),
        session_id: Some(SessionId::from_string(&sess_id).expect("sess")),
    };

    // 1. One stale provider op (crash-left), one resolved provider audit row,
    //    one ordinary pending message op (must stay in the message flow).
    let stale_op = uuid::Uuid::now_v7().to_string();
    let stale_req = uuid::Uuid::now_v7().to_string();
    record_provider_op(&ctx, &scope, &stale_op, &stale_req).await;

    let resolved_op = uuid::Uuid::now_v7().to_string();
    let resolved_req = uuid::Uuid::now_v7().to_string();
    record_provider_op(&ctx, &scope, &resolved_op, &resolved_req).await;
    {
        let mut tx = ctx.pool.begin().await.expect("tx");
        SqliteEventStore::resolve_pending_operation_tx(&mut tx, &resolved_op, &resolved_req)
            .await
            .expect("resolve");
        tx.commit().await.expect("commit");
    }

    let message_op = uuid::Uuid::now_v7().to_string();
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
                operation_id: message_op.clone(),
                kind: "single_message".to_string(),
                message_request_id: uuid::Uuid::now_v7().to_string(),
                create_request_id: None,
                text: "unsent".to_string(),
                title: None,
            },
        },
    )
    .await
    .expect("record message op");

    let listed = handle_list_pending_operations(&ctx)
        .await
        .expect("list pending operations");
    let ids: Vec<&str> = listed
        .operations
        .iter()
        .map(|op| op.operation_id.as_str())
        .collect();
    assert!(ids.contains(&stale_op.as_str()), "{ids:?}");
    assert!(ids.contains(&message_op.as_str()), "{ids:?}");
    assert!(
        !ids.contains(&resolved_op.as_str()),
        "resolved audit rows are not recoverable: {ids:?}"
    );

    // 2. A live op is running, not awaiting recovery: excluded from the list
    //    and refused by the explicit close without side effects.
    ctx.completion_runs
        .insert(&stale_op, CancellationToken::new());
    let listed = handle_list_pending_operations(&ctx)
        .await
        .expect("list pending operations");
    assert!(
        !listed
            .operations
            .iter()
            .any(|op| op.operation_id == stale_op),
        "live ops are not recovery candidates"
    );

    let err = handle_mark_completion_interrupted(
        &ctx,
        mark_completion_env(&ws_id, &proj_id, &sess_id, &stale_op, &stale_req),
    )
    .await
    .expect_err("live op is not closable");
    assert!(err.contains("CONFLICT"), "{err}");
    let status: String =
        sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
            .bind(&stale_op)
            .fetch_one(&ctx.pool)
            .await
            .expect("status");
    assert_eq!(status, "pending", "a refused close leaves the op pending");

    ctx.completion_runs.remove(&stale_op);

    // 3. Explicit close: canonical interrupted terminal, op resolved, one
    //    assistant row; a second close is idempotent and adds nothing.
    let closed = handle_mark_completion_interrupted(
        &ctx,
        mark_completion_env(&ws_id, &proj_id, &sess_id, &stale_op, &stale_req),
    )
    .await
    .expect("close stale op");
    assert_eq!(closed.data.status, "interrupted");

    let repeated = handle_mark_completion_interrupted(
        &ctx,
        mark_completion_env(&ws_id, &proj_id, &sess_id, &stale_op, &stale_req),
    )
    .await
    .expect("idempotent close");
    assert_eq!(repeated.data.status, "already-resolved");

    let row_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM conversation_messages WHERE session_id = ? AND role = 'assistant'",
    )
    .bind(&sess_id)
    .fetch_one(&ctx.pool)
    .await
    .expect("assistant rows");
    assert_eq!(row_count, 1, "one canonical terminal per op");
    let completion: String = sqlx::query_scalar(
        "SELECT completion_json FROM conversation_messages WHERE session_id = ? AND role = 'assistant'",
    )
    .bind(&sess_id)
    .fetch_one(&ctx.pool)
    .await
    .expect("completion");
    assert_eq!(completion, "\"Interrupted\"");

    // 4. Refusals: tampered request id, a message op masquerading as a
    //    provider op, and a foreign session are all rejected untouched.
    let tamper_op = uuid::Uuid::now_v7().to_string();
    let tamper_req = uuid::Uuid::now_v7().to_string();
    record_provider_op(&ctx, &scope, &tamper_op, &tamper_req).await;
    let err = handle_mark_completion_interrupted(
        &ctx,
        mark_completion_env(
            &ws_id,
            &proj_id,
            &sess_id,
            &tamper_op,
            &uuid::Uuid::now_v7().to_string(),
        ),
    )
    .await
    .expect_err("tampered request id");
    assert!(err.contains("REQUEST_ID_CONFLICT"), "{err}");
    let status: String =
        sqlx::query_scalar("SELECT status FROM pending_operations WHERE operation_id = ?")
            .bind(&tamper_op)
            .fetch_one(&ctx.pool)
            .await
            .expect("status");
    assert_eq!(status, "pending");

    let err = handle_mark_completion_interrupted(
        &ctx,
        mark_completion_env(&ws_id, &proj_id, &sess_id, &message_op, &message_op),
    )
    .await
    .expect_err("message op is not a provider op");
    assert!(err.contains("CONTEXT_MISMATCH"), "{err}");

    let err = handle_mark_completion_interrupted(
        &ctx,
        mark_completion_env(
            &ws_id,
            &proj_id,
            &uuid::Uuid::now_v7().to_string(),
            &stale_op,
            &stale_req,
        ),
    )
    .await
    .expect_err("foreign session");
    assert!(
        err.contains("SESSION_NOT_FOUND") || err.contains("CONTEXT_MISMATCH"),
        "{err}"
    );

    let _ = std::fs::remove_file(db_path);
}

async fn record_provider_op(ctx: &ApiContext, scope: &EventScope, op: &str, req: &str) {
    let mut tx = ctx.pool.begin().await.expect("tx");
    SqliteEventStore::record_pending_operation_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        op,
        "provider-completion",
        scope,
        None,
        req,
        "",
        None,
    )
    .await
    .expect("record provider op");
    tx.commit().await.expect("commit");
}

fn mark_completion_env(
    ws: &str,
    proj: &str,
    sess: &str,
    op: &str,
    req: &str,
) -> CommandEnvelope<MarkCompletionInterruptedPayload> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: RequestId::new_v7().to_string(),
        context: CommandContext {
            workspace_id: Some(ws.to_string()),
            project_id: Some(proj.to_string()),
            session_id: Some(sess.to_string()),
        },
        payload: MarkCompletionInterruptedPayload {
            operation_id: op.to_string(),
            expected_message_request_id: req.to_string(),
        },
    }
}
