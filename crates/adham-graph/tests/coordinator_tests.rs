use adham_core_types::{ProjectId, WorkspaceId};
use adham_graph::bridge::coordinator::SubagentCoordinator;
use adham_graph::domain::edge::EdgeDefinition;
use adham_graph::domain::graph::TaskGraph;
use adham_graph::domain::node::{NodeDefinition, NodeId, NodeKind, NodeLifecycle};
use adham_runtime::ports::clock::MockClock;
use adham_runtime::ports::model::FakeModelAdapter;
use adham_runtime::ports::verification::{FakeVerificationAdapter, VerificationVerdict};

#[tokio::test]
async fn test_subagent_coordinator_executes_pipeline_to_completion() {
    let mut graph = TaskGraph::new("parent-run-100");

    let n1 = NodeState::new(NodeDefinition::new(
        "research",
        NodeKind::Research,
        "Research spec",
        "Investigate interface requirements",
    ));
    let n2 = NodeState::new(NodeDefinition::new(
        "code",
        NodeKind::CodingProposal,
        "Implement interface",
        "Generate Rust structs",
    ));

    graph.add_node(n1).unwrap();
    graph.add_node(n2).unwrap();
    graph
        .add_edge(EdgeDefinition::prerequisite("research", "code"))
        .unwrap();

    let workspace_id = WorkspaceId::new_v7();
    let project_id = ProjectId::new_v7();
    let mut coordinator = SubagentCoordinator::new(graph, workspace_id, project_id);

    // 1. Execute first node (research)
    let model1 = FakeModelAdapter::with_default_response("Research completed with findings.");
    let verifier1 = FakeVerificationAdapter::new(VerificationVerdict::Pass);
    let clock1 = MockClock::new(1000);

    let executed1 = coordinator
        .execute_next_node(model1, verifier1, clock1)
        .await
        .unwrap();

    assert_eq!(executed1, Some(NodeId::new("research")));
    assert_eq!(
        coordinator
            .graph
            .get_node(&NodeId::new("research"))
            .unwrap()
            .lifecycle(),
        NodeLifecycle::Completed
    );

    // 2. Execute second node (code) - now ready with upstream artifact
    let model2 = FakeModelAdapter::with_default_response("Code implemented per findings.");
    let verifier2 = FakeVerificationAdapter::new(VerificationVerdict::Pass);
    let clock2 = MockClock::new(2000);

    let executed2 = coordinator
        .execute_next_node(model2, verifier2, clock2)
        .await
        .unwrap();

    assert_eq!(executed2, Some(NodeId::new("code")));
    assert_eq!(
        coordinator
            .graph
            .get_node(&NodeId::new("code"))
            .unwrap()
            .lifecycle(),
        NodeLifecycle::Completed
    );

    // 3. No more nodes to execute
    let model3 = FakeModelAdapter::with_default_response("");
    let verifier3 = FakeVerificationAdapter::new(VerificationVerdict::Pass);
    let clock3 = MockClock::new(3000);

    let executed3 = coordinator
        .execute_next_node(model3, verifier3, clock3)
        .await
        .unwrap();

    assert_eq!(executed3, None);
    assert!(coordinator.graph.is_all_completed());
}

use adham_graph::domain::node::NodeState;
