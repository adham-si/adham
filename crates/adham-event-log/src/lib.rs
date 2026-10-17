pub mod checksum;
pub mod sqlite;

pub use checksum::ChecksumCalculator;
pub use sqlite::provider_credentials;
pub use sqlite::provider_registry;
pub use sqlite::{
    create_sqlite_pool, load_or_create_installation, put_provider_credential, read_preferences,
    read_provider_accounts, read_provider_credential_plaintext, read_provider_models,
    read_provider_registry_revision, remove_provider_credential, request_fingerprint,
    reset_preferences, scope_fingerprint, set_active_scope, set_active_scope_tx,
    upsert_provider_account, upsert_provider_models, verify_storage_health, write_preferences,
    AppendEventRequest, AppendEventResult, CommandReceiptRecord, ContentKeyProvider,
    HydratedPendingOperation, InMemoryProvider, InstallationInit, InstallationRecord,
    OsKeyringProvider, PendingOperationRecord, PreferenceWriteError, ProviderAccountRow,
    ProviderModelRow, ProviderRegistryError, SqliteEventStore, StorageHealthReport,
    StoredPreferences, UnavailableKeyProvider, ENCODING_ENCRYPTED, PREFERENCES_SCHEMA_VERSION,
    PROTECTION_AEAD_V1, PROVIDER_REGISTRY_SCHEMA_VERSION,
};
