use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RecordPendingOperationPayload {
    pub operation_id: String,
    pub kind: String,
    pub message_request_id: String,
    pub create_request_id: Option<String>,
    pub text: String,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PendingOperationDto {
    pub operation_id: String,
    pub kind: String,
    pub workspace_id: String,
    pub project_id: String,
    pub session_id: Option<String>,
    pub create_request_id: Option<String>,
    pub message_request_id: String,
    pub text: String,
    pub title: Option<String>,
    pub status: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct PendingOperationList {
    pub operations: Vec<PendingOperationDto>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ClearPendingOperationPayload {
    pub operation_id: String,
    pub expected_message_request_id: String,
    pub reason: String,
}
