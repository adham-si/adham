//! A2: registry over persisted provider accounts + digest-pinned models.
//!
//! Persistence lives in `adham-event-log` (no secrets in any table). This
//! wrapper adds the typed surface (`ProviderKind`, `PrivacyClass`,
//! `ModelDescriptor`) and an in-memory model cache keyed off the registry
//! revision, so stored-descriptor corruption always surfaces as an error —
//! never a silently "recovered" live configuration.

use crate::domain::account::{PrivacyClass, ProviderAccountId, ProviderKind};
use crate::domain::endpoint::EndpointId;
use crate::domain::error::ProviderError;
use crate::domain::model::{ModelDescriptor, ModelId};
use adham_event_log::provider_registry as store;
use serde_json::Value;
use sqlx::{Pool, Sqlite};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, PartialEq)]
pub struct LocalAccount {
    pub account_id: ProviderAccountId,
    pub kind: ProviderKind,
    pub alias: String,
    pub privacy_class: PrivacyClass,
    pub endpoint_id: EndpointId,
    pub base_url: String,
    pub approved_destination: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct PinnedModel {
    pub model_id: ModelId,
    pub digest: String,
    pub descriptor: ModelDescriptor,
}

/// Model cache: reload when the registry revision moves, else serve memory.
#[derive(Default)]
struct ModelCache {
    revision: i64,
    models: HashMap<String, Vec<PinnedModel>>,
}

pub struct ProviderRegistry {
    pool: Pool<Sqlite>,
    cache: Mutex<ModelCache>,
}

impl ProviderRegistry {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self {
            pool,
            cache: Mutex::new(ModelCache::default()),
        }
    }

    fn store(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    /// Typed read of every local account (no credentials exist in A).
    pub async fn list_accounts(&self) -> Result<Vec<LocalAccount>, ProviderError> {
        let rows = store::read_provider_accounts(self.store())
            .await
            .map_err(integrity)?;
        rows.into_iter()
            .map(|row| {
                Ok(LocalAccount {
                    account_id: ProviderAccountId::new(row.account_id.clone()),
                    kind: enum_from_json(row.kind.clone())?,
                    alias: row.alias,
                    privacy_class: enum_from_json(row.privacy_class.clone())?,
                    endpoint_id: EndpointId::new(row.endpoint_id.clone()),
                    base_url: row.base_url,
                    approved_destination: row.approved_destination,
                })
            })
            .collect()
    }

    /// Resolve an account row (store-level detail also needed by handlers).
    pub async fn account_row(
        &self,
        account: &ProviderAccountId,
    ) -> Result<Option<store::ProviderAccountRow>, ProviderError> {
        let rows = store::read_provider_accounts(self.store())
            .await
            .map_err(integrity)?;
        Ok(rows.into_iter().find(|r| r.account_id == account.0))
    }

    /// Every digest-pinned model for an account, validated against
    /// `ModelDescriptor` on read (cache-served while the registry revision is
    /// unchanged).
    pub async fn list_models(
        &self,
        account: &ProviderAccountId,
    ) -> Result<Vec<PinnedModel>, ProviderError> {
        // revision is read before locking so the guard never spans an await
        let revision_now = current_revision(&self.pool).await;
        {
            let cache = self.cache.lock().expect("registry mutex");
            if !cache.models.is_empty() && cache.revision == revision_now {
                return Ok(cache.models.get(&account.0).cloned().unwrap_or_default());
            }
        }
        let revision = current_revision(&self.pool).await;
        let mut fresh = HashMap::new();
        for row in store::read_provider_accounts(self.store())
            .await
            .map_err(integrity)?
        {
            let mut models = Vec::new();
            for m in store::read_provider_models(self.store(), &row.account_id)
                .await
                .map_err(integrity)?
            {
                let descriptor: ModelDescriptor = serde_json::from_str(&m.descriptor_json)
                    .map_err(|e| {
                        ProviderError::ProtocolParseError(format!(
                            "stored model descriptor corrupt for {}/{}: {e}",
                            row.account_id, m.model_id
                        ))
                    })?;
                models.push(PinnedModel {
                    model_id: descriptor.model_id.clone(),
                    digest: m.digest,
                    descriptor,
                });
            }
            fresh.insert(row.account_id, models);
        }
        let mut cache = self.cache.lock().expect("registry mutex");
        cache.revision = revision;
        cache.models = fresh;
        Ok(cache.models.get(&account.0).cloned().unwrap_or_default())
    }

    /// Insert-or-update a local account (alias/endpoint/profile). An endpoint
    /// change wipes cached model rows server-side (see event-log upsert).
    pub async fn upsert_account(&self, account: &LocalAccount) -> Result<(), ProviderError> {
        let row = store::ProviderAccountRow {
            account_id: account.account_id.0.clone(),
            kind: enum_to_json(account.kind),
            alias: account.alias.clone(),
            privacy_class: enum_to_json(account.privacy_class),
            endpoint_id: account.endpoint_id.0.clone(),
            base_url: account.base_url.clone(),
            approved_destination: account.approved_destination,
            status: "active".into(),
            created_at_us: 0,
            updated_at_us: 0,
        };
        store::upsert_provider_account(self.store(), &row)
            .await
            .map_err(integrity)?;
        self.drop_cache();
        Ok(())
    }

    /// Replace the account's digest-pinned model rows (discovery output).
    pub async fn replace_models(
        &self,
        account: &ProviderAccountId,
        models: &[(ModelId, String, ModelDescriptor)],
    ) -> Result<(), ProviderError> {
        let revision = current_revision(&self.pool).await;
        let mut rows = Vec::with_capacity(models.len());
        for (model_id, digest, descriptor) in models {
            let descriptor_json = serde_json::to_string(descriptor)
                .map_err(|e| ProviderError::ProtocolParseError(e.to_string()))?;
            rows.push(store::ProviderModelRow {
                account_id: account.0.clone(),
                model_id: model_id.0.clone(),
                digest: digest.clone(),
                descriptor_json,
                verified_revision: revision,
            });
        }
        store::upsert_provider_models(self.store(), &account.0, &rows)
            .await
            .map_err(integrity)?;
        self.drop_cache();
        Ok(())
    }

    fn drop_cache(&self) {
        let mut cache = self.cache.lock().expect("registry mutex");
        cache.models.clear();
    }
}

async fn current_revision(pool: &Pool<Sqlite>) -> i64 {
    store::read_provider_registry_revision(pool)
        .await
        .unwrap_or(0)
}

/// Storage-boundary failures surface as transport errors unless they are
/// integrity-grade; both keep corrupt state out of live configuration.
fn integrity(e: store::ProviderRegistryError) -> ProviderError {
    match e {
        store::ProviderRegistryError::Integrity(m) => {
            ProviderError::ProtocolParseError(format!("provider registry integrity: {m}"))
        }
        store::ProviderRegistryError::NotFound(m) => {
            ProviderError::EndpointPolicyViolation(format!("provider account not found: {m}"))
        }
        store::ProviderRegistryError::Storage(m) => ProviderError::TransportError(m),
    }
}

fn enum_to_json<T: serde::Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

fn enum_from_json<T: serde::de::DeserializeOwned>(raw: String) -> Result<T, ProviderError> {
    serde_json::from_value::<T>(Value::from(raw))
        .map_err(|e| ProviderError::ProtocolParseError(format!("stored enum invalid: {e}")))
}
