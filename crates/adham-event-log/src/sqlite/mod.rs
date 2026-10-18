pub mod connection;
pub mod content_crypto;
pub mod content_key;
pub mod fingerprint;
pub mod health;
pub mod identity;
pub mod preferences;
pub mod provider_registry;
pub mod store;

pub use connection::create_sqlite_pool;
pub use content_crypto::{ENCODING_ENCRYPTED, PROTECTION_AEAD_V1};
pub use content_key::{
    ContentKeyProvider, InMemoryProvider, OsKeyringProvider, UnavailableKeyProvider,
};
pub use fingerprint::{request_fingerprint, scope_fingerprint};
pub use health::{StorageHealthReport, verify_storage_health};
pub use identity::{
    InstallationInit, InstallationRecord, load_or_create_installation, set_active_scope,
    set_active_scope_tx,
};
pub use preferences::{
    PREFERENCES_SCHEMA_VERSION, PreferenceWriteError, StoredPreferences, read_preferences,
    reset_preferences, write_preferences,
};
pub use provider_registry::{
    PROVIDER_REGISTRY_SCHEMA_VERSION, ProviderAccountRow, ProviderModelRow, ProviderRegistryError,
    invalidate_provider_models, read_provider_accounts, read_provider_models,
    read_provider_registry_revision, upsert_provider_account, upsert_provider_models,
};
pub use store::{
    AppendEventRequest, AppendEventResult, CommandReceiptRecord, HydratedPendingOperation,
    PendingOperationRecord, SqliteEventStore,
};
