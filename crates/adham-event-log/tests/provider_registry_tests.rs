//! A2: provider registry persistence — accounts + digest-pinned models.
//!
//! SQLite tables backing the provider registry. No secrets in any table.
//! Corruption on read is an integrity error — never a silently "recovered"
//! live configuration.

use adham_event_log::{
    create_sqlite_pool,
    provider_registry::{
        read_provider_accounts, read_provider_models, read_provider_registry_revision,
        upsert_provider_account, upsert_provider_models, ProviderAccountRow, ProviderModelRow,
        ProviderRegistryError,
    },
};
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_provider_reg_{}.db", uuid::Uuid::now_v7()));
    path
}

fn account_row(
    account_id: &str,
    endpoint_id: &str,
    base_url: &str,
    alias: &str,
) -> ProviderAccountRow {
    ProviderAccountRow {
        account_id: account_id.into(),
        kind: "ollama_local".into(),
        alias: alias.into(),
        privacy_class: "local_only".into(),
        endpoint_id: endpoint_id.into(),
        base_url: base_url.into(),
        approved_destination: true,
        status: "active".into(),
        created_at_us: 1_000,
        updated_at_us: 1_000,
    }
}

fn model_row(account_id: &str, model_id: &str, digest: &str, revision: i64) -> ProviderModelRow {
    ProviderModelRow {
        account_id: account_id.into(),
        model_id: model_id.into(),
        digest: digest.into(),
        descriptor_json: format!(
            r#"{{"model_id":"{model_id}","human_label":"{model_id}","privacy_class":"local_only","capabilities":{{"streaming":"supported","structured_output":"unknown","tool_proposals":"unknown","thinking":"unknown"}}}}"#
        ),
        verified_revision: revision,
    }
}

#[tokio::test]
async fn account_upsert_then_read_roundtrip() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");

    upsert_provider_account(
        &pool,
        &account_row("acct-local", "ep-1", "http://127.0.0.1:11434", "Local"),
    )
    .await
    .expect("upsert account");

    let rows = read_provider_accounts(&pool).await.expect("read accounts");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].account_id, "acct-local");
    assert_eq!(rows[0].base_url, "http://127.0.0.1:11434");
    assert!(rows[0].approved_destination);
}

#[tokio::test]
async fn models_upsert_and_read_roundtrip_with_digest() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(
        &pool,
        &account_row("acct-local", "ep-1", "http://127.0.0.1:11434", "Local"),
    )
    .await
    .expect("account");

    upsert_provider_models(
        &pool,
        "acct-local",
        &[model_row("acct-local", "llama3.2", "sha256:deadbeef", 1)],
    )
    .await
    .expect("upsert models");

    let rows = read_provider_models(&pool, "acct-local")
        .await
        .expect("read models");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].model_id, "llama3.2");
    assert_eq!(rows[0].digest, "sha256:deadbeef");
    // descriptor is valid JSON (digest pin + capabilities survive)
    let parsed: serde_json::Value = serde_json::from_str(&rows[0].descriptor_json).expect("json");
    assert_eq!(parsed["privacy_class"], "local_only");
}

#[tokio::test]
async fn corrupt_model_descriptor_reads_as_integrity_error() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(
        &pool,
        &account_row("acct-local", "ep-1", "http://127.0.0.1:11434", "Local"),
    )
    .await
    .expect("account");

    let ok = model_row("acct-local", "bad", "sha256:ok", 1);
    upsert_provider_models(&pool, "acct-local", &[ok])
        .await
        .expect("valid row writes fine with valid descriptor json");

    // corrupt bytes arrive by an out-of-band path (older writer / direct edit)
    sqlx::query("UPDATE provider_models SET descriptor_json = '{not json' WHERE model_id = 'bad'")
        .execute(&pool)
        .await
        .expect("tamper");
    let err = read_provider_models(&pool, "acct-local")
        .await
        .expect_err("corrupt rows must surface as integrity errors");
    assert!(
        matches!(err, ProviderRegistryError::Integrity(_)),
        "got {err:?}"
    );
}

#[tokio::test]
async fn endpoint_change_invalidates_models_and_bumps_revision() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(
        &pool,
        &account_row("acct-local", "ep-1", "http://127.0.0.1:11434", "Local"),
    )
    .await
    .expect("account");
    upsert_provider_models(
        &pool,
        "acct-local",
        &[model_row("acct-local", "llama3.2", "sha256:d", 0)],
    )
    .await
    .expect("models");
    let base_revision = read_provider_registry_revision(&pool)
        .await
        .expect("revision");

    // endpoint/basis change → models cleared, revision bumped
    let moved = account_row("acct-local", "ep-1", "http://127.0.0.1:9999", "Local");
    upsert_provider_account(&pool, &moved)
        .await
        .expect("moved account");
    let rows = read_provider_models(&pool, "acct-local")
        .await
        .expect("cleared");
    assert!(rows.is_empty(), "endpoint change must clear models");
    assert!(
        read_provider_registry_revision(&pool)
            .await
            .expect("revision")
            > base_revision,
        "revision must bump on endpoint change"
    );

    // alias-only update must NOT clear models
    let reseeded = model_row("acct-local", "llama3.2", "sha256:d", 5);
    upsert_provider_models(&pool, "acct-local", &[reseeded])
        .await
        .expect("models again");
    let renamed = account_row("acct-local", "ep-1", "http://127.0.0.1:9999", "Renamed");
    upsert_provider_account(&pool, &renamed)
        .await
        .expect("rename");
    let rows = read_provider_models(&pool, "acct-local")
        .await
        .expect("kept");
    assert_eq!(rows.len(), 1, "alias change must keep models");
}

#[tokio::test]
async fn models_for_unknown_account_not_found() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    let err = upsert_provider_models(&pool, "ghost", &[model_row("ghost", "m", "sha256:d", 0)])
        .await
        .expect_err("unknown account must not bind models");
    assert!(
        matches!(err, ProviderRegistryError::NotFound(_)),
        "got {err:?}"
    );
}
