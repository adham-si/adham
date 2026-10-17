//! G2: provider credential vault — AEAD-sealed cloud API keys keyed by account.
//!
//! A separate table so no registry row (or its descriptor JSON) can ever carry
//! secret material. The plaintext exists only between the caller and the seal/
//! open below: never in SQLite, DTOs, logs, or any cross-IPC response. Rows are
//! authenticated against (installation, account_id, purpose) via AEAD
//! associated data, so a copied DB row cannot be replayed under another
//! account or installation.

use super::content_crypto::{decrypt_aead, encrypt_aead, PROTECTION_AEAD_V1};
use super::content_key::ContentKeyProvider;
use super::provider_registry::ProviderRegistryError;
use adham_core_types::DomainError;
use sqlx::{Pool, Row, Sqlite};
use time::OffsetDateTime;
use zeroize::Zeroize;

fn now_us() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64
}

fn frame(buf: &mut Vec<u8>, field: &str, value: &str) {
    buf.extend_from_slice(&(field.len() as u32).to_le_bytes());
    buf.extend_from_slice(field.as_bytes());
    buf.extend_from_slice(&(value.len() as u32).to_le_bytes());
    buf.extend_from_slice(value.as_bytes());
}

/// Credential rows use their own associated data: (installation, account,
/// purpose) instead of the content scope binding. A credential stolen from one
/// scope cannot authenticate anywhere else.
fn credential_ad(installation_id: &str, account_id: &str) -> Vec<u8> {
    let mut ad = Vec::with_capacity(192);
    frame(&mut ad, "v", "1");
    frame(&mut ad, "purpose", "provider_credential");
    frame(&mut ad, "installation", installation_id);
    frame(&mut ad, "account_id", account_id);
    ad
}

/// Seal and upsert one credential row per account (rotation replaces the row).
pub async fn put_provider_credential(
    pool: &Pool<Sqlite>,
    key_provider: &dyn ContentKeyProvider,
    account_id: &str,
    plaintext: &str,
    installation_id: &str,
) -> Result<(), ProviderRegistryError> {
    if plaintext.is_empty() {
        return Err(ProviderRegistryError::Integrity(
            "refusing to store an empty credential".into(),
        ));
    }
    let mut key = key_provider
        .content_key()
        .map_err(|e| ProviderRegistryError::Integrity(format!("content key unavailable: {e}")))?;
    let ad = credential_ad(installation_id, account_id);
    let sealed = encrypt_aead(&key, &ad, plaintext.as_bytes());
    let key_reference = key_provider.key_reference();
    key.zeroize();
    let (nonce, ciphertext) = sealed.map_err(|e: DomainError| {
        ProviderRegistryError::Integrity(format!("credential seal failed: {e}"))
    })?;

    sqlx::query(
        "INSERT INTO provider_credentials
             (account_id, protection, nonce, ciphertext, key_reference, updated_at_us)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
             protection = excluded.protection,
             nonce = excluded.nonce,
             ciphertext = excluded.ciphertext,
             key_reference = excluded.key_reference,
             updated_at_us = excluded.updated_at_us",
    )
    .bind(account_id)
    .bind(PROTECTION_AEAD_V1)
    .bind(&nonce)
    .bind(&ciphertext)
    .bind(&key_reference)
    .bind(now_us())
    .execute(pool)
    .await
    .map_err(ProviderRegistryError::from)?;
    Ok(())
}

/// Open the stored credential. Callers load this into memory per dispatch and
/// drop it after the adapter consumed it — it is never cached beyond the call.
pub async fn read_provider_credential_plaintext(
    pool: &Pool<Sqlite>,
    key_provider: &dyn ContentKeyProvider,
    account_id: &str,
    installation_id: &str,
) -> Result<String, ProviderRegistryError> {
    let row = sqlx::query(
        "SELECT protection, nonce, ciphertext FROM provider_credentials WHERE account_id = ?",
    )
    .bind(account_id)
    .fetch_optional(pool)
    .await
    .map_err(ProviderRegistryError::from)?
    .ok_or_else(|| ProviderRegistryError::NotFound(account_id.to_string()))?;

    let protection: String = row.get("protection");
    if protection != PROTECTION_AEAD_V1 {
        // future re-encryption migration: unknown scheme = fail closed here
        return Err(ProviderRegistryError::Integrity(format!(
            "unknown credential protection scheme '{protection}'"
        )));
    }
    let mut key = key_provider
        .content_key()
        .map_err(|e| ProviderRegistryError::Integrity(format!("content key unavailable: {e}")))?;
    let ad = credential_ad(installation_id, account_id);
    let opened = decrypt_aead(
        &key,
        &row.get::<Vec<u8>, _>("nonce"),
        &ad,
        &row.get::<Vec<u8>, _>("ciphertext"),
    );
    key.zeroize();
    let bytes = opened.map_err(|e: DomainError| {
        ProviderRegistryError::Integrity(format!("credential authentication failed: {e}"))
    })?;
    String::from_utf8(bytes)
        .map_err(|_| ProviderRegistryError::Integrity("credential is not valid UTF-8".into()))
}

pub async fn remove_provider_credential(
    pool: &Pool<Sqlite>,
    account_id: &str,
) -> Result<(), ProviderRegistryError> {
    sqlx::query("DELETE FROM provider_credentials WHERE account_id = ?")
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(ProviderRegistryError::from)?;
    Ok(())
}
