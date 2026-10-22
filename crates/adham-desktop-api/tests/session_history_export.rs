mod common;
use common::*;

use adham_core_types::history::*;
use adham_core_types::*;
use adham_desktop_api::service::attachment::ingest_text_attachment;
use adham_desktop_api::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_projections::ConversationProjection;
use std::path::{Path, PathBuf};
use time::OffsetDateTime;

fn context(ws: &str, proj: &str, session: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: Some(session.to_string()),
    }
}

fn now_us() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64
}

#[allow(clippy::too_many_arguments)]
async fn insert_message(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session: &str,
    role: &str,
    text: &str,
    reference: Option<(&str, &str)>,
    position: i64,
) -> (String, ContentId) {
    let mut tx = ctx.pool.begin().await.unwrap();
    let content_id = ContentId::new_v7();
    let message_id = MessageId::new_v7();
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(WorkspaceId::from_string(ws).unwrap()),
        project_id: Some(ProjectId::from_string(proj).unwrap()),
        session_id: Some(SessionId::from_string(session).unwrap()),
    };
    SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        if role == "user" {
            "user_text"
        } else {
            "assistant_text"
        },
        "text/plain",
        &scope,
        text.as_bytes(),
    )
    .await
    .unwrap();
    let event_id = EventId::new_v7().to_string();
    if role == "user" {
        ConversationProjection::insert_message_tx(
            &mut tx,
            &message_id.to_string(),
            ws,
            proj,
            session,
            "user",
            &content_id.to_string(),
            &event_id,
            position,
            now_us() + position,
            reference,
        )
        .await
        .unwrap();
    } else {
        ConversationProjection::insert_assistant_completion_tx(
            &mut tx,
            &message_id.to_string(),
            ws,
            proj,
            session,
            &OperationId::new_v7().to_string(),
            &content_id.to_string(),
            &serde_json::to_string(&MessageCompletionV1::Completed { truncated: false }).unwrap(),
            None,
            &event_id,
            position,
            now_us() + position,
        )
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
    (message_id.to_string(), content_id)
}

async fn append_deleted(ctx: &ApiContext, ws: &str, proj: &str, session: &str) {
    let mut tx = ctx.pool.begin().await.unwrap();
    let sequence: Option<i64> =
        sqlx::query_scalar("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(format!("session:{session}"))
            .fetch_optional(&mut *tx)
            .await
            .unwrap();
    SqliteEventStore::append_event_tx(
        &mut tx,
        AppendEventRequest {
            stream_id: format!("session:{session}"),
            stream_kind: "session".to_string(),
            expected_sequence: sequence.unwrap_or(0) as u64,
            event_type: EVENT_TYPE_SESSION_DELETED.to_string(),
            event_version: 1,
            scope: EventScope {
                installation_id: ctx.installation_id,
                workspace_id: Some(WorkspaceId::from_string(ws).unwrap()),
                project_id: Some(ProjectId::from_string(proj).unwrap()),
                session_id: Some(SessionId::from_string(session).unwrap()),
            },
            actor: EventActor {
                actor_id: ctx.actor_id,
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&SessionDeletedV1 {}).unwrap(),
            metadata_json: b"{}".to_vec(),
        },
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

async fn insert_pending(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    create_request_id: Option<&str>,
    status: &str,
) {
    let now = now_us();
    sqlx::query(
        "INSERT INTO pending_operations (operation_id, kind, workspace_id, project_id, session_id,
         create_request_id, message_request_id, content_id, status, created_at_us, updated_at_us)
         VALUES (?, 'completion', ?, ?, NULL, ?, ?, ?, ?, ?, ?)",
    )
    .bind(OperationId::new_v7().to_string())
    .bind(ws)
    .bind(proj)
    .bind(create_request_id)
    .bind(RequestId::new_v7().to_string())
    .bind(ContentId::new_v7().to_string())
    .bind(status)
    .bind(now)
    .bind(now)
    .execute(&ctx.pool)
    .await
    .unwrap();
}

fn export_files(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            files.push(entry.path());
        }
    }
    files
}

fn remove_export_dir(db_path: &Path) {
    let _ = std::fs::remove_dir_all(db_path.with_extension("exports"));
}

#[tokio::test]
async fn export_writes_markdown_with_summary_and_all_branch_rows() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Branch report")).await;
    let (u1, _) = insert_message(
        &ctx,
        &ws,
        &proj,
        &source,
        "user",
        "original prompt",
        None,
        0,
    )
    .await;
    insert_message(
        &ctx,
        &ws,
        &proj,
        &source,
        "assistant",
        "original answer",
        None,
        1,
    )
    .await;
    let (u2, _) = insert_message(
        &ctx,
        &ws,
        &proj,
        &source,
        "user",
        "edited prompt",
        Some((&u1, "edited-from")),
        2,
    )
    .await;
    insert_message(
        &ctx,
        &ws,
        &proj,
        &source,
        "assistant",
        "edited answer",
        None,
        3,
    )
    .await;
    let attachment = ingest_text_attachment(
        &ctx,
        &context(&ws, &proj, &source),
        "notes.md",
        b"note body",
    )
    .await
    .unwrap();
    let mut tx = ctx.pool.begin().await.unwrap();
    SqliteEventStore::link_attachments_to_message_tx(
        &mut tx,
        &MessageId::from_string(&u2).unwrap(),
        &[AttachmentId::from_string(&attachment.attachment_id).unwrap()],
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    handle_set_session_summary(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(&ws, &proj, &source),
            payload: SetSessionSummaryPayload {
                summary: Some("User summary".to_string()),
            },
        },
    )
    .await
    .unwrap();

    let exported = handle_export_session_markdown(&ctx, context(&ws, &proj, &source))
        .await
        .unwrap();
    let markdown = std::fs::read_to_string(&exported.path).unwrap();
    assert_eq!(exported.bytes, markdown.len() as u64);
    assert!(markdown.starts_with("# Branch report"));
    assert!(markdown.contains("**Summary (User):** User summary"));
    assert!(markdown.contains("original prompt"));
    assert!(markdown.contains("original answer"));
    assert!(markdown.contains("edited prompt"));
    assert!(markdown.contains("edited answer"));
    assert!(markdown.contains("Edited from an earlier prompt."));
    assert!(markdown.contains("**Attachments:**"));
    assert!(markdown.contains("notes.md"));
    assert!(markdown.contains("(9 bytes)"));
    assert!(Path::new(&exported.path).exists());

    handle_set_session_summary(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(&ws, &proj, &source),
            payload: SetSessionSummaryPayload { summary: None },
        },
    )
    .await
    .unwrap();
    let exported = handle_export_session_markdown(&ctx, context(&ws, &proj, &source))
        .await
        .unwrap();
    let markdown = std::fs::read_to_string(&exported.path).unwrap();
    assert!(markdown.contains("**Summary (Auto):** original prompt — edited answer"));

    drop(ctx);
    let _ = std::fs::remove_file(&db_path);
    remove_export_dir(&db_path);
}

#[tokio::test]
async fn export_rejects_over_5_mb_without_a_partial_file() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Huge")).await;
    let huge = "x".repeat(5 * 1024 * 1024 + 1);
    insert_message(&ctx, &ws, &proj, &source, "user", &huge, None, 0).await;

    let err = handle_export_session_markdown(&ctx, context(&ws, &proj, &source))
        .await
        .expect_err("over cap");
    assert!(err.contains("EXPORT_TOO_LARGE"), "{err}");
    assert!(export_files(&db_path.with_extension("exports")).is_empty());

    drop(ctx);
    let _ = std::fs::remove_file(&db_path);
    remove_export_dir(&db_path);
}

#[tokio::test]
async fn export_filename_uses_full_id_and_sanitized_slug() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let first = create_test_session(&ctx, &ws, &proj, Some("Same")).await;
    let second = create_test_session(&ctx, &ws, &proj, Some("Same")).await;
    let first_export = handle_export_session_markdown(&ctx, context(&ws, &proj, &first))
        .await
        .unwrap();
    let second_export = handle_export_session_markdown(&ctx, context(&ws, &proj, &second))
        .await
        .unwrap();
    assert_ne!(first_export.path, second_export.path);
    assert!(first_export.path.ends_with(&format!("Same-{first}.md")));
    assert!(second_export.path.ends_with(&format!("Same-{second}.md")));

    let odd = create_test_session(&ctx, &ws, &proj, Some("../A/B:*? C")).await;
    let odd_export = handle_export_session_markdown(&ctx, context(&ws, &proj, &odd))
        .await
        .unwrap();
    let name = Path::new(&odd_export.path)
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(name, format!("A-B-C-{odd}.md"));

    drop(ctx);
    let _ = std::fs::remove_file(&db_path);
    remove_export_dir(&db_path);
}

#[tokio::test]
async fn export_overwrites_same_session_and_sets_owner_only_mode() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Overwrite")).await;
    let first = handle_export_session_markdown(&ctx, context(&ws, &proj, &source))
        .await
        .unwrap();
    insert_message(&ctx, &ws, &proj, &source, "user", "first body", None, 0).await;
    let second = handle_export_session_markdown(&ctx, context(&ws, &proj, &source))
        .await
        .unwrap();
    assert_eq!(first.path, second.path);
    let markdown = std::fs::read_to_string(&second.path).unwrap();
    assert!(markdown.contains("first body"));
    let files = export_files(&db_path.with_extension("exports"));
    assert_eq!(files.len(), 1);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&second.path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
    }

    drop(ctx);
    let _ = std::fs::remove_file(&db_path);
    remove_export_dir(&db_path);
}

#[tokio::test]
async fn export_refuses_deleted_busy_and_unreadable_sessions() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;

    let deleted = create_test_session(&ctx, &ws, &proj, Some("Deleted")).await;
    append_deleted(&ctx, &ws, &proj, &deleted).await;
    let err = handle_export_session_markdown(&ctx, context(&ws, &proj, &deleted))
        .await
        .expect_err("deleted session");
    assert!(err.contains("SESSION_DELETED"), "{err}");

    let busy = create_test_session(&ctx, &ws, &proj, Some("Busy")).await;
    let create_request: String = sqlx::query_scalar(
        "SELECT request_id FROM events WHERE stream_id = ? AND event_type = 'SessionCreated' LIMIT 1",
    )
    .bind(format!("session:{busy}"))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    insert_pending(&ctx, &ws, &proj, Some(&create_request), "pending").await;
    let err = handle_export_session_markdown(&ctx, context(&ws, &proj, &busy))
        .await
        .expect_err("busy session");
    assert!(err.contains("SESSION_BUSY"), "{err}");
    sqlx::query("UPDATE pending_operations SET status = 'resolved' WHERE status = 'pending'")
        .execute(&ctx.pool)
        .await
        .unwrap();
    handle_export_session_markdown(&ctx, context(&ws, &proj, &busy))
        .await
        .expect("resolved rows do not block");

    let unreadable = create_test_session(&ctx, &ws, &proj, Some("Unreadable")).await;
    sqlx::query(
        "INSERT INTO conversation_messages (message_id, workspace_id, project_id, session_id, role,
         content_id, source_event_id, source_global_position, created_at_us)
         VALUES (?, ?, ?, ?, 'user', ?, ?, 0, ?)",
    )
    .bind(MessageId::new_v7().to_string())
    .bind(&ws)
    .bind(&proj)
    .bind(&unreadable)
    .bind(ContentId::new_v7().to_string())
    .bind(EventId::new_v7().to_string())
    .bind(now_us())
    .execute(&ctx.pool)
    .await
    .unwrap();
    let summary_session = create_test_session(&ctx, &ws, &proj, Some("Summary")).await;
    handle_set_session_summary(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(&ws, &proj, &summary_session),
            payload: SetSessionSummaryPayload {
                summary: Some("Will be missing".to_string()),
            },
        },
    )
    .await
    .unwrap();
    let payload: Vec<u8> = sqlx::query_scalar(
        "SELECT payload_json FROM events WHERE stream_id = ? AND event_type = ? ORDER BY global_position DESC LIMIT 1",
    )
    .bind(format!("session:{summary_session}"))
    .bind(EVENT_TYPE_SESSION_SUMMARY_UPDATED)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let update: SessionSummaryUpdatedV1 = serde_json::from_slice(&payload).unwrap();
    sqlx::query("DELETE FROM content_records WHERE content_id = ?")
        .bind(update.content_id.unwrap().to_string())
        .execute(&ctx.pool)
        .await
        .unwrap();
    let err = handle_export_session_markdown(&ctx, context(&ws, &proj, &summary_session))
        .await
        .expect_err("missing summary");
    assert!(err.contains("STORAGE_REPAIR_REQUIRED"), "{err}");
    let err = handle_export_session_markdown(&ctx, context(&ws, &proj, &unreadable))
        .await
        .expect_err("missing content");
    assert!(err.contains("STORAGE_REPAIR_REQUIRED"), "{err}");

    drop(ctx);
    let _ = std::fs::remove_file(&db_path);
    remove_export_dir(&db_path);
}
