//! Installation-identity fail-closed guards: orphaned content blocks
//! regeneration, and `created` is true only for the first-create INSERT winner.

use adham_core_types::DomainError;
use adham_event_log::{create_sqlite_pool, load_or_create_installation};
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_identity_guard_{}.db", uuid::Uuid::now_v7()));
    path
}

async fn insert_orphan_content_record(pool: &sqlx::Pool<sqlx::Sqlite>) {
    sqlx::query(
        "INSERT INTO content_records
         (content_id, content_kind, media_type, encoding, protection_scheme,
          protected_bytes, plaintext_size, created_at_us)
         VALUES ('orphan-1', 'message', 'text/plain', 'encrypted',
                 'aead-xchacha20poly1305-v1', x'00', 0, 0)",
    )
    .execute(pool)
    .await
    .expect("insert orphan content");
}

async fn insert_orphan_event(pool: &sqlx::Pool<sqlx::Sqlite>) {
    sqlx::query(
        "INSERT INTO events
         (event_id, event_type, event_version, stream_id, stream_kind,
          stream_sequence, installation_id, actor_id, actor_kind, request_id,
          correlation_id, occurred_at_us, recorded_at_us, payload_json,
          metadata_json, checksum)
         VALUES ('evt-orphan-1', 'WorkspaceCreated', 1, 'workspace:orphan',
                 'workspace', 1, 'inst-orphan', 'actor-orphan', 'local_human',
                 'req-orphan', 'corr-orphan', 0, 0, x'7b7d', x'7b7d', 'chk1')",
    )
    .execute(pool)
    .await
    .expect("insert orphan event");
}

#[tokio::test]
async fn fresh_db_single_creation_then_reopen() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let first = load_or_create_installation(&pool)
        .await
        .expect("first init");
    assert!(first.created);

    let second = load_or_create_installation(&pool).await.expect("reopen");
    assert!(!second.created);
    assert_eq!(first.record.installation_id, second.record.installation_id);
    assert_eq!(first.record.actor_id, second.record.actor_id);
}

#[tokio::test]
async fn orphan_content_blocks_regeneration() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");
    insert_orphan_content_record(&pool).await;

    let err = load_or_create_installation(&pool)
        .await
        .expect_err("orphan content must block regeneration");
    match &err {
        DomainError::Integrity(msg) => {
            assert!(msg.contains("refusing to regenerate identity"), "{msg}");
        }
        other => panic!("expected Integrity, got {other:?}"),
    }

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(count, 0, "guard must fire before any identity INSERT");
}

#[tokio::test]
async fn orphan_event_blocks_regeneration() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");
    insert_orphan_event(&pool).await;

    let err = load_or_create_installation(&pool)
        .await
        .expect_err("orphan event must block regeneration");
    assert!(matches!(err, DomainError::Integrity(_)), "{err:?}");

    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(count, 0);
}

#[tokio::test]
async fn existing_installation_survives_orphan_check() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");
    let first = load_or_create_installation(&pool)
        .await
        .expect("first init");
    insert_orphan_event(&pool).await;

    let second = load_or_create_installation(&pool)
        .await
        .expect("existing row must load even with content present");
    assert!(!second.created);
    assert_eq!(first.record.installation_id, second.record.installation_id);
}
