pub mod conversation;
pub mod message;
pub mod session;
pub mod system;
pub mod workspace;

pub use conversation::*;
pub use message::*;
pub use session::*;
pub use system::*;
pub use workspace::*;

use adham_core_types::*;
use adham_event_log::{ContentKeyProvider, OsKeyringProvider, SqliteEventStore};
use sqlx::{Pool, Sqlite};
use std::sync::Arc;

pub struct ApiContext {
    pub store: SqliteEventStore,
    pub pool: Pool<Sqlite>,
    pub installation_id: InstallationId,
    pub actor_id: ActorId,
    pub content_key: Arc<dyn ContentKeyProvider>,
}

impl ApiContext {
    pub fn new(
        pool: Pool<Sqlite>,
        installation_id: InstallationId,
        actor_id: ActorId,
        content_key: Arc<dyn ContentKeyProvider>,
    ) -> Self {
        Self {
            store: SqliteEventStore::new(pool.clone()),
            pool,
            installation_id,
            actor_id,
            content_key,
        }
    }

    /// Production startup path.
    ///
    /// Fail-closed ordering: (1) reject non-persistent (mock) credential
    /// backends before any initialization write; (2) load or atomically create
    /// the installation record; (3) only the create-INSERT winner initializes
    /// the content key — everyone else reads it, and a missing key on an
    /// existing installation is an explicit key-loss error, never a mint.
    pub async fn load_or_create(pool: Pool<Sqlite>) -> Result<Self, adham_core_types::DomainError> {
        OsKeyringProvider::ensure_persistent_backend()?;
        let init = adham_event_log::load_or_create_installation(&pool).await?;
        let provider =
            OsKeyringProvider::default_for_installation(&init.record.installation_id.to_string());
        if init.created {
            provider.initialize_content_key()?;
        } else {
            provider.content_key()?;
        }
        Ok(Self::new(
            pool,
            init.record.installation_id,
            init.record.actor_id,
            Arc::new(provider),
        ))
    }

    pub async fn load_or_create_with_key(
        pool: Pool<Sqlite>,
        provider: Arc<dyn ContentKeyProvider>,
    ) -> Result<Self, adham_core_types::DomainError> {
        let init = adham_event_log::load_or_create_installation(&pool).await?;
        Ok(Self::new(
            pool,
            init.record.installation_id,
            init.record.actor_id,
            provider,
        ))
    }
}
