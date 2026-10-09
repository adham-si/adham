use adham_graph::domain::graph::{GraphError, TaskGraph};
use adham_graph::domain::node::{NodeDefinition, NodeId, NodeKind, NodeLifecycle, NodeState};
use adham_graph::engine::scheduler::{advance_graph_state, mark_node_completed, mark_node_running};

fn test_graph() -> TaskGraph {
    let mut graph = TaskGraph::new("run-t");
    graph
        .add_node(NodeState::new(NodeDefinition::new(
            "a",
            NodeKind::Research,
            "A",
            "",
        )))
        .unwrap();
    graph
}

// Transition table (pinned):
// Pending -> Ready | Skipped (scheduler only)
// Ready -> Running | Canceled | Skipped
// Running -> Completed | Failed | Canceled
// Terminal (Completed/Failed/Canceled/Skipped) -> anything: error, no reopen.
// Repeat same-state: error (explicit, not silent idempotent success).
// Unknown node: UnknownNode error, state unchanged.
// Rationale: Completed/Failed assert execution happened, so they require
// Running (dispatch + delegation evidence). A direct Ready -> Completed or
// Ready -> Failed would let a caller claim an outcome for work that never
// ran. Cancel/Skip carry no execution claim, so Ready may take them.

#[test]
fn test_unknown_node_transition_errors_and_preserves_state() {
    let mut graph = test_graph();
    let snapshot = graph.clone();
    let err =
        mark_node_running(&mut graph, &NodeId::new("missing"), "del-1".to_string()).unwrap_err();
    assert!(matches!(err, GraphError::UnknownNode(_)));
    assert_eq!(graph, snapshot);
}

#[test]
fn test_direct_pending_to_running_is_illegal_and_preserves_state() {
    // Node "a" is Pending: dispatch must go through Ready admission.
    let mut graph = test_graph();
    let snapshot = graph.clone();
    let err = mark_node_running(&mut graph, &NodeId::new("a"), "del-1".to_string()).unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_terminal_nodes_cannot_reopen_and_repeat_is_an_error() {
    let mut graph = test_graph();
    // Pending -> Ready (scheduler) -> Running -> Completed: the only path
    // that can assert an execution outcome.
    advance_graph_state(&mut graph).unwrap();
    mark_node_running(&mut graph, &NodeId::new("a"), "del-1".to_string()).unwrap();
    graph
        .transition_node(&NodeId::new("a"), NodeLifecycle::Completed)
        .unwrap();

    // Reopen attempt: terminal -> Running is rejected, state unchanged.
    let snapshot = graph.clone();
    let err = mark_node_running(&mut graph, &NodeId::new("a"), "del-2".to_string()).unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);

    // Same-state repeat is an explicit error, not silent success.
    let err = graph
        .transition_node(&NodeId::new("a"), NodeLifecycle::Completed)
        .unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_ready_cannot_complete_without_running_and_preserves_state() {
    // Completed asserts execution happened, which requires dispatch
    // (Running + delegation). A direct Ready -> Completed would let a
    // caller claim an outcome for work that never ran.
    let mut graph = test_graph();
    advance_graph_state(&mut graph).unwrap();
    let snapshot = graph.clone();
    let err = mark_node_completed(
        &mut graph,
        &NodeId::new("a"),
        Some("unearned artifact".to_string()),
    )
    .unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}
