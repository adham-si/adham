use crate::domain::graph::{GraphError, TaskGraph};
use crate::domain::node::{NodeId, NodeLifecycle};

/// Validates the graph and computes pending transitions before applying
/// any mutation, so an error leaves the graph identical to its
/// pre-operation state. Unknown upstreams are typed invalid-graph errors
/// (never read as satisfied); known failed/canceled/skipped upstreams
/// follow the explicit dependency-failure policy (dependent is skipped).
pub fn advance_graph_state(graph: &mut TaskGraph) -> Result<Vec<NodeId>, GraphError> {
    // Defense in depth: reject structurally invalid graphs before computing
    // or applying anything. Endpoint checks inside run before the acyclic
    // check so a missing node is reported as such, not a spurious cycle.
    graph.validate_loaded()?;

    // Phase 2: compute decisions purely (no mutation).
    let mut newly_ready = Vec::new();
    let mut nodes_to_skip = Vec::new();

    for node in graph.nodes() {
        if node.lifecycle() != NodeLifecycle::Pending {
            continue;
        }

        let node_id = &node.definition.node_id;
        let incoming: Vec<_> = graph
            .edges()
            .iter()
            .filter(|e| &e.to_node == node_id)
            .collect();

        if incoming.is_empty() {
            // Root node with no prerequisites becomes Ready immediately
            newly_ready.push(node_id.clone());
            continue;
        }

        let mut all_completed = true;
        let mut any_failed = false;

        for edge in incoming {
            // Presence validated above; absence here is unreachable.
            let upstream =
                graph
                    .get_node(&edge.from_node)
                    .ok_or_else(|| GraphError::UnknownUpstream {
                        node: node_id.0.clone(),
                        upstream: edge.from_node.0.clone(),
                    })?;
            match upstream.lifecycle() {
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

        if any_failed {
            nodes_to_skip.push(node_id.clone());
        } else if all_completed {
            newly_ready.push(node_id.clone());
        }
    }

    // Phase 3: apply via atomic domain operations. These cannot fail: every
    // target was observed Pending in phase 2 on the same unmutated graph,
    // and prerequisites cannot regress while only Pending nodes change.
    for id in &nodes_to_skip {
        graph
            .skip(id, "Prerequisite dependency failed or canceled".to_string())
            .map_err(|e| GraphError::InvalidGraph(format!("scheduling transition failed: {e}")))?;
    }

    for id in &newly_ready {
        graph
            .admit_ready(id)
            .map_err(|e| GraphError::InvalidGraph(format!("scheduling transition failed: {e}")))?;
    }

    Ok(newly_ready)
}

/// Engine wrappers over the atomic domain operations. Admission,
/// metadata, and prerequisite checks live in the domain; these preserve
/// the engine call shape used by the coordinator.
pub fn mark_node_running(
    graph: &mut TaskGraph,
    node_id: &NodeId,
    delegation_id: String,
) -> Result<(), GraphError> {
    graph.dispatch(node_id, delegation_id)
}

pub fn mark_node_completed(
    graph: &mut TaskGraph,
    node_id: &NodeId,
    artifact_ref: Option<String>,
) -> Result<(), GraphError> {
    graph.complete(node_id, artifact_ref)
}

pub fn mark_node_failed(
    graph: &mut TaskGraph,
    node_id: &NodeId,
    reason: String,
) -> Result<(), GraphError> {
    graph.fail(node_id, reason)
}
