use crate::domain::identity::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepKind {
    ContextPreparation,
    ModelCall,
    Observation,
    Verification,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StepLifecycle {
    Planned,
    Active,
    Completed,
    Failed,
    Canceled,
    Interrupted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StepState {
    pub step_id: StepId,
    pub turn_id: TurnId,
    pub ordinal: u32,
    pub kind: StepKind,
    pub operation_id: OperationId,
    pub lifecycle: StepLifecycle,
    pub attempts_count: u32,
}

impl StepState {
    pub fn new(
        step_id: StepId,
        turn_id: TurnId,
        ordinal: u32,
        kind: StepKind,
        operation_id: OperationId,
    ) -> Self {
        Self {
            step_id,
            turn_id,
            ordinal,
            kind,
            operation_id,
            lifecycle: StepLifecycle::Planned,
            attempts_count: 0,
        }
    }
}
