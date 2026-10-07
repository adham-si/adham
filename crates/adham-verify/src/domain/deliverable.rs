use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliverableKind {
    PatchArtifact,
    AppliedTree,
    OutputArtifact,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CandidateDeliverable {
    pub candidate_id: String,
    pub kind: DeliverableKind,
    pub content_hash: String,
    pub baseline_hash: Option<String>,
    pub target_paths: Vec<String>,
}

impl CandidateDeliverable {
    pub fn new_patch(
        target_paths: Vec<String>,
        patch_content: &str,
        baseline_hash: Option<String>,
    ) -> Self {
        let content_hash = blake3::hash(patch_content.as_bytes()).to_hex().to_string();
        Self {
            candidate_id: Uuid::now_v7().to_string(),
            kind: DeliverableKind::PatchArtifact,
            content_hash,
            baseline_hash,
            target_paths,
        }
    }

    pub fn new_applied(target_paths: Vec<String>, state_bytes: &[u8]) -> Self {
        let content_hash = blake3::hash(state_bytes).to_hex().to_string();
        Self {
            candidate_id: Uuid::now_v7().to_string(),
            kind: DeliverableKind::AppliedTree,
            content_hash,
            baseline_hash: None,
            target_paths,
        }
    }
}
