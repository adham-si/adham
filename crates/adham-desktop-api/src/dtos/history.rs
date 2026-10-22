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

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SetSessionSummaryPayload {
    /// Trimmed text replaces the auto summary; `None` or blank reverts to auto.
    #[ts(optional = nullable)]
    pub summary: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DuplicateSessionPayload {
    #[ts(optional = nullable)]
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ExportSessionResponse {
    pub path: String,
    #[ts(as = "u32")]
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteSessionPayload {
    pub confirm: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DeleteSessionResponse {
    pub session_id: String,
    pub deleted: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SessionSearchFilters {
    pub include_archived: bool,
    pub pinned_only: bool,
    pub bookmarked_only: bool,
    pub role: Option<String>,
    pub has_attachments: bool,
    pub from: Option<String>,
    pub to: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export)]
pub struct SessionSearchRequest {
    pub query: String,
    pub filters: SessionSearchFilters,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionSearchResult {
    pub session_id: String,
    pub title: Option<String>,
    pub summary: Option<String>,
    pub summary_origin: Option<String>,
    pub last_activity_at: String,
    pub match_kind: String,
    pub message_id: Option<String>,
    pub role: Option<String>,
    pub snippet: Option<String>,
    pub attachment_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SessionSearchResponse {
    pub results: Vec<SessionSearchResult>,
    pub truncated: bool,
    pub scanned_sessions: u32,
    pub scan_limit_reached: bool,
    pub skipped_unreadable: u32,
}
