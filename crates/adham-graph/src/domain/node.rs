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
    lifecycle: NodeLifecycle,
    delegation_id: Option<String>,
    output_artifact_ref: Option<String>,
    failure_reason: Option<String>,
}

impl NodeState {
    /// The validated creation command: a fresh Pending node with empty
    /// side fields. Stateful nodes are restored through the loading
    /// boundary, never through normal insertion.
    pub fn new(definition: NodeDefinition) -> Self {
        Self {
            definition,
            lifecycle: NodeLifecycle::Pending,
            delegation_id: None,
            output_artifact_ref: None,
            failure_reason: None,
        }
    }

    /// Fresh-Pending check used by insertion: normal insertion accepts
    /// only nodes no lifecycle event has touched.
    pub(crate) fn is_fresh_pending(&self) -> bool {
        self.lifecycle == NodeLifecycle::Pending
            && self.delegation_id.is_none()
            && self.output_artifact_ref.is_none()
            && self.failure_reason.is_none()
    }

    pub fn lifecycle(&self) -> NodeLifecycle {
        self.lifecycle
    }

    pub fn delegation_id(&self) -> Option<&str> {
        self.delegation_id.as_deref()
    }

    pub fn output_artifact_ref(&self) -> Option<&str> {
        self.output_artifact_ref.as_deref()
    }

    pub fn failure_reason(&self) -> Option<&str> {
        self.failure_reason.as_deref()
    }

    pub(crate) fn set_lifecycle(&mut self, lifecycle: NodeLifecycle) {
        self.lifecycle = lifecycle;
    }

    pub(crate) fn set_delegation_id(&mut self, delegation_id: Option<String>) {
        self.delegation_id = delegation_id;
    }

    pub(crate) fn set_output_artifact_ref(&mut self, artifact_ref: Option<String>) {
        self.output_artifact_ref = artifact_ref;
    }

    pub(crate) fn set_failure_reason(&mut self, reason: Option<String>) {
        self.failure_reason = reason;
    }
}

/// Shared metadata predicate: required delegation/reason fields must be
/// present AND non-empty. Operations and restoration use this same
/// predicate, so presence alone never counts as validity.
pub(crate) fn has_text(value: Option<&str>) -> bool {
    value.is_some_and(|v| !v.is_empty())
}
