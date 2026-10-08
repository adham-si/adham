use adham_core_types::{ProjectId, SessionId, WorkspaceId};
use adham_runtime::application::*;
use adham_runtime::domain::*;
use adham_runtime::ports::*;

fn sample_identity() -> ExecutionIdentity {
    ExecutionIdentity {
        workspace_id: WorkspaceId::new_v7(),
        project_id: ProjectId::new_v7(),
        session_id: SessionId::new_v7(),
        agent_id: AgentId::new("agent-default"),
        run_id: RunId::new_v7(),
    }
}

#[tokio::test]
async fn test_driver_happy_path_completes() {
    let model = FakeModelAdapter::with_default_response("All requirements satisfied");
    let verifier = FakeVerificationAdapter::new(VerificationVerdict::Pass);
    let clock = MockClock::new(1000);
    let driver = AgentDriver::new(model, verifier, clock);

    let mut state = RunState::new_queued(sample_identity());
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
            "Implement feature X",
        )
        .await
        .expect("step execution");

    assert_eq!(result.lifecycle, RunLifecycle::Terminal);
    assert_eq!(result.terminal_outcome, Some(TerminalOutcome::Completed));
    assert_eq!(usage.steps_used, 1);
    assert_eq!(usage.attempts_used, 1);
    assert!(usage.output_bytes_used > 0);
}

#[tokio::test]
async fn test_driver_verification_failure() {
    let model = FakeModelAdapter::with_default_response("Incomplete attempt");
    let verifier = FakeVerificationAdapter::new(VerificationVerdict::Fail(
        "Missing required evidence".to_string(),
    ));
    let clock = MockClock::new(1000);
    let driver = AgentDriver::new(model, verifier, clock);

    let mut state = RunState::new_queued(sample_identity());
    let budget = RunBudget::default();
    let mut usage = BudgetUsage::default();
    let contract = CompletionContract {
        task_id: "task-1".to_string(),
        required_evidence_count: 1,
    };

    let result = driver
        .run_step(&mut state, &budget, &mut usage, &contract, "Build widget")
        .await
        .expect("step execution");

    assert_eq!(result.lifecycle, RunLifecycle::Terminal);
    assert_eq!(
        result.terminal_outcome,
        Some(TerminalOutcome::FailedVerification(
            "Missing required evidence".to_string()
        ))
    );
}

#[tokio::test]
async fn test_driver_cancellation_honored() {
    let model = FakeModelAdapter::with_default_response("Should not be called");
    let verifier = FakeVerificationAdapter::new(VerificationVerdict::Pass);
    let clock = MockClock::new(1000);
    let driver = AgentDriver::new(model, verifier, clock);

    let mut state = RunState::new_queued(sample_identity());
    state.pending_intent = Some(ControlIntent::Cancel);

    let budget = RunBudget::default();
    let mut usage = BudgetUsage::default();
    let contract = CompletionContract {
        task_id: "task-1".to_string(),
        required_evidence_count: 1,
    };

    let result = driver
        .run_step(&mut state, &budget, &mut usage, &contract, "Prompt")
        .await
        .expect("step execution");

    assert_eq!(result.lifecycle, RunLifecycle::Terminal);
    assert_eq!(result.terminal_outcome, Some(TerminalOutcome::Canceled));
    assert_eq!(usage.steps_used, 0); // No model step was executed
}

#[tokio::test]
async fn test_driver_budget_exhaustion() {
    let model = FakeModelAdapter::with_default_response("Text");
    let verifier = FakeVerificationAdapter::new(VerificationVerdict::Pass);
    let clock = MockClock::new(1000);
    let driver = AgentDriver::new(model, verifier, clock);

    let mut state = RunState::new_queued(sample_identity());
    let budget = RunBudget {
        max_steps: 5,
        ..Default::default()
    };
    let mut usage = BudgetUsage {
        steps_used: 5, // Already reached limit
        ..Default::default()
    };
    let contract = CompletionContract {
        task_id: "task-1".to_string(),
        required_evidence_count: 1,
    };

    let result = driver
        .run_step(&mut state, &budget, &mut usage, &contract, "Prompt")
        .await
        .expect("step execution");

    assert_eq!(result.lifecycle, RunLifecycle::Blocked);
    assert_eq!(result.block_reason, Some(BlockReason::BudgetExhausted));
}

#[tokio::test]
async fn test_driver_blocked_verdict_never_completes() {
    let model = FakeModelAdapter::with_default_response("Attempt awaiting checks");
    let verifier = FakeVerificationAdapter::new(VerificationVerdict::Blocked(
        "Mandatory check blocked".to_string(),
    ));
    let clock = MockClock::new(1000);
    let driver = AgentDriver::new(model, verifier, clock);

    let mut state = RunState::new_queued(sample_identity());
    let budget = RunBudget::default();
    let mut usage = BudgetUsage::default();
    let contract = CompletionContract {
        task_id: "task-1".to_string(),
        required_evidence_count: 1,
    };

    let result = driver
        .run_step(&mut state, &budget, &mut usage, &contract, "Build widget")
        .await
        .expect("step execution");

    assert_eq!(result.lifecycle, RunLifecycle::Blocked);
    assert_eq!(result.block_reason, Some(BlockReason::VerificationRequired));
    assert_ne!(result.terminal_outcome, Some(TerminalOutcome::Completed));
    assert_ne!(
        result.terminal_outcome,
        Some(TerminalOutcome::CompletedWithWarnings)
    );
}

#[test]
fn test_checkpoint_create_and_restore() {
    let identity = sample_identity();
    let mut state = RunState::new_queued(identity);
    state.epoch = DriverEpoch(3);
    state.revision = 12;
    state.lifecycle = RunLifecycle::Running;
    state.phase = Some(RunPhase::Observing);

    let usage = BudgetUsage {
        steps_used: 3,
        attempts_used: 4,
        output_bytes_used: 1024,
        ..Default::default()
    };

    let checkpoint = RunCheckpoint::create(&state, usage, 5000);

    let mut target_state = RunState::new_queued(sample_identity());
    checkpoint.restore_into(&mut target_state);

    assert_eq!(target_state.epoch, DriverEpoch(3));
    assert_eq!(target_state.revision, 12);
    assert_eq!(target_state.lifecycle, RunLifecycle::Running);
    assert_eq!(target_state.phase, Some(RunPhase::Observing));
}
