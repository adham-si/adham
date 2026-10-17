//! A2: provider registry persistence — accounts + digest-pinned models.
//!
//! `provider_accounts` / `provider_models` (+ a single-row registry revision
//! counter). No secrets in any table. Descriptor JSON is validated at both
//! boundaries: writes reject unparsable JSON, reads surface corruption as an
//! `Integrity` error — never as a silently "recovered" live configuration.
//! An endpoint change on an account wipes its models and bumps the registry
//! revision (endpoint change invalidates capability/model caches).

use serde::{Deserialize, Serialize};
use sqlx::{Pool, Row, Sqlite};
use time::OffsetDateTime;

pub const PROVIDER_REGISTRY_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, thiserror::Error)]
pub enum ProviderRegistryError {
    #[error("provider registry integrity violation: {0}")]
    Integrity(String),

    #[error("provider account not found: {0}")]
    NotFound(String),

    #[error("provider registry storage error: {0}")]
    Storage(String),
}

impl From<sqlx::Error> for ProviderRegistryError {
    fn from(e: sqlx::Error) -> Self {
        // foreign-key violation on model bind = unknown account
        if let sqlx::Error::Database(db) = &e {
            if db.is_foreign_key_violation() {
                return ProviderRegistryError::NotFound(format!(
                    "unknown provider account (foreign key): {db}"
                ));
            }
        }
        ProviderRegistryError::Storage(e.to_string())
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderAccountRow {
    pub account_id: String,
    pub kind: String,
    pub alias: String,
    pub privacy_class: String,
    pub endpoint_id: String,
    pub base_url: String,
    pub approved_destination: bool,
    pub status: String,
    pub created_at_us: i64,
    pub updated_at_us: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderModelRow {
    pub account_id: String,
    pub model_id: String,
    pub digest: String,
    pub descriptor_json: String,
    pub verified_revision: i64,
}

fn now_us() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64
}

/// Insert-or-update an account. Changing `endpoint_id` or `base_url` invalidates
/// the account's model set (evidence is scoped to the endpoint it came from)
/// and bumps the registry revision; identity-preserving updates (e.g. alias)
/// leave models and the revision untouched.
pub async fn upsert_provider_account(
    pool: &Pool<Sqlite>,
    row: &ProviderAccountRow,
) -> Result<(), ProviderRegistryError> {
    let existing: Option<(String, String)> =
        sqlx::query_as("SELECT endpoint_id, base_url FROM provider_accounts WHERE account_id = ?")
            .bind(&row.account_id)
            .fetch_optional(pool)
            .await
            .map_err(ProviderRegistryError::from)?;

    sqlx::query(
        "INSERT INTO provider_accounts
             (account_id, kind, alias, privacy_class, endpoint_id, base_url,
              approved_destination, status, created_at_us, updated_at_us)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(account_id) DO UPDATE SET
             kind = excluded.kind,
             alias = excluded.alias,
             privacy_class = excluded.privacy_class,
             endpoint_id = excluded.endpoint_id,
             base_url = excluded.base_url,
             approved_destination = excluded.approved_destination,
             status = excluded.status,
             updated_at_us = excluded.updated_at_us",
    )
    .bind(&row.account_id)
    .bind(&row.kind)
    .bind(&row.alias)
    .bind(&row.privacy_class)
    .bind(&row.endpoint_id)
    .bind(&row.base_url)
    .bind(row.approved_destination)
    .bind(&row.status)
    .bind(now_us())
    .bind(now_us())
    .execute(pool)
    .await
    .map_err(ProviderRegistryError::from)?;

    let endpoint_changed = existing
        .map(|(ep, url)| ep != row.endpoint_id || url != row.base_url)
        .unwrap_or(false);
    if endpoint_changed {
        invalidate_provider_models(pool, &row.account_id).await?;
    }
    Ok(())
}

pub async fn read_provider_accounts(
    pool: &Pool<Sqlite>,
) -> Result<Vec<ProviderAccountRow>, ProviderRegistryError> {
    let rows = sqlx::query(
        "SELECT account_id, kind, alias, privacy_class, endpoint_id, base_url,
                approved_destination, status, created_at_us, updated_at_us
         FROM provider_accounts",
    )
    .fetch_all(pool)
    .await
    .map_err(ProviderRegistryError::from)?;

    Ok(rows
        .into_iter()
        .map(|r| ProviderAccountRow {
            account_id: r.get("account_id"),
            kind: r.get("kind"),
            alias: r.get("alias"),
            privacy_class: r.get("privacy_class"),
            endpoint_id: r.get("endpoint_id"),
            base_url: r.get("base_url"),
            approved_destination: r.get::<i64, _>("approved_destination") == 1
                || r.get::<bool, _>("approved_destination"),
            status: r.get("status"),
            created_at_us: r.get("created_at_us"),
            updated_at_us: r.get("updated_at_us"),
        })
        .collect())
}

/// Insert-or-update digest-pinned model rows for an account. Every descriptor
/// must parse as JSON before anything is written (reject-at-write).
pub async fn upsert_provider_models(
    pool: &Pool<Sqlite>,
    account_id: &str,
    models: &[ProviderModelRow],
) -> Result<(), ProviderRegistryError> {
    let exists: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM provider_accounts WHERE account_id = ?")
            .bind(account_id)
            .fetch_optional(pool)
            .await
            .map_err(ProviderRegistryError::from)?;
    if exists.is_none() {
        return Err(ProviderRegistryError::NotFound(account_id.to_string()));
    }

    for model in models {
        serde_json::from_str::<serde::de::IgnoredAny>(&model.descriptor_json).map_err(|e| {
            ProviderRegistryError::Integrity(format!(
                "descriptor for {}/{model_id} is not valid JSON: {e}",
                model.account_id,
                model_id = model.model_id
            ))
        })?;
    }

    let now = now_us();
    for model in models {
        sqlx::query(
            "INSERT INTO provider_models
                 (account_id, model_id, digest, descriptor_json, verified_revision, updated_at_us)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(account_id, model_id) DO UPDATE SET
                 digest = excluded.digest,
                 descriptor_json = excluded.descriptor_json,
                 verified_revision = excluded.verified_revision,
                 updated_at_us = excluded.updated_at_us",
        )
        .bind(account_id)
        .bind(&model.model_id)
        .bind(&model.digest)
        .bind(&model.descriptor_json)
        .bind(model.verified_revision)
        .bind(now)
        .execute(pool)
        .await
        .map_err(ProviderRegistryError::from)?;
    }
    Ok(())
}

pub async fn read_provider_models(
    pool: &Pool<Sqlite>,
    account_id: &str,
) -> Result<Vec<ProviderModelRow>, ProviderRegistryError> {
    let rows = sqlx::query(
        "SELECT model_id, digest, descriptor_json, verified_revision
         FROM provider_models WHERE account_id = ?",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await
    .map_err(ProviderRegistryError::from)?;

    let mut out = Vec::with_capacity(rows.len());
    for r in rows {
        let descriptor_json: String = r.get("descriptor_json");
        // integrity gate: corrupt storage must be an error, never live config
        serde_json::from_str::<serde::de::IgnoredAny>(&descriptor_json).map_err(|e| {
            ProviderRegistryError::Integrity(format!(
                "stored descriptor is not valid JSON for account {account_id}/{}: {e}",
                r.get::<String, _>("model_id")
            ))
        })?;
        out.push(ProviderModelRow {
            account_id: account_id.to_string(),
            model_id: r.get("model_id"),
            digest: r.get("digest"),
            descriptor_json,
            verified_revision: r.get("verified_revision"),
        });
    }
    Ok(out)
}

/// Delete an account row. Model rows and the sealed credential cascade;
/// `NotFound` if the account does not exist.
pub async fn delete_provider_account(
    pool: &Pool<Sqlite>,
    account_id: &str,
) -> Result<(), ProviderRegistryError> {
    let result = sqlx::query("DELETE FROM provider_accounts WHERE account_id = ?")
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(ProviderRegistryError::from)?;
    if result.rows_affected() == 0 {
        return Err(ProviderRegistryError::NotFound(account_id.to_string()));
    }
    Ok(())
}

/// Wipe an account's model rows and bump the registry revision. Callers use
/// this when cached model evidence is no longer valid (endpoint change)./// Single-transaction: the bump and the wipe land together or not at all.
pub async fn invalidate_provider_models(
    pool: &Pool<Sqlite>,
    account_id: &str,
) -> Result<(), ProviderRegistryError> {
    let mut tx = pool.begin().await.map_err(ProviderRegistryError::from)?;
    sqlx::query("DELETE FROM provider_models WHERE account_id = ?")
        .bind(account_id)
        .execute(&mut *tx)
        .await
        .map_err(ProviderRegistryError::from)?;
    sqlx::query(
        "INSERT INTO provider_registry_state (id, revision, updated_at_us)
         VALUES (1, 0, ?) ON CONFLICT(id) DO NOTHING",
    )
    .bind(now_us())
    .execute(&mut *tx)
    .await
    .map_err(ProviderRegistryError::from)?;
    sqlx::query("UPDATE provider_registry_state SET revision = revision + 1, updated_at_us = ? WHERE id = 1")
        .bind(now_us())
        .execute(&mut *tx)
        .await
        .map_err(ProviderRegistryError::from)?;
    tx.commit().await.map_err(ProviderRegistryError::from)
}

/// Current registry revision (0 on a fresh database).
pub async fn read_provider_registry_revision(
    pool: &Pool<Sqlite>,
) -> Result<i64, ProviderRegistryError> {
    let revision: Option<i64> =
        sqlx::query_scalar("SELECT revision FROM provider_registry_state WHERE id = 1")
            .fetch_optional(pool)
            .await
            .map_err(ProviderRegistryError::from)?;
    Ok(revision.unwrap_or(0))
}
