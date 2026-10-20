use adham_core_types::{ActorId, ContentId, CorrelationId, RequestId};
use adham_event_log::{SqliteEventStore, create_sqlite_pool};
use sqlx::Row;
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "adham_session_history_schema_{}.db",
        uuid::Uuid::now_v7()
    ));
    path
}

#[tokio::test]
async fn migration_is_idempotent_and_creates_history_indexes() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path).await.unwrap();
    let tables: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='message_bookmarks'",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(tables, vec!["message_bookmarks"]);
    let indexes: Vec<String> = sqlx::query_scalar(
        "SELECT name FROM sqlite_master WHERE type='index' AND name IN \
         ('events_project_type','content_records_session_idx','pending_operations_create_request_idx')",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(indexes.len(), 3);
    drop(pool);
    let pool = create_sqlite_pool(&db_path).await.unwrap();
    assert!(pool.acquire().await.is_ok());
    drop(pool);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn receipt_range_preserves_first_and_last_positions() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path).await.unwrap();
    let mut tx = pool.begin().await.unwrap();
    SqliteEventStore::record_receipt_range_tx(
        &mut tx,
        &RequestId::new_v7(),
        "duplicate_session",
        1,
        "scope",
        "request",
        &ActorId::new_v7(),
        &CorrelationId::new_v7(),
        "success",
        b"{}",
        1,
        9,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let row = sqlx::query(
        "SELECT first_global_position, last_global_position FROM command_receipts LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.get::<i64, _>("first_global_position"), 1);
    assert_eq!(row.get::<i64, _>("last_global_position"), 9);

    drop(pool);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn erase_content_tx_tombstones_and_deletes_the_record() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path).await.unwrap();
    let content_id = ContentId::new_v7();
    sqlx::query(
        r#"
        INSERT INTO content_records (
            content_id, content_kind, media_type, encoding, protection_scheme,
            protected_bytes, plaintext_size, created_at_us
        ) VALUES (?, 'text', 'text/plain', 'identity', 'none', ?, 3, 1000)
        "#,
    )
    .bind(content_id.to_string())
    .bind(&b"abc"[..])
    .execute(&pool)
    .await
    .unwrap();

    let mut tx = pool.begin().await.unwrap();
    SqliteEventStore::erase_content_tx(&mut tx, &content_id, "session_delete")
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM content_records WHERE content_id = ?")
            .bind(content_id.to_string())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
    let reason: String =
        sqlx::query_scalar("SELECT reason_code FROM content_tombstones WHERE content_id = ?")
            .bind(content_id.to_string())
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(reason, "session_delete");

    drop(pool);
    let _ = std::fs::remove_file(db_path);
}
