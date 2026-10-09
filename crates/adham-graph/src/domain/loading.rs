//! Validated loading boundary for task graphs.
//!
//! [`UncheckedTaskGraph`] is the deserialization DTO. It must never be used
//! directly as a graph: convert through `TryFrom` so malformed input cannot
//! become an accepted [`TaskGraph`]. Scheduling re-validates as defense in
//! depth.

use super::edge::EdgeDefinition;
use super::graph::{GraphError, GraphId, TaskGraph};
use super::node::{has_text, NodeId, NodeLifecycle, NodeState};
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
        Self::validate_loaded_with(self.nodes(), self.edges())
    }

    /// Full proposed-graph validation shared by restoration and edge
    /// insertion: a candidate edge must keep the whole graph loadable.
    /// Pure: never mutates.
    pub(crate) fn validate_loaded_with(
        nodes: &[NodeState],
        edges: &[EdgeDefinition],
    ) -> Result<(), GraphError> {
        let has_node = |id: &NodeId| nodes.iter().any(|n| &n.definition.node_id == id);
        let mut seen = HashSet::new();
        for node in nodes {
            if !seen.insert(node.definition.node_id.as_str()) {
                return Err(GraphError::DuplicateNodeId(
                    node.definition.node_id.0.clone(),
                ));
            }
        }

        // Endpoint checks run before the acyclic check so a missing node is
        // reported as such instead of a spurious cycle.
        for edge in edges {
            if !has_node(&edge.from_node) {
                return Err(GraphError::UnknownUpstream {
                    node: edge.to_node.0.clone(),
                    upstream: edge.from_node.0.clone(),
                });
            }
            if !has_node(&edge.to_node) {
                return Err(GraphError::InvalidGraph(format!(
                    "edge {} references unknown node {}",
                    edge.edge_id.0, edge.to_node.0
                )));
            }
        }

        for node in nodes {
            Self::validate_node_state(node)?;
        }

        for node in nodes {
            Self::validate_admission(node, nodes, edges)?;
        }

        Self::validate_acyclic_with(nodes, edges.iter())
    }

    /// Admission consistency: local state coherence, not proof of real
    /// execution. Admitted nodes (Ready/Running) and execution-terminal
    /// nodes (Completed/Failed/Canceled) cannot have unsatisfied
    /// prerequisites — scheduling ignores already-Ready nodes and the
    /// coordinator dispatches them, so an unadmitted Ready would execute
    /// without its dependencies. Dispatch metadata itself (non-empty
    /// delegation/reason) is enforced by node-state coherence; this
    /// function covers topology relationships only.
    fn validate_admission(
        node: &NodeState,
        nodes: &[NodeState],
        edges: &[EdgeDefinition],
    ) -> Result<(), GraphError> {
        use NodeLifecycle::*;
        let id = &node.definition.node_id;
        let node_lifecycle = |wanted: &NodeId| {
            nodes
                .iter()
                .find(|n| &n.definition.node_id == wanted)
                .map(|n| n.lifecycle())
        };
        let incoming: Vec<&EdgeDefinition> = edges.iter().filter(|e| &e.to_node == id).collect();
        let invalid = |why: String| {
            GraphError::InvalidGraph(format!("node {} in {:?}: {why}", id.0, node.lifecycle()))
        };
        match node.lifecycle() {
            Pending => Ok(()),
            Ready | Running | Completed | Failed | Canceled => {
                for edge in &incoming {
                    let upstream = edge.from_node.clone();
                    let state = node_lifecycle(&edge.from_node)
                        .ok_or_else(|| invalid(format!("unknown upstream {}", upstream.0)))?;
                    if state != Completed {
                        return Err(invalid(format!(
                            "prerequisite {} is {state:?}, not completed",
                            upstream.0
                        )));
                    }
                }
                Ok(())
            }
            Skipped => {
                if incoming.is_empty() {
                    return Err(invalid(
                        "skipped nodes require a failed prerequisite witness".to_string(),
                    ));
                }
                let witnessed = incoming.iter().any(|edge| {
                    node_lifecycle(&edge.from_node)
                        .is_some_and(|s| matches!(s, Failed | Canceled | Skipped))
                });
                if !witnessed {
                    return Err(invalid(
                        "skipped nodes require a failed, canceled, or skipped upstream".to_string(),
                    ));
                }
                Ok(())
            }
        }
    }

    /// Node-state coherence under the existing lifecycle contract: side
    /// fields may only carry values their lifecycle can produce.
    fn validate_node_state(node: &NodeState) -> Result<(), GraphError> {
        use NodeLifecycle::*;
        let id = node.definition.node_id.0.as_str();
        let invalid = |why: &str| {
            GraphError::InvalidGraph(format!("node {id} in {:?}: {why}", node.lifecycle()))
        };
        match node.lifecycle() {
            Pending | Ready => {
                if node.delegation_id().is_some() {
                    return Err(invalid("delegation is only assigned when running"));
                }
                if node.output_artifact_ref().is_some() {
                    return Err(invalid("artifacts are only produced on completion"));
                }
                if node.failure_reason().is_some() {
                    return Err(invalid("unfailed nodes must not carry a failure reason"));
                }
            }
            Running => {
                if !has_text(node.delegation_id()) {
                    return Err(invalid("running nodes require a delegation id"));
                }
                if node.output_artifact_ref().is_some() {
                    return Err(invalid("artifacts are only produced on completion"));
                }
                if node.failure_reason().is_some() {
                    return Err(invalid("running nodes must not carry a failure reason"));
                }
            }
            Completed => {
                if !has_text(node.delegation_id()) {
                    return Err(invalid("completed nodes must retain dispatch delegation"));
                }
                if node.failure_reason().is_some() {
                    return Err(invalid("completed nodes must not carry a failure reason"));
                }
            }
            Failed => {
                if !has_text(node.delegation_id()) {
                    return Err(invalid("failed nodes must retain dispatch delegation"));
                }
                if !has_text(node.failure_reason()) {
                    return Err(invalid("failed nodes require a failure reason"));
                }
                if node.output_artifact_ref().is_some() {
                    return Err(invalid("failed nodes must not carry an artifact"));
                }
            }
            Canceled => {
                if node.output_artifact_ref().is_some() {
                    return Err(invalid("canceled nodes must not carry an artifact"));
                }
            }
            Skipped => {
                if !has_text(node.failure_reason()) {
                    return Err(invalid("skipped nodes require a failure reason"));
                }
                if node.output_artifact_ref().is_some() {
                    return Err(invalid("skipped nodes must not carry an artifact"));
                }
                if node.delegation_id().is_some() {
                    return Err(invalid("skipped nodes must not carry a delegation"));
                }
            }
        }
        Ok(())
    }
}
