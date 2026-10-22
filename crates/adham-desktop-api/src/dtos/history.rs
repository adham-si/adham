use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Session metadata returned by mutations so a receipt matches the next list
/// read. Summary text stays out of this shape; the list owns its rendering.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionMetadata {
    pub session_id: String,
    pub project_id: String,
    pub title: Option<String>,
    pub summary_origin: Option<String>,
    pub pinned: bool,
    pub archived: bool,
    pub created_at: String,
    pub last_activity_at: String,
}

/// List shape knobs. Both are optional so a pre-history client still reads.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct ListSessionsOptions {
    pub include_archived: bool,
    #[ts(optional = nullable)]
    pub active_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RenameSessionPayload {
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetSessionPinnedPayload {
    pub pinned: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetSessionArchivedPayload {
    pub archived: bool,
}
