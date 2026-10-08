use adham_core_types::{ProjectId, SessionId, WorkspaceId};
use adham_runtime::domain::*;

fn sample_identity() -> ExecutionIdentity {
    ExecutionIdentity {
        workspace_id: WorkspaceId::new_v7(),
        project_id: ProjectId::new_v7(),
        session_id: SessionId::new_v7(),
        agent_id: AgentId::new("agent-default"),
        run_id: RunId::new_v7(),
    }
}

#[test]
fn test_legal_lifecycle_flow() {
    let mut state = RunState::new_queued(sample_identity());
    assert_eq!(state.lifecycle, RunLifecycle::Queued);

    // 1. Claim
    state = reduce_run(
        &state,
        RunTrigger::ClaimDriver {
            epoch: DriverEpoch(1),
        },
    )
    .expect("claim");
    assert_eq!(state.lifecycle, RunLifecycle::Running);
    assert_eq!(state.phase, Some(RunPhase::Preparing));

    // 2. Advance through phases
    state = reduce_run(
        &state,
        RunTrigger::AdvancePhase {
            next_phase: RunPhase::Requesting,
        },
    )
    .expect("requesting");
    assert_eq!(state.phase, Some(RunPhase::Requesting));

    state = reduce_run(
        &state,
        RunTrigger::AdvancePhase {
            next_phase: RunPhase::Streaming,
        },
    )
    .expect("streaming");
    assert_eq!(state.phase, Some(RunPhase::Streaming));

    state = reduce_run(
        &state,
        RunTrigger::AdvancePhase {
            next_phase: RunPhase::Observing,
        },
    )
    .expect("observing");
    assert_eq!(state.phase, Some(RunPhase::Observing));

    state = reduce_run(
        &state,
        RunTrigger::AdvancePhase {
            next_phase: RunPhase::Verifying,
        },
    )
    .expect("verifying");
    assert_eq!(state.phase, Some(RunPhase::Verifying));

    // 3. Terminate completed
    state = reduce_run(
        &state,
        RunTrigger::TerminateRun {
            outcome: TerminalOutcome::Completed,
        },
    )
    .expect("completed");
    assert_eq!(state.lifecycle, RunLifecycle::Terminal);
    assert_eq!(state.terminal_outcome, Some(TerminalOutcome::Completed));
    assert!(state.is_terminal());
}

#[test]
fn test_terminal_immutability() {
    let mut state = RunState::new_queued(sample_identity());
    state = reduce_run(
        &state,
        RunTrigger::ClaimDriver {
            epoch: DriverEpoch(1),
        },
    )
    .expect("claim");
    state = reduce_run(
        &state,
        RunTrigger::TerminateRun {
            outcome: TerminalOutcome::Completed,
        },
    )
    .expect("terminate");

    // Any attempt to transition out of Terminal must fail
    let res = reduce_run(
        &state,
        RunTrigger::ClaimDriver {
            epoch: DriverEpoch(2),
        },
    );
    assert_eq!(
        res.unwrap_err(),
        TransitionError::TerminalImmutable(TerminalOutcome::Completed)
    );

    let res_cancel = reduce_run(&state, RunTrigger::RequestCancel);
    assert_eq!(
        res_cancel.unwrap_err(),
        TransitionError::TerminalImmutable(TerminalOutcome::Completed)
    );
}

#[test]
fn test_control_intent_precedence() {
    let mut state = RunState::new_queued(sample_identity());
    state = reduce_run(
        &state,
        RunTrigger::ClaimDriver {
            epoch: DriverEpoch(1),
        },
    )
    .expect("claim");

    // Request cancel
    state = reduce_run(&state, RunTrigger::RequestCancel).expect("request cancel");
    assert_eq!(state.lifecycle, RunLifecycle::Canceling);
    assert_eq!(state.pending_intent, Some(ControlIntent::Cancel));

    // Request pause while cancel is pending: cancel takes precedence
    state = reduce_run(&state, RunTrigger::RequestPause).expect("request pause");
    assert_eq!(state.lifecycle, RunLifecycle::Canceling);
    assert_eq!(state.pending_intent, Some(ControlIntent::Cancel));

    // Confirm cancel
    state = reduce_run(&state, RunTrigger::ConfirmCanceled).expect("confirm cancel");
    assert_eq!(state.lifecycle, RunLifecycle::Terminal);
    assert_eq!(state.terminal_outcome, Some(TerminalOutcome::Canceled));
}

#[test]
fn test_pause_and_resume_cycle() {
    let mut state = RunState::new_queued(sample_identity());
    state = reduce_run(
        &state,
        RunTrigger::ClaimDriver {
            epoch: DriverEpoch(1),
        },
    )
    .expect("claim");

    state = reduce_run(&state, RunTrigger::RequestPause).expect("pause requested");
    assert_eq!(state.lifecycle, RunLifecycle::Pausing);

    state = reduce_run(&state, RunTrigger::ConfirmPaused).expect("confirm paused");
    assert_eq!(state.lifecycle, RunLifecycle::Paused);

    // Stale epoch rejected
    let stale_res = reduce_run(
        &state,
        RunTrigger::ResumeRun {
            epoch: DriverEpoch(1),
        },
    );
    assert!(stale_res.is_err());

    // Fresh epoch succeeds
    state = reduce_run(
        &state,
        RunTrigger::ResumeRun {
            epoch: DriverEpoch(2),
        },
    )
    .expect("resume");
    assert_eq!(state.lifecycle, RunLifecycle::Running);
    assert_eq!(state.epoch, DriverEpoch(2));
}

#[test]
fn test_block_and_resolve_cycle() {
    let mut state = RunState::new_queued(sample_identity());
    state = reduce_run(
        &state,
        RunTrigger::ClaimDriver {
            epoch: DriverEpoch(1),
        },
    )
    .expect("claim");

    state = reduce_run(
        &state,
        RunTrigger::BlockRun {
            reason: BlockReason::CapabilityUnavailable,
        },
    )
    .expect("block");
    assert_eq!(state.lifecycle, RunLifecycle::Blocked);
    assert_eq!(state.block_reason, Some(BlockReason::CapabilityUnavailable));

    state = reduce_run(&state, RunTrigger::ResolveBlock).expect("resolve block");
    assert_eq!(state.lifecycle, RunLifecycle::Running);
    assert_eq!(state.block_reason, None);
}
