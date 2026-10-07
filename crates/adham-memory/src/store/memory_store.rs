use crate::domain::record::MemoryRecord;
use crate::domain::scope::{MemoryId, MemoryScope};
use crate::domain::tombstone::TombstoneRecord;
use std::collections::{HashMap, HashSet};

#[derive(Debug, Default)]
pub struct ScopedMemoryStore {
    records: HashMap<MemoryId, MemoryRecord>,
    tombstones: HashSet<MemoryId>,
}

impl ScopedMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn insert(&mut self, record: MemoryRecord) {
        self.records.insert(record.memory_id.clone(), record);
    }

    pub fn update(&mut self, record: MemoryRecord) {
        self.records.insert(record.memory_id.clone(), record);
    }

    pub fn tombstone(&mut self, tombstone: TombstoneRecord) {
        self.tombstones.insert(tombstone.memory_id);
    }

    pub fn get(&self, id: &MemoryId) -> Option<&MemoryRecord> {
        if self.tombstones.contains(id) {
            None
        } else {
            self.records.get(id)
        }
    }

    pub fn is_tombstoned(&self, id: &MemoryId) -> bool {
        self.tombstones.contains(id)
    }

    pub fn query_by_scope(&self, scope: &MemoryScope) -> Vec<MemoryRecord> {
        self.records
            .values()
            .filter(|r| &r.scope == scope && !self.tombstones.contains(&r.memory_id))
            .cloned()
            .collect()
    }

    pub fn query_by_topic(&self, scope: &MemoryScope, topic: &str) -> Vec<MemoryRecord> {
        self.records
            .values()
            .filter(|r| {
                &r.scope == scope && r.topic == topic && !self.tombstones.contains(&r.memory_id)
            })
            .cloned()
            .collect()
    }
}
