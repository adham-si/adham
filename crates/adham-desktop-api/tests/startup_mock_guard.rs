//! Startup guard against a non-persistent (mock) credential backend.
//!
//! Dedicated test binary: the keyring default builder is process-global, so
//! the mock swap here must not share a process with real-store tests.
//! Guardrail: rejection happens before any identity write.

use adham_core_types::DomainError;
use adham_desktop_api::ApiContext;
use adham_event_log::create_sqlite_pool;
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_startup_mock_{}.db", uuid::Uuid::now_v7()));
    path
}

#[tokio::test]
async fn mock_backend_rejected_before_identity_write() {
    keyring::set_default_credential_builder(keyring::mock::default_credential_builder());

    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let err = match ApiContext::load_or_create(pool.clone()).await {
        Ok(_) => panic!("mock backend must block startup"),
        Err(e) => e,
    };
    match &err {
        DomainError::Storage(msg) => {
            assert!(msg.contains("no supported OS credential backend"), "{msg}");
        }
        other => panic!("expected Storage backend error, got {other:?}"),
    }

    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(
        row_count, 0,
        "guard must fire before any initialization write"
    );
}
