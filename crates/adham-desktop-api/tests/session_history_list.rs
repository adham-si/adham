mod common;
use common::*;

use adham_core_types::history::{
    SessionArchiveChangedV1, SessionDeletedV1, SessionPinChangedV1, SessionRenamedV1,
};
use adham_core_types::*;
use adham_desktop_api::service::list_sessions;
use adham_desktop_api::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_projections::conversation::ConversationProjection;
use serde::Serialize;
use time::OffsetDateTime;

fn now_us() -> i64 {
    OffsetDateTime::now_utc().unix_timestamp_nanos() as i64 / 1_000
}

async fn next_sequence(ctx: &ApiContext, session_id: &str) -> u64 {
    let current: Option<i64> =
        sqlx::query_scalar("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(format!("session:{session_id}"))
            .fetch_optional(&ctx.pool)
            .await
            .unwrap();
    current.unwrap_or(0) as u64
}

async fn append_history<T: Serialize>(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session_id: &str,
    event_type: &str,
    payload: T,
) {
    let expected_sequence = next_sequence(ctx, session_id).await;
    ctx.store
        .append_event(AppendEventRequest {
            stream_id: format!("session:{session_id}"),
            stream_kind: "session".to_string(),
            expected_sequence,
            event_type: event_type.to_string(),
            event_version: 1,
            scope: EventScope {
                installation_id: ctx.installation_id,
                workspace_id: Some(WorkspaceId::from_string(ws).unwrap()),
                project_id: Some(ProjectId::from_string(proj).unwrap()),
                session_id: Some(SessionId::from_string(session_id).unwrap()),
            },
            actor: EventActor {
                actor_id: ctx.actor_id,
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&payload).unwrap(),
            metadata_json: b"{}".to_vec(),
        })
        .await
        .unwrap();
}

#[allow(clippy::too_many_arguments)]
async fn insert_message(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session_id: &str,
    role: &str,
    text: &str,
    source_position: i64,
    created_at_us: i64,
) -> (String, ContentId) {
    let content_id = ContentId::new_v7();
    let message_id = MessageId::new_v7();
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(WorkspaceId::from_string(ws).unwrap()),
        project_id: Some(ProjectId::from_string(proj).unwrap()),
        session_id: Some(SessionId::from_string(session_id).unwrap()),
    };
    let mut tx = ctx.pool.begin().await.unwrap();
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
    ConversationProjection::insert_message_tx(
        &mut tx,
        &message_id.to_string(),
        ws,
        proj,
        session_id,
        role,
        &content_id.to_string(),
        &EventId::new_v7().to_string(),
        source_position,
        created_at_us,
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    (message_id.to_string(), content_id)
}

async fn link_attachment(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session_id: &str,
    message_id: &str,
    file_name: &str,
) {
    let attachment_id = AttachmentId::new_v7();
    let content_id = ContentId::new_v7();
    let mut tx = ctx.pool.begin().await.unwrap();
    sqlx::query(
        r#"
        INSERT INTO attachment_records (
            attachment_id, content_id, file_name, media_type, byte_size,
            content_hash, hash_algorithm, extracted_chars, truncated, retention,
            workspace_id, project_id, session_id, created_at_us
        ) VALUES (?, ?, ?, 'text/plain', 3, 'hash', 'blake3', 3, 0, 'session',
                  ?, ?, ?, ?)
        "#,
    )
    .bind(attachment_id.to_string())
    .bind(content_id.to_string())
    .bind(file_name)
    .bind(ws)
    .bind(proj)
    .bind(session_id)
    .bind(now_us())
    .execute(&mut *tx)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, 1)",
    )
    .bind(message_id)
    .bind(attachment_id.to_string())
    .execute(&mut *tx)
    .await
    .unwrap();
    tx.commit().await.unwrap();
}

fn context(ws: &str, proj: &str, session: Option<&str>) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: session.map(str::to_string),
    }
}

#[tokio::test]
async fn list_folds_actions_and_orders_pinned_first() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;

    let first = create_test_session(&ctx, &ws, &proj, Some("A")).await;
    let second = create_test_session(&ctx, &ws, &proj, Some("B")).await;
    let archived = create_test_session(&ctx, &ws, &proj, Some("C")).await;
    let deleted = create_test_session(&ctx, &ws, &proj, Some("D")).await;
    let empty = create_test_session(&ctx, &ws, &proj, Some("E")).await;

    append_history(
        &ctx,
        &ws,
        &proj,
        &second,
        adham_core_types::history::EVENT_TYPE_SESSION_RENAMED,
        SessionRenamedV1 {
            title: "Renamed B".to_string(),
        },
    )
    .await;
    append_history(
        &ctx,
        &ws,
        &proj,
        &second,
        adham_core_types::history::EVENT_TYPE_SESSION_PIN_CHANGED,
        SessionPinChangedV1 { pinned: true },
    )
    .await;
    append_history(
        &ctx,
        &ws,
        &proj,
        &archived,
        adham_core_types::history::EVENT_TYPE_SESSION_ARCHIVE_CHANGED,
        SessionArchiveChangedV1 { archived: true },
    )
    .await;
    append_history(
        &ctx,
        &ws,
        &proj,
        &deleted,
        adham_core_types::history::EVENT_TYPE_SESSION_DELETED,
        SessionDeletedV1 {},
    )
    .await;

    insert_message(
        &ctx,
        &ws,
        &proj,
        &first,
        "user",
        "First question",
        1,
        now_us() + 10_000_000,
    )
    .await;
    insert_message(
        &ctx,
        &ws,
        &proj,
        &second,
        "user",
        "Second question",
        1,
        now_us() + 20_000_000,
    )
    .await;

    let listed = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();

    let ids: Vec<&str> = listed
        .sessions
        .iter()
        .map(|s| s.session_id.as_str())
        .collect();
    assert_eq!(ids, vec![second.as_str(), first.as_str(), empty.as_str()]);
    assert_eq!(listed.sessions[0].title.as_deref(), Some("Renamed B"));
    assert!(listed.sessions[0].pinned);
    assert!(!listed.sessions[0].archived);
    assert!(listed.sessions[0].last_activity_at != listed.sessions[0].created_at);
    assert_eq!(
        listed.sessions[2].last_activity_at,
        listed.sessions[2].created_at
    );
    assert!(!listed.truncated);
    assert!(!ids.contains(&archived.as_str()));
    assert!(!ids.contains(&deleted.as_str()));
    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn active_archived_session_is_forced_into_the_cap() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;

    let mut sessions = Vec::new();
    for _ in 0..101 {
        sessions.push(create_test_session(&ctx, &ws, &proj, Some("S")).await);
    }
    append_history(
        &ctx,
        &ws,
        &proj,
        &sessions[0],
        adham_core_types::history::EVENT_TYPE_SESSION_ARCHIVE_CHANGED,
        SessionArchiveChangedV1 { archived: true },
    )
    .await;

    let listed = list_sessions(
        &ctx,
        &proj,
        Some(&ws),
        &ListSessionsOptions {
            include_archived: false,
            active_session_id: Some(sessions[0].clone()),
        },
    )
    .await
    .unwrap();

    assert_eq!(listed.sessions.len(), 100);
    assert!(listed.truncated);
    assert!(listed.sessions.iter().any(|s| s.session_id == sessions[0]));
    assert!(!listed.sessions.iter().any(|s| s.session_id == sessions[1]));
    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn auto_summary_uses_first_user_and_latest_assistant() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Summary")).await;

    let base = now_us();
    insert_message(
        &ctx,
        &ws,
        &proj,
        &session,
        "user",
        "First question",
        1,
        base + 1,
    )
    .await;
    insert_message(
        &ctx,
        &ws,
        &proj,
        &session,
        "assistant",
        "Older answer",
        2,
        base + 2,
    )
    .await;
    insert_message(
        &ctx,
        &ws,
        &proj,
        &session,
        "assistant",
        "Latest answer",
        3,
        base + 3,
    )
    .await;

    let listed = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    let row = &listed.sessions[0];
    assert_eq!(row.summary_origin.as_deref(), Some("auto"));
    let summary = row.summary.as_deref().unwrap_or("");
    assert!(summary.contains("First question"), "{summary}");
    assert!(summary.contains("Latest answer"), "{summary}");
    assert!(!summary.contains("Older answer"), "{summary}");
    assert!(!row.summary_unavailable);
    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn auto_summary_handles_attachment_only_and_one_sided_sessions() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Attachment")).await;

    let (message_id, _) =
        insert_message(&ctx, &ws, &proj, &session, "user", "", 1, now_us() + 1).await;
    link_attachment(&ctx, &ws, &proj, &session, &message_id, "canary.txt").await;

    let listed = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    let row = &listed.sessions[0];
    assert_eq!(row.summary_origin.as_deref(), Some("auto"));
    assert!(row.summary.as_deref().unwrap_or("").contains("canary.txt"));
    assert!(!row.summary_unavailable);
    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn unreadable_summary_sets_flag_and_count() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Unreadable")).await;

    let (_, user_content) =
        insert_message(&ctx, &ws, &proj, &session, "user", "Gone", 1, now_us() + 1).await;
    let (_, assistant_content) = insert_message(
        &ctx,
        &ws,
        &proj,
        &session,
        "assistant",
        "Also gone",
        2,
        now_us() + 2,
    )
    .await;
    sqlx::query("DELETE FROM content_records WHERE content_id IN (?, ?)")
        .bind(user_content.to_string())
        .bind(assistant_content.to_string())
        .execute(&ctx.pool)
        .await
        .unwrap();

    let listed = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    let row = &listed.sessions[0];
    assert!(row.summary_unavailable);
    assert!(row.summary.is_none());
    assert_eq!(listed.unreadable_summaries, 1);
    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn deleted_and_foreign_active_session_ids_are_ignored() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let other_proj = create_test_project(&ctx, &ws, "Other").await;

    let deleted = create_test_session(&ctx, &ws, &proj, Some("Deleted")).await;
    let kept = create_test_session(&ctx, &ws, &proj, Some("Kept")).await;
    let foreign = create_test_session(&ctx, &ws, &other_proj, Some("Foreign")).await;
    append_history(
        &ctx,
        &ws,
        &proj,
        &deleted,
        adham_core_types::history::EVENT_TYPE_SESSION_DELETED,
        SessionDeletedV1 {},
    )
    .await;

    for active in [&deleted, &foreign] {
        let listed = list_sessions(
            &ctx,
            &proj,
            Some(&ws),
            &ListSessionsOptions {
                include_archived: false,
                active_session_id: Some(active.clone()),
            },
        )
        .await
        .unwrap();
        assert_eq!(listed.sessions.len(), 1);
        assert_eq!(listed.sessions[0].session_id, kept);
        assert!(!listed.truncated);
    }
    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn old_session_summary_receipts_default_and_fall_back() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;

    let request_id = RequestId::new_v7();
    let title = Some("Old".to_string());
    let title_str = title.as_deref().unwrap_or("").trim().to_string();
    let request_fp = adham_event_log::request_fingerprint("create_session", 1, &title_str);
    let ws_id = WorkspaceId::from_string(&ws).unwrap();
    let proj_id = ProjectId::from_string(&proj).unwrap();
    let scope_fp = adham_event_log::scope_fingerprint(
        "create_session",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ws_id),
        Some(&proj_id),
        None,
    );
    let old = serde_json::json!({
        "sessionId": SessionId::new_v7().to_string(),
        "projectId": proj,
        "title": "Old",
        "createdAt": "2026-01-01T00:00:00Z"
    });
    let mut tx = ctx.pool.begin().await.unwrap();
    SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "create_session",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &CorrelationId::new_v7(),
        "success",
        &serde_json::to_vec(&old).unwrap(),
        0,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let result = handle_create_session(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: request_id.to_string(),
            context: context(&ws, &proj, None),
            payload: CreateSessionPayload { title },
        },
    )
    .await
    .unwrap();
    assert_eq!(result.data.last_activity_at, result.data.created_at);
    assert!(result.data.summary.is_none());
    assert!(!result.data.pinned);
    assert!(!result.data.archived);
    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[test]
fn validation_errors_keep_their_specific_key() {
    let envelope = ErrorEnvelope::from_error_str("VALIDATION_FAILED:summary_too_long");
    assert_eq!(envelope.message_key, "error.validation.summary_too_long");
    let deleted = ErrorEnvelope::from_error_str("SESSION_DELETED: session is deleted");
    assert_eq!(deleted.code, PublicErrorCode::SessionNotFound);
    assert_eq!(deleted.message_key, "error.sessionDeleted");
    let export_write = ErrorEnvelope::from_error_str("EXPORT_WRITE_FAILED: selected destination");
    assert_eq!(export_write.code, PublicErrorCode::StorageUnavailable);
    assert_eq!(export_write.message_key, "error.exportWriteFailed");
    assert!(!export_write.retryable);
}
