pub mod connection;
pub mod store;

pub use connection::create_sqlite_pool;
pub use store::{AppendEventRequest, AppendEventResult, SqliteEventStore};
