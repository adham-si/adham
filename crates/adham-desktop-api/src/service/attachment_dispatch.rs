//! Dispatch-side attachment resolution: selected ids and linked files become
//! the exact text blocks a provider request carries.
//!
//! Both paths refuse on any read problem instead of sending a message without
//! the file content it was selected (or originally sent) with.

use super::attachment::{open_attachment_text, refusal};
use crate::handlers::ApiContext;
use adham_core_types::*;
use adham_event_log::AttachmentRecord;
use std::collections::HashMap;

/// Combined extracted text of one dispatch. Refused above this: the send
/// states that the selection does not fit instead of dropping a file.
pub const MAX_DISPATCH_ATTACHMENT_CHARS: usize = 240_000;

/// One attachment resolved for a dispatch: the exact text appended to the
/// newest user message, with the file identity the receipt records.
pub struct DispatchAttachment {
    pub attachment_id: AttachmentId,
    pub file_name: String,
    pub media_type: String,
    pub content_hash: String,
    pub text: String,
    pub truncated: bool,
}

fn dispatch_attachment(record: AttachmentRecord, text: String) -> DispatchAttachment {
    DispatchAttachment {
        attachment_id: record.attachment_id,
        file_name: record.file_name,
        media_type: record.media_type,
        content_hash: record.content_hash,
        text,
        truncated: record.truncated,
    }
}

/// Resolve the explicitly selected attachment ids against this session's
/// scope. A selected id that is missing, out of scope, or makes the selection
/// exceed the per-dispatch cap refuses the send: a selected attachment is
/// never silently dropped.
pub async fn resolve_dispatch_attachments(
    ctx: &ApiContext,
    ws_id: &WorkspaceId,
    proj_id: &ProjectId,
    sess_id: &SessionId,
    attachment_ids: &[String],
) -> Result<Vec<DispatchAttachment>, String> {
    if attachment_ids.is_empty() {
        return Ok(Vec::new());
    }
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(*ws_id),
        project_id: Some(*proj_id),
        session_id: Some(*sess_id),
    };
    let mut total_chars: usize = 0;
    let mut resolved = Vec::with_capacity(attachment_ids.len());
    for raw in attachment_ids {
        let id = AttachmentId::from_string(raw).map_err(|_| refusal("notFound"))?;
        let record = ctx
            .store
            .get_attachment(ws_id, proj_id, sess_id, &id)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
            .ok_or_else(|| refusal("notFound"))?;
        let text = open_attachment_text(ctx, &scope, &record).await?;
        total_chars += text.chars().count();
        if total_chars > MAX_DISPATCH_ATTACHMENT_CHARS {
            return Err(refusal("selectionTooLarge"));
        }
        resolved.push(dispatch_attachment(record, text));
    }
    Ok(resolved)
}

/// Attachments linked to this session's messages, keyed by the message they
/// were sent with. A read failure refuses the dispatch: file content that a
/// message was sent with is never silently dropped from a later send or retry.
pub async fn session_dispatch_attachments(
    ctx: &ApiContext,
    ws_id: &WorkspaceId,
    proj_id: &ProjectId,
    sess_id: &SessionId,
) -> Result<HashMap<String, Vec<DispatchAttachment>>, String> {
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(*ws_id),
        project_id: Some(*proj_id),
        session_id: Some(*sess_id),
    };
    let linked = ctx
        .store
        .list_session_message_attachments(sess_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let mut map: HashMap<String, Vec<DispatchAttachment>> = HashMap::new();
    for (message_id, record) in linked {
        let text = open_attachment_text(ctx, &scope, &record).await?;
        map.entry(message_id)
            .or_default()
            .push(dispatch_attachment(record, text));
    }
    Ok(map)
}
