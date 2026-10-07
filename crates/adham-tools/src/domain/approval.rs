use crate::domain::proposal::ToolProposalId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ApprovalId(pub String);

impl ApprovalId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for ApprovalId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalScope {
    Once,
    Task,
    StandingRule,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ApprovalDecision {
    Approved { scope: ApprovalScope },
    Rejected { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub approval_id: ApprovalId,
    pub proposal_id: ToolProposalId,
    pub action_fingerprint: String,
    pub human_preview: String,
    pub required_scope: ApprovalScope,
    pub requested_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ApprovalRecord {
    pub request: ApprovalRequest,
    pub decision: Option<ApprovalDecision>,
    pub resolved_at_ms: Option<u64>,
}

impl ApprovalRecord {
    pub fn new(request: ApprovalRequest) -> Self {
        Self {
            request,
            decision: None,
            resolved_at_ms: None,
        }
    }

    pub fn resolve(&mut self, decision: ApprovalDecision, now_ms: u64) {
        self.decision = Some(decision);
        self.resolved_at_ms = Some(now_ms);
    }

    pub fn is_approved(&self) -> bool {
        matches!(self.decision, Some(ApprovalDecision::Approved { .. }))
    }
}
