use adham_graph::domain::edge::EdgeDefinition;
use adham_graph::domain::graph::{GraphError, TaskGraph};
use adham_graph::domain::node::{NodeDefinition, NodeKind, NodeState};

#[test]
fn test_acyclic_dag_construction_succeeds() {
    let mut graph = TaskGraph::new("parent-run-1");

    let n1 = NodeState::new(NodeDefinition::new(
        "n1",
        NodeKind::Research,
        "Research",
        "obj1",
    ));
    let n2 = NodeState::new(NodeDefinition::new(
        "n2",
        NodeKind::CodingProposal,
        "Code",
        "obj2",
    ));
    let n3 = NodeState::new(NodeDefinition::new(
        "n3",
        NodeKind::Verification,
        "Verify",
        "obj3",
    ));

    graph.add_node(n1).unwrap();
    graph.add_node(n2).unwrap();
    graph.add_node(n3).unwrap();

    // Linear DAG: n1 -> n2 -> n3
    assert!(graph
        .add_edge(EdgeDefinition::prerequisite("n1", "n2"))
        .is_ok());
    assert!(graph
        .add_edge(EdgeDefinition::prerequisite("n2", "n3"))
        .is_ok());
    assert!(graph.validate_acyclic().is_ok());
}

#[test]
fn test_cyclic_edge_addition_fails() {
    let mut graph = TaskGraph::new("parent-run-1");

    let n1 = NodeState::new(NodeDefinition::new(
        "n1",
        NodeKind::Research,
        "Research",
        "obj1",
    ));
    let n2 = NodeState::new(NodeDefinition::new(
        "n2",
        NodeKind::CodingProposal,
        "Code",
        "obj2",
    ));

    graph.add_node(n1).unwrap();
    graph.add_node(n2).unwrap();

    assert!(graph
        .add_edge(EdgeDefinition::prerequisite("n1", "n2"))
        .is_ok());

    // Adding reverse edge n2 -> n1 causes a cycle
    let err = graph
        .add_edge(EdgeDefinition::prerequisite("n2", "n1"))
        .unwrap_err();

    assert!(matches!(err, GraphError::CycleDetected(_)));
}

#[test]
fn test_multi_node_cycle_detection() {
    let mut graph = TaskGraph::new("parent-run-1");

    let n1 = NodeState::new(NodeDefinition::new("a", NodeKind::Research, "A", ""));
    let n2 = NodeState::new(NodeDefinition::new("b", NodeKind::Research, "B", ""));
    let n3 = NodeState::new(NodeDefinition::new("c", NodeKind::Research, "C", ""));

    graph.add_node(n1).unwrap();
    graph.add_node(n2).unwrap();
    graph.add_node(n3).unwrap();

    graph
        .add_edge(EdgeDefinition::prerequisite("a", "b"))
        .unwrap();
    graph
        .add_edge(EdgeDefinition::prerequisite("b", "c"))
        .unwrap();

    // Closing the triangle c -> a
    let err = graph
        .add_edge(EdgeDefinition::prerequisite("c", "a"))
        .unwrap_err();
    assert!(matches!(err, GraphError::CycleDetected(_)));
}
