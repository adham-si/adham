use crate::domain::graph::TaskGraph;
use crate::domain::node::{NodeId, NodeLifecycle};

pub fn advance_graph_state(graph: &mut TaskGraph) -> Vec<NodeId> {
    let mut newly_ready = Vec::new();
    let mut nodes_to_skip = Vec::new();

    for node in &graph.nodes {
        if node.lifecycle != NodeLifecycle::Pending {
            continue;
        }

        let node_id = &node.definition.node_id;
        let incoming_edges: Vec<_> = graph
            .edges
            .iter()
            .filter(|e| &e.to_node == node_id)
            .collect();

        if incoming_edges.is_empty() {
            // Root node with no prerequisites becomes Ready immediately
            newly_ready.push(node_id.clone());
            continue;
        }

        let mut all_completed = true;
        let mut any_failed = false;

        for edge in incoming_edges {
            if let Some(upstream) = graph.get_node(&edge.from_node) {
                match upstream.lifecycle {
                    NodeLifecycle::Completed => {}
                    NodeLifecycle::Failed | NodeLifecycle::Canceled | NodeLifecycle::Skipped => {
                        any_failed = true;
                        all_completed = false;
                        break;
                    }
                    _ => {
                        all_completed = false;
                    }
                }
            }
        }

        if any_failed {
            nodes_to_skip.push(node_id.clone());
        } else if all_completed {
            newly_ready.push(node_id.clone());
        }
    }

    for id in &nodes_to_skip {
        if let Some(n) = graph.get_node_mut(id) {
            n.lifecycle = NodeLifecycle::Skipped;
            n.failure_reason = Some("Prerequisite dependency failed or canceled".to_string());
        }
    }

    for id in &newly_ready {
        if let Some(n) = graph.get_node_mut(id) {
            n.lifecycle = NodeLifecycle::Ready;
        }
    }

    newly_ready
}

pub fn mark_node_running(graph: &mut TaskGraph, node_id: &NodeId, delegation_id: String) {
    if let Some(n) = graph.get_node_mut(node_id) {
        n.lifecycle = NodeLifecycle::Running;
        n.delegation_id = Some(delegation_id);
    }
}

pub fn mark_node_completed(graph: &mut TaskGraph, node_id: &NodeId, artifact_ref: Option<String>) {
    if let Some(n) = graph.get_node_mut(node_id) {
        n.lifecycle = NodeLifecycle::Completed;
        n.output_artifact_ref = artifact_ref;
    }
}

pub fn mark_node_failed(graph: &mut TaskGraph, node_id: &NodeId, reason: String) {
    if let Some(n) = graph.get_node_mut(node_id) {
        n.lifecycle = NodeLifecycle::Failed;
        n.failure_reason = Some(reason);
    }
}
