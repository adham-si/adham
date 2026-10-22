//! Bounded, trust-checked ingestion of user-selected text/code files.
//!
//! Refusals are specific and pre-append: unknown type, binary content, not
//! UTF-8, or over the byte cap. The extracted text is sealed under the full
//! session scope and nothing else is retained, so every later reader sees
//! exactly what a dispatch would send.

use crate::dtos::*;
use crate::handlers::ApiContext;
use crate::service::common::{ensure_session_active_tx, lock_session_stream_tx};
use adham_core_types::*;
use adham_event_log::{AttachmentRecord, SqliteEventStore};
use std::io::Read;
use std::path::Path;
use time::OffsetDateTime;

/// Hard byte cap for one attachment. Larger files are refused, not silently
/// cut: the user picks a bounded file instead.
pub const MAX_ATTACHMENT_BYTES: usize = 5 * 1024 * 1024;
/// Character cap for the extracted text handed to the model budget.
pub const MAX_EXTRACTED_CHARS: usize = 200_000;
/// Bytes scanned for NUL when telling text from binary.
const SNIFF_BYTES: usize = 8 * 1024;

pub(super) fn refusal(code: &str) -> String {
    format!("VALIDATION_FAILED: attachment.{code}")
}

/// Extension allowlist: text and code only. Unknown extensions are refused,
/// never guessed, so a renamed binary still has to pass the NUL and UTF-8
/// checks below.
fn classify_text(file_name: &str) -> Option<&'static str> {
    let ext = file_name
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())?;
    Some(match ext.as_str() {
        "txt" | "text" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "json" => "application/json",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "csv" | "tsv" => "text/csv",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "xml" => "text/xml",
        "ini" | "cfg" | "conf" => "text/plain",
        "sh" | "bash" | "zsh" => "text/x-shellscript",
        "py" => "text/x-python",
        "rs" => "text/x-rust",
        "go" => "text/x-go",
        "java" => "text/x-java",
        "kt" | "kts" => "text/x-kotlin",
        "swift" => "text/x-swift",
        "c" | "h" => "text/x-c",
        "cc" | "cpp" | "cxx" | "hpp" => "text/x-c++",
        "cs" => "text/x-csharp",
        "rb" => "text/x-ruby",
        "php" => "text/x-php",
        "sql" => "text/x-sql",
        "ts" | "tsx" => "text/x-typescript",
        "js" | "jsx" | "mjs" | "cjs" => "text/x-javascript",
        "vue" | "svelte" => "text/plain",
        _ => return None,
    })
}

/// Keep only the base name and drop control characters, so a chip or a prompt
/// label never renders a path or breaks a line.
fn sanitize_file_name(raw: &str) -> String {
    let base = Path::new(raw)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment");
    let cleaned: String = base.chars().filter(|c| !c.is_control()).take(200).collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "attachment".to_string()
    } else {
        trimmed.to_string()
    }
}

struct Extracted {
    media_type: &'static str,
    text: String,
    truncated: bool,
}

fn extract_text(file_name: &str, bytes: &[u8]) -> Result<Extracted, String> {
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(refusal("tooLarge"));
    }
    let media_type = classify_text(file_name).ok_or_else(|| refusal("unsupportedType"))?;
    if bytes[..bytes.len().min(SNIFF_BYTES)].contains(&0) {
        return Err(refusal("binaryContent"));
    }
    let text = std::str::from_utf8(bytes).map_err(|_| refusal("notUtf8"))?;
    let truncated = text.chars().nth(MAX_EXTRACTED_CHARS).is_some();
    let text = if truncated {
        text.chars().take(MAX_EXTRACTED_CHARS).collect()
    } else {
        text.to_string()
    };
    Ok(Extracted {
        media_type,
        text,
        truncated,
    })
}

struct AttachmentIds {
    ws_id: WorkspaceId,
    proj_id: ProjectId,
    sess_id: SessionId,
}

async fn resolve_ids(
    ctx: &ApiContext,
    context: &CommandContext,
) -> Result<(AttachmentIds, EventScope), String> {
    let sess_id = crate::service::common::resolve_scoped_session(ctx, context).await?;
    let ws_id = WorkspaceId::from_string(
        context
            .workspace_id
            .as_deref()
            .ok_or("workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let proj_id = ProjectId::from_string(
        context
            .project_id
            .as_deref()
            .ok_or("projectId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ws_id),
        project_id: Some(proj_id),
        session_id: Some(sess_id),
    };
    Ok((
        AttachmentIds {
            ws_id,
            proj_id,
            sess_id,
        },
        scope,
    ))
}

fn attachment_dto(record: &AttachmentRecord, text: String) -> AttachmentDto {
    AttachmentDto {
        attachment_id: record.attachment_id.to_string(),
        file_name: record.file_name.clone(),
        media_type: record.media_type.clone(),
        byte_size: record.byte_size as u32,
        content_hash: record.content_hash.clone(),
        hash_algorithm: record.hash_algorithm.clone(),
        extracted_chars: record.extracted_chars as u32,
        truncated: record.truncated,
        retention: record.retention.clone(),
        text,
    }
}

pub fn message_attachment_dto(record: &AttachmentRecord) -> MessageAttachmentDto {
    MessageAttachmentDto {
        attachment_id: record.attachment_id.to_string(),
        file_name: record.file_name.clone(),
        media_type: record.media_type.clone(),
        byte_size: record.byte_size as u32,
        content_hash: record.content_hash.clone(),
        hash_algorithm: record.hash_algorithm.clone(),
        extracted_chars: record.extracted_chars as u32,
        truncated: record.truncated,
    }
}

/// Ingest one text attachment. Content and index row commit together; a
/// refused file writes nothing.
pub async fn ingest_text_attachment(
    ctx: &ApiContext,
    context: &CommandContext,
    file_name: &str,
    bytes: &[u8],
) -> Result<AttachmentDto, String> {
    let (ids, scope) = resolve_ids(ctx, context).await?;
    let file_name = sanitize_file_name(file_name);
    let extracted = extract_text(&file_name, bytes)?;
    let record = AttachmentRecord {
        attachment_id: AttachmentId::new_v7(),
        content_id: ContentId::new_v7(),
        file_name,
        media_type: extracted.media_type.to_string(),
        byte_size: bytes.len() as i64,
        content_hash: blake3::hash(bytes).to_hex().to_string(),
        hash_algorithm: "blake3".to_string(),
        extracted_chars: extracted.text.chars().count() as i64,
        truncated: extracted.truncated,
        retention: "session".to_string(),
        workspace_id: ids.ws_id,
        project_id: ids.proj_id,
        session_id: ids.sess_id,
        created_at_us: (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64,
    };
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    lock_session_stream_tx(&mut tx, &ids.sess_id.to_string()).await?;
    ensure_session_active_tx(&mut tx, &ids.sess_id.to_string()).await?;
    SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &record.content_id,
        "attachment_text",
        &record.media_type,
        &scope,
        extracted.text.as_bytes(),
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    SqliteEventStore::insert_attachment_tx(&mut tx, &record)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    Ok(attachment_dto(&record, extracted.text))
}

/// Read one byte-capped file from disk for the drop path: metadata first,
/// then at most cap+1 bytes so an oversized file is refused, never truncated.
pub fn read_bounded_file(file_path: &str) -> Result<Vec<u8>, String> {
    let path = Path::new(file_path);
    let metadata = std::fs::metadata(path).map_err(|e| format!("attachment.unreadable: {e}"))?;
    if !metadata.is_file() {
        return Err(refusal("unsupportedSource"));
    }
    if metadata.len() > MAX_ATTACHMENT_BYTES as u64 {
        return Err(refusal("tooLarge"));
    }
    let file = std::fs::File::open(path).map_err(|e| format!("attachment.unreadable: {e}"))?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_ATTACHMENT_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("attachment.unreadable: {e}"))?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(refusal("tooLarge"));
    }
    Ok(bytes)
}

pub async fn ingest_attachment_path(
    ctx: &ApiContext,
    context: &CommandContext,
    file_path: &str,
) -> Result<AttachmentDto, String> {
    let bytes = read_bounded_file(file_path)?;
    let file_name = Path::new(file_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("attachment");
    ingest_text_attachment(ctx, context, file_name, &bytes).await
}

pub async fn read_attachment_text(
    ctx: &ApiContext,
    context: &CommandContext,
    attachment_id: &str,
) -> Result<AttachmentDto, String> {
    let (ids, scope) = resolve_ids(ctx, context).await?;
    let attachment_id =
        AttachmentId::from_string(attachment_id).map_err(|_| refusal("notFound"))?;
    let record = ctx
        .store
        .get_attachment(&ids.ws_id, &ids.proj_id, &ids.sess_id, &attachment_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
        .ok_or_else(|| refusal("notFound"))?;
    let text = open_attachment_text(ctx, &scope, &record).await?;
    Ok(attachment_dto(&record, text))
}

/// Open one sealed attachment's extracted text under the session scope.
pub(super) async fn open_attachment_text(
    ctx: &ApiContext,
    scope: &EventScope,
    record: &AttachmentRecord,
) -> Result<String, String> {
    let bytes = ctx
        .store
        .get_content(ctx.content_key.as_ref(), &record.content_id, scope)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
        .ok_or_else(|| "STORAGE_REPAIR_REQUIRED: attachment content missing".to_string())?;
    String::from_utf8(bytes)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: attachment content invalid utf-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_text_and_code_extensions() {
        assert_eq!(classify_text("notes.md"), Some("text/markdown"));
        assert_eq!(classify_text("main.RS"), Some("text/x-rust"));
        assert_eq!(classify_text("data.yaml"), Some("application/yaml"));
        assert_eq!(classify_text("photo.png"), None);
        assert_eq!(classify_text("no-extension"), None);
    }

    #[test]
    fn sanitizes_file_names_to_a_base_name() {
        assert_eq!(sanitize_file_name("../../etc/passwd"), "passwd");
        assert_eq!(sanitize_file_name("weird\nname.md"), "weirdname.md");
        assert_eq!(sanitize_file_name(""), "attachment");
    }

    #[test]
    fn refuses_an_unknown_type_even_when_the_text_looks_fine() {
        let err = extract_text("photo.png", b"plain text")
            .err()
            .expect("refuse");
        assert!(err.contains("attachment.unsupportedType"), "{err}");
    }

    #[test]
    fn refuses_binary_content_in_a_text_extension() {
        let err = extract_text("sneaky.txt", b"a\0b").err().expect("refuse");
        assert!(err.contains("attachment.binaryContent"), "{err}");
    }

    #[test]
    fn refuses_invalid_utf8() {
        let err = extract_text("notes.txt", &[0xFF, 0xFE])
            .err()
            .expect("refuse");
        assert!(err.contains("attachment.notUtf8"), "{err}");
    }

    #[test]
    fn truncates_on_a_character_boundary() {
        let text = "é".repeat(MAX_EXTRACTED_CHARS + 1);
        let extracted = extract_text("notes.txt", text.as_bytes()).expect("extract");
        assert!(extracted.truncated);
        assert_eq!(extracted.text.chars().count(), MAX_EXTRACTED_CHARS);
    }

    #[test]
    fn keeps_text_under_the_cap_unchanged() {
        let extracted = extract_text("notes.txt", b"canary").expect("extract");
        assert!(!extracted.truncated);
        assert_eq!(extracted.text, "canary");
    }

    #[test]
    fn read_bounded_file_refuses_directories() {
        let err = read_bounded_file(".").expect_err("refuse");
        assert!(err.contains("attachment.unsupportedSource"), "{err}");
    }
}
