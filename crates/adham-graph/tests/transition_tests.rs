use adham_graph::domain::graph::{GraphError, TaskGraph};
use adham_graph::domain::node::{NodeDefinition, NodeId, NodeKind, NodeState};
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
    mark_node_completed(&mut graph, &NodeId::new("a"), None).unwrap();

    // Reopen attempt: terminal -> Running is rejected, state unchanged.
    let snapshot = graph.clone();
    let err = mark_node_running(&mut graph, &NodeId::new("a"), "del-2".to_string()).unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);

    // Same-state repeat is an explicit error, not silent success.
    let err = mark_node_completed(&mut graph, &NodeId::new("a"), None).unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

fn admitted_pair() -> TaskGraph {
    use adham_graph::domain::edge::EdgeDefinition;
    let mut graph = test_graph();
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
    graph
}

#[test]
fn test_admission_requires_completed_prerequisites() {
    // "b" is Pending with a Pending prerequisite: admission must fail and
    // leave the graph unchanged. This is what makes Pending -> Ready
    // scheduler-gated in practice, not just by convention.
    let mut graph = admitted_pair();
    let snapshot = graph.clone();
    let err = graph.admit_ready(&NodeId::new("b")).unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_dispatch_requires_delegation() {
    let mut graph = test_graph();
    graph.admit_ready(&NodeId::new("a")).unwrap();
    let snapshot = graph.clone();
    let err = graph.dispatch(&NodeId::new("a"), "").unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_fail_and_skip_require_reasons() {
    let mut graph = test_graph();
    graph.admit_ready(&NodeId::new("a")).unwrap();
    let snapshot = graph.clone();
    let err = graph.fail(&NodeId::new("a"), "").unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);

    let mut graph = test_graph();
    let snapshot = graph.clone();
    let err = graph.skip(&NodeId::new("a"), "").unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_skip_requires_a_failed_prerequisite_witness() {
    // Skipping a node with healthy (or no) prerequisites would produce a
    // graph the loader rejects, so the operation itself must refuse.
    let mut graph = admitted_pair();
    let snapshot = graph.clone();
    let err = graph
        .skip(&NodeId::new("b"), "no real blockage".to_string())
        .unwrap_err();
    assert!(
        matches!(err, GraphError::IllegalTransition { .. }),
        "unexpected error: {err:?}"
    );
    assert_eq!(graph, snapshot);
}

#[test]
fn test_every_accepted_operation_preserves_loaded_validity() {
    // Governing rule, start side: each successful op leaves validate_loaded Ok.
    let mut graph = admitted_pair();
    graph.admit_ready(&NodeId::new("a")).unwrap();
    graph.validate_loaded().unwrap();
    graph
        .dispatch(&NodeId::new("a"), "del-1".to_string())
        .unwrap();
    graph.validate_loaded().unwrap();
    graph
        .complete(&NodeId::new("a"), Some("artifact-1".to_string()))
        .unwrap();
    graph.validate_loaded().unwrap();
    graph.admit_ready(&NodeId::new("b")).unwrap();
    graph.validate_loaded().unwrap();

    // Fail side: dispatch, fail, and let scheduling skip the dependent
    // (the scheduler is the legitimate skip caller; the witness rule holds).
    let mut graph = admitted_pair();
    graph.admit_ready(&NodeId::new("a")).unwrap();
    graph
        .dispatch(&NodeId::new("a"), "del-1".to_string())
        .unwrap();
    graph
        .fail(&NodeId::new("a"), "bad evidence".to_string())
        .unwrap();
    graph.validate_loaded().unwrap();
    advance_graph_state(&mut graph).unwrap();
    graph.validate_loaded().unwrap();

    // Cancel side on a fresh graph.
    let mut graph = admitted_pair();
    graph.admit_ready(&NodeId::new("a")).unwrap();
    graph.cancel(&NodeId::new("a")).unwrap();
    graph.validate_loaded().unwrap();
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
