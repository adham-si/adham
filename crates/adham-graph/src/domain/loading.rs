//! Validated loading boundary for task graphs.
//!
//! [`UncheckedTaskGraph`] is the deserialization DTO. It must never be used
//! directly as a graph: convert through `TryFrom` so malformed input cannot
//! become an accepted [`TaskGraph`]. Scheduling re-validates as defense in
//! depth.

use super::edge::EdgeDefinition;
use super::graph::{GraphError, GraphId, TaskGraph};
use super::node::{NodeLifecycle, NodeState};
use serde::Deserialize;
use std::collections::HashSet;

/// Unchecked deserialization DTO. Never used directly as a graph: convert
/// through `TryFrom` so malformed input cannot become an accepted
/// `TaskGraph`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct UncheckedTaskGraph {
    pub graph_id: GraphId,
    pub parent_run_id: String,
    pub nodes: Vec<NodeState>,
    pub edges: Vec<EdgeDefinition>,
}

impl TryFrom<UncheckedTaskGraph> for TaskGraph {
    type Error = GraphError;

    fn try_from(dto: UncheckedTaskGraph) -> Result<Self, Self::Error> {
        Self::from_validated_parts(dto.graph_id, dto.parent_run_id, dto.nodes, dto.edges)
    }
}

impl TaskGraph {
    /// Trust-boundary validation for deserialized graphs. Checks run in an
    /// order that reports the most specific corruption first: duplicate
    /// IDs, unknown endpoints, node-state coherence, then acyclicity.
    /// Pure: never mutates.
    pub fn validate_loaded(&self) -> Result<(), GraphError> {
        let mut seen = HashSet::new();
        for node in self.nodes() {
            if !seen.insert(node.definition.node_id.as_str()) {
                return Err(GraphError::DuplicateNodeId(
                    node.definition.node_id.0.clone(),
                ));
            }
        }

        // Endpoint checks run before the acyclic check so a missing node is
        // reported as such instead of a spurious cycle.
        for edge in self.edges() {
            if !self.has_node(&edge.from_node) {
                return Err(GraphError::UnknownUpstream {
                    node: edge.to_node.0.clone(),
                    upstream: edge.from_node.0.clone(),
                });
            }
            if !self.has_node(&edge.to_node) {
                return Err(GraphError::InvalidGraph(format!(
                    "edge {} references unknown node {}",
                    edge.edge_id.0, edge.to_node.0
                )));
            }
        }

        for node in self.nodes() {
            Self::validate_node_state(node)?;
        }

        self.validate_acyclic()
    }

    /// Node-state coherence under the existing lifecycle contract: side
    /// fields may only carry values their lifecycle can produce.
    fn validate_node_state(node: &NodeState) -> Result<(), GraphError> {
        use NodeLifecycle::*;
        let id = node.definition.node_id.0.as_str();
        let invalid = |why: &str| {
            GraphError::InvalidGraph(format!("node {id} in {:?}: {why}", node.lifecycle))
        };
        match node.lifecycle {
            Pending | Ready => {
                if node.delegation_id.is_some() {
                    return Err(invalid("delegation is only assigned when running"));
                }
                if node.output_artifact_ref.is_some() {
                    return Err(invalid("artifacts are only produced on completion"));
                }
                if node.failure_reason.is_some() {
                    return Err(invalid("unfailed nodes must not carry a failure reason"));
                }
            }
            Running => {
                if node.delegation_id.is_none() {
                    return Err(invalid("running nodes require a delegation id"));
                }
                if node.output_artifact_ref.is_some() {
                    return Err(invalid("artifacts are only produced on completion"));
                }
                if node.failure_reason.is_some() {
                    return Err(invalid("running nodes must not carry a failure reason"));
                }
            }
            Completed => {
                if node.failure_reason.is_some() {
                    return Err(invalid("completed nodes must not carry a failure reason"));
                }
            }
            Failed => {
                if node.failure_reason.is_none() {
                    return Err(invalid("failed nodes require a failure reason"));
                }
                if node.output_artifact_ref.is_some() {
                    return Err(invalid("failed nodes must not carry an artifact"));
                }
            }
            Canceled => {
                if node.output_artifact_ref.is_some() {
                    return Err(invalid("canceled nodes must not carry an artifact"));
                }
            }
            Skipped => {
                if node.failure_reason.is_none() {
                    return Err(invalid("skipped nodes require a failure reason"));
                }
                if node.output_artifact_ref.is_some() {
                    return Err(invalid("skipped nodes must not carry an artifact"));
                }
                if node.delegation_id.is_some() {
                    return Err(invalid("skipped nodes must not carry a delegation"));
                }
            }
        }
        Ok(())
    }
}
