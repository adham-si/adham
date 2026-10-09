use adham_graph::domain::edge::EdgeDefinition;
use adham_graph::domain::graph::{GraphError, TaskGraph};
use adham_graph::domain::node::{NodeDefinition, NodeId, NodeKind, NodeState};

// Normal insertion accepts a fresh Pending node; anything stateful must
// come through the validated loading boundary. Rejected insertion leaves
// the whole graph unchanged.

fn pending(id: &str) -> NodeState {
    NodeState::new(NodeDefinition::new(id, NodeKind::Research, id, ""))
}

fn stateful_node(json: serde_json::Value) -> NodeState {
    serde_json::from_value(json).unwrap()
}

#[test]
fn test_fresh_pending_insertion_is_accepted() {
    let mut graph = TaskGraph::new("run-i");
    graph.add_node(pending("a")).unwrap();
    assert_eq!(graph.nodes().len(), 1);
}

#[test]
fn test_running_without_delegation_insertion_is_rejected_without_mutation() {
    let mut graph = TaskGraph::new("run-i");
    graph.add_node(pending("a")).unwrap();
    let snapshot = graph.clone();
    let running = stateful_node(serde_json::json!({
        "definition": {"node_id": "b", "kind": "research", "title": "b",
                       "objective": "", "allocated_tokens": 1, "allocated_steps": 1},
        "lifecycle": "running", "delegation_id": null,
        "output_artifact_ref": null, "failure_reason": null
    }));
    let err = graph.add_node(running).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_pre_completed_insertion_is_rejected_without_mutation() {
    let mut graph = TaskGraph::new("run-i");
    let snapshot = graph.clone();
    let done = stateful_node(serde_json::json!({
        "definition": {"node_id": "done", "kind": "research", "title": "d",
                       "objective": "", "allocated_tokens": 1, "allocated_steps": 1},
        "lifecycle": "completed", "delegation_id": "del-1",
        "output_artifact_ref": "artifact-1", "failure_reason": null
    }));
    let err = graph.add_node(done).unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

fn two_roots() -> TaskGraph {
    let mut graph = TaskGraph::new("run-topo");
    graph.add_node(pending("a")).unwrap();
    graph.add_node(pending("b")).unwrap();
    graph
}

#[test]
fn test_edge_to_ready_target_with_pending_prerequisite_is_rejected_without_mutation() {
    let mut graph = two_roots();
    graph.admit_ready(&NodeId::new("b")).unwrap();
    let snapshot = graph.clone();
    let err = graph
        .add_edge(EdgeDefinition::prerequisite("a", "b"))
        .unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_edge_to_running_target_with_pending_prerequisite_is_rejected_without_mutation() {
    let mut graph = two_roots();
    graph.admit_ready(&NodeId::new("b")).unwrap();
    graph
        .dispatch(&NodeId::new("b"), "del-b".to_string())
        .unwrap();
    let snapshot = graph.clone();
    let err = graph
        .add_edge(EdgeDefinition::prerequisite("a", "b"))
        .unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_edge_to_completed_target_with_pending_prerequisite_is_rejected_without_mutation() {
    let mut graph = two_roots();
    graph.admit_ready(&NodeId::new("b")).unwrap();
    graph
        .dispatch(&NodeId::new("b"), "del-b".to_string())
        .unwrap();
    graph
        .complete(&NodeId::new("b"), Some("artifact-b".to_string()))
        .unwrap();
    let snapshot = graph.clone();
    let err = graph
        .add_edge(EdgeDefinition::prerequisite("a", "b"))
        .unwrap_err();
    assert!(
        matches!(err, GraphError::InvalidGraph(_)),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_edge_between_completed_nodes_is_accepted_and_reloads() {
    use adham_graph::domain::loading::UncheckedTaskGraph;
    let mut graph = two_roots();
    for id in ["a", "b"] {
        graph.admit_ready(&NodeId::new(id)).unwrap();
        graph
            .dispatch(&NodeId::new(id), format!("del-{id}"))
            .unwrap();
        graph
            .complete(&NodeId::new(id), Some(format!("artifact-{id}")))
            .unwrap();
    }
    graph
        .add_edge(EdgeDefinition::prerequisite("a", "b"))
        .unwrap();
    graph.validate_loaded().unwrap();
    let json = serde_json::to_value(&graph).unwrap();
    let dto: UncheckedTaskGraph = serde_json::from_value(json).unwrap();
    let reloaded = TaskGraph::try_from(dto).unwrap();
    assert_eq!(graph, reloaded);
}
