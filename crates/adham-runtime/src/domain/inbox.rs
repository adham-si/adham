use crate::domain::identity::*;
use adham_core_types::ContentId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxItemType {
    // Steering has highest priority at preparation boundary
    Steering,
    Objective,
    FollowUp,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InboxDisposition {
    Queued,
    Claimed,
    Applied,
    Canceled,
    Superseded,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InboxItem {
    pub inbox_item_id: InboxItemId,
    pub item_type: InboxItemType,
    pub content_id: ContentId,
    pub target_run_id: Option<RunId>,
    pub enqueue_position: u64,
    pub disposition: InboxDisposition,
}

impl InboxItem {
    pub fn new(
        inbox_item_id: InboxItemId,
        item_type: InboxItemType,
        content_id: ContentId,
        target_run_id: Option<RunId>,
        enqueue_position: u64,
    ) -> Self {
        Self {
            inbox_item_id,
            item_type,
            content_id,
            target_run_id,
            enqueue_position,
            disposition: InboxDisposition::Queued,
        }
    }
}
