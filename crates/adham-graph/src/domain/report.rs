use crate::domain::delegation::DelegationId;
use crate::domain::node::NodeId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChildReport {
    pub delegation_id: DelegationId,
    pub node_id: NodeId,
    pub summary: String,
    pub artifact_ref: Option<String>,
    pub tokens_used: u32,
    pub steps_used: u32,
    pub success: bool,
}

impl ChildReport {
    pub fn success(
        delegation_id: DelegationId,
        node_id: NodeId,
        summary: impl Into<String>,
        artifact_ref: Option<String>,
        tokens_used: u32,
        steps_used: u32,
    ) -> Self {
        Self {
            delegation_id,
            node_id,
            summary: summary.into(),
            artifact_ref,
            tokens_used,
            steps_used,
            success: true,
        }
    }

    pub fn failure(
        delegation_id: DelegationId,
        node_id: NodeId,
        summary: impl Into<String>,
        tokens_used: u32,
        steps_used: u32,
    ) -> Self {
        Self {
            delegation_id,
            node_id,
            summary: summary.into(),
            artifact_ref: None,
            tokens_used,
            steps_used,
            success: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ArtifactBinding {
    pub source_node_id: NodeId,
    pub target_node_id: NodeId,
    pub artifact_ref: String,
}
