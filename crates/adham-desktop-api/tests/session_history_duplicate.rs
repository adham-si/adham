//! Size exception (AGENTS.md): one shared fixture matrix keeps the duplicate
//! cases (branches, limits, replay, attachments, repair, re-seal) together.
mod common;
use common::*;

use adham_core_types::history::*;
use adham_core_types::*;
use adham_desktop_api::service::attachment::ingest_text_attachment;
use adham_desktop_api::service::branch::active_branch_rows;
use adham_desktop_api::service::list_sessions;
use adham_desktop_api::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_projections::{ConversationMessageView, ConversationProjection};
use sqlx::Row;
use time::OffsetDateTime;

fn context(ws: &str, proj: &str, session: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: Some(session.to_string()),
    }
}

fn scope(installation: InstallationId, ws: &str, proj: &str, session: &str) -> EventScope {
    EventScope {
        installation_id: installation,
        workspace_id: Some(WorkspaceId::from_string(ws).unwrap()),
        project_id: Some(ProjectId::from_string(proj).unwrap()),
        session_id: Some(SessionId::from_string(session).unwrap()),
    }
}

fn now_us() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64
}

async fn next_sequence(tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>, session: &str) -> u64 {
    let current: Option<i64> =
        sqlx::query_scalar("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(format!("session:{session}"))
            .fetch_optional(&mut **tx)
            .await
            .unwrap();
    current.unwrap_or(0) as u64
}

async fn append_user(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session: &str,
    text: &str,
    reference: Option<(&str, &str)>,
    attachment_ids: &[String],
) -> (String, String) {
    let mut tx = ctx.pool.begin().await.unwrap();
    let expected_sequence = next_sequence(&mut tx, session).await;
    let message_id = MessageId::new_v7();
    let content_id = ContentId::new_v7();
    let event_scope = EventScope {
        installation_id: ctx.installation_id,
        ..scope(ctx.installation_id, ws, proj, session)
    };
    SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        "user_text",
        "text/plain",
        &event_scope,
        text.as_bytes(),
    )
    .await
    .unwrap();
    let reference_payload = reference.map(|(id, relation)| MessageReferenceV1 {
        refers_to_message_id: MessageId::from_string(id).unwrap(),
        relation: relation.to_string(),
    });
    let payload = MessageSubmittedV2 {
        message_id,
        content_id,
        content_kind: "user_text".to_string(),
        size_bytes: text.len() as u64,
        reference: reference_payload,
    };
    let append = SqliteEventStore::append_event_tx(
        &mut tx,
        AppendEventRequest {
            stream_id: format!("session:{session}"),
            stream_kind: "session".to_string(),
            expected_sequence,
            event_type: "MessageSubmitted".to_string(),
            event_version: 2,
            scope: event_scope,
            actor: EventActor {
                actor_id: ctx.actor_id,
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&payload).unwrap(),
            metadata_json: b"{}".to_vec(),
        },
    )
    .await
    .unwrap();
    ConversationProjection::insert_message_tx(
        &mut tx,
        &message_id.to_string(),
        ws,
        proj,
        session,
        "user",
        &content_id.to_string(),
        &append.event_id.to_string(),
        append.global_position,
        now_us() + expected_sequence as i64,
        reference,
    )
    .await
    .unwrap();
    if !attachment_ids.is_empty() {
        let ids: Vec<AttachmentId> = attachment_ids
            .iter()
            .map(|id| AttachmentId::from_string(id).unwrap())
            .collect();
        SqliteEventStore::link_attachments_to_message_tx(&mut tx, &message_id, &ids)
            .await
            .unwrap();
    }
    tx.commit().await.unwrap();
    (message_id.to_string(), content_id.to_string())
}

async fn append_assistant(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session: &str,
    text: &str,
) -> (String, String) {
    let mut tx = ctx.pool.begin().await.unwrap();
    let expected_sequence = next_sequence(&mut tx, session).await;
    let message_id = MessageId::new_v7();
    let content_id = ContentId::new_v7();
    let op_id = OperationId::new_v7();
    let event_scope = EventScope {
        installation_id: ctx.installation_id,
        ..scope(ctx.installation_id, ws, proj, session)
    };
    SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        "assistant_text",
        "text/plain",
        &event_scope,
        text.as_bytes(),
    )
    .await
    .unwrap();
    let completion = MessageCompletionV1::Completed { truncated: false };
    let usage = MessageUsageV1 {
        prompt_tokens: Some(10),
        completion_tokens: Some(5),
        total_tokens: Some(15),
    };
    let payload = MessageCompletedV1 {
        op_id,
        message_id,
        content_id,
        content_kind: "assistant_text".to_string(),
        size_bytes: text.len() as u64,
        completion,
        usage: Some(usage.clone()),
    };
    let append = SqliteEventStore::append_event_tx(
        &mut tx,
        AppendEventRequest {
            stream_id: format!("session:{session}"),
            stream_kind: "session".to_string(),
            expected_sequence,
            event_type: EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED.to_string(),
            event_version: 1,
            scope: event_scope,
            actor: EventActor {
                actor_id: ctx.actor_id,
                kind: ActorKind::System,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&payload).unwrap(),
            metadata_json: b"{}".to_vec(),
        },
    )
    .await
    .unwrap();
    ConversationProjection::insert_assistant_completion_tx(
        &mut tx,
        &message_id.to_string(),
        ws,
        proj,
        session,
        &op_id.to_string(),
        &content_id.to_string(),
        &serde_json::to_string(&completion).unwrap(),
        Some(&serde_json::to_string(&usage).unwrap()),
        &append.event_id.to_string(),
        append.global_position,
        now_us() + expected_sequence as i64,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    (message_id.to_string(), content_id.to_string())
}

async fn get_messages(ctx: &ApiContext, session: &str) -> Vec<ConversationMessageView> {
    ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &SessionId::from_string(session).unwrap(),
    )
    .await
    .unwrap()
}

fn duplicate_env(
    ws: &str,
    proj: &str,
    session: &str,
    request_id: &str,
    title: Option<&str>,
) -> CommandEnvelope<DuplicateSessionPayload> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: request_id.to_string(),
        context: context(ws, proj, session),
        payload: DuplicateSessionPayload {
            title: title.map(str::to_string),
        },
    }
}

async fn session_count(ctx: &ApiContext, project: &str) -> i64 {
    sqlx::query_scalar(
        "SELECT COUNT(*) FROM events WHERE project_id = ? AND event_type = 'SessionCreated'",
    )
    .bind(project)
    .fetch_one(&ctx.pool)
    .await
    .unwrap()
}

async fn insert_pending(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session_id: Option<&str>,
    create_request_id: Option<&str>,
    status: &str,
) -> String {
    let id = OperationId::new_v7().to_string();
    let now = now_us();
    sqlx::query(
        "INSERT INTO pending_operations (operation_id, kind, workspace_id, project_id, session_id,
         create_request_id, message_request_id, content_id, status, created_at_us, updated_at_us)
         VALUES (?, 'completion', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(&id)
    .bind(ws)
    .bind(proj)
    .bind(session_id)
    .bind(create_request_id)
    .bind(RequestId::new_v7().to_string())
    .bind(ContentId::new_v7().to_string())
    .bind(status)
    .bind(now)
    .bind(now)
    .execute(&ctx.pool)
    .await
    .unwrap();
    id
}

#[tokio::test]
async fn duplicate_copies_all_branches_and_remaps_refs_and_bookmarks() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Branchy")).await;

    let (u1, _) = append_user(&ctx, &ws, &proj, &source, "original prompt", None, &[]).await;
    let _a1 = append_assistant(&ctx, &ws, &proj, &source, "original answer").await;
    let (u2, _) = append_user(
        &ctx,
        &ws,
        &proj,
        &source,
        "edited prompt",
        Some((&u1, "edited-from")),
        &[],
    )
    .await;
    let (a2, _) = append_assistant(&ctx, &ws, &proj, &source, "edited answer").await;
    let now = now_us();
    sqlx::query(
        "INSERT INTO message_bookmarks (session_id, message_id, created_at_us) VALUES (?, ?, ?)",
    )
    .bind(&source)
    .bind(&u1)
    .bind(now)
    .execute(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO message_bookmarks (session_id, message_id, created_at_us) VALUES (?, ?, ?)",
    )
    .bind(&source)
    .bind(&a2)
    .bind(now + 1)
    .execute(&ctx.pool)
    .await
    .unwrap();
    sqlx::query("INSERT INTO answer_feedback (session_id, message_id, verdict, updated_at_us) VALUES (?, ?, 'like', ?)")
        .bind(&source)
        .bind(&a2)
        .bind(now)
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO branch_selections (session_id, root_message_id, active_message_id, updated_at_us) VALUES (?, ?, ?, ?)")
        .bind(&source)
        .bind(&u1)
        .bind(&u2)
        .bind(now)
        .execute(&ctx.pool)
        .await
        .unwrap();
    handle_set_session_pinned(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(&ws, &proj, &source),
            payload: SetSessionPinnedPayload { pinned: true },
        },
    )
    .await
    .unwrap();
    handle_set_session_archived(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(&ws, &proj, &source),
            payload: SetSessionArchivedPayload { archived: true },
        },
    )
    .await
    .unwrap();

    let copy = handle_duplicate_session(
        &ctx,
        duplicate_env(
            &ws,
            &proj,
            &source,
            &RequestId::new_v7().to_string(),
            Some("Branchy copy"),
        ),
    )
    .await
    .unwrap()
    .data;
    assert_eq!(copy.title.as_deref(), Some("Branchy copy"));
    assert!(!copy.pinned);
    assert!(!copy.archived);

    let copy_rows = get_messages(&ctx, &copy.session_id).await;
    assert_eq!(
        copy_rows
            .iter()
            .map(|r| r.content.as_str())
            .collect::<Vec<_>>(),
        vec![
            "original prompt",
            "original answer",
            "edited prompt",
            "edited answer"
        ]
    );
    let copy_u1 = &copy_rows[0].message_id;
    assert_eq!(
        copy_rows[2].refers_to_message_id.as_deref(),
        Some(copy_u1.as_str())
    );
    assert_eq!(
        copy_rows[2].refers_to_relation.as_deref(),
        Some("edited-from")
    );
    assert_eq!(copy_rows[3].usage.as_ref().unwrap().total_tokens, Some(15));

    let bookmarks: Vec<String> = sqlx::query_scalar(
        "SELECT message_id FROM message_bookmarks WHERE session_id = ? ORDER BY message_id",
    )
    .bind(&copy.session_id)
    .fetch_all(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(bookmarks.len(), 2);
    assert!(bookmarks.contains(&copy_rows[0].message_id));
    assert!(bookmarks.contains(&copy_rows[3].message_id));
    assert!(!bookmarks.contains(&u1));
    let feedback: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM answer_feedback WHERE session_id = ?")
            .bind(&copy.session_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(feedback, 0);
    let selections: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM branch_selections WHERE session_id = ?")
            .bind(&copy.session_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(selections, 0);
    let active = active_branch_rows(copy_rows.clone(), &[]);
    assert_eq!(
        active
            .iter()
            .map(|r| r.content.as_str())
            .collect::<Vec<_>>(),
        vec!["edited prompt", "edited answer"]
    );

    let listed = list_sessions(
        &ctx,
        &proj,
        Some(&ws),
        &ListSessionsOptions {
            include_archived: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let source_row = listed
        .sessions
        .iter()
        .find(|s| s.session_id == source)
        .unwrap();
    assert!(source_row.pinned);
    assert!(source_row.archived);
    assert_eq!(get_messages(&ctx, &source).await.len(), 4);

    ConversationProjection::rebuild(&ctx.pool).await.unwrap();
    let rebuilt = get_messages(&ctx, &copy.session_id).await;
    assert_eq!(rebuilt.len(), 4);
    assert_eq!(
        rebuilt[2].refers_to_message_id.as_deref(),
        Some(copy_u1.as_str())
    );

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn duplicate_refuses_pending_and_null_session_first_send() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Busy")).await;
    let create_request: String = sqlx::query_scalar(
        "SELECT request_id FROM events WHERE stream_id = ? AND event_type = 'SessionCreated' LIMIT 1",
    )
    .bind(format!("session:{source}"))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let pending = insert_pending(&ctx, &ws, &proj, None, Some(&create_request), "pending").await;
    let before = session_count(&ctx, &proj).await;

    let err = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect_err("pending first send blocks");
    assert!(err.contains("SESSION_BUSY"), "{err}");
    assert_eq!(session_count(&ctx, &proj).await, before);

    sqlx::query("UPDATE pending_operations SET status = 'resolved' WHERE operation_id = ?")
        .bind(&pending)
        .execute(&ctx.pool)
        .await
        .unwrap();
    handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect("resolved rows do not block");
    assert_eq!(session_count(&ctx, &proj).await, before + 1);

    sqlx::query("UPDATE pending_operations SET status = 'pending', session_id = ?, create_request_id = NULL WHERE operation_id = ?")
        .bind(&source)
        .bind(&pending)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let err = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect_err("session pending blocks");
    assert!(err.contains("SESSION_BUSY"), "{err}");
    assert_eq!(session_count(&ctx, &proj).await, before + 1);

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn duplicate_refuses_over_500_messages_or_5_mb() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let many = create_test_session(&ctx, &ws, &proj, Some("Many")).await;
    let mut tx = ctx.pool.begin().await.unwrap();
    for index in 0..501i64 {
        sqlx::query(
            "INSERT INTO conversation_messages (message_id, workspace_id, project_id, session_id, role,
             content_id, source_event_id, source_global_position, created_at_us)
             VALUES (?, ?, ?, ?, 'user', ?, ?, ?, ?)",
        )
        .bind(MessageId::new_v7().to_string())
        .bind(&ws)
        .bind(&proj)
        .bind(&many)
        .bind(ContentId::new_v7().to_string())
        .bind(EventId::new_v7().to_string())
        .bind(index)
        .bind(now_us() + index)
        .execute(&mut *tx)
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();
    let err = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &many, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect_err("message cap");
    assert!(err.contains("DUPLICATE_TOO_LARGE"), "{err}");

    let huge = create_test_session(&ctx, &ws, &proj, Some("Huge")).await;
    let content_id = ContentId::new_v7();
    sqlx::query(
        "INSERT INTO content_records (content_id, content_kind, media_type, encoding, protection_scheme,
         key_reference, nonce, protected_bytes, plaintext_size, created_at_us)
         VALUES (?, 'user_text', 'text/plain', 'encrypted', 'aead-xchacha20poly1305-v1', NULL, X'', X'', ?, ?)",
    )
    .bind(content_id.to_string())
    .bind(5_242_881i64)
    .bind(now_us())
    .execute(&ctx.pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO conversation_messages (message_id, workspace_id, project_id, session_id, role,
         content_id, source_event_id, source_global_position, created_at_us)
         VALUES (?, ?, ?, ?, 'user', ?, ?, 0, ?)",
    )
    .bind(MessageId::new_v7().to_string())
    .bind(&ws)
    .bind(&proj)
    .bind(&huge)
    .bind(content_id.to_string())
    .bind(EventId::new_v7().to_string())
    .bind(now_us())
    .execute(&ctx.pool)
    .await
    .unwrap();
    let before = session_count(&ctx, &proj).await;
    let err = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &huge, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect_err("plaintext cap");
    assert!(err.contains("DUPLICATE_TOO_LARGE"), "{err}");
    assert_eq!(session_count(&ctx, &proj).await, before);

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn duplicate_receipt_replay_returns_the_same_new_session() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Original")).await;
    append_user(&ctx, &ws, &proj, &source, "hello", None, &[]).await;
    let request_id = RequestId::new_v7().to_string();
    let before = session_count(&ctx, &proj).await;

    let first = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &request_id, Some("Replay copy")),
    )
    .await
    .unwrap()
    .data;
    let second = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &request_id, Some("Replay copy")),
    )
    .await
    .unwrap()
    .data;
    assert_eq!(first.session_id, second.session_id);
    assert_eq!(session_count(&ctx, &proj).await, before + 1);
    assert_eq!(get_messages(&ctx, &first.session_id).await.len(), 1);

    let conflict = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &request_id, Some("Different")),
    )
    .await
    .expect_err("same request id, different title");
    assert!(conflict.contains("REQUEST_ID_CONFLICT"), "{conflict}");

    let fallback = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &RequestId::new_v7().to_string(), None),
    )
    .await
    .unwrap()
    .data;
    assert_eq!(fallback.title.as_deref(), Some("Original copy"));

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn duplicate_copies_only_linked_attachments() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Files")).await;
    let linked = ingest_text_attachment(
        &ctx,
        &context(&ws, &proj, &source),
        "linked.md",
        b"linked attachment text",
    )
    .await
    .unwrap();
    let unlinked = ingest_text_attachment(
        &ctx,
        &context(&ws, &proj, &source),
        "unlinked.md",
        b"unlinked attachment text",
    )
    .await
    .unwrap();
    append_user(
        &ctx,
        &ws,
        &proj,
        &source,
        "see attached",
        None,
        std::slice::from_ref(&linked.attachment_id),
    )
    .await;

    let copy = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &RequestId::new_v7().to_string(), None),
    )
    .await
    .unwrap()
    .data;
    assert_eq!(copy.title.as_deref(), Some("Files copy"));

    let rows = sqlx::query(
        "SELECT attachment_id, content_id, file_name FROM attachment_records WHERE session_id = ?",
    )
    .bind(&copy.session_id)
    .fetch_all(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    let copy_attachment = rows[0].get::<String, _>("attachment_id");
    assert_ne!(copy_attachment, linked.attachment_id);
    assert_ne!(copy_attachment, unlinked.attachment_id);
    assert_eq!(rows[0].get::<String, _>("file_name"), "linked.md");
    let link_count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM message_attachments ma JOIN conversation_messages cm ON cm.message_id = ma.message_id WHERE cm.session_id = ?",
    )
    .bind(&copy.session_id)
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert_eq!(link_count, 1);

    let bytes = ctx
        .store
        .get_content(
            ctx.content_key.as_ref(),
            &ContentId::from_string(&rows[0].get::<String, _>("content_id")).unwrap(),
            &scope(ctx.installation_id, &ws, &proj, &copy.session_id),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(String::from_utf8(bytes).unwrap(), "linked attachment text");

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn duplicate_fails_on_missing_or_unreadable_content() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;

    let missing = create_test_session(&ctx, &ws, &proj, Some("Missing")).await;
    let (_, missing_content) =
        append_user(&ctx, &ws, &proj, &missing, "missing content", None, &[]).await;
    sqlx::query("DELETE FROM content_records WHERE content_id = ?")
        .bind(&missing_content)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let before = session_count(&ctx, &proj).await;
    let err = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &missing, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect_err("missing content");
    assert!(err.contains("STORAGE_REPAIR_REQUIRED"), "{err}");
    assert_eq!(session_count(&ctx, &proj).await, before);

    let unreadable = create_test_session(&ctx, &ws, &proj, Some("Unreadable")).await;
    let (_, unreadable_content) = append_user(
        &ctx,
        &ws,
        &proj,
        &unreadable,
        "unreadable content",
        None,
        &[],
    )
    .await;
    sqlx::query("UPDATE content_records SET protected_bytes = X'00' WHERE content_id = ?")
        .bind(&unreadable_content)
        .execute(&ctx.pool)
        .await
        .unwrap();
    let before = session_count(&ctx, &proj).await;
    let err = handle_duplicate_session(
        &ctx,
        duplicate_env(
            &ws,
            &proj,
            &unreadable,
            &RequestId::new_v7().to_string(),
            None,
        ),
    )
    .await
    .expect_err("unreadable content");
    assert!(err.contains("STORAGE_REPAIR_REQUIRED"), "{err}");
    assert_eq!(session_count(&ctx, &proj).await, before);

    let summary = create_test_session(&ctx, &ws, &proj, Some("Summary")).await;
    append_user(&ctx, &ws, &proj, &summary, "summary source", None, &[]).await;
    handle_set_session_summary(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(&ws, &proj, &summary),
            payload: SetSessionSummaryPayload {
                summary: Some("custom summary".to_string()),
            },
        },
    )
    .await
    .unwrap();
    let payload: Vec<u8> = sqlx::query_scalar(
        "SELECT payload_json FROM events WHERE stream_id = ? AND event_type = 'SessionSummaryUpdated' ORDER BY global_position DESC LIMIT 1",
    )
    .bind(format!("session:{summary}"))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    let update: SessionSummaryUpdatedV1 = serde_json::from_slice(&payload).unwrap();
    sqlx::query("DELETE FROM content_records WHERE content_id = ?")
        .bind(update.content_id.unwrap().to_string())
        .execute(&ctx.pool)
        .await
        .unwrap();
    let before = session_count(&ctx, &proj).await;
    let err = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &summary, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect_err("missing summary content");
    assert!(err.contains("STORAGE_REPAIR_REQUIRED"), "{err}");
    assert_eq!(session_count(&ctx, &proj).await, before);

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn duplicate_reseals_content_under_the_new_session_scope() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let source = create_test_session(&ctx, &ws, &proj, Some("Sealed")).await;
    let attachment = ingest_text_attachment(
        &ctx,
        &context(&ws, &proj, &source),
        "sealed.md",
        b"sealed attachment text",
    )
    .await
    .unwrap();
    append_user(
        &ctx,
        &ws,
        &proj,
        &source,
        "sealed user text",
        None,
        std::slice::from_ref(&attachment.attachment_id),
    )
    .await;
    append_assistant(&ctx, &ws, &proj, &source, "sealed assistant text").await;
    handle_set_session_summary(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(&ws, &proj, &source),
            payload: SetSessionSummaryPayload {
                summary: Some("sealed summary".to_string()),
            },
        },
    )
    .await
    .unwrap();

    let copy = handle_duplicate_session(
        &ctx,
        duplicate_env(&ws, &proj, &source, &RequestId::new_v7().to_string(), None),
    )
    .await
    .unwrap()
    .data;
    let source_rows =
        sqlx::query("SELECT content_id, content_kind FROM content_records WHERE session_id = ?")
            .bind(&source)
            .fetch_all(&ctx.pool)
            .await
            .unwrap();
    let copy_rows =
        sqlx::query("SELECT content_id, content_kind FROM content_records WHERE session_id = ?")
            .bind(&copy.session_id)
            .fetch_all(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(source_rows.len(), 4);
    assert_eq!(copy_rows.len(), 4);
    let source_ids: Vec<String> = source_rows.iter().map(|r| r.get("content_id")).collect();
    let source_scope = scope(ctx.installation_id, &ws, &proj, &source);
    let copy_scope = scope(ctx.installation_id, &ws, &proj, &copy.session_id);
    for row in &copy_rows {
        let id_str: String = row.get("content_id");
        assert!(!source_ids.contains(&id_str));
        let id = ContentId::from_string(&id_str).unwrap();
        assert!(
            ctx.store
                .get_content(ctx.content_key.as_ref(), &id, &copy_scope)
                .await
                .unwrap()
                .is_some()
        );
        assert!(
            ctx.store
                .get_content(ctx.content_key.as_ref(), &id, &source_scope)
                .await
                .is_err()
        );
    }
    for kind in [
        "user_text",
        "assistant_text",
        "attachment_text",
        "session_summary",
    ] {
        let source_cipher: Vec<u8> = sqlx::query_scalar(
            "SELECT protected_bytes FROM content_records WHERE session_id = ? AND content_kind = ?",
        )
        .bind(&source)
        .bind(kind)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        let copy_cipher: Vec<u8> = sqlx::query_scalar(
            "SELECT protected_bytes FROM content_records WHERE session_id = ? AND content_kind = ?",
        )
        .bind(&copy.session_id)
        .bind(kind)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
        assert_ne!(source_cipher, copy_cipher, "{kind} must be resealed");
    }

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}
