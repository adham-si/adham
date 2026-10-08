use crate::domain::identity::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunLifecycle {
    Queued,
    Running,
    Pausing,
    Paused,
    Canceling,
    Recovering,
    Blocked,
    Terminal,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunPhase {
    Preparing,
    Requesting,
    Streaming,
    Observing,
    Verifying,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TerminalOutcome {
    Completed,
    CompletedWithWarnings,
    Canceled,
    Failed(String),
    FailedVerification(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockReason {
    CapabilityUnavailable,
    BudgetExhausted,
    NoProgressRepetition,
    VerificationRequired,
    RecoverableFault(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ControlIntent {
    Pause,
    Cancel,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunState {
    pub identity: ExecutionIdentity,
    pub epoch: DriverEpoch,
    pub revision: u64,
    pub lifecycle: RunLifecycle,
    pub phase: Option<RunPhase>,
    pub terminal_outcome: Option<TerminalOutcome>,
    pub block_reason: Option<BlockReason>,
    pub pending_intent: Option<ControlIntent>,
    pub active_turn: Option<TurnId>,
    pub active_step: Option<StepId>,
    pub active_attempt: Option<AttemptId>,
}

impl RunState {
    pub fn new_queued(identity: ExecutionIdentity) -> Self {
        Self {
            identity,
            epoch: DriverEpoch(0),
            revision: 1,
            lifecycle: RunLifecycle::Queued,
            phase: None,
            terminal_outcome: None,
            block_reason: None,
            pending_intent: None,
            active_turn: None,
            active_step: None,
            active_attempt: None,
        }
    }

    pub fn is_terminal(&self) -> bool {
        matches!(self.lifecycle, RunLifecycle::Terminal)
    }
}
