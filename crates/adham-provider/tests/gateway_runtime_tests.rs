use adham_core_types::{ProjectId, SessionId, WorkspaceId};
use adham_provider::adapters::mock::MockProviderAdapter;
use adham_provider::domain::endpoint::{EndpointDescriptor, EndpointId, ServiceKind};
use adham_provider::gateway::ProviderGateway;
use adham_runtime::application::AgentDriver;
use adham_runtime::domain::*;
use adham_runtime::ports::clock::MockClock;
use adham_runtime::ports::verification::{
    CompletionContract, FakeVerificationAdapter, VerificationVerdict,
};

#[tokio::test]
async fn test_provider_gateway_runtime_integration() {
    let endpoint = EndpointDescriptor::new(
        EndpointId::new("local-ollama"),
        "http://localhost:11434",
        ServiceKind::OllamaLocal,
    )
    .expect("endpoint");

    let adapter = MockProviderAdapter::new(vec![
        "This is ".to_string(),
        "a streamed response ".to_string(),
        "from ProviderGateway.".to_string(),
    ]);

    let gateway = ProviderGateway::new(endpoint, adapter);
    let verifier = FakeVerificationAdapter::new(VerificationVerdict::Pass);
    let clock = MockClock::new(1000);

    // Wire gateway directly into AgentDriver
    let driver = AgentDriver::new(gateway, verifier, clock);

    let identity = ExecutionIdentity {
        workspace_id: WorkspaceId::new_v7(),
        project_id: ProjectId::new_v7(),
        session_id: SessionId::new_v7(),
        agent_id: AgentId::new("agent-default"),
        run_id: RunId::new_v7(),
    };

    let mut state = RunState::new_queued(identity);
    let budget = RunBudget::default();
    let mut usage = BudgetUsage::default();
    let contract = CompletionContract {
        task_id: "task-1".to_string(),
        required_evidence_count: 1,
    };

    let result = driver
        .run_step(
            &mut state,
            &budget,
            &mut usage,
            &contract,
            "Execute reasoning step",
        )
        .await
        .expect("step execution via gateway");

    assert_eq!(result.lifecycle, RunLifecycle::Terminal);
    assert_eq!(result.terminal_outcome, Some(TerminalOutcome::Completed));
    assert_eq!(usage.steps_used, 1);
    assert_eq!(usage.attempts_used, 1);
    assert!(usage.output_bytes_used > 0);
}
