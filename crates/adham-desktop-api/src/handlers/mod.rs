pub mod session;
pub mod system;
pub mod workspace;

pub use session::*;
pub use system::*;
pub use workspace::*;

use adham_core_types::*;
use adham_event_log::SqliteEventStore;
use sqlx::{Pool, Sqlite};

pub struct ApiContext {
    pub store: SqliteEventStore,
    pub pool: Pool<Sqlite>,
    pub installation_id: InstallationId,
}

impl ApiContext {
    pub fn new(pool: Pool<Sqlite>, installation_id: InstallationId) -> Self {
        Self {
            store: SqliteEventStore::new(pool.clone()),
            pool,
            installation_id,
        }
    }
}
