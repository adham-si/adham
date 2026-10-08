use crate::domain::budget::BudgetUsage;
use crate::domain::identity::*;
use crate::domain::run::{RunLifecycle, RunPhase, RunState};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunCheckpoint {
    pub checkpoint_id: CheckpointId,
    pub run_id: RunId,
    pub epoch: DriverEpoch,
    pub revision: u64,
    pub lifecycle: RunLifecycle,
    pub phase: Option<RunPhase>,
    pub budget_usage: BudgetUsage,
    pub created_at_us: i64,
}

impl RunCheckpoint {
    pub fn create(state: &RunState, budget_usage: BudgetUsage, created_at_us: i64) -> Self {
        Self {
            checkpoint_id: CheckpointId::new_v7(),
            run_id: state.identity.run_id.clone(),
            epoch: state.epoch,
            revision: state.revision,
            lifecycle: state.lifecycle,
            phase: state.phase,
            budget_usage,
            created_at_us,
        }
    }

    pub fn restore_into(&self, state: &mut RunState) {
        state.epoch = self.epoch;
        state.revision = self.revision;
        state.lifecycle = self.lifecycle;
        state.phase = self.phase;
    }
}
