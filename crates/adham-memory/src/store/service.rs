use crate::domain::proposal::{validate_memory_content, MemoryError, MemoryWriteProposal};
use crate::domain::record::{MemoryRecord, Provenance};
use crate::domain::scope::{MemoryId, MemoryScope};
use crate::domain::tombstone::TombstoneRecord;
use crate::store::memory_store::ScopedMemoryStore;

pub struct MemoryService {
    store: ScopedMemoryStore,
}

impl Default for MemoryService {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryService {
    pub fn new() -> Self {
        Self {
            store: ScopedMemoryStore::new(),
        }
    }

    pub fn commit_proposal(
        &mut self,
        proposal: MemoryWriteProposal,
        actor: &str,
        now_ms: u64,
    ) -> Result<MemoryId, MemoryError> {
        validate_memory_content(&proposal.content)?;

        let memory_id = MemoryId::new();
        let provenance = Provenance::new(actor, now_ms);
        let record = MemoryRecord::new(
            memory_id.clone(),
            proposal.scope,
            proposal.kind,
            proposal.topic,
            proposal.content,
            provenance,
        );

        self.store.insert(record);
        Ok(memory_id)
    }

    pub fn update_memory(
        &mut self,
        memory_id: &MemoryId,
        new_content: &str,
        expected_rev: u32,
        now_ms: u64,
    ) -> Result<u32, MemoryError> {
        validate_memory_content(new_content)?;

        if self.store.is_tombstoned(memory_id) {
            return Err(MemoryError::Tombstoned(memory_id.0.clone()));
        }

        let existing = self
            .store
            .get(memory_id)
            .ok_or_else(|| MemoryError::MemoryNotFound(memory_id.0.clone()))?
            .clone();

        if existing.revision != expected_rev {
            return Err(MemoryError::RevisionConflict {
                expected: expected_rev,
                actual: existing.revision,
            });
        }

        let new_revision = existing.revision + 1;
        let content_hash = blake3::hash(new_content.as_bytes()).to_hex().to_string();

        let mut updated = existing;
        updated.content = new_content.to_string();
        updated.content_hash = content_hash;
        updated.revision = new_revision;
        updated.provenance.recorded_at_ms = now_ms;

        self.store.update(updated);
        Ok(new_revision)
    }

    pub fn forget(
        &mut self,
        memory_id: &MemoryId,
        scope: &MemoryScope,
        reason: &str,
        now_ms: u64,
    ) -> Result<(), MemoryError> {
        let existing = self
            .store
            .get(memory_id)
            .ok_or_else(|| MemoryError::MemoryNotFound(memory_id.0.clone()))?;

        if &existing.scope != scope {
            return Err(MemoryError::ScopeMismatch);
        }

        let tombstone = TombstoneRecord::new(memory_id.clone(), scope.clone(), now_ms, reason);
        self.store.tombstone(tombstone);
        Ok(())
    }

    pub fn retrieve(&self, scope: &MemoryScope, topic_filter: Option<&str>) -> Vec<MemoryRecord> {
        match topic_filter {
            Some(topic) => self.store.query_by_topic(scope, topic),
            None => self.store.query_by_scope(scope),
        }
    }
}
