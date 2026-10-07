use crate::domain::node::NodeId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct DelegationId(pub String);

impl DelegationId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for DelegationId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DelegationContract {
    pub delegation_id: DelegationId,
    pub node_id: NodeId,
    pub child_session_id: String,
    pub child_run_id: String,
    pub context_shard: String,
    pub budget_tokens: u32,
    pub budget_steps: u32,
    pub assigned_at_ms: u64,
}

impl DelegationContract {
    pub fn new(
        node_id: NodeId,
        child_session_id: impl Into<String>,
        child_run_id: impl Into<String>,
        context_shard: impl Into<String>,
        budget_tokens: u32,
        budget_steps: u32,
        assigned_at_ms: u64,
    ) -> Self {
        Self {
            delegation_id: DelegationId::new(),
            node_id,
            child_session_id: child_session_id.into(),
            child_run_id: child_run_id.into(),
            context_shard: context_shard.into(),
            budget_tokens,
            budget_steps,
            assigned_at_ms,
        }
    }
}
