use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum RevocationReason {
    SecurityQuarantine { details: String },
    SchemaChanged,
    ConnectionSuspended,
    UserRevoked,
    ScopeBoundaryExceeded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RevocationEvent {
    pub target_id: String,
    pub reason: RevocationReason,
    pub invalidated_generation: u64,
    pub timestamp_epoch_ms: u64,
}

impl RevocationEvent {
    pub fn new(
        target_id: impl Into<String>,
        reason: RevocationReason,
        invalidated_generation: u64,
        timestamp_epoch_ms: u64,
    ) -> Self {
        Self {
            target_id: target_id.into(),
            reason,
            invalidated_generation,
            timestamp_epoch_ms,
        }
    }
}
