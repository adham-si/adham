//! Installation-scoped application preferences (SETTINGS-01 Pillar 1).
//!
//! Single-row `installation_preferences` table: presentation-only settings
//! (theme, language, fonts, contrast, motion, composer input). No secrets,
//! no operational/security policy. Revision-guarded writes give rapid UI
//! changes last-writer-wins ordering without silent overwrites.

use adham_event_log::{
    PREFERENCES_SCHEMA_VERSION, PreferenceWriteError, StoredPreferences, create_sqlite_pool,
};
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_prefs_{}.db", uuid::Uuid::now_v7()));
    path
}

const PREFS_A: &str = r#"{"appearance":"dark","language":"en","fontFamily":"default","fontSize":"md","highContrast":"system","reducedMotion":"system","enterToSend":true}"#;
const PREFS_B: &str = r#"{"appearance":"light","language":"ar","fontFamily":"serif","fontSize":"lg","highContrast":"enabled","reducedMotion":"reduce","enterToSend":false}"#;

#[tokio::test]
async fn read_preferences_returns_none_on_fresh_db() {
    let pool = create_sqlite_pool(&test_db_path())
        .await
        .expect("create pool");
    let stored = adham_event_log::read_preferences(&pool)
        .await
        .expect("read prefs");
    assert!(stored.is_none(), "fresh install has no stored preferences");
}

#[tokio::test]
async fn write_then_read_roundtrip() {
    let pool = create_sqlite_pool(&test_db_path())
        .await
        .expect("create pool");
    let stored = adham_event_log::write_preferences(&pool, PREFERENCES_SCHEMA_VERSION, PREFS_A, 0)
        .await
        .expect("first write");
    assert_eq!(stored.revision, 1);
    assert_eq!(stored.schema_version, PREFERENCES_SCHEMA_VERSION);
    assert_eq!(stored.prefs_json, PREFS_A);

    let reread: Option<StoredPreferences> = adham_event_log::read_preferences(&pool)
        .await
        .expect("read prefs");
    assert_eq!(reread.expect("row present").prefs_json, PREFS_A);
}

#[tokio::test]
async fn stale_base_revision_conflicts_without_overwrite() {
    let pool = create_sqlite_pool(&test_db_path())
        .await
        .expect("create pool");
    adham_event_log::write_preferences(&pool, PREFERENCES_SCHEMA_VERSION, PREFS_A, 0)
        .await
        .expect("first write");

    let err = adham_event_log::write_preferences(&pool, PREFERENCES_SCHEMA_VERSION, PREFS_B, 0)
        .await
        .expect_err("stale base must conflict");
    match err {
        PreferenceWriteError::Conflict(current) => {
            assert_eq!(current.revision, 1);
            assert_eq!(current.prefs_json, PREFS_A);
        }
        PreferenceWriteError::Storage(e) => panic!("expected conflict, got storage error: {e}"),
    }

    // Loser value was not persisted.
    let reread = adham_event_log::read_preferences(&pool)
        .await
        .expect("read prefs")
        .expect("row present");
    assert_eq!(reread.prefs_json, PREFS_A);
}

#[tokio::test]
async fn sequential_writes_increment_revision() {
    let pool = create_sqlite_pool(&test_db_path())
        .await
        .expect("create pool");
    let first = adham_event_log::write_preferences(&pool, PREFERENCES_SCHEMA_VERSION, PREFS_A, 0)
        .await
        .expect("first write");
    let second = adham_event_log::write_preferences(
        &pool,
        PREFERENCES_SCHEMA_VERSION,
        PREFS_B,
        first.revision,
    )
    .await
    .expect("second write");
    assert_eq!(second.revision, first.revision + 1);
    assert_eq!(second.prefs_json, PREFS_B);
}

#[tokio::test]
async fn reset_returns_to_defaults() {
    let pool = create_sqlite_pool(&test_db_path())
        .await
        .expect("create pool");
    adham_event_log::write_preferences(&pool, PREFERENCES_SCHEMA_VERSION, PREFS_A, 0)
        .await
        .expect("first write");
    adham_event_log::reset_preferences(&pool)
        .await
        .expect("reset");
    let stored = adham_event_log::read_preferences(&pool)
        .await
        .expect("read prefs");
    assert!(
        stored.is_none(),
        "reset removes the row; callers fall back to defaults"
    );
}

#[tokio::test]
async fn preferences_survive_reopen() {
    let path = test_db_path();
    let pool = create_sqlite_pool(&path).await.expect("create pool");
    adham_event_log::write_preferences(&pool, PREFERENCES_SCHEMA_VERSION, PREFS_A, 0)
        .await
        .expect("first write");
    pool.close().await;

    let reopened = create_sqlite_pool(&path).await.expect("reopen pool");
    let stored = adham_event_log::read_preferences(&reopened)
        .await
        .expect("read prefs")
        .expect("row present after reopen");
    assert_eq!(stored.prefs_json, PREFS_A);
    assert_eq!(stored.revision, 1);
}
