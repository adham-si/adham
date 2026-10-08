use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct NodeId(pub String);

impl NodeId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeKind {
    Research,
    CodingProposal,
    Verification,
    Integration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NodeLifecycle {
    Pending,
    Ready,
    Running,
    Completed,
    Failed,
    Canceled,
    Skipped,
}

impl NodeLifecycle {
    pub fn is_terminal(&self) -> bool {
        matches!(
            self,
            Self::Completed | Self::Failed | Self::Canceled | Self::Skipped
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeDefinition {
    pub node_id: NodeId,
    pub kind: NodeKind,
    pub title: String,
    pub objective: String,
    pub allocated_tokens: u32,
    pub allocated_steps: u32,
}

impl NodeDefinition {
    pub fn new(
        node_id: impl Into<String>,
        kind: NodeKind,
        title: impl Into<String>,
        objective: impl Into<String>,
    ) -> Self {
        Self {
            node_id: NodeId::new(node_id),
            kind,
            title: title.into(),
            objective: objective.into(),
            allocated_tokens: 10_000,
            allocated_steps: 10,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeState {
    pub definition: NodeDefinition,
    pub lifecycle: NodeLifecycle,
    pub delegation_id: Option<String>,
    pub output_artifact_ref: Option<String>,
    pub failure_reason: Option<String>,
}

impl NodeState {
    pub fn new(definition: NodeDefinition) -> Self {
        Self {
            definition,
            lifecycle: NodeLifecycle::Pending,
            delegation_id: None,
            output_artifact_ref: None,
            failure_reason: None,
        }
    }
}
