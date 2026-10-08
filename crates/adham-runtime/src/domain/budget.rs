use crate::domain::run::BlockReason;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RunBudget {
    pub max_turns: u32,
    pub max_steps: u32,
    pub max_attempts: u32,
    pub max_model_attempts_per_op: u32,
    pub max_active_duration_ms: u64,
    pub max_output_bytes: u64,
}

impl Default for RunBudget {
    fn default() -> Self {
        Self {
            max_turns: 16,
            max_steps: 32,
            max_attempts: 64,
            max_model_attempts_per_op: 3,
            max_active_duration_ms: 10 * 60 * 1000, // 10 minutes
            max_output_bytes: 4 * 1024 * 1024,      // 4 MiB
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BudgetUsage {
    pub turns_used: u32,
    pub steps_used: u32,
    pub attempts_used: u32,
    pub active_duration_ms: u64,
    pub output_bytes_used: u64,
}

impl BudgetUsage {
    pub fn check_exhaustion(&self, budget: &RunBudget) -> Option<BlockReason> {
        if self.turns_used >= budget.max_turns
            || self.steps_used >= budget.max_steps
            || self.attempts_used >= budget.max_attempts
            || self.active_duration_ms >= budget.max_active_duration_ms
            || self.output_bytes_used >= budget.max_output_bytes
        {
            Some(BlockReason::BudgetExhausted)
        } else {
            None
        }
    }
}
