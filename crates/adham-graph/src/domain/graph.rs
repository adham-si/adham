use crate::domain::edge::EdgeDefinition;
use crate::domain::node::{NodeId, NodeLifecycle, NodeState};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct GraphId(pub String);

impl GraphId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for GraphId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GraphError {
    #[error("Cycle detected in task graph involving node: {0}")]
    CycleDetected(String),
    #[error("Referenced node not found in graph: {0}")]
    NodeNotFound(String),
    #[error("Duplicate node ID in graph: {0}")]
    DuplicateNodeId(String),
    #[error("Unknown node in graph: {0}")]
    UnknownNode(String),
    #[error("Illegal lifecycle transition for node {node}: {from:?} -> {to:?}")]
    IllegalTransition {
        node: String,
        from: NodeLifecycle,
        to: NodeLifecycle,
    },
    #[error("Unknown upstream node {upstream} referenced by node {node}")]
    UnknownUpstream { node: String, upstream: String },
    #[error("Invalid graph: {0}")]
    InvalidGraph(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct TaskGraph {
    graph_id: GraphId,
    parent_run_id: String,
    nodes: Vec<NodeState>,
    edges: Vec<EdgeDefinition>,
}

impl TaskGraph {
    pub fn new(parent_run_id: impl Into<String>) -> Self {
        Self {
            graph_id: GraphId::new(),
            parent_run_id: parent_run_id.into(),
            nodes: Vec::new(),
            edges: Vec::new(),
        }
    }

    /// Crate-internal validated constructor: the only way to build a graph
    /// from parts. Runs the trust-boundary check so in-crate code cannot
    /// bypass validation either.
    pub(crate) fn from_validated_parts(
        graph_id: GraphId,
        parent_run_id: String,
        nodes: Vec<NodeState>,
        edges: Vec<EdgeDefinition>,
    ) -> Result<Self, GraphError> {
        let graph = Self {
            graph_id,
            parent_run_id,
            nodes,
            edges,
        };
        graph.validate_loaded()?;
        Ok(graph)
    }

    pub fn add_node(&mut self, node: NodeState) -> Result<(), GraphError> {
        if self
            .nodes
            .iter()
            .any(|n| n.definition.node_id == node.definition.node_id)
        {
            return Err(GraphError::DuplicateNodeId(node.definition.node_id.0));
        }
        self.nodes.push(node);
        Ok(())
    }

    pub fn add_edge(&mut self, edge: EdgeDefinition) -> Result<(), GraphError> {
        if !self.has_node(&edge.from_node) {
            return Err(GraphError::NodeNotFound(edge.from_node.0));
        }
        if !self.has_node(&edge.to_node) {
            return Err(GraphError::NodeNotFound(edge.to_node.0));
        }
        // Validate the candidate before mutating: a rejected edge must
        // leave the graph identical to its pre-operation state.
        Self::validate_acyclic_with(&self.nodes, self.edges.iter().chain([&edge]))?;
        self.edges.push(edge);
        Ok(())
    }

    pub fn has_node(&self, id: &NodeId) -> bool {
        self.nodes.iter().any(|n| &n.definition.node_id == id)
    }

    /// Immutable readers: the aggregate exposes state but no direct
    /// mutation path. All mutation goes through validated methods.
    pub fn nodes(&self) -> &[NodeState] {
        &self.nodes
    }

    pub fn edges(&self) -> &[EdgeDefinition] {
        &self.edges
    }

    pub fn graph_id(&self) -> &GraphId {
        &self.graph_id
    }

    pub fn parent_run_id(&self) -> &str {
        &self.parent_run_id
    }

    pub fn get_node(&self, id: &NodeId) -> Option<&NodeState> {
        self.nodes.iter().find(|n| &n.definition.node_id == id)
    }

    /// Narrow crate-internal side-field setters. Lifecycle itself can only
    /// change through [`TaskGraph::transition_node`]; these helpers cannot
    /// alter lifecycle, reopen terminals, or create nodes.
    fn find_node_mut(&mut self, id: &NodeId) -> Option<&mut NodeState> {
        self.nodes.iter_mut().find(|n| &n.definition.node_id == id)
    }

    pub(crate) fn set_delegation_id(&mut self, id: &NodeId, delegation_id: String) -> bool {
        let Some(node) = self.find_node_mut(id) else {
            return false;
        };
        node.delegation_id = Some(delegation_id);
        true
    }

    pub(crate) fn set_output_artifact(
        &mut self,
        id: &NodeId,
        artifact_ref: Option<String>,
    ) -> bool {
        let Some(node) = self.find_node_mut(id) else {
            return false;
        };
        node.output_artifact_ref = artifact_ref;
        true
    }

    pub(crate) fn set_failure_reason(&mut self, id: &NodeId, reason: String) -> bool {
        let Some(node) = self.find_node_mut(id) else {
            return false;
        };
        node.failure_reason = Some(reason);
        true
    }

    /// Validated lifecycle transition. Unknown nodes and illegal moves
    /// (including any move out of a terminal state or a same-state repeat)
    /// return a typed error and leave the graph unchanged.
    pub fn transition_node(&mut self, id: &NodeId, to: NodeLifecycle) -> Result<(), GraphError> {
        let node = self
            .find_node_mut(id)
            .ok_or_else(|| GraphError::UnknownNode(id.0.clone()))?;
        let from = node.lifecycle;
        if !Self::is_transition_allowed(from, to) {
            return Err(GraphError::IllegalTransition {
                node: id.0.clone(),
                from,
                to,
            });
        }
        node.lifecycle = to;
        Ok(())
    }

    fn is_transition_allowed(from: NodeLifecycle, to: NodeLifecycle) -> bool {
        use NodeLifecycle::*;
        // Completed/Failed assert execution happened, so they require
        // Running (dispatch + delegation evidence). Ready may only take
        // non-execution outcomes (Running dispatch, Canceled, Skipped).
        matches!(
            (from, to),
            (Pending, Ready)
                | (Pending, Skipped)
                | (Ready, Running)
                | (Ready, Canceled)
                | (Ready, Skipped)
                | (Running, Completed)
                | (Running, Failed)
                | (Running, Canceled)
        )
    }

    pub fn validate_acyclic(&self) -> Result<(), GraphError> {
        Self::validate_acyclic_with(&self.nodes, self.edges.iter())
    }

    fn validate_acyclic_with<'a>(
        nodes: &'a [NodeState],
        edges: impl Iterator<Item = &'a EdgeDefinition>,
    ) -> Result<(), GraphError> {
        let mut in_degree: HashMap<&str, usize> = HashMap::new();
        let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();

        for node in nodes {
            in_degree.insert(node.definition.node_id.as_str(), 0);
            adj.insert(node.definition.node_id.as_str(), Vec::new());
        }

        for edge in edges {
            let from = edge.from_node.as_str();
            let to = edge.to_node.as_str();
            adj.entry(from).or_default().push(to);
            *in_degree.entry(to).or_default() += 1;
        }

        let mut queue: VecDeque<&str> = in_degree
            .iter()
            .filter(|(_, &deg)| deg == 0)
            .map(|(&id, _)| id)
            .collect();

        let mut visited_count = 0;

        while let Some(curr) = queue.pop_front() {
            visited_count += 1;
            if let Some(neighbors) = adj.get(curr) {
                for &neighbor in neighbors {
                    if let Some(deg) = in_degree.get_mut(neighbor) {
                        *deg -= 1;
                        if *deg == 0 {
                            queue.push_back(neighbor);
                        }
                    }
                }
            }
        }

        if visited_count != nodes.len() {
            let cycle_node = in_degree
                .iter()
                .find(|(_, &deg)| deg > 0)
                .map(|(&id, _)| id)
                .unwrap_or("unknown");
            return Err(GraphError::CycleDetected(cycle_node.to_string()));
        }

        Ok(())
    }

    pub fn is_all_completed(&self) -> bool {
        !self.nodes.is_empty()
            && self
                .nodes
                .iter()
                .all(|n| n.lifecycle == NodeLifecycle::Completed)
    }

    pub fn has_any_failed(&self) -> bool {
        self.nodes
            .iter()
            .any(|n| n.lifecycle == NodeLifecycle::Failed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::edge::EdgeDefinition;
    use crate::domain::node::{NodeDefinition, NodeKind};
    use crate::engine::scheduler::advance_graph_state;

    fn pending_node(id: &str) -> NodeState {
        NodeState::new(NodeDefinition::new(id, NodeKind::Research, id, ""))
    }

    #[test]
    fn rejected_schedule_leaves_graph_unchanged() {
        // Built literally: the ghost upstream cannot be constructed through
        // any validated API, which is exactly what makes this a scheduling
        // defense-in-depth probe.
        let mut graph = TaskGraph {
            graph_id: GraphId::new(),
            parent_run_id: "run-x".to_string(),
            nodes: vec![pending_node("lonely")],
            edges: vec![EdgeDefinition::prerequisite("ghost", "lonely")],
        };
        let snapshot = graph.clone();
        let err = advance_graph_state(&mut graph).unwrap_err();
        assert!(matches!(err, GraphError::UnknownUpstream { .. }));
        assert_eq!(graph, snapshot);
    }
}
