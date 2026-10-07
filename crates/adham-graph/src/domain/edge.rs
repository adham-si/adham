use crate::domain::node::NodeId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct EdgeId(pub String);

impl EdgeId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for EdgeId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DependencyKind {
    Prerequisite,
    ArtifactTransfer,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EdgeDefinition {
    pub edge_id: EdgeId,
    pub from_node: NodeId,
    pub to_node: NodeId,
    pub kind: DependencyKind,
}

impl EdgeDefinition {
    pub fn prerequisite(from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            edge_id: EdgeId::new(),
            from_node: NodeId::new(from),
            to_node: NodeId::new(to),
            kind: DependencyKind::Prerequisite,
        }
    }

    pub fn artifact_transfer(from: impl Into<String>, to: impl Into<String>) -> Self {
        Self {
            edge_id: EdgeId::new(),
            from_node: NodeId::new(from),
            to_node: NodeId::new(to),
            kind: DependencyKind::ArtifactTransfer,
        }
    }
}
