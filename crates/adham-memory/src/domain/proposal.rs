use crate::domain::record::MemoryKind;
use crate::domain::scope::MemoryScope;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MemoryProposalId(pub String);

impl MemoryProposalId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for MemoryProposalId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum MemoryError {
    #[error("Memory write rejected: contains prohibited sensitive pattern '{0}'")]
    SensitiveContentForbidden(String),
    #[error("Scope mismatch: memory belongs to a different project or session")]
    ScopeMismatch,
    #[error("Revision conflict: expected revision {expected}, but actual is {actual}")]
    RevisionConflict { expected: u32, actual: u32 },
    #[error("Memory record '{0}' not found")]
    MemoryNotFound(String),
    #[error("Memory record '{0}' has been tombstoned")]
    Tombstoned(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemoryWriteProposal {
    pub proposal_id: MemoryProposalId,
    pub scope: MemoryScope,
    pub kind: MemoryKind,
    pub topic: String,
    pub content: String,
    pub expected_revision: Option<u32>,
}

impl MemoryWriteProposal {
    pub fn new(
        scope: MemoryScope,
        kind: MemoryKind,
        topic: impl Into<String>,
        content: impl Into<String>,
        expected_revision: Option<u32>,
    ) -> Result<Self, MemoryError> {
        let content_str = content.into();
        validate_memory_content(&content_str)?;
        Ok(Self {
            proposal_id: MemoryProposalId::new(),
            scope,
            kind,
            topic: topic.into(),
            content: content_str,
            expected_revision,
        })
    }
}

pub fn validate_memory_content(content: &str) -> Result<(), MemoryError> {
    let lower = content.to_lowercase();
    let prohibited_patterns = [
        "begin private key",
        "api_key",
        "apikey",
        "bearer ",
        "sk-proj-",
        "ghp_",
        "password",
        "passwd",
        "secret_key",
    ];

    for pattern in prohibited_patterns {
        if lower.contains(pattern) {
            return Err(MemoryError::SensitiveContentForbidden(pattern.to_string()));
        }
    }

    Ok(())
}
