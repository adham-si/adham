//! G2: provider credential vault — AEAD-sealed API keys keyed by account.
//!
//! Separate table from all registry rows; the plaintext never enters SQLite,
//! DTOs, or logs. Ciphertexts are bound to (installation, account, purpose) via
//! AEAD associated data, so a copied row cannot be replayed elsewhere.

use adham_event_log::{
    create_sqlite_pool,
    provider_credentials::{
        put_provider_credential, read_provider_credential_plaintext, remove_provider_credential,
    },
    provider_registry::{upsert_provider_account, ProviderAccountRow},
    InMemoryProvider,
};
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_provider_cred_{}.db", uuid::Uuid::now_v7()));
    path
}

fn google_account(account_id: &str) -> ProviderAccountRow {
    ProviderAccountRow {
        account_id: account_id.into(),
        kind: "google_gemini".into(),
        alias: "Google".into(),
        privacy_class: "cloud_only".into(),
        endpoint_id: "google-gemini-cloud".into(),
        base_url: "https://generativelanguage.googleapis.com".into(),
        approved_destination: true,
        status: "active".into(),
        created_at_us: 1_000,
        updated_at_us: 1_000,
    }
}

fn key() -> InMemoryProvider {
    InMemoryProvider::generate()
}

#[tokio::test]
async fn sealed_credential_roundtrips_through_the_content_key() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(&pool, &google_account("acc-1"))
        .await
        .expect("account");
    let provider = key();

    put_provider_credential(&pool, &provider, "acc-1", "AIza-test-key", "inst-1")
        .await
        .expect("put");
    let plaintext = read_provider_credential_plaintext(&pool, &provider, "acc-1", "inst-1")
        .await
        .expect("get");
    assert_eq!(plaintext, "AIza-test-key");
}

#[tokio::test]
async fn tampered_ciphertext_fails_authentication() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(&pool, &google_account("acc-1"))
        .await
        .expect("account");
    let provider = key();
    put_provider_credential(&pool, &provider, "acc-1", "AIza-test-key", "inst-1")
        .await
        .expect("put");

    // Flip one ciphertext byte in place — storage corruption, not a key issue.
    let raw: Vec<u8> = sqlx::query_scalar(
        "SELECT ciphertext FROM provider_credentials WHERE account_id = 'acc-1'",
    )
    .fetch_one(&pool)
    .await
    .expect("row");
    let mut corrupted = raw.clone();
    corrupted[0] ^= 0x40;
    sqlx::query("UPDATE provider_credentials SET ciphertext = ? WHERE account_id = 'acc-1'")
        .bind(&corrupted)
        .execute(&pool)
        .await
        .expect("tamper");

    let result = read_provider_credential_plaintext(&pool, &provider, "acc-1", "inst-1").await;
    assert!(result.is_err(), "tampered credential must not decrypt");
}

#[tokio::test]
async fn credential_is_bound_to_its_account_and_installation() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(&pool, &google_account("acc-1"))
        .await
        .expect("account");
    upsert_provider_account(&pool, &google_account("acc-2"))
        .await
        .expect("account");
    let provider = key();
    put_provider_credential(&pool, &provider, "acc-1", "AIza-test-key", "inst-1")
        .await
        .expect("put");

    // Replaying the same sealed row under a different account (or
    // installation) must fail: the AD does not authenticate.
    assert!(
        read_provider_credential_plaintext(&pool, &provider, "acc-2", "inst-1")
            .await
            .is_err(),
        "cross-account replay must fail"
    );
    assert!(
        read_provider_credential_plaintext(&pool, &provider, "acc-1", "inst-other")
            .await
            .is_err(),
        "cross-installation replay must fail"
    );
}

#[tokio::test]
async fn put_rotates_the_single_row_per_account() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(&pool, &google_account("acc-1"))
        .await
        .expect("account");
    let provider = key();
    put_provider_credential(&pool, &provider, "acc-1", "AIza-old", "inst-1")
        .await
        .expect("put");
    put_provider_credential(&pool, &provider, "acc-1", "AIza-new", "inst-1")
        .await
        .expect("rotate");

    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM provider_credentials WHERE account_id = 'acc-1'")
            .fetch_one(&pool)
            .await
            .expect("count");
    assert_eq!(count, 1, "rotation replaces, never accumulates");
    let plaintext = read_provider_credential_plaintext(&pool, &provider, "acc-1", "inst-1")
        .await
        .expect("get");
    assert_eq!(plaintext, "AIza-new");
}

#[tokio::test]
async fn remove_drops_the_row_and_account_delete_cascades() {
    let pool = create_sqlite_pool(&test_db_path()).await.expect("pool");
    upsert_provider_account(&pool, &google_account("acc-1"))
        .await
        .expect("account");
    let provider = key();
    put_provider_credential(&pool, &provider, "acc-1", "AIza-test-key", "inst-1")
        .await
        .expect("put");
    remove_provider_credential(&pool, "acc-1")
        .await
        .expect("rm");
    assert!(
        read_provider_credential_plaintext(&pool, &provider, "acc-1", "inst-1")
            .await
            .is_err()
    );

    put_provider_credential(&pool, &provider, "acc-1", "AIza-test-key", "inst-1")
        .await
        .expect("put again");
    sqlx::query("DELETE FROM provider_accounts WHERE account_id = 'acc-1'")
        .execute(&pool)
        .await
        .expect("delete account");
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM provider_credentials")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(count, 0, "account delete cascades the credential");
}
