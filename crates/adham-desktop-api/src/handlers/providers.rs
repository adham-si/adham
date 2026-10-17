//! Provider commands (Delivery A: Ollama Local only — no keys, no cloud).
//!
//! Ownership split: the application layer owns a transport-neutral
//! [`EventSink`]; `src-tauri` adapts `Channel<StreamEventDto>` into it. The
//! op handle (`pending_operations`, `kind='provider-completion'`) is recorded
//! BEFORE any socket is opened. History is assembled server-side from the
//! projection + protected content store — renderer-supplied history is
//! ignored and never authoritative. The terminal event is idempotent per op
//! and persists even when the renderer is gone.

use super::ApiContext;
use crate::dtos::*;
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_provider::adapters::ollama_http::OllamaHttpAdapter;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::model::{ModelDescriptor, ModelId, ModelSelectionSnapshot};
use adham_provider::domain::request::{ChatMessage, MessageRole, ProviderRequestV1};
use adham_provider::domain::stream::{NormalizedStreamEvent, StreamCompletionOutcome, StreamUsage};
use adham_provider::registry::{LocalAccount, PinnedModel};
use adham_provider::transport::HttpTransport;
use serde::Serialize;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Mutex;
use time::OffsetDateTime;
use tokio_util::sync::CancellationToken;
use tracing::info;
use ts_rs::TS;

/// Transport-neutral event sink. A failed/dropped renderer must never block
/// persistence: send failures are logged, the terminal is persisted anyway.
pub trait EventSink: Send + Sync {
    fn send(&self, event: StreamEventDto) -> Result<(), String>;
}

/// A sink that never receives (tests: renderer disconnect simulation).
pub struct NullSink;

impl EventSink for NullSink {
    fn send(&self, _event: StreamEventDto) -> Result<(), String> {
        Ok(())
    }
}

/// Per-op cancellation handles: one token per op; `stop_completion` (or the
/// op deadline) ends it.
#[derive(Default)]
pub struct CompletionRuns {
    runs: Mutex<HashMap<String, CancellationToken>>,
}

impl CompletionRuns {
    pub fn insert(&self, op: &str, token: CancellationToken) {
        self.runs
            .lock()
            .expect("runs mutex")
            .insert(op.to_string(), token);
    }

    pub fn cancel_of(&self, op: &str) -> bool {
        match self.runs.lock().expect("runs mutex").get(op) {
            Some(token) => {
                token.cancel();
                true
            }
            None => false,
        }
    }

    pub fn remove(&self, op: &str) {
        self.runs.lock().expect("runs mutex").remove(op);
    }
}

/// Bounded server-side history: cap N messages and N bytes, trimmed from the
/// oldest end. The newest user message (the dispatch input) is always kept.
const MAX_HISTORY_MESSAGES: usize = 20;
const MAX_HISTORY_BYTES: usize = 16_384;
/// Assistant accumulation bound: provider output beyond this is a protocol
/// failure (bounded content, never an unbounded write).
const MAX_ASSISTANT_BYTES: usize = 262_144;

fn cap_str(status: adham_provider::domain::model::CapabilityStatus) -> &'static str {
    use adham_provider::domain::model::CapabilityStatus::*;
    match status {
        Supported => "supported",
        Unsupported => "unsupported",
        Unknown => "unknown",
    }
}

async fn local_account(ctx: &ApiContext, account_id: &str) -> Result<LocalAccount, String> {
    let accounts = ctx
        .registry
        .list_accounts()
        .await
        .map_err(|e| e.to_string())?;
    accounts
        .into_iter()
        .find(|a| a.account_id.0 == account_id)
        .ok_or_else(|| format!("VALIDATION_FAILED: unknown provider account '{account_id}'"))
}

fn ollama_adapter(account: &LocalAccount) -> Result<OllamaHttpAdapter, String> {
    OllamaHttpAdapter::new(HttpTransport::default(), &account.base_url).map_err(|e| e.to_string())
}

fn ok_result<T: Serialize + TS>(request_id: String, data: T) -> CommandResult<T> {
    CommandResult {
        protocol_version: 1,
        request_id,
        correlation_id: CorrelationId::new_v7().to_string(),
        data,
    }
}

// ===== discovery / connection / account =====

/// Metadata-only health probe (GET /api/tags — no prompt, no billable call).
pub async fn handle_test_provider_connection(
    ctx: &ApiContext,
    env: CommandEnvelope<TestProviderConnectionPayload>,
) -> Result<CommandResult<ProviderHealthResponse>, String> {
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;
    let account = local_account(ctx, &env.payload.account_id).await?;
    let adapter = ollama_adapter(&account)?;
    let response = match adapter.connection_test().await {
        Ok(count) => ok_result(
            env.request_id,
            ProviderHealthResponse {
                reachable: true,
                model_tag_count: count,
            },
        ),
        Err(_) => ok_result(
            env.request_id,
            ProviderHealthResponse {
                reachable: false,
                model_tag_count: 0,
            },
        ),
    };
    Ok(response)
}

/// Full discovery: `/api/tags` + `/api/show` per model, persisted as
/// digest-pinned rows (registry revision bumps wipe them on endpoint change).
pub async fn handle_discover_ollama_models(
    ctx: &ApiContext,
    env: CommandEnvelope<DiscoverOllamaModelsPayload>,
) -> Result<CommandResult<ProviderModelsList>, String> {
    let account = local_account(ctx, &env.payload.account_id).await?;
    let adapter = ollama_adapter(&account)?;
    let pinned = adapter.discover().await.map_err(|e| e.to_string())?;
    let tuples: Vec<(ModelId, String, ModelDescriptor)> = pinned
        .iter()
        .map(|m| (m.model_id.clone(), m.digest.clone(), m.descriptor.clone()))
        .collect();
    ctx.registry
        .replace_models(&account.account_id, &tuples)
        .await
        .map_err(|e| e.to_string())?;
    let models = pinned
        .iter()
        .map(|m| provider_model_dto(&m.descriptor, &m.digest))
        .collect();
    Ok(ok_result(env.request_id, ProviderModelsList { models }))
}

fn provider_model_dto(descriptor: &ModelDescriptor, digest: &str) -> ProviderModelDto {
    ProviderModelDto {
        model_id: descriptor.model_id.0.clone(),
        digest: digest.to_string(),
        human_label: descriptor.human_label.clone(),
        privacy_class: serde_plain_repr(&descriptor.privacy_class).to_string(),
        capabilities: ProviderCapabilitiesDto {
            streaming: cap_str(descriptor.capabilities.streaming).to_string(),
            structured_output: cap_str(descriptor.capabilities.structured_output).to_string(),
            tool_proposals: cap_str(descriptor.capabilities.tool_proposals).to_string(),
            thinking: cap_str(descriptor.capabilities.thinking).to_string(),
        },
    }
}

fn serde_plain_repr<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Alias + endpoint update; `account_id: None` mints a local Ollama account.
pub async fn handle_update_provider_account(
    ctx: &ApiContext,
    env: CommandEnvelope<UpdateProviderAccountPayload>,
) -> Result<CommandResult<ProviderAccountDto>, String> {
    let account = match env.payload.account_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let existing = local_account(ctx, id).await?;
            LocalAccount {
                alias: env.payload.alias.clone().unwrap_or(existing.alias),
                base_url: env
                    .payload
                    .endpoint_url
                    .clone()
                    .unwrap_or(existing.base_url),
                ..existing
            }
        }
        None => {
            let alias = env
                .payload
                .alias
                .clone()
                .ok_or("VALIDATION_FAILED: alias required when creating a provider account")?;
            let url = env.payload.endpoint_url.clone().ok_or(
                "VALIDATION_FAILED: endpointUrl required when creating a provider account",
            )?;
            LocalAccount {
                account_id: ProviderAccountId::new(uuid::Uuid::now_v7().to_string()),
                kind: adham_provider::domain::account::ProviderKind::OllamaLocal,
                alias,
                privacy_class: PrivacyClass::LocalOnly,
                endpoint_id: EndpointId::new("local-ollama"),
                base_url: url,
                approved_destination: false,
            }
        }
    };
    ctx.registry
        .upsert_account(&account)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ok_result(
        env.request_id,
        ProviderAccountDto {
            account_id: account.account_id.0.clone(),
            alias: account.alias.clone(),
            endpoint_url: account.base_url.clone(),
            privacy_class: serde_plain_repr(&account.privacy_class).to_string(),
        },
    ))
}

// ===== completion =====

struct StreamIds {
    ws_id: WorkspaceId,
    proj_id: ProjectId,
    sess_id: SessionId,
}

fn expect_full_scope(context: &CommandContext) -> Result<StreamIds, String> {
    let ws_id = WorkspaceId::from_string(
        context
            .workspace_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: workspaceId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let proj_id = ProjectId::from_string(
        context
            .project_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: projectId context required")?,
    )
    .map_err(|e| e.to_string())?;
    let sess_id = SessionId::from_string(
        context
            .session_id
            .as_deref()
            .ok_or("VALIDATION_FAILED: sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;
    Ok(StreamIds {
        ws_id,
        proj_id,
        sess_id,
    })
}

/// Ownership check: the session's stream row must carry exactly this
/// workspace/project pair (renderer-supplied scope can never cross).
async fn validate_session_scope(ctx: &ApiContext, ids: &StreamIds) -> Result<(), String> {
    let sess_stream = format!("session:{}", ids.sess_id);
    let row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(&sess_stream)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| e.to_string())?;
    match row {
        Some(row) => {
            let row_ws: Option<String> = row.get("workspace_id");
            let row_proj: Option<String> = row.get("project_id");
            if row_ws.as_deref() != Some(&ids.ws_id.to_string())
                || row_proj.as_deref() != Some(&ids.proj_id.to_string())
            {
                Err(
                    "CONTEXT_MISMATCH: session does not belong to specified project or workspace"
                        .to_string(),
                )
            } else {
                Ok(())
            }
        }
        None => Err("SESSION_NOT_FOUND: session stream does not exist".to_string()),
    }
}

pub async fn handle_stop_completion(
    ctx: &ApiContext,
    env: CommandEnvelope<StopCompletionPayload>,
) -> Result<CommandResult<StopCompletionResponse>, String> {
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;

    let op_id = OperationId::from_string(&env.payload.op_id).map_err(|_| {
        format!(
            "VALIDATION_FAILED: unknown completion operation '{}'",
            env.payload.op_id
        )
    })?;
    let op_str = op_id.to_string();

    let pending: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id, session_id, status FROM pending_operations \
             WHERE operation_id = ? AND kind = 'provider-completion'",
    )
    .bind(&op_str)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| e.to_string())?;
    let row = pending
        .ok_or_else(|| format!("CONTEXT_MISMATCH: unknown completion operation '{op_str}'"))?;
    let matches = row.get::<String, _>("workspace_id") == ids.ws_id.to_string()
        && row.get::<String, _>("project_id") == ids.proj_id.to_string()
        && row.get::<Option<String>, _>("session_id").as_deref() == Some(&ids.sess_id.to_string());
    if !matches {
        return Err(format!(
            "CONTEXT_MISMATCH: completion operation '{op_str}' does not belong to this session"
        ));
    }

    let status = if ctx.completion_runs.cancel_of(&op_str) {
        "cancelled"
    } else {
        "already-resolved"
    };
    Ok(ok_result(
        env.request_id,
        StopCompletionResponse {
            op_id: op_str,
            status: status.to_string(),
        },
    ))
}

/// Complete exactly once, streaming deltas over the sink. Returns only after
/// the terminal outcome is persisted. The user message is atomically
/// submitted first; the op handle is durable BEFORE dispatch.
pub async fn handle_complete_once_streaming<S>(
    ctx: &ApiContext,
    env: CommandEnvelope<CompleteOncePayload>,
    sink: &S,
) -> Result<CommandResult<CompletionStartDto>, String>
where
    S: EventSink,
{
    let trimmed = env.payload.text.trim().to_string();
    if trimmed.is_empty() {
        return Err("VALIDATION_FAILED: text cannot be empty".to_string());
    }
    if trimmed.len() > 65536 {
        return Err("VALIDATION_FAILED: text exceeds 65536 bytes".to_string());
    }
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;

    // Model evidence before ANY socket: unknown ids dispatch nothing.
    let account = local_account(ctx, &env.payload.account_id).await?;
    if !matches!(
        account.kind,
        adham_provider::domain::account::ProviderKind::OllamaLocal
    ) {
        return Err(format!(
            "VALIDATION_FAILED: account '{}' is not a local Ollama account",
            env.payload.account_id
        ));
    }
    let pinned = resolve_pinned(ctx, &account.account_id, &env.payload.model_id).await?;

    let adapter = ollama_adapter(&account)?;
    let op_id = OperationId::new_v7();
    let message_id = MessageId::new_v7();
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ids.ws_id),
        project_id: Some(ids.proj_id),
        session_id: Some(ids.sess_id),
    };
    let sess_stream = format!("session:{}", ids.sess_id);

    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    // idempotent IPC retry: same request → same op handle, never a second dispatch
    if let Some(receipt) = SqliteEventStore::check_receipt_tx(&mut tx, &request_id)
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?
    {
        let persisted: CompletionStartDto = serde_json::from_slice(&receipt.response_json)
            .map_err(|_| "STORAGE_REPAIR_REQUIRED: receipt response unparseable".to_string())?;
        tx.rollback()
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        return Ok(CommandResult {
            protocol_version: 1,
            request_id: env.request_id,
            correlation_id: receipt.correlation_id,
            data: persisted,
        });
    }

    let seq_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&sess_stream)
            .fetch_optional(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    let current_seq = seq_row
        .map(|r| r.get::<i64, _>("current_sequence") as u64)
        .unwrap_or(0);

    let content_id = ContentId::new_v7();
    SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        "user_text",
        "text/plain",
        &scope,
        trimmed.as_bytes(),
    )
    .await
    .map_err(|e| e.to_string())?;

    let correlation_id = CorrelationId::new_v7();
    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;
    let append_req = AppendEventRequest {
        stream_id: sess_stream,
        stream_kind: "session".to_string(),
        expected_sequence: current_seq,
        event_type: "MessageSubmitted".to_string(),
        event_version: 1,
        scope: scope.clone(),
        actor: EventActor {
            actor_id: ctx.actor_id,
            kind: ActorKind::LocalHuman,
        },
        request_id,
        correlation_id,
        causation_id: None,
        payload_json: serde_json::to_vec(&MessageSubmittedV1 {
            message_id,
            content_id,
            content_kind: "user_text".to_string(),
            size_bytes: trimmed.len() as u64,
        })
        .map_err(|e| e.to_string())?,
        metadata_json: b"{}".to_vec(),
    };
    let append_res = SqliteEventStore::append_event_tx(&mut tx, append_req)
        .await
        .map_err(|e| e.to_string())?;
    adham_projections::ConversationProjection::insert_message_tx(
        &mut tx,
        &message_id.to_string(),
        &ids.ws_id.to_string(),
        &ids.proj_id.to_string(),
        &ids.sess_id.to_string(),
        "user",
        &content_id.to_string(),
        &append_res.event_id.to_string(),
        append_res.global_position,
        now_us,
    )
    .await
    .map_err(|e| e.to_string())?;

    // Durable op handle BEFORE any socket (fail-closed record-then-POST).
    SqliteEventStore::record_pending_operation_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &op_id.to_string(),
        "provider-completion",
        &scope,
        None,
        &request_id.to_string(),
        "",
        None,
    )
    .await
    .map_err(|e| e.to_string())?;

    let start = CompletionStartDto {
        op_id: op_id.to_string(),
        message_id: message_id.to_string(),
    };
    let persisted = serde_json::to_vec(&start).unwrap_or_default();
    let request_fp = adham_event_log::request_fingerprint("complete_once_streaming", 1, &trimmed);
    let scope_fp = adham_event_log::scope_fingerprint(
        "complete_once_streaming",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ids.ws_id),
        Some(&ids.proj_id),
        Some(&ids.sess_id),
    );
    SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "complete_once_streaming",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "completed",
        &persisted,
        append_res.global_position,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let token = CancellationToken::new();
    ctx.completion_runs.insert(&start.op_id, token.clone());

    info!("provider completion dispatching op {}", start.op_id);
    let outcome = run_stream(
        ctx,
        &adapter,
        &pinned,
        &account,
        &start.op_id,
        &request_id.to_string(),
        &ids,
        &token,
        sink,
    )
    .await;
    ctx.completion_runs.remove(&start.op_id);
    info!(
        "provider completion op {} outcome: {}",
        start.op_id, outcome
    );

    Ok(CommandResult {
        protocol_version: 1,
        request_id: env.request_id,
        correlation_id: correlation_id.to_string(),
        data: start,
    })
}

async fn resolve_pinned(
    ctx: &ApiContext,
    account_id: &ProviderAccountId,
    model_id: &str,
) -> Result<PinnedModel, String> {
    let models = ctx
        .registry
        .list_models(account_id)
        .await
        .map_err(|e| e.to_string())?;
    models
        .into_iter()
        .find(|m| m.model_id.0 == model_id)
        .ok_or_else(|| format!("VALIDATION_FAILED: unknown model '{model_id}' — discover first"))
}

/// Bounded server-side history: newest-last message list, capped; interrupted
/// and failed rows never enter next-dispatch context.
fn bounded_history(
    rows: impl Iterator<Item = adham_projections::ConversationMessageView>,
) -> Vec<ChatMessage> {
    let mut kept: Vec<(usize, String, String)> = Vec::new(); // (index, role, content)
    for row in rows.enumerate() {
        if matches!(
            row.1.completion,
            Some(MessageCompletionV1::Interrupted) | Some(MessageCompletionV1::Failed)
        ) {
            continue;
        }
        kept.push((row.0, row.1.role, row.1.content));
    }
    // trim from the oldest end; the newest messages win
    while kept.len() > MAX_HISTORY_MESSAGES {
        kept.remove(0);
    }
    let mut bytes: usize = kept.iter().map(|(_, _, c)| c.len()).sum();
    while bytes > MAX_HISTORY_BYTES && kept.len() > 1 {
        bytes -= kept.remove(0).2.len();
    }
    kept.into_iter()
        .map(|(_, role, content)| ChatMessage {
            role: if role == "assistant" {
                MessageRole::Assistant
            } else {
                MessageRole::User
            },
            content,
        })
        .collect()
}

fn terminal_status(outcome: &StreamCompletionOutcome) -> (&'static str, bool) {
    match outcome {
        StreamCompletionOutcome::Stop => ("completed", false),
        StreamCompletionOutcome::LengthExceeded => ("completed", true),
        StreamCompletionOutcome::Interrupted => ("interrupted", false),
        StreamCompletionOutcome::ContentFilter => ("failed", false),
    }
}

fn map_completion(outcome: &StreamCompletionOutcome) -> MessageCompletionV1 {
    match outcome {
        StreamCompletionOutcome::Stop => MessageCompletionV1::Completed { truncated: false },
        StreamCompletionOutcome::LengthExceeded => {
            MessageCompletionV1::Completed { truncated: true }
        }
        StreamCompletionOutcome::Interrupted => MessageCompletionV1::Interrupted,
        StreamCompletionOutcome::ContentFilter => MessageCompletionV1::Failed,
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_stream<S>(
    ctx: &ApiContext,
    adapter: &OllamaHttpAdapter,
    pinned: &PinnedModel,
    account: &LocalAccount,
    op_id: &str,
    request_id: &str,
    ids: &StreamIds,
    token: &CancellationToken,
    sink: &S,
) -> &'static str
where
    S: EventSink,
{
    // bounded history from protected content (server-side, never the renderer's)
    let history_rows = adham_projections::ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &ids.sess_id,
    )
    .await
    .unwrap_or_default();
    let mut messages = bounded_history(history_rows.into_iter());
    // non-empty content guard: model gets a user prompt (the submitted row is in history)
    if messages.last().map(|m| m.role) != Some(MessageRole::User) {
        messages.push(ChatMessage {
            role: MessageRole::User,
            content: "(empty prompt)".to_string(),
        });
    }

    let request = ProviderRequestV1 {
        operation_id: op_id.to_string(),
        model_selection: ModelSelectionSnapshot {
            account_id: account.account_id.clone(),
            endpoint_id: account.endpoint_id.clone(),
            model_id: pinned.model_id.clone(),
            privacy_class: pinned.descriptor.privacy_class,
        },
        messages,
        max_output_tokens: None,
        temperature: None,
    };

    let stream = match adapter.stream_chat(pinned, &request).await {
        Ok(s) => s,
        Err(e) => {
            tracing::debug!("completion op {op_id}: dispatch failed pre-wire: {e}");
            // after the op handle exists: a pre-wire dispatch failure is a
            // failed terminal, never a vanished generation
            let mut seq = 0u64;
            sink.send(stream_event(
                op_id,
                &mut seq,
                StreamEventPayloadDto::Completed {
                    completion: "failed".to_string(),
                    truncated: false,
                    usage: None,
                },
            ))
            .ok_or_log(op_id);
            return persist_terminal(
                ctx,
                op_id,
                request_id,
                ids,
                "",
                &StreamCompletionOutcome::ContentFilter,
                None,
            )
            .await;
        }
    };

    // StreamStarted first, per-op sequence numbers increase in order.
    let mut sequence: u64 = 0;
    sink.send(stream_event(
        op_id,
        &mut sequence,
        StreamEventPayloadDto::Started,
    ))
    .ok_or_log(op_id);

    let mut acc = String::new();
    let mut usage: Option<MessageUsageV1> = None;
    let mut stream = stream;
    let mut terminal_outcome: Option<StreamCompletionOutcome> = None;
    let mut failed_reason: Option<String> = None;

    loop {
        if token.is_cancelled() {
            terminal_outcome = Some(StreamCompletionOutcome::Interrupted);
            break;
        }
        tokio::select! {
            biased;
            _ = token.cancelled() => {
                terminal_outcome = Some(StreamCompletionOutcome::Interrupted);
                break;
            }
            event = stream.next_event() => match event {
                None => break,
                // StreamStarted is protocol parity; the sink-led Started
                // event already carries the contract.
                Some(Ok(NormalizedStreamEvent::StreamStarted)) => {}
                Some(Ok(NormalizedStreamEvent::TextDelta(text))) => {
                    acc.push_str(&text);
                    if acc.len() > MAX_ASSISTANT_BYTES {
                        failed_reason = Some("assistant content exceeded bounded size".to_string());
                        break;
                    }
                    sink.send(stream_event(op_id, &mut sequence, StreamEventPayloadDto::Delta { text }))
                        .ok_or_log(op_id);
                }
                Some(Ok(NormalizedStreamEvent::Progress(StreamUsage { prompt_tokens, completion_tokens, total_tokens }))) => {
                    usage = Some(MessageUsageV1 {
                        prompt_tokens: Some(prompt_tokens as u64),
                        completion_tokens: Some(completion_tokens as u64),
                        total_tokens: Some(total_tokens as u64),
                    });
                }
                Some(Ok(NormalizedStreamEvent::ThinkingDelta(_))) => {
                    // provider-internal reasoning: not part of the persisted
                    // assistant answer in Delivery A
                }
                Some(Ok(NormalizedStreamEvent::StreamCompleted(outcome))) => {
                    terminal_outcome = Some(outcome);
                    break;
                }
                Some(Err(e)) => {
                    failed_reason = Some(e.to_string());
                    break;
                }
            },
        }
    }

    let outcome = terminal_outcome.unwrap_or(StreamCompletionOutcome::ContentFilter);
    // sink failure path: log; persistence below is unconditional
    if failed_reason.is_some()
        || matches!(
            outcome,
            StreamCompletionOutcome::ContentFilter | StreamCompletionOutcome::Interrupted
        )
    {
        sink.send(stream_event(
            op_id,
            &mut sequence,
            StreamEventPayloadDto::Completed {
                completion: if failed_reason.is_some() {
                    "failed"
                } else {
                    "interrupted"
                }
                .to_string(),
                truncated: false,
                usage: usage.clone(),
            },
        ))
        .ok_or_log(op_id);
    }
    // completed terminals go straight to the same DTO shape
    if matches!(
        outcome,
        StreamCompletionOutcome::Stop | StreamCompletionOutcome::LengthExceeded
    ) {
        let (completion, truncated) = terminal_status(&outcome);
        sink.send(stream_event(
            op_id,
            &mut sequence,
            StreamEventPayloadDto::Completed {
                completion: completion.to_string(),
                truncated,
                usage: usage.clone(),
            },
        ))
        .ok_or_log(op_id);
    }

    persist_terminal(ctx, op_id, request_id, ids, &acc, &outcome, usage.as_ref()).await
}

fn stream_event(op_id: &str, sequence: &mut u64, event: StreamEventPayloadDto) -> StreamEventDto {
    *sequence += 1;
    StreamEventDto {
        op_id: op_id.to_string(),
        sequence: *sequence,
        event,
    }
}

trait SinkLog {
    fn ok_or_log(self, op_id: &str);
}

impl SinkLog for Result<(), String> {
    fn ok_or_log(self, op_id: &str) {
        if let Err(e) = self {
            tracing::debug!(
                "completion op {op_id}: renderer went away mid-stream ({}), terminal persists regardless",
                e
            );
        }
    }
}

async fn persist_terminal(
    ctx: &ApiContext,
    op_id: &str,
    request_id: &str,
    ids: &StreamIds,
    text: &str,
    outcome: &StreamCompletionOutcome,
    usage: Option<&MessageUsageV1>,
) -> &'static str {
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ids.ws_id),
        project_id: Some(ids.proj_id),
        session_id: Some(ids.sess_id),
    };
    let sess_stream = format!("session:{}", ids.sess_id);
    let message_id = MessageId::new_v7();
    let content_id = ContentId::new_v7();

    let mut tx = match ctx.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!("completion op {op_id}: terminal persistence unavailable: {e}");
            return "failed";
        }
    };

    if let Err(e) = SqliteEventStore::put_content_tx(
        &mut tx,
        ctx.content_key.as_ref(),
        &content_id,
        "assistant_text",
        "text/plain",
        &scope,
        text.as_bytes(),
    )
    .await
    {
        tracing::error!("completion op {op_id}: terminal content store failed: {e}");
        let _ = tx.rollback().await;
        return "failed";
    }

    // current stream sequence + event append
    let seq_row: Option<sqlx::sqlite::SqliteRow> =
        sqlx::query("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&sess_stream)
            .fetch_optional(&mut *tx)
            .await
            .ok()
            .flatten();
    let current_seq = seq_row
        .map(|r| r.get::<i64, _>("current_sequence") as u64)
        .unwrap_or(0);

    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;
    let completion = map_completion(outcome);
    let event_payload = MessageCompletedV1 {
        op_id: OperationId::from_string(op_id).unwrap_or_else(|_| OperationId::new_v7()),
        message_id,
        content_id,
        content_kind: "assistant_text".to_string(),
        size_bytes: text.len() as u64,
        completion,
        usage: usage.cloned(),
    };
    let append_req = AppendEventRequest {
        stream_id: sess_stream,
        stream_kind: "session".to_string(),
        expected_sequence: current_seq,
        event_type: EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED.to_string(),
        event_version: 1,
        scope: scope.clone(),
        actor: EventActor {
            actor_id: ctx.actor_id,
            kind: ActorKind::System,
        },
        request_id: RequestId::from_string(op_id).unwrap_or_else(|_| RequestId::new_v7()),
        correlation_id: CorrelationId::from_string(op_id)
            .unwrap_or_else(|_| CorrelationId::new_v7()),
        causation_id: None,
        payload_json: serde_json::to_vec(&event_payload).unwrap_or_default(),
        metadata_json: b"{}".to_vec(),
    };
    let append_res = match SqliteEventStore::append_event_tx(&mut tx, append_req).await {
        Ok(r) => r,
        Err(e) => {
            tracing::error!("completion op {op_id}: terminal append failed: {e}");
            let _ = tx.rollback().await;
            return "failed";
        }
    };
    if let Err(e) = adham_projections::ConversationProjection::insert_assistant_completion_tx(
        &mut tx,
        &message_id.to_string(),
        &ids.ws_id.to_string(),
        &ids.proj_id.to_string(),
        &ids.sess_id.to_string(),
        op_id,
        &content_id.to_string(),
        &serde_json::to_string(&completion).unwrap_or_default(),
        usage
            .map(|u| serde_json::to_string(u).unwrap_or_default())
            .as_deref(),
        &append_res.event_id.to_string(),
        append_res.global_position,
        now_us,
    )
    .await
    {
        tracing::error!("completion op {op_id}: terminal projection failed: {e}");
        let _ = tx.rollback().await;
        return "failed";
    }
    if let Err(e) = SqliteEventStore::resolve_pending_operation_tx(&mut tx, op_id, request_id).await
    {
        tracing::error!("completion op {op_id}: pending op resolution failed: {e}");
        let _ = tx.rollback().await;
        return "failed";
    }
    if let Err(e) = tx.commit().await {
        tracing::error!("completion op {op_id}: terminal commit failed: {e}");
        return "failed";
    }

    // op_id doubles as the pending op's message_request_id? No — resolve by op
    // id only; the request-id guard applies to client-minted flows.
    "succeeded"
}
