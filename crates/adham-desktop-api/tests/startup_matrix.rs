//! Production startup matrix against the real Windows Credential Manager.
//!
//! Uses the real `adham-content-key` service with synthetic random
//! installation accounts, deleting each credential at test exit.

#![cfg(windows)]

use adham_core_types::DomainError;
use adham_desktop_api::ApiContext;
use adham_event_log::create_sqlite_pool;
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_startup_matrix_{}.db", uuid::Uuid::now_v7()));
    path
}

fn delete_credential(installation_id: &str) {
    if let Ok(entry) = keyring::Entry::new("adham-content-key", installation_id) {
        let _ = entry.delete_credential();
    }
}

#[tokio::test]
async fn fresh_startup_initializes_key_and_reopen_is_stable() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let ctx = ApiContext::load_or_create(pool.clone())
        .await
        .expect("fresh startup");
    let account = ctx.installation_id.to_string();
    let key_first = ctx.content_key.content_key().expect("fresh key read");
    let key_second = ctx.content_key.content_key().expect("fresh key reread");
    assert_eq!(key_first, key_second);

    let ctx2 = ApiContext::load_or_create(pool)
        .await
        .expect("reopen startup");
    assert_eq!(ctx.installation_id, ctx2.installation_id);
    assert_eq!(ctx.actor_id, ctx2.actor_id);
    let key_reopen = ctx2.content_key.content_key().expect("reopen key read");
    assert_eq!(key_first, key_reopen, "key must survive restart");

    delete_credential(&account);
}

#[tokio::test]
async fn existing_installation_with_deleted_key_fails_closed() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let ctx = ApiContext::load_or_create(pool.clone())
        .await
        .expect("first startup");
    let account = ctx.installation_id.to_string();
    delete_credential(&account);

    let err = match ApiContext::load_or_create(pool.clone()).await {
        Ok(_) => panic!("missing key must block startup"),
        Err(e) => e,
    };
    match &err {
        DomainError::Storage(msg) => {
            assert!(msg.contains("content key missing"), "{msg}");
        }
        other => panic!("expected Storage key-loss error, got {other:?}"),
    }

    let entry = keyring::Entry::new("adham-content-key", &account).expect("entry");
    assert!(
        matches!(entry.get_password(), Err(keyring::Error::NoEntry)),
        "failed startup must not mint a replacement key"
    );
    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(row_count, 1, "identity must be preserved across key loss");

    delete_credential(&account);
}

#[tokio::test]
async fn orphan_content_blocks_startup_regeneration() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");
    sqlx::query(
        "INSERT INTO events
         (event_id, event_type, event_version, stream_id, stream_kind,
          stream_sequence, installation_id, actor_id, actor_kind, request_id,
          correlation_id, occurred_at_us, recorded_at_us, payload_json,
          metadata_json, checksum)
         VALUES ('evt-orphan-startup', 'WorkspaceCreated', 1, 'workspace:orphan',
                 'workspace', 1, 'inst-orphan', 'actor-orphan', 'local_human',
                 'req-orphan', 'corr-orphan', 0, 0, x'7b7d', x'7b7d', 'chk1')",
    )
    .execute(&pool)
    .await
    .expect("insert orphan event");

    let err = match ApiContext::load_or_create(pool.clone()).await {
        Ok(_) => panic!("orphan content must block startup"),
        Err(e) => e,
    };
    assert!(matches!(err, DomainError::Integrity(_)), "{err:?}");
    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(row_count, 0, "no identity may be generated under live data");
}
