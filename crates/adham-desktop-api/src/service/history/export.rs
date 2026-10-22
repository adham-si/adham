//! Export the persisted transcript as plaintext Markdown in the app-data
//! `exports/` folder. This is deliberately not encrypted and is not removed by
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
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("STORAGE_UNAVAILABLE: export folder: {e}"))?;
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
                return Err(format!("STORAGE_UNAVAILABLE: export temp file: {error}"));
            }
        }
    }
    let (temp, mut file) = temp
        .zip(file)
        .ok_or_else(|| "STORAGE_UNAVAILABLE: export temp file collision".to_string())?;
    let result = (|| -> Result<(), String> {
        file.write_all(bytes)
            .map_err(|e| format!("STORAGE_UNAVAILABLE: export write: {e}"))?;
        file.sync_all()
            .map_err(|e| format!("STORAGE_UNAVAILABLE: export sync: {e}"))?;
        drop(file);
        replace_file(&temp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

#[cfg(not(windows))]
fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    fs::rename(temp, target).map_err(|e| format!("STORAGE_UNAVAILABLE: export replace: {e}"))
}

#[cfg(windows)]
fn replace_file(temp: &Path, target: &Path) -> Result<(), String> {
    match fs::rename(temp, target) {
        Ok(()) => Ok(()),
        Err(_) if target.exists() => {
            fs::remove_file(target)
                .map_err(|e| format!("STORAGE_UNAVAILABLE: export replace: {e}"))?;
            fs::rename(temp, target)
                .map_err(|e| format!("STORAGE_UNAVAILABLE: export replace: {e}"))
        }
        Err(error) => Err(format!("STORAGE_UNAVAILABLE: export replace: {error}")),
    }
}

pub async fn export_session_markdown(
    ctx: &ApiContext,
    context: CommandContext,
) -> Result<ExportSessionResponse, String> {
    let (ws_id, proj_id, session_id) = parse_context(&context)?;
    let session = session_id.to_string();
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    lock_session_stream_tx(&mut tx, &session).await?;
    ensure_session_active_tx(&mut tx, &session).await?;
    ensure_source_scope_tx(&mut tx, &session, &ws_id, &proj_id).await?;
    ensure_no_live_operation_tx(&mut tx, &session).await?;

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

    let exports = ctx.export_dir()?;
    let file_name = format!("{}-{}.md", slug(title.as_deref()), session_id);
    let path = exports.join(file_name);
    write_atomic(&path, markdown.as_bytes())?;
    tx.rollback()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    Ok(ExportSessionResponse {
        path: path.to_string_lossy().to_string(),
        bytes: markdown.len() as u64,
    })
}
