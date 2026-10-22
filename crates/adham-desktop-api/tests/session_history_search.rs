//! Search matrix: filters, scopes, snippets, unreadable content, and caps.
mod common;
use common::*;

use adham_core_types::history::*;
use adham_core_types::*;
use adham_desktop_api::*;
use adham_event_log::{AppendEventRequest, ContentKeyProvider, InMemoryProvider, SqliteEventStore};
use adham_projections::ConversationProjection;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use time::OffsetDateTime;

fn context(ws: &str, proj: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: None,
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

async fn create_named_session(ctx: &ApiContext, ws: &str, proj: &str, title: &str) -> String {
    handle_create_session(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(ws, proj),
            payload: CreateSessionPayload {
                title: Some(title.to_string()),
            },
        },
    )
    .await
    .unwrap()
    .data
    .session_id
}

async fn seed_message(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session: &str,
    role: &str,
    text: &str,
    position: i64,
) -> (String, String) {
    let mut tx = ctx.pool.begin().await.unwrap();
    let content_id = ContentId::new_v7();
    let message_id = MessageId::new_v7().to_string();
    let event_scope = scope(ctx.installation_id, ws, proj, session);
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
        &event_scope,
        text.as_bytes(),
    )
    .await
    .unwrap();
    ConversationProjection::insert_message_tx(
        &mut tx,
        &message_id,
        ws,
        proj,
        session,
        role,
        &content_id.to_string(),
        &uuid::Uuid::now_v7().to_string(),
        position,
        now_us() + position,
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    (message_id, content_id.to_string())
}

async fn seed_unreadable_message(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session: &str,
    role: &str,
    position: i64,
) -> String {
    let mut tx = ctx.pool.begin().await.unwrap();
    let message_id = MessageId::new_v7().to_string();
    ConversationProjection::insert_message_tx(
        &mut tx,
        &message_id,
        ws,
        proj,
        session,
        role,
        &ContentId::new_v7().to_string(),
        &uuid::Uuid::now_v7().to_string(),
        position,
        now_us() + position,
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    message_id
}

async fn append_deleted(ctx: &ApiContext, ws: &str, proj: &str, session: &str) {
    let mut tx = ctx.pool.begin().await.unwrap();
    let current: Option<i64> =
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
            expected_sequence: current.unwrap_or(0) as u64,
            event_type: EVENT_TYPE_SESSION_DELETED.to_string(),
            event_version: 1,
            scope: scope(ctx.installation_id, ws, proj, session),
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

async fn search(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    query: &str,
    filters: SessionSearchFilters,
) -> Result<SessionSearchResponse, String> {
    handle_search_history(
        ctx,
        context(ws, proj),
        SessionSearchRequest {
            query: query.to_string(),
            filters,
        },
    )
    .await
}

#[tokio::test]
async fn search_matches_title_summary_message_and_linked_attachment_only() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Search").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;

    create_named_session(&ctx, &ws, &proj, "Needle title").await;
    let summary_session = create_named_session(&ctx, &ws, &proj, "Summary row").await;
    seed_message(&ctx, &ws, &proj, &summary_session, "user", "hello", 1).await;
    handle_set_session_summary(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: Some(summary_session.clone()),
            },
            payload: SetSessionSummaryPayload {
                summary: Some("needle summary".to_string()),
            },
        },
    )
    .await
    .unwrap();

    let message_session = create_named_session(&ctx, &ws, &proj, "Message row").await;
    seed_message(
        &ctx,
        &ws,
        &proj,
        &message_session,
        "user",
        "prefix NeEdLe suffix",
        2,
    )
    .await;

    let attachment_session = create_named_session(&ctx, &ws, &proj, "Attachment row").await;
    let (attachment_message, _) = seed_message(
        &ctx,
        &ws,
        &proj,
        &attachment_session,
        "assistant",
        "hello",
        3,
    )
    .await;
    let attachment = handle_ingest_attachment(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: Some(attachment_session.clone()),
            },
            payload: IngestAttachmentPayload {
                file_name: "needle.txt".to_string(),
                text: "attachment body".to_string(),
            },
        },
    )
    .await
    .unwrap()
    .data;
    sqlx::query(
        "INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, 0)",
    )
    .bind(&attachment_message)
    .bind(&attachment.attachment_id)
    .execute(&ctx.pool)
    .await
    .unwrap();

    let unlinked_session = create_named_session(&ctx, &ws, &proj, "Unlinked row").await;
    handle_ingest_attachment(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: Some(unlinked_session.clone()),
            },
            payload: IngestAttachmentPayload {
                file_name: "needle-unlinked.txt".to_string(),
                text: "not linked".to_string(),
            },
        },
    )
    .await
    .unwrap();

    let response = search(&ctx, &ws, &proj, "needle", SessionSearchFilters::default())
        .await
        .unwrap();
    let kinds: Vec<&str> = response
        .results
        .iter()
        .map(|result| result.match_kind.as_str())
        .collect();
    assert!(kinds.contains(&"title"));
    assert!(kinds.contains(&"summary"));
    assert!(kinds.contains(&"message"));
    assert!(kinds.contains(&"attachment"));
    assert!(
        response
            .results
            .iter()
            .all(|result| result.attachment_name.as_deref() != Some("needle-unlinked.txt"))
    );
    let message = response
        .results
        .iter()
        .find(|result| result.match_kind == "message")
        .unwrap();
    let snippet = message.snippet.as_deref().unwrap();
    assert!(snippet.to_lowercase().contains("needle"));
    assert!(snippet.chars().count() <= 180);
    assert_eq!(response.scanned_sessions, 5);
    assert_eq!(response.skipped_unreadable, 0);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn empty_query_requires_a_filter_and_bookmarks_are_message_level() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Empty").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;

    let pinned = create_named_session(&ctx, &ws, &proj, "Pinned").await;
    handle_set_session_pinned(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: Some(pinned.clone()),
            },
            payload: SetSessionPinnedPayload { pinned: true },
        },
    )
    .await
    .unwrap();

    let bookmarked = create_named_session(&ctx, &ws, &proj, "Bookmarked").await;
    let (message_id, _) =
        seed_message(&ctx, &ws, &proj, &bookmarked, "user", "saved text", 10).await;
    handle_set_message_bookmark(
        &ctx,
        CommandContext {
            workspace_id: Some(ws.clone()),
            project_id: Some(proj.clone()),
            session_id: Some(bookmarked.clone()),
        },
        SetMessageBookmarkPayload {
            message_id: message_id.clone(),
            bookmarked: true,
        },
    )
    .await
    .unwrap();

    let pinned_only = search(
        &ctx,
        &ws,
        &proj,
        "",
        SessionSearchFilters {
            pinned_only: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(pinned_only.results.len(), 1);
    assert_eq!(pinned_only.results[0].match_kind, "session");

    let bookmarks = search(
        &ctx,
        &ws,
        &proj,
        "",
        SessionSearchFilters {
            bookmarked_only: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(bookmarks.results.len(), 1);
    assert_eq!(bookmarks.results[0].match_kind, "bookmark");
    assert_eq!(
        bookmarks.results[0].message_id.as_deref(),
        Some(message_id.as_str())
    );

    let err = search(&ctx, &ws, &proj, "", SessionSearchFilters::default())
        .await
        .expect_err("empty query needs a filter");
    assert!(err.contains("VALIDATION_FAILED:empty_query"), "{err}");
    let err = search(
        &ctx,
        &ws,
        &proj,
        "",
        SessionSearchFilters {
            include_archived: true,
            ..Default::default()
        },
    )
    .await
    .expect_err("include archived alone is not a filter");
    assert!(err.contains("VALIDATION_FAILED:empty_query"), "{err}");

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn query_role_and_date_validation_are_specific() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Validation").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;

    let err = search(
        &ctx,
        &ws,
        &proj,
        "",
        SessionSearchFilters {
            role: Some("user".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect_err("role needs a query");
    assert!(
        err.contains("VALIDATION_FAILED:role_requires_query"),
        "{err}"
    );
    let err = search(
        &ctx,
        &ws,
        &proj,
        "needle",
        SessionSearchFilters {
            role: Some("agent".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect_err("unknown role");
    assert!(err.contains("VALIDATION_FAILED:role"), "{err}");
    let err = search(&ctx, &ws, &proj, " a ", SessionSearchFilters::default())
        .await
        .expect_err("short query");
    assert!(err.contains("VALIDATION_FAILED:query_too_short"), "{err}");
    let err = search(
        &ctx,
        &ws,
        &proj,
        "needle",
        SessionSearchFilters {
            from: Some("not-a-date".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect_err("bad date");
    assert!(err.contains("VALIDATION_FAILED:date_range"), "{err}");
    let err = search(
        &ctx,
        &ws,
        &proj,
        "needle",
        SessionSearchFilters {
            from: Some("2026-10-22T00:00:00Z".to_string()),
            to: Some("2026-10-21T00:00:00Z".to_string()),
            ..Default::default()
        },
    )
    .await
    .expect_err("reversed date");
    assert!(err.contains("VALIDATION_FAILED:date_range"), "{err}");

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn role_and_bookmark_filters_exclude_title_and_summary_matches() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Kinds").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let session = create_named_session(&ctx, &ws, &proj, "needle title").await;
    let (user_message, _) =
        seed_message(&ctx, &ws, &proj, &session, "user", "needle question", 20).await;
    seed_message(&ctx, &ws, &proj, &session, "assistant", "needle answer", 21).await;
    handle_set_message_bookmark(
        &ctx,
        CommandContext {
            workspace_id: Some(ws.clone()),
            project_id: Some(proj.clone()),
            session_id: Some(session.clone()),
        },
        SetMessageBookmarkPayload {
            message_id: user_message.clone(),
            bookmarked: true,
        },
    )
    .await
    .unwrap();

    let assistant = search(
        &ctx,
        &ws,
        &proj,
        "needle",
        SessionSearchFilters {
            role: Some("assistant".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(assistant.results.iter().all(
        |result| result.match_kind == "message" && result.role.as_deref() == Some("assistant")
    ));
    assert!(!assistant.results.is_empty());

    let bookmarked = search(
        &ctx,
        &ws,
        &proj,
        "needle",
        SessionSearchFilters {
            bookmarked_only: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(bookmarked.results.len(), 1);
    assert_eq!(bookmarked.results[0].match_kind, "message");
    assert_eq!(
        bookmarked.results[0].message_id.as_deref(),
        Some(user_message.as_str())
    );

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn unlinked_attachments_are_excluded_and_unreadable_rows_are_counted() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Unreadable").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let session = create_named_session(&ctx, &ws, &proj, "Unreadable").await;
    seed_message(&ctx, &ws, &proj, &session, "user", "needle readable", 30).await;
    seed_unreadable_message(&ctx, &ws, &proj, &session, "assistant", 31).await;

    let (anchor, _) = seed_message(&ctx, &ws, &proj, &session, "user", "anchor", 32).await;
    let missing_attachment = handle_ingest_attachment(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: Some(session.clone()),
            },
            payload: IngestAttachmentPayload {
                file_name: "other.txt".to_string(),
                text: "needle in missing attachment".to_string(),
            },
        },
    )
    .await
    .unwrap()
    .data;
    sqlx::query(
        "INSERT INTO message_attachments (message_id, attachment_id, position) VALUES (?, ?, 0)",
    )
    .bind(&anchor)
    .bind(&missing_attachment.attachment_id)
    .execute(&ctx.pool)
    .await
    .unwrap();
    let missing_content_id: String =
        sqlx::query_scalar("SELECT content_id FROM attachment_records WHERE attachment_id = ?")
            .bind(&missing_attachment.attachment_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    sqlx::query("DELETE FROM content_records WHERE content_id = ?")
        .bind(&missing_content_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    handle_ingest_attachment(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: Some(session.clone()),
            },
            payload: IngestAttachmentPayload {
                file_name: "needle-unlinked.txt".to_string(),
                text: "needle".to_string(),
            },
        },
    )
    .await
    .unwrap();

    let response = search(&ctx, &ws, &proj, "needle", SessionSearchFilters::default())
        .await
        .unwrap();
    let messages: Vec<_> = response
        .results
        .iter()
        .filter(|result| result.match_kind == "message")
        .collect();
    assert_eq!(messages.len(), 1);
    assert!(
        response
            .results
            .iter()
            .all(|result| result.match_kind != "attachment")
    );
    assert!(
        response.skipped_unreadable >= 2,
        "{}",
        response.skipped_unreadable
    );

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn search_is_case_insensitive_bounded_and_searches_all_branch_rows() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Snippet").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let session = create_named_session(&ctx, &ws, &proj, "Snippet").await;
    let padded = format!("{}NeEdLe{}", "x".repeat(220), "y".repeat(220));
    seed_message(&ctx, &ws, &proj, &session, "user", &padded, 40).await;
    seed_message(
        &ctx,
        &ws,
        &proj,
        &session,
        "assistant",
        "another needle row",
        41,
    )
    .await;

    let response = search(&ctx, &ws, &proj, "needle", SessionSearchFilters::default())
        .await
        .unwrap();
    let messages: Vec<_> = response
        .results
        .iter()
        .filter(|result| result.match_kind == "message")
        .collect();
    assert_eq!(messages.len(), 2);
    for result in messages {
        let snippet = result.snippet.as_deref().unwrap();
        assert!(snippet.to_lowercase().contains("needle"));
        assert!(
            snippet.chars().count() <= 180,
            "{}",
            snippet.chars().count()
        );
    }

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn archived_filter_and_deleted_sessions_are_honored() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Archive").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let archived = create_named_session(&ctx, &ws, &proj, "needle archived").await;
    seed_message(
        &ctx,
        &ws,
        &proj,
        &archived,
        "user",
        "needle archived body",
        50,
    )
    .await;
    handle_set_session_archived(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: Some(archived.clone()),
            },
            payload: SetSessionArchivedPayload { archived: true },
        },
    )
    .await
    .unwrap();
    let deleted = create_named_session(&ctx, &ws, &proj, "needle deleted").await;
    seed_message(
        &ctx,
        &ws,
        &proj,
        &deleted,
        "user",
        "needle deleted body",
        51,
    )
    .await;
    append_deleted(&ctx, &ws, &proj, &deleted).await;

    let default_search = search(&ctx, &ws, &proj, "needle", SessionSearchFilters::default())
        .await
        .unwrap();
    assert!(
        default_search
            .results
            .iter()
            .all(|result| result.session_id != archived)
    );
    assert!(
        default_search
            .results
            .iter()
            .all(|result| result.session_id != deleted)
    );

    let with_archived = search(
        &ctx,
        &ws,
        &proj,
        "needle",
        SessionSearchFilters {
            include_archived: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(
        with_archived
            .results
            .iter()
            .any(|result| result.session_id == archived)
    );
    assert!(
        with_archived
            .results
            .iter()
            .all(|result| result.session_id != deleted)
    );

    let _ = std::fs::remove_file(&db_path);
}

struct CountingProvider {
    inner: InMemoryProvider,
    calls: Arc<AtomicUsize>,
}

impl ContentKeyProvider for CountingProvider {
    fn content_key(&self) -> Result<[u8; 32], DomainError> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        self.inner.content_key()
    }

    fn key_reference(&self) -> String {
        self.inner.key_reference()
    }
}

#[tokio::test]
async fn search_uses_one_key_read_for_all_plaintext() {
    let db_path = test_db_path();
    let calls = Arc::new(AtomicUsize::new(0));
    let provider: Arc<dyn ContentKeyProvider> = Arc::new(CountingProvider {
        inner: InMemoryProvider::generate(),
        calls: Arc::clone(&calls),
    });
    let ctx = setup_ctx_with_key(&db_path, provider).await;
    let ws = create_test_workspace(&ctx, "Key").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let session = create_named_session(&ctx, &ws, &proj, "Key").await;
    seed_message(&ctx, &ws, &proj, &session, "user", "needle body", 60).await;

    calls.store(0, Ordering::SeqCst);
    let response = search(&ctx, &ws, &proj, "needle", SessionSearchFilters::default())
        .await
        .unwrap();
    assert!(
        response
            .results
            .iter()
            .any(|result| result.match_kind == "message")
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn result_and_session_caps_are_reported() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "Caps").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;

    for index in 0..101 {
        let session = create_named_session(&ctx, &ws, &proj, &format!("Pinned {index}")).await;
        handle_set_session_pinned(
            &ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: CommandContext {
                    workspace_id: Some(ws.clone()),
                    project_id: Some(proj.clone()),
                    session_id: Some(session),
                },
                payload: SetSessionPinnedPayload { pinned: true },
            },
        )
        .await
        .unwrap();
    }
    let response = search(
        &ctx,
        &ws,
        &proj,
        "",
        SessionSearchFilters {
            pinned_only: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(response.scanned_sessions, 100);
    assert_eq!(response.results.len(), 50);
    assert!(response.truncated);

    let _ = std::fs::remove_file(&db_path);
}

#[tokio::test]
async fn scan_limit_stops_at_ten_thousand_message_rows() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "ScanCap").await;
    let proj = create_test_project(&ctx, &ws, "Project").await;
    let session = create_named_session(&ctx, &ws, &proj, "ScanCap").await;
    let mut tx = ctx.pool.begin().await.unwrap();
    for index in 0..10_001 {
        ConversationProjection::insert_message_tx(
            &mut tx,
            &MessageId::new_v7().to_string(),
            &ws,
            &proj,
            &session,
            "user",
            &ContentId::new_v7().to_string(),
            &uuid::Uuid::now_v7().to_string(),
            index,
            now_us() + index,
            None,
        )
        .await
        .unwrap();
    }
    tx.commit().await.unwrap();

    let response = search(&ctx, &ws, &proj, "needle", SessionSearchFilters::default())
        .await
        .unwrap();
    assert!(response.scan_limit_reached);
    assert!(response.results.is_empty());
    assert!(response.skipped_unreadable >= 10_000);

    let _ = std::fs::remove_file(&db_path);
}
