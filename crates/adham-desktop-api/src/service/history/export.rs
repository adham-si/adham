//! Export the persisted transcript as plaintext Markdown to the caller-selected
//! destination. This is deliberately not encrypted and is not removed by
//! session deletion; the UI warns before writing.
use crate::dtos::{CommandContext, ExportSessionResponse};
use crate::handlers::ApiContext;
use crate::service::common::{
    ensure_no_live_operation_tx, ensure_session_active_tx, lock_session_stream_tx,
};
use crate::service::history::duplicate::{
    ensure_source_scope_tx, map_source_error, read_summary_id_tx, read_summary_text_tx,
    read_title_tx,
};
use crate::service::history::key_cache::CachedContentKeyProvider;
use adham_core_types::*;
use adham_event_log::SqliteEventStore;
use adham_projections::{ConversationMessageView, ConversationProjection};
use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

const MAX_EXPORT_BYTES: usize = 5 * 1024 * 1024;
const SLUG_SCALARS: usize = 40;
const SLUG_BYTES: usize = 120;
static TEMP_SEQ: AtomicU64 = AtomicU64::new(0);

async fn validate_export_source_tx(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    session: &str,
    ws_id: &WorkspaceId,
    proj_id: &ProjectId,
) -> Result<(), String> {
    lock_session_stream_tx(tx, session).await?;
    ensure_session_active_tx(tx, session).await?;
    ensure_source_scope_tx(tx, session, ws_id, proj_id).await?;
    ensure_no_live_operation_tx(tx, session).await?;
    Ok(())
}

fn parse_context(context: &CommandContext) -> Result<(WorkspaceId, ProjectId, SessionId), String> {
    let ws = WorkspaceId::from_string(
        context
            .workspace_id
            .as_deref()
            .ok_or("workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let proj = ProjectId::from_string(
        context
            .project_id
            .as_deref()
            .ok_or("projectId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let session = SessionId::from_string(
        context
            .session_id
            .as_deref()
            .ok_or("sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;
    Ok((ws, proj, session))
}

fn slug(title: Option<&str>) -> String {
    let mut out = String::new();
    let mut count = 0usize;
    let mut last_separator = false;
    for ch in title.unwrap_or("").chars() {
        let mapped = if ch.is_alphanumeric() || ch == '_' || ch == '-' || ch == ' ' {
            ch
        } else {
            '-'
        };
        if mapped == '-' || mapped == ' ' {
            if last_separator {
                continue;
            }
            last_separator = true;
        } else {
            last_separator = false;
        }
        if count >= SLUG_SCALARS || out.len() + mapped.len_utf8() > SLUG_BYTES {
            break;
        }
        out.push(mapped);
        count += 1;
    }
    let trimmed = out.trim_matches(|ch| ch == '-' || ch == ' ');
    if trimmed.is_empty() {
        "session".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn suggested_export_file_name(title: Option<&str>, session_id: &str) -> String {
    format!("{}-{}.md", slug(title), session_id)
}

fn clip_chars(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn auto_summary(
    messages: &[ConversationMessageView],
    attachments: &HashMap<String, Vec<(String, i64)>>,
) -> Option<String> {
    let first_user = messages.iter().find(|message| message.role == "user");
    let latest_assistant = messages
        .iter()
        .rev()
        .find(|message| message.role == "assistant");
    let user_text = first_user.and_then(|message| {
        let text = message.content.trim();
        if !text.is_empty() {
            return Some(clip_chars(text, 120));
        }
        let names = attachments.get(&message.message_id)?;
        if names.is_empty() {
            return None;
        }
        Some(clip_chars(
            &names
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>()
                .join(", "),
            120,
        ))
    });
    let assistant_text = latest_assistant.and_then(|message| {
        let text = message.content.trim();
        if text.is_empty() {
            None
        } else {
            Some(clip_chars(text, 140))
        }
    });
    match (user_text, assistant_text) {
        (None, None) => None,
        (Some(user), None) => Some(user),
        (None, Some(assistant)) => Some(assistant),
        (Some(user), Some(assistant)) => Some(clip_chars(&format!("{user} — {assistant}"), 240)),
    }
}

fn completion_label(completion: &Option<MessageCompletionV1>) -> Option<&'static str> {
    match completion {
        Some(MessageCompletionV1::Completed { truncated: false }) => Some("Completed"),
        Some(MessageCompletionV1::Completed { truncated: true }) => Some("Completed (truncated)"),
        Some(MessageCompletionV1::Interrupted) => Some("Interrupted"),
        Some(MessageCompletionV1::Failed) => Some("Failed"),
        None => None,
    }
}

fn render(
    title: Option<&str>,
    summary: Option<&str>,
    origin: Option<&str>,
    messages: &[ConversationMessageView],
    attachments: &HashMap<String, Vec<(String, i64)>>,
) -> String {
    let mut markdown = String::new();
    writeln!(markdown, "# {}\n", title.unwrap_or("Untitled session")).expect("write to string");
    if let Some(summary) = summary {
        let label = if origin == Some("user") {
            "User"
        } else {
            "Auto"
        };
        writeln!(markdown, "**Summary ({label}):** {summary}\n").expect("write to string");
    }
    for message in messages {
        let role = match message.role.as_str() {
            "user" => "User",
            "assistant" => "Assistant",
            other => other,
        };
        writeln!(markdown, "## {role}\n").expect("write to string");
        match message.refers_to_relation.as_deref() {
            Some("edited-from") => {
                writeln!(markdown, "*Edited from an earlier prompt.*\n").expect("write to string")
            }
            Some("replied") => {
                writeln!(markdown, "*Reply to an earlier message.*\n").expect("write to string")
            }
            _ => {}
        }
        let text = message.content.trim_end();
        if !text.is_empty() {
            writeln!(markdown, "{text}\n").expect("write to string");
        }
        if let Some(label) = completion_label(&message.completion) {
            writeln!(markdown, "*Completion: {label}*\n").expect("write to string");
        }
        if let Some(files) = attachments.get(&message.message_id) {
            if !files.is_empty() {
                writeln!(markdown, "**Attachments:**\n").expect("write to string");
                for (name, size) in files {
                    writeln!(markdown, "- {name} ({size} bytes)").expect("write to string");
                }
                markdown.push('\n');
            }
        }
    }
    markdown
}

fn temp_path(target: &Path) -> PathBuf {
    let name = target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("export.md");
    let sequence = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
    target.with_file_name(format!(".{name}.{}.{}.tmp", std::process::id(), sequence))
}

fn write_atomic(target: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(parent) = target.parent().filter(|path| !path.as_os_str().is_empty()) {
        fs::create_dir_all(parent)
            .map_err(|e| format!("EXPORT_WRITE_FAILED: destination folder: {e}"))?;
    }
    let mut temp = None;
    let mut file = None;
    for _ in 0..20 {
        let candidate = temp_path(target);
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&candidate) {
            Ok(handle) => {
                temp = Some(candidate);
                file = Some(handle);
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("EXPORT_WRITE_FAILED: temporary file: {error}"));
            }
        }
    }
    let (temp, mut file) = temp
        .zip(file)
        .ok_or_else(|| "EXPORT_WRITE_FAILED: temporary file collision".to_string())?;
    let result = (|| -> Result<(), String> {
        file.write_all(bytes)
            .map_err(|e| format!("EXPORT_WRITE_FAILED: write: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("EXPORT_WRITE_FAILED: sync: {e}"))?;
        drop(file);
        replace_file(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    // `fs::rename` replaces an existing file atomically: MoveFileExW with
    // MOVEFILE_REPLACE_EXISTING on Windows, rename(2) elsewhere. A failed
    // replacement must leave the original target untouched.
    fs::rename(temp, target).map_err(|e| format!("EXPORT_WRITE_FAILED: replace: {e}"))
}

pub async fn validate_export_session(
    ctx: &ApiContext,
    context: &CommandContext,
) -> Result<(), String> {
    let (ws_id, proj_id, session_id) = parse_context(context)?;
    let session = session_id.to_string();
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    validate_export_source_tx(&mut tx, &session, &ws_id, &proj_id).await?;
    tx.rollback()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    Ok(())
}

pub async fn export_session_markdown(
    ctx: &ApiContext,
    context: CommandContext,
    destination: PathBuf,
) -> Result<ExportSessionResponse, String> {
    let (ws_id, proj_id, session_id) = parse_context(&context)?;
    let session = session_id.to_string();
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    validate_export_source_tx(&mut tx, &session, &ws_id, &proj_id).await?;

    let provider = CachedContentKeyProvider::new(Arc::clone(&ctx.content_key));
    let title = read_title_tx(&mut tx, &session).await?;
    let summary_id = read_summary_id_tx(&mut tx, &session).await?;
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ws_id),
        project_id: Some(proj_id),
        session_id: Some(session_id),
    };
    let summary_text =
        read_summary_text_tx(&mut tx, &provider, &scope, summary_id.as_ref()).await?;
    let messages = ConversationProjection::get_session_messages(
        &ctx.pool,
        &provider,
        &ctx.installation_id,
        &session_id,
    )
    .await
    .map_err(map_source_error)?;

    let linked = SqliteEventStore::list_session_message_attachments_tx(&mut tx, &session_id)
        .await
        .map_err(map_source_error)?;
    let mut attachments: HashMap<String, Vec<(String, i64)>> = HashMap::new();
    for (message_id, record) in linked {
        attachments
            .entry(message_id)
            .or_default()
            .push((record.file_name, record.byte_size));
    }

    let (summary, origin) = match summary_text {
        Some(text) => (Some(text), Some("user")),
        None => (auto_summary(&messages, &attachments), Some("auto")),
    };
    let origin = origin.filter(|_| summary.is_some());
    let markdown = render(
        title.as_deref(),
        summary.as_deref(),
        origin,
        &messages,
        &attachments,
    );
    if markdown.len() > MAX_EXPORT_BYTES {
        return Err("EXPORT_TOO_LARGE: the export exceeds 5 MB".to_string());
    }

    write_atomic(&destination, markdown.as_bytes())?;
    tx.rollback()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    Ok(ExportSessionResponse {
        path: destination.to_string_lossy().to_string(),
        bytes: markdown.len() as u64,
    })
}
