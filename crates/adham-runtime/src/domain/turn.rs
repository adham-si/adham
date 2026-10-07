use crate::domain::identity::*;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TurnLifecycle {
    Queued,
    Active,
    Answered,
    Yielded,
    Canceled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TurnState {
    pub turn_id: TurnId,
    pub run_id: RunId,
    pub ordinal: u32,
    pub lifecycle: TurnLifecycle,
    pub claimed_inbox_items: Vec<InboxItemId>,
}

impl TurnState {
    pub fn new(
        turn_id: TurnId,
        run_id: RunId,
        ordinal: u32,
        claimed_inbox_items: Vec<InboxItemId>,
    ) -> Self {
        Self {
            turn_id,
            run_id,
            ordinal,
            lifecycle: TurnLifecycle::Active,
            claimed_inbox_items,
        }
    }
}
