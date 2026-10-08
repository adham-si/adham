mod content;
mod events;
mod receipts;

use adham_core_types::*;
use sqlx::{Pool, Sqlite};

pub struct SqliteEventStore {
    pool: Pool<Sqlite>,
}

#[derive(Debug, Clone)]
pub struct AppendEventRequest {
    pub stream_id: String,
    pub stream_kind: String,
    pub expected_sequence: u64,
    pub event_type: String,
    pub event_version: u16,
    pub scope: EventScope,
    pub actor: EventActor,
    pub request_id: RequestId,
    pub correlation_id: CorrelationId,
    pub causation_id: Option<EventId>,
    pub payload_json: Vec<u8>,
    pub metadata_json: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct AppendEventResult {
    pub event_id: EventId,
    pub stream_sequence: u64,
    pub global_position: i64,
    pub checksum: String,
}

#[derive(Debug, Clone)]
pub struct CommandReceiptRecord {
    pub request_id: String,
    pub command_type: String,
    pub command_version: i32,
    pub scope_fingerprint: String,
    pub request_fingerprint: String,
    pub actor_id: String,
    pub correlation_id: String,
    pub outcome_code: String,
    pub response_json: Vec<u8>,
}

impl SqliteEventStore {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }
}
