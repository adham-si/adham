use crate::domain::budget::*;
use crate::domain::run::*;
use crate::domain::transition::*;
use crate::ports::clock::Clock;
use crate::ports::model::ModelPort;
use crate::ports::verification::{CompletionContract, VerificationPort, VerificationVerdict};

pub struct AgentDriver<M: ModelPort, V: VerificationPort, C: Clock> {
    model: M,
    verifier: V,
    #[allow(dead_code)]
    clock: C,
}

impl<M: ModelPort, V: VerificationPort, C: Clock> AgentDriver<M, V, C> {
    pub fn new(model: M, verifier: V, clock: C) -> Self {
        Self {
            model,
            verifier,
            clock,
        }
    }

    /// Advances a run by claiming queued input, checking budgets, executing model calls,
    /// and evaluating verification gates until answering, pausing, canceling, or reaching terminal completion.
    pub async fn run_step(
        &self,
        state: &mut RunState,
        budget: &RunBudget,
        usage: &mut BudgetUsage,
        contract: &CompletionContract,
        prompt: &str,
    ) -> Result<RunState, TransitionError> {
        // 1. If queued, claim with fresh epoch
        if state.lifecycle == RunLifecycle::Queued {
            let next_epoch = state.epoch.next();
            *state = reduce_run(state, RunTrigger::ClaimDriver { epoch: next_epoch })?;
        }

        // 2. Check pending control intents
        if state.pending_intent == Some(ControlIntent::Cancel) {
            *state = reduce_run(
                state,
                RunTrigger::AdvancePhase {
                    next_phase: RunPhase::Preparing,
                },
            )?;
            *state = reduce_run(state, RunTrigger::ConfirmCanceled)?;
            return Ok(state.clone());
        }

        if state.pending_intent == Some(ControlIntent::Pause) {
            *state = reduce_run(
                state,
                RunTrigger::AdvancePhase {
                    next_phase: RunPhase::Preparing,
                },
            )?;
            *state = reduce_run(state, RunTrigger::ConfirmPaused)?;
            return Ok(state.clone());
        }

        // 3. Check budget exhaustion
        if let Some(reason) = usage.check_exhaustion(budget) {
            *state = reduce_run(state, RunTrigger::BlockRun { reason })?;
            return Ok(state.clone());
        }

        // 4. Advance phase: Preparing -> Requesting
        *state = reduce_run(
            state,
            RunTrigger::AdvancePhase {
                next_phase: RunPhase::Requesting,
            },
        )?;

        // 5. Model call
        usage.steps_used += 1;
        usage.attempts_used += 1;
        let model_res = match self.model.request_completion(prompt).await {
            Ok(res) => res,
            Err(e) => {
                *state = reduce_run(
                    state,
                    RunTrigger::TerminateRun {
                        outcome: TerminalOutcome::Failed(e),
                    },
                )?;
                return Ok(state.clone());
            }
        };

        usage.output_bytes_used += model_res.text.len() as u64;

        // 6. Advance phase: Requesting -> Streaming -> Observing
        *state = reduce_run(
            state,
            RunTrigger::AdvancePhase {
                next_phase: RunPhase::Streaming,
            },
        )?;
        *state = reduce_run(
            state,
            RunTrigger::AdvancePhase {
                next_phase: RunPhase::Observing,
            },
        )?;

        // Check if pause/cancel was requested during streaming
        if state.pending_intent == Some(ControlIntent::Cancel) {
            *state = reduce_run(state, RunTrigger::RequestCancel)?;
            *state = reduce_run(state, RunTrigger::ConfirmCanceled)?;
            return Ok(state.clone());
        }

        // 7. Advance phase: Observing -> Verifying
        *state = reduce_run(
            state,
            RunTrigger::AdvancePhase {
                next_phase: RunPhase::Verifying,
            },
        )?;

        // 8. Verification gate evaluation
        let evidence = vec![model_res.text];
        let verdict = match self.verifier.verify_completion(contract, &evidence).await {
            Ok(v) => v,
            Err(e) => {
                *state = reduce_run(
                    state,
                    RunTrigger::TerminateRun {
                        outcome: TerminalOutcome::Failed(e),
                    },
                )?;
                return Ok(state.clone());
            }
        };

        match verdict {
            VerificationVerdict::Pass => {
                *state = reduce_run(
                    state,
                    RunTrigger::TerminateRun {
                        outcome: TerminalOutcome::Completed,
                    },
                )?;
            }
            VerificationVerdict::PassWithWarnings(_) => {
                *state = reduce_run(
                    state,
                    RunTrigger::TerminateRun {
                        outcome: TerminalOutcome::CompletedWithWarnings,
                    },
                )?;
            }
            VerificationVerdict::Fail(reason) => {
                *state = reduce_run(
                    state,
                    RunTrigger::TerminateRun {
                        outcome: TerminalOutcome::FailedVerification(reason),
                    },
                )?;
            }
            VerificationVerdict::Blocked(_) => {
                *state = reduce_run(
                    state,
                    RunTrigger::BlockRun {
                        reason: BlockReason::VerificationRequired,
                    },
                )?;
            }
        }

        Ok(state.clone())
    }
}
