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

    pub async fn load_or_create(pool: Pool<Sqlite>) -> Result<Self, adham_core_types::DomainError> {
        let rec = adham_event_log::load_or_create_installation(&pool).await?;
        let provider: Arc<dyn ContentKeyProvider> = Arc::new(
            OsKeyringProvider::default_for_installation(&rec.installation_id.to_string()),
        );
        // Touch the key early so missing/unavailable store fails fast.
        provider.content_key()?;
        Ok(Self::new(pool, rec.installation_id, rec.actor_id, provider))
    }

    pub async fn load_or_create_with_key(
        pool: Pool<Sqlite>,
        provider: Arc<dyn ContentKeyProvider>,
    ) -> Result<Self, adham_core_types::DomainError> {
        let rec = adham_event_log::load_or_create_installation(&pool).await?;
        Ok(Self::new(pool, rec.installation_id, rec.actor_id, provider))
    }
}
