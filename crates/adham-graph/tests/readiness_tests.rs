use adham_graph::domain::edge::EdgeDefinition;
use adham_graph::domain::graph::{GraphError, TaskGraph};
use adham_graph::domain::node::{NodeDefinition, NodeId, NodeKind, NodeLifecycle, NodeState};
use adham_graph::engine::scheduler::{
    advance_graph_state, mark_node_completed, mark_node_failed, mark_node_running,
};

#[test]
fn test_topological_readiness_and_completion_cascade() {
    let mut graph = TaskGraph::new("run-1");

    let n1 = NodeState::new(NodeDefinition::new("root", NodeKind::Research, "Root", ""));
    let n2 = NodeState::new(NodeDefinition::new(
        "child",
        NodeKind::CodingProposal,
        "Child",
        "",
    ));

    graph.add_node(n1).unwrap();
    graph.add_node(n2).unwrap();
    graph
        .add_edge(EdgeDefinition::prerequisite("root", "child"))
        .unwrap();

    // 1. Initial advance -> root is ready, child is pending
    let ready = advance_graph_state(&mut graph).unwrap();
    assert_eq!(ready, vec![NodeId::new("root")]);
    assert_eq!(
        graph.get_node(&NodeId::new("root")).unwrap().lifecycle(),
        NodeLifecycle::Ready
    );
    assert_eq!(
        graph.get_node(&NodeId::new("child")).unwrap().lifecycle(),
        NodeLifecycle::Pending
    );

    // 2. Dispatch root (Ready -> Running) then complete -> child is ready.
    // Completion requires Running: outcomes cannot skip dispatch.
    mark_node_running(&mut graph, &NodeId::new("root"), "del-root".to_string()).unwrap();
    mark_node_completed(
        &mut graph,
        &NodeId::new("root"),
        Some("Root artifact".to_string()),
    )
    .unwrap();
    let next_ready = advance_graph_state(&mut graph).unwrap();
    assert_eq!(next_ready, vec![NodeId::new("child")]);
    assert_eq!(
        graph.get_node(&NodeId::new("child")).unwrap().lifecycle(),
        NodeLifecycle::Ready
    );
}

#[test]
fn test_failure_cascades_to_skipped_for_dependent_nodes() {
    let mut graph = TaskGraph::new("run-2");

    let n1 = NodeState::new(NodeDefinition::new("a", NodeKind::Research, "A", ""));
    let n2 = NodeState::new(NodeDefinition::new("b", NodeKind::CodingProposal, "B", ""));

    graph.add_node(n1).unwrap();
    graph.add_node(n2).unwrap();
    graph
        .add_edge(EdgeDefinition::prerequisite("a", "b"))
        .unwrap();

    let _ = advance_graph_state(&mut graph);

    // Fail node A (via Running dispatch) -> node B is skipped
    mark_node_running(&mut graph, &NodeId::new("a"), "del-a".to_string()).unwrap();
    mark_node_failed(&mut graph, &NodeId::new("a"), "Failed check".to_string()).unwrap();
    let ready = advance_graph_state(&mut graph).unwrap();
    assert!(ready.is_empty());
    assert_eq!(
        graph.get_node(&NodeId::new("b")).unwrap().lifecycle(),
        NodeLifecycle::Skipped
    );
}

#[test]
fn test_unknown_upstream_is_invalid_graph_and_preserves_state() {
    // A graph whose edge references a missing upstream node is structurally
    // invalid: loading must reject it before scheduling ever runs. The
    // scheduling-level defense is probed by the in-crate
    // `rejected_schedule_leaves_graph_unchanged` unit test, since no
    // validated API can construct such a graph.
    use adham_graph::domain::loading::UncheckedTaskGraph;
    let json = serde_json::json!({
        "graph_id": "g1",
        "parent_run_id": "run-x",
        "nodes": [
            {"definition": {"node_id": "lonely", "kind": "research", "title": "L",
                            "objective": "", "allocated_tokens": 1, "allocated_steps": 1},
             "lifecycle": "pending", "delegation_id": null,
             "output_artifact_ref": null, "failure_reason": null}
        ],
        "edges": [
            {"edge_id": "e1", "from_node": "ghost", "to_node": "lonely",
             "kind": "prerequisite"}
        ]
    });
    let dto: UncheckedTaskGraph = serde_json::from_value(json).unwrap();
    let err = TaskGraph::try_from(dto).unwrap_err();
    assert!(
        matches!(
            err,
            GraphError::UnknownUpstream { .. } | GraphError::InvalidGraph(_)
        ),
        "unexpected error: {err:?}"
    );
}
