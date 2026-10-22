//! Size exception (AGENTS.md): the delete matrix keeps tombstone, purge,
//! replay, and late-write cases together against one fixture setup.
mod common;
use common::*;

use adham_core_types::history::*;
use adham_core_types::*;
use adham_desktop_api::service::list_sessions;
use adham_desktop_api::*;
use sqlx::Row;

fn context(ws: &str, proj: &str, session: Option<&str>) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: session.map(str::to_string),
    }
}

fn envelope<P>(context: CommandContext, request_id: String, payload: P) -> CommandEnvelope<P> {
    CommandEnvelope {
        protocol_version: 1,
        request_id,
        context,
        payload,
    }
}

async fn create_named_session(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    title: &str,
) -> (String, String) {
    let request_id = RequestId::new_v7().to_string();
    let result = handle_create_session(
        ctx,
        envelope(
            context(ws, proj, None),
            request_id.clone(),
            CreateSessionPayload {
                title: Some(title.to_string()),
            },
        ),
    )
    .await
    .unwrap();
    (result.data.session_id, request_id)
}

async fn submit(ctx: &ApiContext, ws: &str, proj: &str, session: &str, text: &str) -> String {
    let result = handle_submit_message(
        ctx,
        envelope(
            context(ws, proj, Some(session)),
            RequestId::new_v7().to_string(),
            SubmitMessagePayload {
                text: text.to_string(),
                attachment_ids: Vec::new(),
            },
        ),
    )
    .await
    .unwrap();
    result.data.message_id
}

async fn delete(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session: &str,
    confirm: bool,
    request_id: String,
) -> Result<CommandResult<DeleteSessionResponse>, String> {
    handle_delete_session(
        ctx,
        envelope(
            context(ws, proj, Some(session)),
            request_id,
            DeleteSessionPayload { confirm },
        ),
    )
    .await
}

#[tokio::test]
async fn delete_tombstones_purges_and_keeps_exported_markdown() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Delete").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, _) = create_named_session(&ctx, &ws, &proj, "Victim").await;
    let message_id = submit(&ctx, &ws, &proj, &session, "delete me").await;

    handle_set_message_bookmark(
        &ctx,
        context(&ws, &proj, Some(&session)),
        SetMessageBookmarkPayload {
            message_id: message_id.clone(),
            bookmarked: true,
        },
    )
    .await
    .unwrap();
    handle_set_session_summary(
        &ctx,
        envelope(
            context(&ws, &proj, Some(&session)),
            RequestId::new_v7().to_string(),
            SetSessionSummaryPayload {
                summary: Some("summary to erase".to_string()),
            },
        ),
    )
    .await
    .unwrap();
    let attachment = handle_ingest_attachment(
        &ctx,
        envelope(
            context(&ws, &proj, Some(&session)),
            RequestId::new_v7().to_string(),
            IngestAttachmentPayload {
                file_name: "notes.txt".to_string(),
                text: "attachment text".to_string(),
            },
        ),
    )
    .await
    .unwrap()
    .data;
    sqlx::query(
        "INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, 0)",
    )
    .bind(&message_id)
    .bind(&attachment.attachment_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO answer_feedback (session_id, message_id, verdict, reason, updated_at_us) VALUES (?, ?, 'like', NULL, 0)")
        .bind(&session)
        .bind(&message_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO branch_selections (session_id, root_message_id, active_message_id, updated_at_us) VALUES (?, ?, ?, 0)")
        .bind(&session)
        .bind(&message_id)
        .bind(&message_id)
        .execute(&ctx.pool)
        .await
        .unwrap();

    let exported = handle_export_session_markdown(&ctx, context(&ws, &proj, Some(&session)))
        .await
        .unwrap();
    let exported_body = std::fs::read_to_string(&exported.path).unwrap();
    let content_ids: Vec<String> =
        sqlx::query_scalar("SELECT content_id FROM content_records WHERE session_id = ?")
            .bind(&session)
            .fetch_all(&ctx.pool)
            .await
            .unwrap();
    assert!(!content_ids.is_empty());

    let response = delete(
        &ctx,
        &ws,
        &proj,
        &session,
        true,
        RequestId::new_v7().to_string(),
    )
    .await
    .unwrap()
    .data;
    assert!(response.deleted);
    assert_eq!(response.session_id, session);

    let tombstoned: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM content_tombstones WHERE content_id IN (SELECT value FROM json_each(?))",
    )
    .bind(serde_json::to_string(&content_ids).unwrap())
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(tombstoned, content_ids.len() as i64);
    for table in [
        "conversation_messages",
        "attachment_records",
        "message_attachments",
        "answer_feedback",
        "branch_selections",
        "message_bookmarks",
        "pending_operations",
    ] {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
        assert_eq!(count, 0, "{table} was not purged");
    }
    let leftovers: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM content_records WHERE session_id = ?")
            .bind(&session)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(leftovers, 0);
    let deleted_events: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE event_type = ?")
            .bind(EVENT_TYPE_SESSION_DELETED)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(deleted_events, 1);

    let list = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    assert!(list.sessions.is_empty());
    let read = handle_get_conversation(&ctx, context(&ws, &proj, Some(&session)))
        .await
        .expect_err("deleted session must not reopen");
    assert!(read.contains("SESSION_DELETED"), "{read}");
    assert_eq!(
        std::fs::read_to_string(&exported.path).unwrap(),
        exported_body
    );

    let _ = std::fs::remove_file(&exported.path);
    let _ = std::fs::remove_dir_all(db_path.with_extension("exports"));
    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn delete_requires_confirmation_without_mutating() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Confirm").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, _) = create_named_session(&ctx, &ws, &proj, "Keep").await;
    submit(&ctx, &ws, &proj, &session, "stay").await;
    let events_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let content_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM content_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let request_id = RequestId::new_v7().to_string();

    let err = delete(&ctx, &ws, &proj, &session, false, request_id.clone())
        .await
        .expect_err("confirmation is required");
    assert!(err.contains("VALIDATION_FAILED:confirm_required"), "{err}");
    let events_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let content_after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM content_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(events_before, events_after);
    assert_eq!(content_before, content_after);
    let receipts: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM command_receipts WHERE request_id = ?")
            .bind(&request_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(receipts, 0);
    let list = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    assert_eq!(list.sessions.len(), 1);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn delete_refuses_live_first_send_then_purges_its_null_session_content() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "FirstSend").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, create_request_id) = create_named_session(&ctx, &ws, &proj, "Pending").await;
    let operation_id = uuid::Uuid::now_v7().to_string();
    let message_request_id = uuid::Uuid::now_v7().to_string();
    handle_record_pending_operation(
        &ctx,
        envelope(
            context(&ws, &proj, None),
            RequestId::new_v7().to_string(),
            RecordPendingOperationPayload {
                operation_id: operation_id.clone(),
                kind: "first_send".to_string(),
                message_request_id: message_request_id.clone(),
                create_request_id: Some(create_request_id),
                text: "pending text".to_string(),
                title: Some("pending title".to_string()),
            },
        ),
    )
    .await
    .unwrap();
    let row = sqlx::query(
        "SELECT content_id, title_content_id FROM pending_operations WHERE operation_id = ?",
    )
    .bind(&operation_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let content_id: String = row.get("content_id");
    let title_id: String = row.get("title_content_id");

    let err = delete(
        &ctx,
        &ws,
        &proj,
        &session,
        true,
        RequestId::new_v7().to_string(),
    )
    .await
    .expect_err("live operation blocks delete");
    assert!(err.contains("SESSION_BUSY"), "{err}");

    sqlx::query("UPDATE pending_operations SET status = 'resolved' WHERE operation_id = ?")
        .bind(&operation_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    delete(
        &ctx,
        &ws,
        &proj,
        &session,
        true,
        RequestId::new_v7().to_string(),
    )
    .await
    .unwrap();

    for id in [content_id, title_id] {
        let content: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM content_records WHERE content_id = ?")
                .bind(&id)
                .fetch_one(&ctx.pool)
                .await
                .unwrap();
        let tombstone: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM content_tombstones WHERE content_id = ?")
                .bind(&id)
                .fetch_one(&ctx.pool)
                .await
                .unwrap();
        assert_eq!(content, 0);
        assert_eq!(tombstone, 1);
    }
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_operations")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(pending, 0);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn delete_purges_resolved_pending_rows_and_replays_receipt() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Replay").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, _) = create_named_session(&ctx, &ws, &proj, "Replay").await;
    let operation_id = uuid::Uuid::now_v7().to_string();
    let message_request_id = uuid::Uuid::now_v7().to_string();
    handle_record_pending_operation(
        &ctx,
        envelope(
            context(&ws, &proj, Some(&session)),
            RequestId::new_v7().to_string(),
            RecordPendingOperationPayload {
                operation_id: operation_id.clone(),
                kind: "single_message".to_string(),
                message_request_id: message_request_id.clone(),
                create_request_id: None,
                text: "resolved text".to_string(),
                title: None,
            },
        ),
    )
    .await
    .unwrap();
    sqlx::query("UPDATE pending_operations SET status = 'resolved' WHERE operation_id = ?")
        .bind(&operation_id)
        .execute(&ctx.pool)
        .await
        .unwrap();

    let request_id = RequestId::new_v7().to_string();
    let first = delete(&ctx, &ws, &proj, &session, true, request_id.clone())
        .await
        .unwrap();
    let second = delete(&ctx, &ws, &proj, &session, true, request_id)
        .await
        .unwrap();
    assert_eq!(first.data, second.data);
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_operations")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(pending, 0);
    let deleted: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE event_type = ?")
        .bind(EVENT_TYPE_SESSION_DELETED)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(deleted, 1);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn late_submit_after_delete_is_rejected() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Late").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, _) = create_named_session(&ctx, &ws, &proj, "Late").await;
    delete(
        &ctx,
        &ws,
        &proj,
        &session,
        true,
        RequestId::new_v7().to_string(),
    )
    .await
    .unwrap();

    let err = handle_submit_message(
        &ctx,
        envelope(
            context(&ws, &proj, Some(&session)),
            RequestId::new_v7().to_string(),
            SubmitMessagePayload {
                text: "late".to_string(),
                attachment_ids: Vec::new(),
            },
        ),
    )
    .await
    .expect_err("late submit");
    assert!(err.contains("SESSION_DELETED"), "{err}");
    let messages: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM conversation_messages")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let content: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM content_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(messages, 0);
    assert_eq!(content, 0);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn first_send_pending_after_delete_is_rejected() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "PendingLate").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, create_request_id) = create_named_session(&ctx, &ws, &proj, "PendingLate").await;
    delete(
        &ctx,
        &ws,
        &proj,
        &session,
        true,
        RequestId::new_v7().to_string(),
    )
    .await
    .unwrap();

    let err = handle_record_pending_operation(
        &ctx,
        envelope(
            context(&ws, &proj, None),
            RequestId::new_v7().to_string(),
            RecordPendingOperationPayload {
                operation_id: uuid::Uuid::now_v7().to_string(),
                kind: "first_send".to_string(),
                message_request_id: uuid::Uuid::now_v7().to_string(),
                create_request_id: Some(create_request_id),
                text: "late pending".to_string(),
                title: None,
            },
        ),
    )
    .await
    .expect_err("late pending");
    assert!(err.contains("SESSION_DELETED"), "{err}");
    let pending: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM pending_operations")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let content: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM content_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(pending, 0);
    assert_eq!(content, 0);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn attachment_ingestion_after_delete_is_rejected() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "AttachLate").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, _) = create_named_session(&ctx, &ws, &proj, "AttachLate").await;
    delete(
        &ctx,
        &ws,
        &proj,
        &session,
        true,
        RequestId::new_v7().to_string(),
    )
    .await
    .unwrap();

    let err = handle_ingest_attachment(
        &ctx,
        envelope(
            context(&ws, &proj, Some(&session)),
            RequestId::new_v7().to_string(),
            IngestAttachmentPayload {
                file_name: "late.txt".to_string(),
                text: "late".to_string(),
            },
        ),
    )
    .await
    .expect_err("late attachment");
    assert!(err.contains("SESSION_DELETED"), "{err}");
    let attachments: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM attachment_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let content: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM content_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(attachments, 0);
    assert_eq!(content, 0);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn create_receipt_replay_after_delete_is_rejected() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "CreateReplay").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let (session, create_request_id) = create_named_session(&ctx, &ws, &proj, "CreateReplay").await;
    delete(
        &ctx,
        &ws,
        &proj,
        &session,
        true,
        RequestId::new_v7().to_string(),
    )
    .await
    .unwrap();

    let err = handle_create_session(
        &ctx,
        envelope(
            context(&ws, &proj, None),
            create_request_id,
            CreateSessionPayload {
                title: Some("CreateReplay".to_string()),
            },
        ),
    )
    .await
    .expect_err("replay after delete");
    assert!(err.contains("SESSION_DELETED"), "{err}");

    let _ = std::fs::remove_file(&db_path);
}
