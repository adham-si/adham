use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// One ingested attachment as the UI sees it: metadata plus the exact text a
/// dispatch would send. `text` is the extracted (possibly truncated) content,
/// never the raw file.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct AttachmentDto {
    pub attachment_id: String,
    pub file_name: String,
    pub media_type: String,
    pub byte_size: u32,
    pub content_hash: String,
    pub hash_algorithm: String,
    pub extracted_chars: u32,
    pub truncated: bool,
    /// "session": retained for this session under the sealed content record.
    /// The record states what it is; no other retention scope exists yet.
    pub retention: String,
    pub text: String,
}

/// Picker and paste path: the webview decodes the selected file and sends the
/// text. The Rust side re-validates type, bytes and UTF-8 regardless.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IngestAttachmentPayload {
    pub file_name: String,
    pub text: String,
}

/// Drop path: the window drop event yields a filesystem path; the Rust side
/// reads at most the byte cap before any parsing. No folder recursion.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct IngestAttachmentPathPayload {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ReadAttachmentPayload {
    pub attachment_id: String,
}

/// Attachment summary on a conversation message. No text: rendering history
/// never needs it, and the read command rehydrates the preview on demand.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct MessageAttachmentDto {
    pub attachment_id: String,
    pub file_name: String,
    pub media_type: String,
    pub byte_size: u32,
    pub content_hash: String,
    pub hash_algorithm: String,
    pub extracted_chars: u32,
    pub truncated: bool,
}
