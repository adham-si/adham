use crate::domain::identity::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AttemptLifecycle {
    Created,
    Dispatching,
    Active,
    Succeeded,
    Failed,
    Canceled,
    Interrupted,
    OutcomeUnknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AttemptState {
    pub attempt_id: AttemptId,
    pub step_id: StepId,
    pub epoch: DriverEpoch,
    pub ordinal: u32,
    pub lifecycle: AttemptLifecycle,
    pub error_code: Option<String>,
}

impl AttemptState {
    pub fn new(attempt_id: AttemptId, step_id: StepId, epoch: DriverEpoch, ordinal: u32) -> Self {
        Self {
            attempt_id,
            step_id,
            epoch,
            ordinal,
            lifecycle: AttemptLifecycle::Created,
            error_code: None,
        }
    }
}
