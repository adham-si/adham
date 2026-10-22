//! Duplicate a persisted transcript as new events under a fresh session id.
//! Source content is read and re-sealed once; every write stays in one
//! transaction with one replayable receipt.
//!
//! Size exception (AGENTS.md): read, precheck, re-seal, and receipt stay in one
//! module because they share one transaction invariant; splitting would spread
//! that invariant across files.
use crate::dtos::{CommandEnvelope, CommandResult, DuplicateSessionPayload, SessionMetadata};
use crate::handlers::ApiContext;
use crate::service::common::{
    conflict_msg, ensure_no_live_operation_tx, ensure_session_active_tx, lock_session_stream_tx,
};
use crate::service::history::actions::{parse_metadata, parse_scope, receipt_matches};
use crate::service::history::key_cache::CachedContentKeyProvider;
use crate::service::history::list::read_session_metadata_tx;
use adham_core_types::history::*;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, AppendEventResult, AttachmentRecord, SqliteEventStore};
use adham_projections::ConversationProjection;
use serde::Serialize;
use sqlx::{Row, Sqlite, Transaction};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use time::OffsetDateTime;

const DUPLICATE_COMMAND: &str = "duplicate_session";
const MAX_MESSAGES: usize = 500;
const MAX_PLAINTEXT: i64 = 5 * 1024 * 1024;
const MAX_TITLE_SCALARS: usize = 120;

fn now_us() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64
}

fn normalize_title(title: Option<&str>) -> Result<Option<String>, String> {
    match title {
        None => Ok(None),
        Some(raw) => {
            let trimmed = raw.trim();
            validate_title(trimmed).map_err(|_| "VALIDATION_FAILED:title_invalid".to_string())?;
            Ok(Some(trimmed.to_string()))
        }
    }
}

fn fallback_title(source: Option<&str>) -> String {
    let base = source
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Session");
    let mut title: String = base.chars().take(MAX_TITLE_SCALARS - 5).collect();
    title.push_str(" copy");
    title
}

fn map_source_error(error: DomainError) -> String {
    match error {
        DomainError::Storage(message) => format!("STORAGE_UNAVAILABLE: {message}"),
        _ => "STORAGE_REPAIR_REQUIRED: source content is missing or unreadable".to_string(),
    }
}

fn event_scope(
    ws: WorkspaceId,
    proj: ProjectId,
    session: SessionId,
    installation: InstallationId,
) -> EventScope {
    EventScope {
        installation_id: installation,
        workspace_id: Some(ws),
        project_id: Some(proj),
        session_id: Some(session),
    }
}

#[allow(clippy::too_many_arguments)]
async fn append_event<T: Serialize>(
    tx: &mut Transaction<'_, Sqlite>,
    request_id: &RequestId,
    correlation_id: &CorrelationId,
    actor_id: &ActorId,
    scope: &EventScope,
    expected_sequence: u64,
    event_type: &str,
    event_version: u16,
    payload: &T,
) -> Result<AppendEventResult, String> {
    SqliteEventStore::append_event_tx(
        tx,
        AppendEventRequest {
            stream_id: format!(
                "session:{}",
                scope
                    .session_id
                    .expect("duplicate writes always carry a session scope")
            ),
            stream_kind: "session".to_string(),
            expected_sequence,
            event_type: event_type.to_string(),
            event_version,
            scope: scope.clone(),
            actor: EventActor {
                actor_id: *actor_id,
                kind: ActorKind::LocalHuman,
            },
            request_id: *request_id,
            correlation_id: *correlation_id,
            causation_id: None,
            payload_json: serde_json::to_vec(payload).map_err(|e| e.to_string())?,
            metadata_json: b"{}".to_vec(),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

async fn ensure_source_scope_tx(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: &str,
    expected_ws: &WorkspaceId,
    expected_proj: &ProjectId,
) -> Result<(), String> {
    let row = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(format!("session:{session_id}"))
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    .ok_or("SESSION_NOT_FOUND: session stream does not exist".to_string())?;
    let workspace: Option<String> = row.get("workspace_id");
    let project: Option<String> = row.get("project_id");
    if workspace.as_deref() != Some(&expected_ws.to_string())
        || project.as_deref() != Some(&expected_proj.to_string())
    {
        return Err(
            "CONTEXT_MISMATCH: session does not belong to specified workspace or project"
                .to_string(),
        );
    }
    Ok(())
}

async fn read_title_tx(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: &str,
) -> Result<Option<String>, String> {
    let rows = sqlx::query(
        "SELECT event_type, payload_json FROM events WHERE stream_id = ? AND event_type IN ('SessionCreated', ?) ORDER BY global_position ASC",
    )
    .bind(format!("session:{session_id}"))
    .bind(EVENT_TYPE_SESSION_RENAMED)
    .fetch_all(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let mut title = None;
    let mut saw_created = false;
    for row in rows {
        let event_type: String = row.get("event_type");
        let payload: Vec<u8> = row.get("payload_json");
        if event_type == "SessionCreated" {
            let created: SessionCreatedV1 = serde_json::from_slice(&payload)
                .map_err(|_| "STORAGE_REPAIR_REQUIRED: session record unparseable".to_string())?;
            title = created.title;
            saw_created = true;
        } else {
            let renamed: SessionRenamedV1 = serde_json::from_slice(&payload)
                .map_err(|_| "STORAGE_REPAIR_REQUIRED: session history unparseable".to_string())?;
            title = Some(renamed.title);
        }
    }
    if !saw_created {
        return Err("STORAGE_REPAIR_REQUIRED: session record missing".to_string());
    }
    Ok(title)
}

async fn read_summary_id_tx(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: &str,
) -> Result<Option<ContentId>, String> {
    let payload: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT payload_json FROM events WHERE stream_id = ? AND event_type = ? ORDER BY global_position DESC LIMIT 1",
    )
    .bind(format!("session:{session_id}"))
    .bind(EVENT_TYPE_SESSION_SUMMARY_UPDATED)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    match payload {
        None => Ok(None),
        Some(bytes) => {
            let update: SessionSummaryUpdatedV1 = serde_json::from_slice(&bytes)
                .map_err(|_| "STORAGE_REPAIR_REQUIRED: summary record unparseable".to_string())?;
            Ok(update.content_id)
        }
    }
}

async fn precheck_source_tx(
    tx: &mut Transaction<'_, Sqlite>,
    session_id: &str,
    summary_id: Option<&ContentId>,
) -> Result<(), String> {
    let count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM conversation_messages WHERE session_id = ?")
            .bind(session_id)
            .fetch_one(&mut **tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    if count > MAX_MESSAGES as i64 {
        return Err("DUPLICATE_TOO_LARGE: source exceeds the message limit".to_string());
    }
    let total: i64 = sqlx::query_scalar(
        r#"
        SELECT COALESCE(SUM(plaintext_size), 0) FROM content_records
        WHERE content_id IN (
            SELECT content_id FROM conversation_messages WHERE session_id = ?
            UNION
            SELECT ar.content_id FROM message_attachments ma
            JOIN conversation_messages cm ON cm.message_id = ma.message_id
            JOIN attachment_records ar ON ar.attachment_id = ma.attachment_id AND ar.session_id = cm.session_id
            WHERE ar.session_id = ?
            UNION SELECT ?
        )
        "#,
    )
    .bind(session_id)
    .bind(session_id)
    .bind(summary_id.map(|id| id.to_string()).unwrap_or_default())
    .fetch_one(&mut **tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    if total > MAX_PLAINTEXT {
        return Err("DUPLICATE_TOO_LARGE: source exceeds the plaintext limit".to_string());
    }
    Ok(())
}

async fn read_summary_text_tx(
    tx: &mut Transaction<'_, Sqlite>,
    provider: &dyn adham_event_log::ContentKeyProvider,
    scope: &EventScope,
    summary_id: Option<&ContentId>,
) -> Result<Option<String>, String> {
    let Some(content_id) = summary_id else {
        return Ok(None);
    };
    let bytes = SqliteEventStore::get_content_tx(tx, provider, content_id, scope)
        .await
        .map_err(map_source_error)?
        .ok_or_else(|| "STORAGE_REPAIR_REQUIRED: summary content is missing".to_string())?;
    let text = String::from_utf8(bytes)
        .map_err(|_| "STORAGE_REPAIR_REQUIRED: summary content invalid utf-8".to_string())?;
    if text.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(text))
    }
}

struct SourceAttachment {
    linked_message_id: String,
    record: AttachmentRecord,
    content_kind: String,
    plaintext: Arc<Vec<u8>>,
}

async fn read_attachments_tx(
    tx: &mut Transaction<'_, Sqlite>,
    provider: &dyn adham_event_log::ContentKeyProvider,
    scope: &EventScope,
    session_id: &SessionId,
) -> Result<Vec<SourceAttachment>, String> {
    let linked = SqliteEventStore::list_session_message_attachments_tx(tx, session_id)
        .await
        .map_err(map_source_error)?;
    let mut content_cache: HashMap<String, (String, Arc<Vec<u8>>)> = HashMap::new();
    let mut result = Vec::with_capacity(linked.len());
    for (linked_message_id, record) in linked {
        let key = record.content_id.to_string();
        let (content_kind, plaintext) = match content_cache.get(&key) {
            Some((kind, bytes)) => (kind.clone(), Arc::clone(bytes)),
            None => {
                let row =
                    sqlx::query("SELECT content_kind FROM content_records WHERE content_id = ?")
                        .bind(&key)
                        .fetch_optional(&mut **tx)
                        .await
                        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
                        .ok_or_else(|| {
                            "STORAGE_REPAIR_REQUIRED: attachment content is missing".to_string()
                        })?;
                let kind: String = row.get("content_kind");
                let bytes =
                    SqliteEventStore::get_content_tx(tx, provider, &record.content_id, scope)
                        .await
                        .map_err(map_source_error)?
                        .ok_or_else(|| {
                            "STORAGE_REPAIR_REQUIRED: attachment content is missing".to_string()
                        })?;
                let bytes = Arc::new(bytes);
                content_cache.insert(key, (kind.clone(), Arc::clone(&bytes)));
                (kind, bytes)
            }
        };
        result.push(SourceAttachment {
            linked_message_id,
            record,
            content_kind,
            plaintext,
        });
    }
    Ok(result)
}

struct CopyBudget {
    used: usize,
}

impl CopyBudget {
    fn new() -> Self {
        Self { used: 0 }
    }

    fn charge(&mut self, bytes: usize) -> Result<(), String> {
        self.used += bytes;
        if self.used > MAX_PLAINTEXT as usize {
            return Err("DUPLICATE_TOO_LARGE: source exceeds the plaintext limit".to_string());
        }
        Ok(())
    }
}

pub async fn duplicate_session(
    ctx: &ApiContext,
    env: CommandEnvelope<DuplicateSessionPayload>,
) -> Result<CommandResult<SessionMetadata>, String> {
    let (ws_id, proj_id, source_id, request_id) = parse_scope(&env.context, &env.request_id)?;
    let requested_title = normalize_title(env.payload.title.as_deref())?;
    let request_input = serde_json::to_string(&requested_title).map_err(|e| e.to_string())?;
    let request_fp = adham_event_log::request_fingerprint(DUPLICATE_COMMAND, 1, &request_input);
    let scope_fp = adham_event_log::scope_fingerprint(
        DUPLICATE_COMMAND,
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ws_id),
        Some(&proj_id),
        Some(&source_id),
    );
    let source_session = source_id.to_string();
    let source_scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ws_id),
        project_id: Some(proj_id),
        session_id: Some(source_id),
    };

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    lock_session_stream_tx(&mut tx, &source_session).await?;
    ensure_session_active_tx(&mut tx, &source_session).await?;

    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        if receipt_matches(&receipt, ctx, DUPLICATE_COMMAND, &scope_fp, &request_fp) {
            let data = parse_metadata(&receipt)?;
            let correlation_id = receipt.correlation_id.clone();
            tx.rollback()
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
            return Ok(CommandResult {
                protocol_version: 1,
                request_id: env.request_id,
                correlation_id,
                data,
            });
        }
        let _ = tx.rollback().await;
        return Err(conflict_msg());
    }

    ensure_source_scope_tx(&mut tx, &source_session, &ws_id, &proj_id).await?;
    ensure_no_live_operation_tx(&mut tx, &source_session).await?;

    let provider = CachedContentKeyProvider::new(Arc::clone(&ctx.content_key));
    let summary_id = read_summary_id_tx(&mut tx, &source_session).await?;
    precheck_source_tx(&mut tx, &source_session, summary_id.as_ref()).await?;

    let messages = ConversationProjection::get_session_messages(
        &ctx.pool,
        &provider,
        &ctx.installation_id,
        &source_id,
    )
    .await
    .map_err(map_source_error)?;
    if messages.len() > MAX_MESSAGES {
        return Err("DUPLICATE_TOO_LARGE: source exceeds the message limit".to_string());
    }
    let source_title = read_title_tx(&mut tx, &source_session).await?;
    let title = match requested_title {
        Some(title) => title,
        None => {
            let fallback = fallback_title(source_title.as_deref());
            validate_title(&fallback)
                .map_err(|_| "STORAGE_REPAIR_REQUIRED: source title is invalid".to_string())?;
            fallback
        }
    };
    let summary_text =
        read_summary_text_tx(&mut tx, &provider, &source_scope, summary_id.as_ref()).await?;
    let attachments = read_attachments_tx(&mut tx, &provider, &source_scope, &source_id).await?;

    let new_session_id = SessionId::new_v7();
    let new_scope = event_scope(ws_id, proj_id, new_session_id, ctx.installation_id);
    let correlation_id = CorrelationId::new_v7();
    let base_now = now_us();
    let mut expected_sequence = 0u64;
    let mut last_position;
    let mut source_to_new: HashMap<String, String> = HashMap::new();
    let mut budget = CopyBudget::new();

    let created = SessionCreatedV1 {
        session_id: new_session_id,
        project_id: proj_id,
        title: Some(title.clone()),
    };
    let first = append_event(
        &mut tx,
        &request_id,
        &correlation_id,
        &ctx.actor_id,
        &new_scope,
        expected_sequence,
        "SessionCreated",
        1,
        &created,
    )
    .await?;
    last_position = first.global_position;
    expected_sequence += 1;

    for (index, message) in messages.iter().enumerate() {
        let created_at = base_now + index as i64 + 1;
        match message.role.as_str() {
            "user" => {
                budget.charge(message.content.len())?;
                let new_message_id = MessageId::new_v7();
                let new_content_id = ContentId::new_v7();
                SqliteEventStore::put_content_tx(
                    &mut tx,
                    &provider,
                    &new_content_id,
                    "user_text",
                    "text/plain",
                    &new_scope,
                    message.content.as_bytes(),
                )
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
                let reference = match (
                    message.refers_to_message_id.as_deref(),
                    message.refers_to_relation.as_deref(),
                ) {
                    (None, None) => None,
                    (Some(old_id), Some(relation)) => {
                        let new_id = source_to_new.get(old_id).ok_or_else(|| {
                            "STORAGE_REPAIR_REQUIRED: source reference target is missing"
                                .to_string()
                        })?;
                        Some(MessageReferenceV1 {
                            refers_to_message_id: MessageId::from_string(new_id).map_err(|_| {
                                "STORAGE_REPAIR_REQUIRED: reference id corrupt".to_string()
                            })?,
                            relation: relation.to_string(),
                        })
                    }
                    _ => {
                        return Err(
                            "STORAGE_REPAIR_REQUIRED: source message reference is incomplete"
                                .to_string(),
                        );
                    }
                };
                let payload = MessageSubmittedV2 {
                    message_id: new_message_id,
                    content_id: new_content_id,
                    content_kind: "user_text".to_string(),
                    size_bytes: message.content.len() as u64,
                    reference,
                };
                payload
                    .validate()
                    .map_err(|_| "STORAGE_REPAIR_REQUIRED: source message invalid".to_string())?;
                let appended = append_event(
                    &mut tx,
                    &request_id,
                    &correlation_id,
                    &ctx.actor_id,
                    &new_scope,
                    expected_sequence,
                    "MessageSubmitted",
                    2,
                    &payload,
                )
                .await?;
                expected_sequence += 1;
                last_position = appended.global_position;
                let reference_ids = payload.reference.as_ref().map(|reference| {
                    (
                        reference.refers_to_message_id.to_string(),
                        reference.relation.clone(),
                    )
                });
                ConversationProjection::insert_message_tx(
                    &mut tx,
                    &new_message_id.to_string(),
                    &ws_id.to_string(),
                    &proj_id.to_string(),
                    &new_session_id.to_string(),
                    "user",
                    &new_content_id.to_string(),
                    &appended.event_id.to_string(),
                    appended.global_position,
                    created_at,
                    reference_ids
                        .as_ref()
                        .map(|(id, relation)| (id.as_str(), relation.as_str())),
                )
                .await
                .map_err(map_source_error)?;
                source_to_new.insert(message.message_id.clone(), new_message_id.to_string());
            }
            "assistant" => {
                budget.charge(message.content.len())?;
                message.op_id.ok_or_else(|| {
                    "STORAGE_REPAIR_REQUIRED: assistant operation id is missing".to_string()
                })?;
                let completion = message.completion.ok_or_else(|| {
                    "STORAGE_REPAIR_REQUIRED: assistant completion is missing".to_string()
                })?;
                let new_message_id = MessageId::new_v7();
                let new_content_id = ContentId::new_v7();
                SqliteEventStore::put_content_tx(
                    &mut tx,
                    &provider,
                    &new_content_id,
                    "assistant_text",
                    "text/plain",
                    &new_scope,
                    message.content.as_bytes(),
                )
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
                let payload = MessageCompletedV1 {
                    op_id: OperationId::new_v7(),
                    message_id: new_message_id,
                    content_id: new_content_id,
                    content_kind: "assistant_text".to_string(),
                    size_bytes: message.content.len() as u64,
                    completion,
                    usage: message.usage.clone(),
                };
                payload.validate().map_err(|_| {
                    "STORAGE_REPAIR_REQUIRED: source completion invalid".to_string()
                })?;
                let appended = append_event(
                    &mut tx,
                    &request_id,
                    &correlation_id,
                    &ctx.actor_id,
                    &new_scope,
                    expected_sequence,
                    EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED,
                    1,
                    &payload,
                )
                .await?;
                expected_sequence += 1;
                last_position = appended.global_position;
                let completion_json =
                    serde_json::to_string(&completion).map_err(|e| e.to_string())?;
                let usage_json = message
                    .usage
                    .as_ref()
                    .map(serde_json::to_string)
                    .transpose()
                    .map_err(|e| e.to_string())?;
                ConversationProjection::insert_assistant_completion_tx(
                    &mut tx,
                    &new_message_id.to_string(),
                    &ws_id.to_string(),
                    &proj_id.to_string(),
                    &new_session_id.to_string(),
                    &payload.op_id.to_string(),
                    &new_content_id.to_string(),
                    &completion_json,
                    usage_json.as_deref(),
                    &appended.event_id.to_string(),
                    appended.global_position,
                    created_at,
                )
                .await
                .map_err(map_source_error)?;
                source_to_new.insert(message.message_id.clone(), new_message_id.to_string());
            }
            other => {
                return Err(format!(
                    "STORAGE_REPAIR_REQUIRED: unsupported source message role {other}"
                ));
            }
        }
    }

    let mut copied_attachments: HashMap<String, String> = HashMap::new();
    let mut attachment_links: HashMap<String, Vec<String>> = HashMap::new();
    let mut counted_attachment_content: HashSet<String> = HashSet::new();
    for (index, attachment) in attachments.iter().enumerate() {
        let new_message_id = source_to_new
            .get(&attachment.linked_message_id)
            .ok_or_else(|| "STORAGE_REPAIR_REQUIRED: attachment message is missing".to_string())?;
        let source_key = attachment.record.attachment_id.to_string();
        let new_attachment_id = match copied_attachments.get(&source_key) {
            Some(id) => id.clone(),
            None => {
                if counted_attachment_content.insert(attachment.record.content_id.to_string()) {
                    budget.charge(attachment.plaintext.len())?;
                }
                let new_attachment_id = AttachmentId::new_v7();
                let new_content_id = ContentId::new_v7();
                SqliteEventStore::put_content_tx(
                    &mut tx,
                    &provider,
                    &new_content_id,
                    &attachment.content_kind,
                    &attachment.record.media_type,
                    &new_scope,
                    attachment.plaintext.as_slice(),
                )
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
                let record = AttachmentRecord {
                    attachment_id: new_attachment_id,
                    content_id: new_content_id,
                    file_name: attachment.record.file_name.clone(),
                    media_type: attachment.record.media_type.clone(),
                    byte_size: attachment.record.byte_size,
                    content_hash: attachment.record.content_hash.clone(),
                    hash_algorithm: attachment.record.hash_algorithm.clone(),
                    extracted_chars: attachment.record.extracted_chars,
                    truncated: attachment.record.truncated,
                    retention: attachment.record.retention.clone(),
                    workspace_id: ws_id,
                    project_id: proj_id,
                    session_id: new_session_id,
                    created_at_us: base_now + index as i64 + 1,
                };
                SqliteEventStore::insert_attachment_tx(&mut tx, &record)
                    .await
                    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
                copied_attachments.insert(source_key, new_attachment_id.to_string());
                new_attachment_id.to_string()
            }
        };
        attachment_links
            .entry(new_message_id.clone())
            .or_default()
            .push(new_attachment_id);
    }
    for (new_message_id, new_attachment_ids) in attachment_links {
        let ids: Vec<AttachmentId> = new_attachment_ids
            .iter()
            .map(|id| AttachmentId::from_string(id).expect("minted attachment id"))
            .collect();
        SqliteEventStore::link_attachments_to_message_tx(
            &mut tx,
            &MessageId::from_string(&new_message_id).expect("minted message id"),
            &ids,
        )
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    }

    if let Some(text) = summary_text {
        budget.charge(text.len())?;
        let content_id = ContentId::new_v7();
        SqliteEventStore::put_content_tx(
            &mut tx,
            &provider,
            &content_id,
            "session_summary",
            "text/plain; charset=utf-8",
            &new_scope,
            text.as_bytes(),
        )
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        let appended = append_event(
            &mut tx,
            &request_id,
            &correlation_id,
            &ctx.actor_id,
            &new_scope,
            expected_sequence,
            EVENT_TYPE_SESSION_SUMMARY_UPDATED,
            1,
            &SessionSummaryUpdatedV1 {
                content_id: Some(content_id),
            },
        )
        .await?;
        last_position = appended.global_position;
    }

    let bookmarks: Vec<String> = sqlx::query_scalar(
        "SELECT message_id FROM message_bookmarks WHERE session_id = ? ORDER BY message_id",
    )
    .bind(&source_session)
    .fetch_all(&mut *tx)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    for (index, old_id) in bookmarks.iter().enumerate() {
        let Some(new_id) = source_to_new.get(old_id) else {
            continue;
        };
        sqlx::query(
            "INSERT INTO message_bookmarks (session_id, message_id, created_at_us) VALUES (?, ?, ?)",
        )
        .bind(new_session_id.to_string())
        .bind(new_id)
        .bind(base_now + index as i64 + 1)
        .execute(&mut *tx)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    }

    let data =
        read_session_metadata_tx(&mut tx, &provider, &ctx.installation_id, &new_session_id).await?;
    let response_json = serde_json::to_vec(&data).map_err(|e| e.to_string())?;
    SqliteEventStore::record_receipt_range_tx(
        &mut tx,
        &request_id,
        DUPLICATE_COMMAND,
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "success",
        &response_json,
        first.global_position,
        last_position,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: failed to record receipt: {e}"))?;

    if let Err(e) = tx.commit().await {
        match ctx.store.check_receipt(&request_id).await {
            Ok(Some(receipt))
                if receipt_matches(&receipt, ctx, DUPLICATE_COMMAND, &scope_fp, &request_fp) =>
            {
                return Ok(CommandResult {
                    protocol_version: 1,
                    request_id: env.request_id,
                    correlation_id: receipt.correlation_id.clone(),
                    data: parse_metadata(&receipt)?,
                });
            }
            Ok(Some(_)) => return Err(conflict_msg()),
            _ => return Err(format!("STORAGE_UNAVAILABLE: commit failed: {e}")),
        }
    }

    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data,
    })
}
