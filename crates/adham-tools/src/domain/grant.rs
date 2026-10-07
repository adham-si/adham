use crate::domain::approval::ApprovalScope;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GrantId(pub String);

impl GrantId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for GrantId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ExecutionGrant {
    pub grant_id: GrantId,
    pub action_fingerprint: String,
    pub scope: ApprovalScope,
    pub issued_at_ms: u64,
    pub expires_at_ms: u64,
    pub consumed: bool,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GrantError {
    #[error("Execution grant has expired")]
    Expired,
    #[error("Execution grant was already consumed (single-use)")]
    AlreadyConsumed,
    #[error("Action fingerprint mismatch: expected {expected}, got {actual}")]
    FingerprintMismatch { expected: String, actual: String },
}

impl ExecutionGrant {
    pub fn issue(
        action_fingerprint: String,
        scope: ApprovalScope,
        now_ms: u64,
        ttl_ms: u64,
    ) -> Self {
        Self {
            grant_id: GrantId::new(),
            action_fingerprint,
            scope,
            issued_at_ms: now_ms,
            expires_at_ms: now_ms + ttl_ms,
            consumed: false,
        }
    }

    pub fn consume(&mut self, action_fingerprint: &str, now_ms: u64) -> Result<(), GrantError> {
        if now_ms > self.expires_at_ms {
            return Err(GrantError::Expired);
        }
        if self.action_fingerprint != action_fingerprint {
            return Err(GrantError::FingerprintMismatch {
                expected: self.action_fingerprint.clone(),
                actual: action_fingerprint.to_string(),
            });
        }
        if self.consumed && self.scope == ApprovalScope::Once {
            return Err(GrantError::AlreadyConsumed);
        }
        self.consumed = true;
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RootGrant {
    pub root_id: String,
    pub project_id: String,
    pub base_path: PathBuf,
}

impl RootGrant {
    pub fn new(
        root_id: impl Into<String>,
        project_id: impl Into<String>,
        base_path: PathBuf,
    ) -> Self {
        Self {
            root_id: root_id.into(),
            project_id: project_id.into(),
            base_path,
        }
    }
}
