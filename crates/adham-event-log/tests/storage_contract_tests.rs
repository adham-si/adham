use adham_core_types::*;
use adham_event_log::{create_sqlite_pool, verify_storage_health, SqliteEventStore};
use sqlx::Row;
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "adham_storage_contract_{}.db",
        uuid::Uuid::now_v7()
    ));
    path
}

#[tokio::test]
async fn test_storage_health_verification() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");

    let report = verify_storage_health(&pool)
        .await
        .expect("verify storage health");

    assert!(report.is_healthy, "storage must report healthy state");
    assert_eq!(report.journal_mode.to_lowercase(), "wal");
    assert!(report.foreign_keys, "foreign keys must be enabled");
    assert!(
        report.busy_timeout_ms >= 5000,
        "busy timeout must be at least 5000ms"
    );
    assert!(report.quick_check_ok, "quick_check must report ok");

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_foreign_key_enforcement() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");

    // Create a child table with FK reference to verify enforcement is active
    sqlx::query(
        r#"
        CREATE TABLE fk_parent (id TEXT PRIMARY KEY);
        CREATE TABLE fk_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES fk_parent(id));
        "#,
    )
    .execute(&pool)
    .await
    .expect("create test tables");

    // Attempt insert into fk_child without matching parent
    let insert_result =
        sqlx::query("INSERT INTO fk_child (id, parent_id) VALUES ('c1', 'nonexistent')")
            .execute(&pool)
            .await;

    assert!(
        insert_result.is_err(),
        "Expected foreign key constraint violation error"
    );

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_transaction_rollback_guarantee() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");

    let mut tx = pool.begin().await.expect("begin transaction");

    // Insert content inside transaction
    let content_id = ContentId::new_v7();
    sqlx::query(
        r#"
        INSERT INTO content_records (
            content_id, content_kind, media_type, encoding, protection_scheme,
            protected_bytes, plaintext_size, created_at_us
        ) VALUES (?, 'text', 'text/plain', 'identity', 'none', ?, 12, 1000)
        "#,
    )
    .bind(content_id.to_string())
    .bind(&b"secret hello"[..])
    .execute(&mut *tx)
    .await
    .expect("insert content in tx");

    // Insert event inside transaction
    let event_id = EventId::new_v7();
    sqlx::query(
        r#"
        INSERT INTO events (
            event_id, event_type, event_version, stream_id, stream_kind, stream_sequence,
            installation_id, actor_id, actor_kind, request_id, correlation_id,
            occurred_at_us, recorded_at_us, payload_json, metadata_json, checksum
        ) VALUES (?, 'TestEvent', 1, 'stream:1', 'test', 1, 'inst-1', 'act-1', 'human', 'req-1', 'corr-1', 1000, 1000, ?, ?, 'chk-1')
        "#,
    )
    .bind(event_id.to_string())
    .bind(&b"{}"[..])
    .bind(&b"{}"[..])
    .execute(&mut *tx)
    .await
    .expect("insert event in tx");

    // Explicitly roll back the transaction
    tx.rollback().await.expect("rollback transaction");

    // Verify neither row persisted
    let content_count: i64 = sqlx::query("SELECT COUNT(*) FROM content_records")
        .fetch_one(&pool)
        .await
        .expect("count content")
        .get(0);
    assert_eq!(
        content_count, 0,
        "No content records should exist after rollback"
    );

    let event_count: i64 = sqlx::query("SELECT COUNT(*) FROM events")
        .fetch_one(&pool)
        .await
        .expect("count events")
        .get(0);
    assert_eq!(event_count, 0, "No events should exist after rollback");

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_projection_checkpoints_upsert_and_recovery() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");

    // Insert initial checkpoint
    sqlx::query(
        r#"
        INSERT INTO projection_checkpoints (
            projection_name, projection_version, last_global_position, status, error_code, updated_at_us
        ) VALUES ('conversation_messages', 1, 10, 'active', NULL, 1000)
        "#,
    )
    .execute(&pool)
    .await
    .expect("insert checkpoint");

    let row = sqlx::query(
        "SELECT last_global_position, status FROM projection_checkpoints WHERE projection_name = 'conversation_messages'",
    )
    .fetch_one(&pool)
    .await
    .expect("query checkpoint");

    let pos: i64 = row.get("last_global_position");
    let status: String = row.get("status");
    assert_eq!(pos, 10);
    assert_eq!(status, "active");

    // Advance checkpoint via upsert
    sqlx::query(
        r#"
        INSERT INTO projection_checkpoints (
            projection_name, projection_version, last_global_position, status, error_code, updated_at_us
        ) VALUES ('conversation_messages', 1, 25, 'active', NULL, 2000)
        ON CONFLICT(projection_name) DO UPDATE SET
            last_global_position = excluded.last_global_position,
            status = excluded.status,
            updated_at_us = excluded.updated_at_us
        "#,
    )
    .execute(&pool)
    .await
    .expect("advance checkpoint");

    let row_updated = sqlx::query(
        "SELECT last_global_position, updated_at_us FROM projection_checkpoints WHERE projection_name = 'conversation_messages'",
    )
    .fetch_one(&pool)
    .await
    .expect("query updated checkpoint");

    let pos_updated: i64 = row_updated.get("last_global_position");
    let updated_us: i64 = row_updated.get("updated_at_us");
    assert_eq!(pos_updated, 25);
    assert_eq!(updated_us, 2000);

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_content_tombstone_lifecycle() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");
    let store = SqliteEventStore::new(pool.clone());

    let content_id = ContentId::new_v7();
    store
        .put_content(
            &content_id,
            "private_text",
            "text/plain",
            "identity",
            "none",
            b"temporary sensitive data",
        )
        .await
        .expect("put content");

    assert!(store.get_content(&content_id).await.unwrap().is_some());

    // Transactionally erase content and create tombstone
    let mut tx = pool.begin().await.expect("begin erase tx");
    sqlx::query("DELETE FROM content_records WHERE content_id = ?")
        .bind(content_id.to_string())
        .execute(&mut *tx)
        .await
        .expect("delete content");

    sqlx::query(
        "INSERT INTO content_tombstones (content_id, erased_at_us, reason_code) VALUES (?, 5000, 'user_requested')",
    )
    .bind(content_id.to_string())
    .execute(&mut *tx)
    .await
    .expect("insert tombstone");

    tx.commit().await.expect("commit erase tx");

    // Verify content erased and tombstone recorded
    assert!(store.get_content(&content_id).await.unwrap().is_none());

    let tombstone_row =
        sqlx::query("SELECT reason_code FROM content_tombstones WHERE content_id = ?")
            .bind(content_id.to_string())
            .fetch_one(&pool)
            .await
            .expect("fetch tombstone");

    let reason: String = tombstone_row.get("reason_code");
    assert_eq!(reason, "user_requested");

    let _ = std::fs::remove_file(db_path);
}
