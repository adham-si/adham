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
use crate::pending_dtos::{MarkCompletionInterruptedPayload, MarkCompletionInterruptedResponse};
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore};
use adham_provider::adapters::ollama_http::OllamaHttpAdapter;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::model::{ModelDescriptor, ModelId, ModelSelectionSnapshot};
use adham_provider::domain::request::{ChatMessage, MessageRole, ProviderRequestV1, ThinkValue};
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

    /// Liveness check without cancelling: recovery must never treat a running
    /// op as a crashed one.
    pub fn is_live(&self, op: &str) -> bool {
        self.runs.lock().expect("runs mutex").contains_key(op)
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

/// Modes are declarations with real semantics. "execute" has no runtime to
/// execute under, so it is refused rather than silently downgraded; unknown
/// modes never reach a socket. Shared by send and retry.
fn validate_mode(mode: Option<&str>) -> Result<(), String> {
    if let Some(mode) = mode {
        if mode == "execute" {
            return Err(
                "EXECUTE_UNAVAILABLE: execution requires the policy and tool runtime, which is not built"
                    .to_string(),
            );
        }
        if mode_instruction(mode).is_none() {
            return Err(format!("VALIDATION_FAILED: unknown mode '{mode}'"));
        }
    }
    Ok(())
}

/// Model evidence before ANY socket: unknown ids dispatch nothing, and only a
/// local Ollama account may be used (no keys, no cloud).
async fn resolve_dispatch_target(
    ctx: &ApiContext,
    account_id: &str,
    model_id: &str,
) -> Result<(LocalAccount, PinnedModel), String> {
    let account = local_account(ctx, account_id).await?;
    if !matches!(
        account.kind,
        adham_provider::domain::account::ProviderKind::OllamaLocal
    ) {
        return Err(format!(
            "VALIDATION_FAILED: account '{account_id}' is not a local Ollama account"
        ));
    }
    let pinned = resolve_pinned(ctx, &account.account_id, model_id).await?;
    Ok((account, pinned))
}

/// `think` values are documented per model by `/api/show` (`thinking.values`).
/// Only an exact documented value may be sent: Ollama silently falls back to
/// the model default for anything else, which would turn the UI's
/// applied-state into a lie. No documented values = refused.
fn validate_think(pinned: &PinnedModel, think: &ThinkValue) -> Result<(), String> {
    let documented: &[String] = pinned
        .descriptor
        .capabilities
        .thinking_control
        .as_ref()
        .map(|control| control.values.as_slice())
        .unwrap_or_default();
    if documented.is_empty() {
        return Err("THINKING_UNSUPPORTED: model has no documented thinking values".to_string());
    }
    let requested = think.as_documented();
    if !documented.contains(&requested) {
        return Err(format!(
            "THINKING_VALUE_UNSUPPORTED: '{requested}' is not a documented thinking value"
        ));
    }
    Ok(())
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
    if let Some(ids) = optional_full_scope(&env.context)? {
        validate_session_scope(ctx, &ids).await?;
    }
    // URL probe without persistence: "failed test saves nothing"
    if env.payload.account_id.trim().is_empty() {
        if let Some(url) = env
            .payload
            .endpoint_url
            .as_deref()
            .filter(|u| !u.trim().is_empty())
        {
            let health = transient_probe(ctx, url).await?;
            return Ok(ok_result(env.request_id, health));
        }
        return Err(
            "VALIDATION_FAILED: accountId or endpointUrl required to test a connection".to_string(),
        );
    }
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
            image_input: cap_str(descriptor.capabilities.image_input).to_string(),
            thinking_values: descriptor
                .capabilities
                .thinking_control
                .as_ref()
                .map(|control| control.values.clone()),
            thinking_default: descriptor
                .capabilities
                .thinking_control
                .as_ref()
                .and_then(|control| control.default_value.clone()),
        },
        context_limit: descriptor.context_limit,
        configured_context: descriptor.configured_context,
        effective_context_budget: effective_context_budget(descriptor),
        evidence: ProviderModelEvidenceDto {
            source: descriptor.evidence.source.clone(),
            server_version: descriptor.evidence.server_version.clone(),
            observed_at: format_observed_at(descriptor.evidence.observed_at_us),
        },
    }
}

/// Micros → RFC3339 UTC (the DTO timestamp convention). Zero/negative means
/// never observed → None, never a fabricated epoch date.
fn format_observed_at(observed_at_us: i64) -> Option<String> {
    if observed_at_us <= 0 {
        return None;
    }
    let dt =
        time::OffsetDateTime::from_unix_timestamp_nanos((observed_at_us * 1_000) as i128).ok()?;
    Some(
        dt.format(&time::format_description::well_known::Rfc3339)
            .unwrap_or_default(),
    )
}

/// The request-time budget is only claimed when both bounds are evidenced —
/// the model maximum and the endpoint-configured context. Either one alone
/// overstates: the server-wide default is not queryable, and a configured
/// value above the model maximum is not a real budget.
fn effective_context_budget(descriptor: &ModelDescriptor) -> Option<u32> {
    match (descriptor.context_limit, descriptor.configured_context) {
        (Some(model_max), Some(configured)) => Some(model_max.min(configured)),
        _ => None,
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

/// Provider-management commands are app-level: the settings surface has no
/// active conversation session. A scope is validated only when supplied
/// (all three ids present), never inferred from a partial one.
fn optional_full_scope(context: &CommandContext) -> Result<Option<StreamIds>, String> {
    if context.workspace_id.is_none()
        && context.project_id.is_none()
        && context.session_id.is_none()
    {
        return Ok(None);
    }
    expect_full_scope(context).map(Some)
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

/// Close a stale provider op left pending by a crash or a failed terminal
/// commit. Explicit, one-shot authority from the recovery surface: the op is
/// claimed inside the same tx that writes the canonical `interrupted`
/// terminal, so history gains a labelled cancelled turn instead of staying
/// silently unanswered. The pending row itself is never deleted.
pub async fn handle_mark_completion_interrupted(
    ctx: &ApiContext,
    env: CommandEnvelope<MarkCompletionInterruptedPayload>,
) -> Result<CommandResult<MarkCompletionInterruptedResponse>, String> {
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;

    let op_id = OperationId::from_string(&env.payload.operation_id).map_err(|_| {
        format!(
            "VALIDATION_FAILED: unknown completion operation '{}'",
            env.payload.operation_id
        )
    })?;
    let op_str = op_id.to_string();

    let row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id, session_id, message_request_id, status \
         FROM pending_operations WHERE operation_id = ? AND kind = 'provider-completion'",
    )
    .bind(&op_str)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let row =
        row.ok_or_else(|| format!("CONTEXT_MISMATCH: unknown completion operation '{op_str}'"))?;

    let matches = row.get::<String, _>("workspace_id") == ids.ws_id.to_string()
        && row.get::<String, _>("project_id") == ids.proj_id.to_string()
        && row.get::<Option<String>, _>("session_id").as_deref() == Some(&ids.sess_id.to_string());
    if !matches {
        return Err(format!(
            "CONTEXT_MISMATCH: completion operation '{op_str}' does not belong to this session"
        ));
    }
    if row.get::<String, _>("message_request_id") != env.payload.expected_message_request_id {
        return Err(
            "REQUEST_ID_CONFLICT: expected_message_request_id does not match the operation"
                .to_string(),
        );
    }
    if ctx.completion_runs.is_live(&op_str) {
        // A healthy run owns its own terminal (Stop or completion).
        return Err(format!(
            "CONFLICT: completion operation '{op_str}' is still running"
        ));
    }

    let status = if row.get::<String, _>("status") == "pending" {
        match persist_terminal(
            ctx,
            &op_str,
            &env.payload.expected_message_request_id,
            &ids,
            "",
            &StreamCompletionOutcome::Interrupted,
            None,
            true,
        )
        .await
        {
            "succeeded" => "interrupted",
            "already-resolved" => "already-resolved",
            _ => {
                return Err(
                    "STORAGE_UNAVAILABLE: interrupted terminal could not be recorded".to_string(),
                );
            }
        }
    } else {
        "already-resolved"
    };

    Ok(ok_result(
        env.request_id,
        MarkCompletionInterruptedResponse {
            status: status.to_string(),
        },
    ))
}

/// Validate a submission reference against this session's persisted history:
/// the target must be a message of the session, and only a user message can be
/// edited. Nothing is written on refusal.
fn validate_submit_reference(
    rows: &[adham_projections::ConversationMessageView],
    reference: &MessageReferenceDto,
) -> Result<(), String> {
    if reference.relation != "replied" && reference.relation != "edited-from" {
        return Err("VALIDATION_FAILED: relation must be replied or edited-from".to_string());
    }
    let target = rows
        .iter()
        .find(|r| r.message_id == reference.refers_to_message_id)
        .ok_or_else(|| "VALIDATION_FAILED: reference target is not in this session".to_string())?;
    if reference.relation == "edited-from" && target.role != "user" {
        return Err("VALIDATION_FAILED: only a user message can be edited".to_string());
    }
    Ok(())
}

/// The canonical event payload form of a validated IPC reference.
fn message_reference_v1(reference: &MessageReferenceDto) -> Result<MessageReferenceV1, String> {
    Ok(MessageReferenceV1 {
        refers_to_message_id: MessageId::from_string(&reference.refers_to_message_id)
            .map_err(|e| format!("VALIDATION_FAILED: {e}"))?,
        relation: reference.relation.clone(),
    })
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
    validate_mode(env.payload.mode.as_deref())?;
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;

    // A submission reference is validated against persisted history before
    // anything else: unknown targets and non-user edits refuse the whole
    // send, pre-append and pre-socket.
    if let Some(reference) = &env.payload.reference {
        let rows = adham_projections::ConversationProjection::get_session_messages(
            &ctx.pool,
            ctx.content_key.as_ref(),
            &ctx.installation_id,
            &ids.sess_id,
        )
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        validate_submit_reference(&rows, reference)?;
    }

    // Model evidence before ANY socket: unknown ids dispatch nothing.
    let (account, pinned) =
        resolve_dispatch_target(ctx, &env.payload.account_id, &env.payload.model_id).await?;
    if let Some(think) = &env.payload.think {
        validate_think(&pinned, think)?;
    }

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
        event_version: MESSAGE_SUBMITTED_CURRENT_VERSION,
        scope: scope.clone(),
        actor: EventActor {
            actor_id: ctx.actor_id,
            kind: ActorKind::LocalHuman,
        },
        request_id,
        correlation_id,
        causation_id: None,
        payload_json: serde_json::to_vec(&MessageSubmittedV2 {
            message_id,
            content_id,
            content_kind: "user_text".to_string(),
            size_bytes: trimmed.len() as u64,
            reference: env
                .payload
                .reference
                .as_ref()
                .map(message_reference_v1)
                .transpose()?,
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
        env.payload
            .reference
            .as_ref()
            .map(|r| (r.refers_to_message_id.as_str(), r.relation.as_str())),
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

    // The stored receipt is the replay record; the assembly summary is filled
    // in after the submitted row is durable (below), so a replayed receipt
    // carries none.
    let start = CompletionStartDto {
        op_id: op_id.to_string(),
        message_id: message_id.to_string(),
        context: None,
    };
    let persisted = serde_json::to_vec(&start).unwrap_or_default();
    // The fingerprint covers the semantic input: a reference, when present, is
    // part of it, so a reused request id with a different reference conflicts.
    // A reference-free send hashes exactly as before.
    let request_input = match &env.payload.reference {
        Some(r) => format!("{trimmed}|{}|{}", r.refers_to_message_id, r.relation),
        None => trimmed.clone(),
    };
    let request_fp =
        adham_event_log::request_fingerprint("complete_once_streaming", 1, &request_input);
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

    // Budgeted assembly runs inside this branch's reap protection, after the
    // submitted row above is durable (it must reach the model). History comes
    // from protected content server-side, never from the renderer.
    let (input_budget, max_output_tokens) = budget_with_reserve(&pinned.descriptor);
    let history_rows = adham_projections::ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &ids.sess_id,
    )
    .await
    .unwrap_or_default();
    let assembled = assemble_context(
        branch_context_rows(history_rows, env.payload.reference.as_ref()),
        env.payload.mode.as_deref().and_then(mode_instruction),
        input_budget,
        // A fresh send keeps the whole session history; the branch lives in
        // the row iterator instead of a stop_after cut.
        None,
    );

    Ok(run_and_settle(
        ctx,
        env.request_id,
        correlation_id,
        &ids,
        &adapter,
        &account,
        &pinned,
        &token,
        start,
        assembled,
        max_output_tokens,
        env.payload.think,
        sink,
    )
    .await)
}

/// Retry / regenerate: one NEW assistant attempt for an existing user turn.
///
/// The user row is never duplicated and previous attempts stay persisted, so
/// history is preserved and each retry is an explicit, visible dispatch with
/// its own durable op handle — never a silent re-run and never a resend of the
/// user's message as a new turn. Only the session's latest user turn can be
/// retried: history is append-only, so an older turn cannot be answered now
/// without answering it out of order (refused before any socket).
pub async fn handle_retry_completion_streaming<S>(
    ctx: &ApiContext,
    env: CommandEnvelope<RetryCompletionPayload>,
    sink: &S,
) -> Result<CommandResult<CompletionStartDto>, String>
where
    S: EventSink,
{
    validate_mode(env.payload.mode.as_deref())?;
    let ids = expect_full_scope(&env.context)?;
    validate_session_scope(ctx, &ids).await?;
    let request_id = RequestId::from_client_str(&env.request_id)
        .map_err(|_| "VALIDATION_FAILED: request_id must be UUID".to_string())?;
    let (account, pinned) =
        resolve_dispatch_target(ctx, &env.payload.account_id, &env.payload.model_id).await?;
    if let Some(think) = &env.payload.think {
        validate_think(&pinned, think)?;
    }
    let adapter = ollama_adapter(&account)?;

    // The retried turn must be a persisted user row of this session, and the
    // session's latest user turn. History comes from protected content
    // server-side; the renderer only names the turn.
    let reply_to = env.payload.reply_to_message_id.clone();
    let history_rows = adham_projections::ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &ids.sess_id,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let target = history_rows
        .iter()
        .find(|r| r.message_id == reply_to)
        .ok_or_else(|| "VALIDATION_FAILED: reply target is not in this session".to_string())?;
    if target.role != "user" {
        return Err("VALIDATION_FAILED: only a user turn can be retried".to_string());
    }
    let latest_user = history_rows.iter().rev().find(|r| r.role == "user");
    if latest_user.map(|r| r.message_id.as_str()) != Some(reply_to.as_str()) {
        return Err("RETRY_NOT_LATEST_TURN: only the latest user turn can be retried".to_string());
    }

    let op_id = OperationId::new_v7();
    let scope = EventScope {
        installation_id: ctx.installation_id,
        workspace_id: Some(ids.ws_id),
        project_id: Some(ids.proj_id),
        session_id: Some(ids.sess_id),
    };
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    // idempotent IPC retry: same request → same op handle, never a second
    // attempt. A deliberate second retry is a new request id, and then it IS
    // a second visible attempt.
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

    // Durable op handle BEFORE any socket (fail-closed record-then-POST). The
    // response names the retried user turn: there is no new user message.
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

    let correlation_id = CorrelationId::new_v7();
    let start = CompletionStartDto {
        op_id: op_id.to_string(),
        message_id: reply_to.clone(),
        context: None,
    };
    let persisted = serde_json::to_vec(&start).unwrap_or_default();
    let request_input = format!("{reply_to}|{}", env.payload.model_id);
    let request_fp = adham_event_log::request_fingerprint("retry_completion", 1, &request_input);
    let scope_fp = adham_event_log::scope_fingerprint(
        "retry_completion",
        1,
        &ctx.actor_id,
        &ctx.installation_id,
        Some(&ids.ws_id),
        Some(&ids.proj_id),
        Some(&ids.sess_id),
    );
    // A retry appends no event at dispatch (the user row already exists), so
    // this receipt has no global position to point at; 0 marks that. Receipt
    // replay reads the stored response only, never these positions.
    SqliteEventStore::record_receipt_tx(
        &mut tx,
        &request_id,
        "retry_completion",
        1,
        &scope_fp,
        &request_fp,
        &ctx.actor_id,
        &correlation_id,
        "completed",
        &persisted,
        0,
    )
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    let token = CancellationToken::new();
    ctx.completion_runs.insert(&start.op_id, token.clone());

    // The retried turn's own context: history stops at the user row being
    // answered, so the previous attempts of this turn are not sent back to the
    // model (they stay persisted and visible) and later turns cannot exist —
    // the latest-turn rule above guarantees it.
    let (input_budget, max_output_tokens) = budget_with_reserve(&pinned.descriptor);
    let assembled = assemble_context(
        history_rows.into_iter(),
        env.payload.mode.as_deref().and_then(mode_instruction),
        input_budget,
        Some(&reply_to),
    );

    Ok(run_and_settle(
        ctx,
        env.request_id,
        correlation_id,
        &ids,
        &adapter,
        &account,
        &pinned,
        &token,
        start,
        assembled,
        max_output_tokens,
        env.payload.think,
        sink,
    )
    .await)
}

/// Assembly summary + dispatch + settle for one completion op. Shared by a
/// fresh send and a retry/regenerate attempt: both write exactly one assistant
/// terminal for one durable op handle, and the op leaves `completion_runs`
/// before this returns.
#[allow(clippy::too_many_arguments)]
async fn run_and_settle<S>(
    ctx: &ApiContext,
    request_id: String,
    correlation_id: CorrelationId,
    ids: &StreamIds,
    adapter: &OllamaHttpAdapter,
    account: &LocalAccount,
    pinned: &PinnedModel,
    token: &CancellationToken,
    mut start: CompletionStartDto,
    assembled: AssembledContext,
    max_output_tokens: Option<u32>,
    think: Option<ThinkValue>,
    sink: &S,
) -> CommandResult<CompletionStartDto>
where
    S: EventSink,
{
    start.context = Some(ContextAssemblyDto {
        estimated_input_tokens: assembled.estimated_input_tokens,
        input_budget_tokens: assembled.input_budget_tokens,
        dropped_messages: assembled.dropped_messages,
    });

    info!("provider completion dispatching op {}", start.op_id);
    let outcome = run_stream(
        ctx,
        adapter,
        pinned,
        account,
        &start.op_id,
        &request_id,
        ids,
        token,
        assembled.messages,
        max_output_tokens,
        think,
        sink,
    )
    .await;
    ctx.completion_runs.remove(&start.op_id);
    info!(
        "provider completion op {} outcome: {}",
        start.op_id, outcome
    );

    CommandResult {
        protocol_version: 1,
        request_id,
        correlation_id: correlation_id.to_string(),
        data: start,
    }
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

/// Chars-per-token estimate for budgeting. No tokenizer is embedded, so every
/// figure derived from this is labeled estimated in the UI.
const ESTIMATE_CHARS_PER_TOKEN: usize = 4;
/// Output/generation reserve inside the effective context: Ollama's num_ctx
/// covers prompt + generated tokens (thinking included), so num_predict is
/// pinned to the reserve below. At most half the budget, never more than 4096.
const OUTPUT_RESERVE_TOKENS: u32 = 4096;

struct AssembledContext {
    messages: Vec<ChatMessage>,
    estimated_input_tokens: u32,
    input_budget_tokens: Option<u32>,
    dropped_messages: u32,
}

fn estimate_tokens(chars: usize) -> u32 {
    (chars as u64).div_ceil(ESTIMATE_CHARS_PER_TOKEN as u64) as u32
}

/// Evidenced input budget and output reserve: effective context (model max ∩
/// configured num_ctx) minus the reserve. Unknown evidence stays unknown —
/// nothing is guessed. Returns (input_budget, max_output_tokens).
fn budget_with_reserve(descriptor: &ModelDescriptor) -> (Option<u32>, Option<u32>) {
    let Some(effective) = effective_context_budget(descriptor) else {
        return (None, None);
    };
    let reserve = OUTPUT_RESERVE_TOKENS.min(effective / 2);
    (Some(effective - reserve), (reserve > 0).then_some(reserve))
}

/// The rows a dispatch is answered against. A fresh send (or a reply, which
/// only quotes) keeps the whole session history. An "edited-from" branch
/// answers against the context its original had: everything before the edited
/// message, plus the just-submitted edited turn. The original prompt, its
/// answers, and whatever followed stay persisted and visible, but are not fed
/// back to the model.
fn branch_context_rows(
    rows: Vec<adham_projections::ConversationMessageView>,
    reference: Option<&MessageReferenceDto>,
) -> impl Iterator<Item = adham_projections::ConversationMessageView> {
    let newest = rows.len().saturating_sub(1);
    // The reference was validated before the submit effect: the target is a
    // persisted user row of this session (position found defensively anyway).
    let cut = reference
        .filter(|r| r.relation == "edited-from")
        .and_then(|r| {
            rows.iter()
                .position(|row| row.message_id.as_str() == r.refers_to_message_id)
        });
    rows.into_iter()
        .enumerate()
        .filter_map(move |(index, row)| match cut {
            Some(cut) if index >= cut && index != newest => None,
            _ => Some(row),
        })
}

/// Context assembly: mode instruction + branch history under the caps and the
/// evidenced input budget. Oldest messages drop first and every drop is
/// counted; the newest message always survives (a single oversized message is
/// sent as-is with the estimate visible rather than refusing the send).
/// `stop_after` (retry/regenerate) ends history at that message inclusive: the
/// turn is answered again against the context it originally had, and previous
/// attempts of the same turn are not fed back to the model.
fn assemble_context(
    rows: impl Iterator<Item = adham_projections::ConversationMessageView>,
    instruction: Option<&str>,
    input_budget: Option<u32>,
    stop_after: Option<&str>,
) -> AssembledContext {
    let instruction_chars = instruction.map(str::len).unwrap_or(0);
    let mut kept: Vec<ChatMessage> = Vec::new();
    for row in rows {
        if matches!(
            row.completion,
            Some(MessageCompletionV1::Interrupted) | Some(MessageCompletionV1::Failed)
        ) {
            continue;
        }
        let is_last = stop_after == Some(row.message_id.as_str());
        kept.push(ChatMessage {
            role: if row.role == "assistant" {
                MessageRole::Assistant
            } else {
                MessageRole::User
            },
            content: row.content,
        });
        if is_last {
            break;
        }
    }
    // trim from the oldest end; the newest messages win
    let mut dropped_messages: u32 = 0;
    loop {
        if kept.len() <= 1 {
            break;
        }
        let bytes: usize = kept.iter().map(|m| m.content.len()).sum();
        let estimated = estimate_tokens(bytes + instruction_chars);
        let over_caps = kept.len() > MAX_HISTORY_MESSAGES || bytes > MAX_HISTORY_BYTES;
        let over_budget = input_budget.map(|b| estimated > b).unwrap_or(false);
        if !over_caps && !over_budget {
            break;
        }
        kept.remove(0);
        dropped_messages += 1;
    }
    // non-empty content guard: model gets a user prompt (the submitted row is in history)
    if kept.last().map(|m| m.role) != Some(MessageRole::User) {
        kept.push(ChatMessage {
            role: MessageRole::User,
            content: "(empty prompt)".to_string(),
        });
    }
    // Turn-mode instruction: part of this request only. The stored user text
    // stays exactly what the user wrote; the mode is frozen at dispatch.
    if let Some(instruction) = instruction {
        kept.insert(
            0,
            ChatMessage {
                role: MessageRole::System,
                content: instruction.to_string(),
            },
        );
    }
    let bytes: usize = kept.iter().map(|m| m.content.len()).sum();
    AssembledContext {
        estimated_input_tokens: estimate_tokens(bytes),
        input_budget_tokens: input_budget,
        dropped_messages,
        messages: kept,
    }
}

/// System instruction for a declared turn mode. Request-only: mode semantics
/// never persist and no mode grants permissions — tools do not exist yet, so
/// "execute" (refused in the handler) is the only mode with nothing to bind to.
fn mode_instruction(mode: &str) -> Option<&'static str> {
    match mode {
        "ask" => Some(
            "Mode: Ask. Hold a conversation: answer and discuss directly. Do not claim to change \
             files, run commands, or take any action.",
        ),
        "plan" => Some(
            "Mode: Plan. Respond with a read-only plan: steps, trade-offs and risks. Do not claim \
             to have changed or executed anything.",
        ),
        "code" => Some(
            "Mode: Code. Respond with code ready to review and apply by hand (complete snippets \
             or diffs). You cannot execute anything.",
        ),
        _ => None,
    }
}

fn terminal_status(outcome: &StreamCompletionOutcome) -> (&'static str, bool) {
    match outcome {
        StreamCompletionOutcome::Stop => ("completed", false),
        StreamCompletionOutcome::LengthExceeded => ("completed", true),
        StreamCompletionOutcome::Interrupted => ("interrupted", false),
        StreamCompletionOutcome::ContentFilter
        | StreamCompletionOutcome::EmptyAnswer
        | StreamCompletionOutcome::StructuredOnly
        | StreamCompletionOutcome::Unknown { .. } => ("failed", false),
    }
}

fn map_completion(outcome: &StreamCompletionOutcome) -> MessageCompletionV1 {
    match outcome {
        StreamCompletionOutcome::Stop => MessageCompletionV1::Completed { truncated: false },
        StreamCompletionOutcome::LengthExceeded => {
            MessageCompletionV1::Completed { truncated: true }
        }
        StreamCompletionOutcome::Interrupted => MessageCompletionV1::Interrupted,
        StreamCompletionOutcome::ContentFilter
        | StreamCompletionOutcome::EmptyAnswer
        | StreamCompletionOutcome::StructuredOnly
        | StreamCompletionOutcome::Unknown { .. } => MessageCompletionV1::Failed,
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
    // Assembled + budgeted by the caller after the submitted row was durable.
    messages: Vec<ChatMessage>,
    max_output_tokens: Option<u32>,
    // Documented `think` parameter; validated against model evidence already.
    think: Option<ThinkValue>,
    sink: &S,
) -> &'static str
where
    S: EventSink,
{
    // The op handle is announced before dispatch: the renderer must be able
    // to Stop while the socket is still connecting, before any frame.
    let mut sequence: u64 = 0;
    sink.send(stream_event(
        op_id,
        &mut sequence,
        StreamEventPayloadDto::Started,
    ))
    .ok_or_log(op_id);

    let request = ProviderRequestV1 {
        operation_id: op_id.to_string(),
        model_selection: ModelSelectionSnapshot {
            account_id: account.account_id.clone(),
            endpoint_id: account.endpoint_id.clone(),
            model_id: pinned.model_id.clone(),
            privacy_class: pinned.descriptor.privacy_class,
        },
        messages,
        max_output_tokens,
        think,
        temperature: None,
    };

    // A user Stop during connect cancels the in-flight request instead of
    // waiting for a first frame; `biased` also observes a token cancelled
    // before dispatch (no socket is kept). Cancellation never depends on an
    // answer delta.
    let dispatch = tokio::select! {
        biased;
        _ = token.cancelled() => None,
        res = adapter.stream_chat(pinned, &request) => Some(res),
    };
    let mut stream = match dispatch {
        None => {
            // cancelled while connecting: Interrupted, even with no text yet
            sink.send(stream_event(
                op_id,
                &mut sequence,
                StreamEventPayloadDto::Completed {
                    completion: "interrupted".to_string(),
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
                &StreamCompletionOutcome::Interrupted,
                None,
                false,
            )
            .await;
        }
        Some(Err(e)) => {
            tracing::debug!("completion op {op_id}: dispatch failed pre-wire: {e}");
            // after the op handle exists: a pre-wire dispatch failure is a
            // failed terminal, never a vanished generation
            sink.send(stream_event(
                op_id,
                &mut sequence,
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
                false,
            )
            .await;
        }
        Some(Ok(s)) => s,
    };

    let mut acc = String::new();
    let mut usage: Option<MessageUsageV1> = None;
    let mut terminal_outcome: Option<StreamCompletionOutcome> = None;
    let mut failed_reason: Option<String> = None;
    let mut saw_thinking = false;
    let mut saw_structured = false;

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
                Some(Ok(NormalizedStreamEvent::ThinkingActivity))
                | Some(Ok(NormalizedStreamEvent::ThinkingDelta(_))) => {
                    // reasoning text never crosses this boundary: exactly one
                    // activity marker per op, so the UI can say "Thinking…"
                    // without ever seeing the model's reasoning
                    if !saw_thinking {
                        saw_thinking = true;
                        sink.send(stream_event(
                            op_id,
                            &mut sequence,
                            StreamEventPayloadDto::Thinking,
                        ))
                        .ok_or_log(op_id);
                    }
                }
                Some(Ok(NormalizedStreamEvent::StructuredActivity)) => {
                    // non-text output seen: the empty-answer rule must not
                    // claim this turn as a silent refusal
                    saw_structured = true;
                }
                Some(Ok(NormalizedStreamEvent::StreamCompleted(outcome))) => {
                    terminal_outcome = Some(outcome);
                    break;
                }
                Some(Err(e)) => {
                    tracing::warn!("completion op {op_id}: stream error mid-wire: {e}");
                    failed_reason = Some(e.to_string());
                    break;
                }
            },
        }
    }

    let mut outcome = terminal_outcome.unwrap_or(StreamCompletionOutcome::ContentFilter);
    if let Some(reason) = &failed_reason {
        // bounded: transport/accounting reason only, never model output
        tracing::debug!("completion op {op_id}: error terminal ({reason})");
    }
    if failed_reason.is_none() && acc.is_empty() {
        // A normal terminal with no answer text at all is not a success:
        // thinking-only runs and silent refusals fail visibly. Tool-only
        // output is its own outcome, never an "empty answer" error.
        outcome = match outcome {
            StreamCompletionOutcome::Stop | StreamCompletionOutcome::LengthExceeded => {
                if saw_structured {
                    StreamCompletionOutcome::StructuredOnly
                } else {
                    StreamCompletionOutcome::EmptyAnswer
                }
            }
            other => other,
        };
    }

    // one honest terminal on the wire, in contract order (Started is first)
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

    persist_terminal(
        ctx,
        op_id,
        request_id,
        ids,
        &acc,
        &outcome,
        usage.as_ref(),
        false,
    )
    .await
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

#[allow(clippy::too_many_arguments)]
async fn persist_terminal(
    ctx: &ApiContext,
    op_id: &str,
    request_id: &str,
    ids: &StreamIds,
    text: &str,
    outcome: &StreamCompletionOutcome,
    usage: Option<&MessageUsageV1>,
    // Recovery callers claim the pending row exactly once inside this tx:
    // zero rows claimed means another call already recorded a terminal.
    require_pending: bool,
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
    let now = OffsetDateTime::now_utc();
    let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;

    let mut tx = match ctx.pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::error!("completion op {op_id}: terminal persistence unavailable: {e}");
            return "failed";
        }
    };

    if require_pending {
        let claimed = match sqlx::query(
            "UPDATE pending_operations SET status = 'resolved', updated_at_us = ? \
             WHERE operation_id = ? AND message_request_id = ? \
               AND kind = 'provider-completion' AND status = 'pending'",
        )
        .bind(now_us)
        .bind(op_id)
        .bind(request_id)
        .execute(&mut *tx)
        .await
        {
            Ok(result) => result.rows_affected(),
            Err(e) => {
                tracing::error!("completion op {op_id}: pending claim failed: {e}");
                let _ = tx.rollback().await;
                return "failed";
            }
        };
        if claimed == 0 {
            // The claim and the terminal roll back together, so a crash
            // between them leaves the op recoverable.
            let _ = tx.rollback().await;
            return "already-resolved";
        }
    }

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

/// Ollama local accounts for the settings UI (reload-safe source of truth).
pub async fn handle_list_provider_accounts(
    ctx: &ApiContext,
) -> Result<CommandResult<ListProviderAccountsResponse>, String> {
    let accounts = ctx
        .registry
        .list_accounts()
        .await
        .map_err(|e| e.to_string())?;
    let dtos = accounts
        .iter()
        .map(|a| ProviderAccountDto {
            account_id: a.account_id.0.clone(),
            alias: a.alias.clone(),
            endpoint_url: a.base_url.clone(),
            privacy_class: serde_plain_repr(&a.privacy_class).to_string(),
        })
        .collect();
    Ok(ok_result(
        CorrelationId::new_v7().to_string(),
        ListProviderAccountsResponse { accounts: dtos },
    ))
}

/// Test an un-persisted endpoint URL: probing against `endpointUrl` with no
/// saved account NEVER writes a row ("failed test saves nothing").
pub async fn transient_probe(
    ctx: &ApiContext,
    endpoint_url: &str,
) -> Result<ProviderHealthResponse, String> {
    let synthetic = LocalAccount {
        account_id: ProviderAccountId::new(uuid::Uuid::now_v7().to_string()),
        kind: adham_provider::domain::account::ProviderKind::OllamaLocal,
        alias: "probe".to_string(),
        privacy_class: PrivacyClass::LocalOnly,
        endpoint_id: EndpointId::new("local-ollama"),
        base_url: endpoint_url.to_string(),
        approved_destination: false,
    };
    let adapter = ollama_adapter(&synthetic)?;
    let _ = ctx; // transport is validated against the shared policy below
    match adapter.connection_test().await {
        Ok(count) => Ok(ProviderHealthResponse {
            reachable: true,
            model_tag_count: count,
        }),
        Err(_) => Ok(ProviderHealthResponse {
            reachable: false,
            model_tag_count: 0,
        }),
    }
}

/// Persisted digest-pinned models for one account (registry read — no
/// network), used by the Models page and composer picker on reload.
pub async fn handle_list_provider_models(
    ctx: &ApiContext,
    env: CommandEnvelope<ListProviderModelsPayload>,
) -> Result<CommandResult<ListProviderModelsResponse>, String> {
    let account = local_account(ctx, env.payload.account_id.trim()).await?;
    let pinned = ctx
        .registry
        .list_models(&account.account_id)
        .await
        .map_err(|e| e.to_string())?;
    let models = pinned
        .iter()
        .map(|m| provider_model_dto(&m.descriptor, &m.digest))
        .collect();
    Ok(ok_result(
        env.request_id,
        ListProviderModelsResponse { models },
    ))
}
