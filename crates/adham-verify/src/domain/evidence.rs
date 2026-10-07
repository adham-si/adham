use crate::domain::check::CheckId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EvidenceId(pub String);

impl EvidenceId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for EvidenceId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EvidenceRecord {
    pub evidence_id: EvidenceId,
    pub check_id: CheckId,
    pub candidate_hash: String,
    pub contract_revision: u32,
    pub producer_version: String,
    pub exit_code: Option<i32>,
    pub captured_output_excerpt: String,
    pub recorded_at_ms: u64,
    pub ttl_ms: u64,
}

impl EvidenceRecord {
    pub fn new(
        check_id: CheckId,
        candidate_hash: impl Into<String>,
        contract_revision: u32,
        exit_code: Option<i32>,
        output: impl Into<String>,
        now_ms: u64,
        ttl_ms: u64,
    ) -> Self {
        Self {
            evidence_id: EvidenceId::new(),
            check_id,
            candidate_hash: candidate_hash.into(),
            contract_revision,
            producer_version: "1.0.0".to_string(),
            exit_code,
            captured_output_excerpt: output.into(),
            recorded_at_ms: now_ms,
            ttl_ms,
        }
    }

    pub fn is_fresh(&self, now_ms: u64) -> bool {
        now_ms <= self.recorded_at_ms + self.ttl_ms
    }

    pub fn matches_candidate(&self, candidate_hash: &str) -> bool {
        self.candidate_hash == candidate_hash
    }
}
