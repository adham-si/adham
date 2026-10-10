mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;
use adham_event_log::create_sqlite_pool;

async fn submit(
    ctx: &ApiContext,
    request_id: &str,
    ws: &str,
    proj: &str,
    sess: &str,
    text: &str,
) -> Result<CommandResult<SubmittedMessage>, String> {
    handle_submit_message(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: request_id.to_string(),
            context: CommandContext {
                workspace_id: Some(ws.to_string()),
                project_id: Some(proj.to_string()),
                session_id: Some(sess.to_string()),
            },
            payload: SubmitMessagePayload {
                text: text.to_string(),
            },
        },
    )
    .await
}

async fn counts(ctx: &ApiContext) -> (i64, i64, i64, i64) {
    let events: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let content: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM content_records")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let conv: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM conversation_messages")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM command_receipts")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    (events, content, conv, receipts)
}

#[tokio::test]
async fn test_cross_scope_reuse_conflicts_without_mutation() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "ws").await;
    let proj = create_test_project(&ctx, &ws, "proj").await;
    let sess_a = create_test_session(&ctx, &ws, &proj, Some("A")).await;
    let sess_b = create_test_session(&ctx, &ws, &proj, Some("B")).await;

    let req_id = RequestId::new_v7().to_string();
    let first = submit(&ctx, &req_id, &ws, &proj, &sess_a, "Same content")
        .await
        .expect("first submit");
    let before = counts(&ctx).await;

    // Same request_id + same text in a different session must conflict,
    // not create a second message.
    let err = submit(&ctx, &req_id, &ws, &proj, &sess_b, "Same content")
        .await
        .expect_err("cross-scope reuse must conflict");
    assert!(err.contains("REQUEST_ID_CONFLICT"), "got: {err}");
    let after = counts(&ctx).await;
    assert_eq!(before, after, "conflict must not mutate any table");

    // Retry in original scope still replays the same message.
    let replay = submit(&ctx, &req_id, &ws, &proj, &sess_a, "Same content")
        .await
        .expect("replay");
    assert_eq!(replay.data.message_id, first.data.message_id);
    assert_eq!(counts(&ctx).await, after);
}

#[tokio::test]
async fn test_malformed_request_id_rejected() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "ws").await;
    let proj = create_test_project(&ctx, &ws, "proj").await;
    let sess = create_test_session(&ctx, &ws, &proj, None).await;
    let before = counts(&ctx).await;
    let err = submit(&ctx, "not-a-uuid", &ws, &proj, &sess, "hi")
        .await
        .expect_err("malformed request_id must be rejected");
    assert!(err.contains("VALIDATION_FAILED"), "got: {err}");
    assert_eq!(counts(&ctx).await, before);
}

#[tokio::test]
async fn test_installation_identity_stable_across_reopen() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let inst = ctx.installation_id.to_string();
    let actor = ctx.actor_id.to_string();
    let key = ctx.content_key.content_key().expect("export key");
    drop(ctx);

    let provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
        std::sync::Arc::new(adham_event_log::InMemoryProvider::from_key(key));
    let ctx2 = setup_ctx_with_key(&db, provider).await;
    assert_eq!(ctx2.installation_id.to_string(), inst);
    assert_eq!(ctx2.actor_id.to_string(), actor);
}

#[tokio::test]
async fn test_concurrent_init_single_identity() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");
    let mut handles = Vec::new();
    for _ in 0..8 {
        let p = pool.clone();
        handles.push(tokio::spawn(async move {
            adham_event_log::load_or_create_installation(&p)
                .await
                .expect("load_or_create")
        }));
    }
    let mut ids = Vec::new();
    let mut created_count = 0usize;
    for h in handles {
        let init = h.await.expect("join");
        if init.created {
            created_count += 1;
        }
        ids.push((
            init.record.installation_id.to_string(),
            init.record.actor_id.to_string(),
        ));
    }
    for id in &ids {
        assert_eq!(id, &ids[0]);
    }
    // Exactly one concurrent caller may win first-creation authority; that
    // winner alone is allowed to initialize the content key.
    assert_eq!(created_count, 1, "exactly one init winner expected");
    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(row_count, 1);
}

#[tokio::test]
async fn test_retry_after_commit_replays_same_message() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "ws").await;
    let proj = create_test_project(&ctx, &ws, "proj").await;
    let sess = create_test_session(&ctx, &ws, &proj, None).await;
    let req_id = RequestId::new_v7().to_string();

    // First attempt commits; response "lost" (dropped).
    let first = submit(&ctx, &req_id, &ws, &proj, &sess, "retry me")
        .await
        .expect("first");
    let before = counts(&ctx).await;

    // Retry after commit-but-before-response must replay identically.
    let second = submit(&ctx, &req_id, &ws, &proj, &sess, "retry me")
        .await
        .expect("retry");
    assert_eq!(second.data.message_id, first.data.message_id);
    assert_eq!(second.correlation_id, first.correlation_id);
    assert_eq!(counts(&ctx).await, before);
}

#[tokio::test]
async fn test_conflicting_payload_leaves_no_orphan() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "ws").await;
    let proj = create_test_project(&ctx, &ws, "proj").await;
    let sess = create_test_session(&ctx, &ws, &proj, None).await;
    let req_id = RequestId::new_v7().to_string();
    submit(&ctx, &req_id, &ws, &proj, &sess, "original")
        .await
        .expect("first");
    let before = counts(&ctx).await;
    let err = submit(&ctx, &req_id, &ws, &proj, &sess, "different")
        .await
        .expect_err("conflict");
    assert!(err.contains("REQUEST_ID_CONFLICT"), "got: {err}");
    assert_eq!(counts(&ctx).await, before);
}

#[tokio::test]
async fn test_persisted_state_contains_no_cleartext() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "ws").await;
    let proj = create_test_project(&ctx, &ws, "proj").await;
    let sess = create_test_session(&ctx, &ws, &proj, None).await;
    let secret = "canary-secret-9f27b4";
    let req_id = RequestId::new_v7().to_string();
    submit(&ctx, &req_id, &ws, &proj, &sess, secret)
        .await
        .expect("submit");

    let schemes: Vec<String> = sqlx::query_scalar("SELECT protection_scheme FROM content_records")
        .fetch_all(&ctx.pool)
        .await
        .unwrap();
    assert!(!schemes.is_empty());
    for s in &schemes {
        assert_eq!(s, adham_event_log::PROTECTION_AEAD_V1);
    }
    let blobs: Vec<Vec<u8>> = sqlx::query_scalar("SELECT protected_bytes FROM content_records")
        .fetch_all(&ctx.pool)
        .await
        .unwrap();
    for b in &blobs {
        assert!(
            !b.windows(secret.len()).any(|w| w == secret.as_bytes()),
            "cleartext found at rest"
        );
    }
    let receipts: Vec<Vec<u8>> = sqlx::query_scalar(
        "SELECT response_json FROM command_receipts WHERE command_type = 'submit_message'",
    )
    .fetch_all(&ctx.pool)
    .await
    .unwrap();
    assert!(!receipts.is_empty());
    for r in &receipts {
        assert!(
            !r.windows(secret.len()).any(|w| w == secret.as_bytes()),
            "cleartext found in receipt"
        );
    }
}

#[tokio::test]
async fn test_deleted_content_retry_fails_cleanly_without_duplicate() {
    let db = test_db_path();
    let ctx = setup_ctx(&db).await;
    let ws = create_test_workspace(&ctx, "ws").await;
    let proj = create_test_project(&ctx, &ws, "proj").await;
    let sess = create_test_session(&ctx, &ws, &proj, None).await;
    let req_id = RequestId::new_v7().to_string();
    let first = submit(&ctx, &req_id, &ws, &proj, &sess, "ephemeral")
        .await
        .expect("first");
    let before = counts(&ctx).await;

    // Erase content + tombstone (user-requested deletion).
    let content_id: String =
        sqlx::query_scalar("SELECT content_id FROM conversation_messages WHERE message_id = ?")
            .bind(&first.data.message_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    sqlx::query("DELETE FROM content_records WHERE content_id = ?")
        .bind(&content_id)
        .execute(&ctx.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO content_tombstones (content_id, erased_at_us, reason_code) VALUES (?, 7000, 'user_requested')")
        .bind(&content_id)
        .execute(&ctx.pool)
        .await
        .unwrap();

    // Retry must not duplicate; hydration fails as repair-required.
    let err = submit(&ctx, &req_id, &ws, &proj, &sess, "ephemeral")
        .await
        .expect_err("deleted content retry");
    assert!(err.contains("STORAGE_REPAIR_REQUIRED"), "got: {err}");
    // No new event/projection/receipt rows from the failed retry.
    assert_eq!(counts(&ctx).await.0, before.0);
    assert_eq!(counts(&ctx).await.2, before.2);
    assert_eq!(counts(&ctx).await.3, before.3);
}
