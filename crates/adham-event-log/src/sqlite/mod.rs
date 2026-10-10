pub mod connection;
pub mod content_crypto;
pub mod content_key;
pub mod fingerprint;
pub mod health;
pub mod identity;
pub mod store;

pub use connection::create_sqlite_pool;
pub use content_crypto::{ENCODING_ENCRYPTED, PROTECTION_AEAD_V1};
pub use content_key::{
    ContentKeyProvider, InMemoryProvider, OsKeyringProvider, UnavailableKeyProvider,
};
pub use fingerprint::{request_fingerprint, scope_fingerprint};
pub use health::{verify_storage_health, StorageHealthReport};
pub use identity::{
    load_or_create_installation, set_active_scope, set_active_scope_tx, InstallationInit,
    InstallationRecord,
};
pub use store::{AppendEventRequest, AppendEventResult, CommandReceiptRecord, SqliteEventStore};
