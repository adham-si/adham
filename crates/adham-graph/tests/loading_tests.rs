use adham_graph::domain::graph::{GraphError, TaskGraph};
use adham_graph::domain::loading::UncheckedTaskGraph;

fn node_json(id: &str, lifecycle: &str) -> serde_json::Value {
    serde_json::json!({
        "definition": {"node_id": id, "kind": "research", "title": id,
                       "objective": "", "allocated_tokens": 1, "allocated_steps": 1},
        "lifecycle": lifecycle, "delegation_id": null,
        "output_artifact_ref": null, "failure_reason": null
    })
}

fn edge_json(id: &str, from: &str, to: &str) -> serde_json::Value {
    serde_json::json!({"edge_id": id, "from_node": from, "to_node": to,
                       "kind": "prerequisite"})
}

fn load(json: serde_json::Value) -> Result<TaskGraph, GraphError> {
    let dto: UncheckedTaskGraph = serde_json::from_value(json).unwrap();
    TaskGraph::try_from(dto)
}

fn valid_two_node() -> serde_json::Value {
    serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("a", "pending"), node_json("b", "pending")],
        "edges": [edge_json("e1", "a", "b")]
    })
}

#[test]
fn test_valid_loaded_graph_is_accepted() {
    let graph = load(valid_two_node()).unwrap();
    assert_eq!(graph.nodes().len(), 2);
    assert_eq!(graph.edges().len(), 1);
}

#[test]
fn test_ready_with_pending_prerequisite_is_rejected() {
    // Admission consistency: a Ready node must have completed
    // prerequisites, otherwise scheduling would ignore it and the
    // coordinator would dispatch unadmitted work.
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("a", "pending"), node_json("b", "ready")],
        "edges": [edge_json("e1", "a", "b")]
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_completed_without_delegation_is_rejected() {
    // Dispatch metadata is retained: Completed implies dispatched.
    let mut node = node_json("a", "completed");
    node["output_artifact_ref"] = serde_json::json!("artifact-1");
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node],
        "edges": []
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_successful_command_graph_survives_validated_reload() {
    // Round-trip: a graph built only through validated commands must
    // serialize and reload cleanly.
    use adham_graph::domain::edge::EdgeDefinition;
    use adham_graph::domain::node::{NodeDefinition, NodeId, NodeKind, NodeState};
    let mut graph = TaskGraph::new("run-rt");
    graph
        .add_node(NodeState::new(NodeDefinition::new(
            "a",
            NodeKind::Research,
            "A",
            "",
        )))
        .unwrap();
    graph
        .add_node(NodeState::new(NodeDefinition::new(
            "b",
            NodeKind::CodingProposal,
            "B",
            "",
        )))
        .unwrap();
    graph
        .add_edge(EdgeDefinition::prerequisite("a", "b"))
        .unwrap();
    graph.admit_ready(&NodeId::new("a")).unwrap();
    graph
        .dispatch(&NodeId::new("a"), "del-1".to_string())
        .unwrap();
    graph
        .complete(&NodeId::new("a"), Some("artifact-1".to_string()))
        .unwrap();
    graph.admit_ready(&NodeId::new("b")).unwrap();

    let json = serde_json::to_value(&graph).unwrap();
    let dto: UncheckedTaskGraph = serde_json::from_value(json).unwrap();
    let reloaded = TaskGraph::try_from(dto).unwrap();
    assert_eq!(graph, reloaded);
}

#[test]
fn test_duplicate_node_ids_are_rejected() {
    let mut json = valid_two_node();
    json["nodes"]
        .as_array_mut()
        .unwrap()
        .push(node_json("a", "pending"));
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::DuplicateNodeId(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_missing_upstream_endpoint_is_rejected() {
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("lonely", "pending")],
        "edges": [edge_json("e1", "ghost", "lonely")]
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::UnknownUpstream { .. }),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_missing_downstream_endpoint_is_rejected() {
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("a", "pending")],
        "edges": [edge_json("e1", "a", "ghost")]
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_cyclic_loaded_graph_is_rejected() {
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("a", "pending"), node_json("b", "pending")],
        "edges": [edge_json("e1", "a", "b"), edge_json("e2", "b", "a")]
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::CycleDetected(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_self_loop_is_rejected() {
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("a", "pending")],
        "edges": [edge_json("e1", "a", "a")]
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::CycleDetected(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_failed_without_reason_is_rejected() {
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("a", "failed")],
        "edges": []
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_pending_with_failure_reason_is_rejected() {
    let mut node = node_json("a", "pending");
    node["failure_reason"] = serde_json::json!("stale reason");
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node],
        "edges": []
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_running_without_delegation_is_rejected() {
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node_json("a", "running")],
        "edges": []
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
}

#[test]
fn test_lifecycle_distribution_stays_valid_after_load() {
    // A loaded Ready node with an artifact is incoherent: artifacts are
    // only produced on completion.
    let mut node = node_json("a", "ready");
    node["output_artifact_ref"] = serde_json::json!("artifact-1");
    let json = serde_json::json!({
        "graph_id": "g1", "parent_run_id": "run-1",
        "nodes": [node],
        "edges": []
    });
    let err = load(json).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
}
