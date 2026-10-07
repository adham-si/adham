use crate::domain::identity::*;
use crate::domain::run::*;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum TransitionError {
    #[error("Terminal states are immutable; cannot transition out of {0:?}")]
    TerminalImmutable(TerminalOutcome),
    #[error("Illegal transition from lifecycle {0:?} via trigger {1}")]
    IllegalTransition(RunLifecycle, &'static str),
    #[error("Stale driver epoch: state epoch is {state:?}, trigger epoch is {trigger:?}")]
    StaleEpoch {
        state: DriverEpoch,
        trigger: DriverEpoch,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RunTrigger {
    ClaimDriver { epoch: DriverEpoch },
    AdvancePhase { next_phase: RunPhase },
    RequestPause,
    ConfirmPaused,
    ResumeRun { epoch: DriverEpoch },
    RequestCancel,
    ConfirmCanceled,
    BlockRun { reason: BlockReason },
    ResolveBlock,
    TerminateRun { outcome: TerminalOutcome },
    InterruptDriver,
}

pub fn reduce_run(state: &RunState, trigger: RunTrigger) -> Result<RunState, TransitionError> {
    if let RunLifecycle::Terminal = state.lifecycle {
        let outcome = state
            .terminal_outcome
            .clone()
            .unwrap_or(TerminalOutcome::Completed);
        return Err(TransitionError::TerminalImmutable(outcome));
    }

    let mut next = state.clone();
    next.revision += 1;

    match trigger {
        RunTrigger::ClaimDriver { epoch } => {
            if state.lifecycle != RunLifecycle::Queued {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "ClaimDriver",
                ));
            }
            if epoch <= state.epoch && state.epoch != DriverEpoch(0) {
                return Err(TransitionError::StaleEpoch {
                    state: state.epoch,
                    trigger: epoch,
                });
            }
            next.lifecycle = RunLifecycle::Running;
            next.phase = Some(RunPhase::Preparing);
            next.epoch = epoch;
        }

        RunTrigger::AdvancePhase { next_phase } => {
            if state.lifecycle != RunLifecycle::Running {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "AdvancePhase",
                ));
            }
            // Enforce control intent precedence
            if next.pending_intent == Some(ControlIntent::Cancel) {
                next.lifecycle = RunLifecycle::Canceling;
                next.phase = None;
            } else if next.pending_intent == Some(ControlIntent::Pause) {
                next.lifecycle = RunLifecycle::Pausing;
                next.phase = None;
            } else {
                next.phase = Some(next_phase);
            }
        }

        RunTrigger::RequestPause => match state.lifecycle {
            RunLifecycle::Queued => {
                next.lifecycle = RunLifecycle::Paused;
                next.phase = None;
            }
            RunLifecycle::Running => {
                // If cancel is already pending, cancel takes precedence
                if next.pending_intent != Some(ControlIntent::Cancel) {
                    next.pending_intent = Some(ControlIntent::Pause);
                    next.lifecycle = RunLifecycle::Pausing;
                }
            }
            RunLifecycle::Pausing | RunLifecycle::Paused | RunLifecycle::Canceling => {}
            _ => {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "RequestPause",
                ))
            }
        },

        RunTrigger::ConfirmPaused => {
            if state.lifecycle != RunLifecycle::Pausing {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "ConfirmPaused",
                ));
            }
            next.lifecycle = RunLifecycle::Paused;
            next.phase = None;
            next.pending_intent = None;
        }

        RunTrigger::ResumeRun { epoch } => {
            if state.lifecycle != RunLifecycle::Paused {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "ResumeRun",
                ));
            }
            if epoch <= state.epoch {
                return Err(TransitionError::StaleEpoch {
                    state: state.epoch,
                    trigger: epoch,
                });
            }
            next.lifecycle = RunLifecycle::Running;
            next.phase = Some(RunPhase::Preparing);
            next.epoch = epoch;
            next.pending_intent = None;
        }

        RunTrigger::RequestCancel => match state.lifecycle {
            RunLifecycle::Queued | RunLifecycle::Paused | RunLifecycle::Blocked => {
                next.lifecycle = RunLifecycle::Terminal;
                next.phase = None;
                next.terminal_outcome = Some(TerminalOutcome::Canceled);
                next.pending_intent = None;
            }
            RunLifecycle::Running | RunLifecycle::Pausing => {
                next.pending_intent = Some(ControlIntent::Cancel);
                next.lifecycle = RunLifecycle::Canceling;
                next.phase = None;
            }
            RunLifecycle::Canceling => {}
            _ => {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "RequestCancel",
                ))
            }
        },

        RunTrigger::ConfirmCanceled => {
            if state.lifecycle != RunLifecycle::Canceling {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "ConfirmCanceled",
                ));
            }
            next.lifecycle = RunLifecycle::Terminal;
            next.phase = None;
            next.terminal_outcome = Some(TerminalOutcome::Canceled);
            next.pending_intent = None;
        }

        RunTrigger::BlockRun { reason } => {
            if state.lifecycle != RunLifecycle::Running {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "BlockRun",
                ));
            }
            next.lifecycle = RunLifecycle::Blocked;
            next.phase = None;
            next.block_reason = Some(reason);
        }

        RunTrigger::ResolveBlock => {
            if state.lifecycle != RunLifecycle::Blocked {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "ResolveBlock",
                ));
            }
            next.lifecycle = RunLifecycle::Running;
            next.phase = Some(RunPhase::Preparing);
            next.block_reason = None;
        }

        RunTrigger::TerminateRun { outcome } => {
            if state.lifecycle != RunLifecycle::Running {
                return Err(TransitionError::IllegalTransition(
                    state.lifecycle,
                    "TerminateRun",
                ));
            }
            next.lifecycle = RunLifecycle::Terminal;
            next.phase = None;
            next.terminal_outcome = Some(outcome);
            next.pending_intent = None;
        }

        RunTrigger::InterruptDriver => {
            next.lifecycle = RunLifecycle::Recovering;
            next.phase = None;
        }
    }

    Ok(next)
}
