use crate::domain::scope::{MemoryId, MemoryScope};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryKind {
    Fact,
    Decision,
    Constraint,
    Preference,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Provenance {
    pub source_actor: String,
    pub source_session_id: Option<String>,
    pub source_task_id: Option<String>,
    pub recorded_at_ms: u64,
}

impl Provenance {
    pub fn new(source_actor: impl Into<String>, recorded_at_ms: u64) -> Self {
        Self {
            source_actor: source_actor.into(),
            source_session_id: None,
            source_task_id: None,
            recorded_at_ms,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryRecord {
    pub memory_id: MemoryId,
    pub scope: MemoryScope,
    pub kind: MemoryKind,
    pub topic: String,
    pub content: String,
    pub revision: u32,
    pub content_hash: String,
    pub provenance: Provenance,
}

impl MemoryRecord {
    pub fn new(
        memory_id: MemoryId,
        scope: MemoryScope,
        kind: MemoryKind,
        topic: impl Into<String>,
        content: impl Into<String>,
        provenance: Provenance,
    ) -> Self {
        let content_str = content.into();
        let content_hash = blake3::hash(content_str.as_bytes()).to_hex().to_string();
        Self {
            memory_id,
            scope,
            kind,
            topic: topic.into(),
            content: content_str,
            revision: 1,
            content_hash,
            provenance,
        }
    }
}
