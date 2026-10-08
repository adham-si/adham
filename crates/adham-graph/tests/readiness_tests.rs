use adham_graph::domain::edge::EdgeDefinition;
use adham_graph::domain::graph::TaskGraph;
use adham_graph::domain::node::{NodeDefinition, NodeId, NodeKind, NodeLifecycle, NodeState};
use adham_graph::engine::scheduler::{advance_graph_state, mark_node_completed, mark_node_failed};

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
    let ready = advance_graph_state(&mut graph);
    assert_eq!(ready, vec![NodeId::new("root")]);
    assert_eq!(
        graph.get_node(&NodeId::new("root")).unwrap().lifecycle,
        NodeLifecycle::Ready
    );
    assert_eq!(
        graph.get_node(&NodeId::new("child")).unwrap().lifecycle,
        NodeLifecycle::Pending
    );

    // 2. Mark root completed -> child becomes ready
    mark_node_completed(
        &mut graph,
        &NodeId::new("root"),
        Some("Root artifact".to_string()),
    );
    let next_ready = advance_graph_state(&mut graph);
    assert_eq!(next_ready, vec![NodeId::new("child")]);
    assert_eq!(
        graph.get_node(&NodeId::new("child")).unwrap().lifecycle,
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

    // Fail node A -> node B is skipped
    mark_node_failed(&mut graph, &NodeId::new("a"), "Failed check".to_string());
    let ready = advance_graph_state(&mut graph);
    assert!(ready.is_empty());
    assert_eq!(
        graph.get_node(&NodeId::new("b")).unwrap().lifecycle,
        NodeLifecycle::Skipped
    );
}
