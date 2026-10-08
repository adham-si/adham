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
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskGraph {
    pub graph_id: GraphId,
    pub parent_run_id: String,
    pub nodes: Vec<NodeState>,
    pub edges: Vec<EdgeDefinition>,
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
        self.edges.push(edge);
        self.validate_acyclic()?;
        Ok(())
    }

    pub fn has_node(&self, id: &NodeId) -> bool {
        self.nodes.iter().any(|n| &n.definition.node_id == id)
    }

    pub fn get_node(&self, id: &NodeId) -> Option<&NodeState> {
        self.nodes.iter().find(|n| &n.definition.node_id == id)
    }

    pub fn get_node_mut(&mut self, id: &NodeId) -> Option<&mut NodeState> {
        self.nodes.iter_mut().find(|n| &n.definition.node_id == id)
    }

    pub fn validate_acyclic(&self) -> Result<(), GraphError> {
        let mut in_degree: HashMap<&str, usize> = HashMap::new();
        let mut adj: HashMap<&str, Vec<&str>> = HashMap::new();

        for node in &self.nodes {
            in_degree.insert(node.definition.node_id.as_str(), 0);
            adj.insert(node.definition.node_id.as_str(), Vec::new());
        }

        for edge in &self.edges {
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

        if visited_count != self.nodes.len() {
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
