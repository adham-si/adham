use adham_core_types::{ProjectId, SessionId, WorkspaceId};
use adham_runtime::application::AgentDriver;
use adham_runtime::domain::*;
use adham_runtime::ports::clock::MockClock;
use adham_runtime::ports::model::FakeModelAdapter;
use adham_runtime::ports::verification::CompletionContract;
use adham_verify::bridge::runtime_adapter::AdhamVerificationAdapter;

#[tokio::test]
async fn test_verification_adapter_runtime_driver_integration() {
    let verifier = AdhamVerificationAdapter::for_task(
        "task-123",
        vec!["src/lib.rs".to_string()],
        "pub fn verified_code() {}",
    );
    let model = FakeModelAdapter::with_default_response("Reasoning complete, candidate delivered.");
    let clock = MockClock::new(1000);

    let driver = AgentDriver::new(model, verifier, clock);

    let identity = ExecutionIdentity {
        workspace_id: WorkspaceId::new_v7(),
        project_id: ProjectId::new_v7(),
        session_id: SessionId::new_v7(),
        agent_id: AgentId::new("agent-1"),
        run_id: RunId::new_v7(),
    };

    let mut state = RunState::new_queued(identity);
    let budget = RunBudget::default();
    let mut usage = BudgetUsage::default();
    let contract = CompletionContract {
        task_id: "task-123".to_string(),
        required_evidence_count: 1,
    };

    let result = driver
        .run_step(
            &mut state,
            &budget,
            &mut usage,
            &contract,
            "Run verification turn",
        )
        .await
        .expect("step execution via verifier adapter");

    assert_eq!(result.lifecycle, RunLifecycle::Terminal);
    assert_eq!(result.terminal_outcome, Some(TerminalOutcome::Completed));
    assert_eq!(state.lifecycle, RunLifecycle::Terminal);
}
