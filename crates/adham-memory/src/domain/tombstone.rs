use crate::domain::scope::{MemoryId, MemoryScope};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TombstoneRecord {
    pub memory_id: MemoryId,
    pub scope: MemoryScope,
    pub tombstoned_at_ms: u64,
    pub reason: String,
}

impl TombstoneRecord {
    pub fn new(
        memory_id: MemoryId,
        scope: MemoryScope,
        now_ms: u64,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            memory_id,
            scope,
            tombstoned_at_ms: now_ms,
            reason: reason.into(),
        }
    }
}
