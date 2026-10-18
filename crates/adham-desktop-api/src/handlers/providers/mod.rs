//! Provider commands (Delivery A: Ollama Local only — no keys, no cloud).
//!
//! Ownership split: the application layer owns a transport-neutral
//! [`EventSink`]; `src-tauri` adapts `Channel<StreamEventDto>` into it. The
//! op handle (`pending_operations`, `kind='provider-completion'`) is recorded
//! BEFORE any socket is opened. History is assembled server-side from the
//! projection + protected content store — renderer-supplied history is
//! ignored and never authoritative. The terminal event is idempotent per op
//! and persists even when the renderer is gone.

pub mod accounts;
pub mod discovery;
pub mod google;
pub mod stream_io;
pub mod streaming;

pub use accounts::{handle_list_provider_accounts, handle_list_provider_models, transient_probe};
pub use discovery::{
    handle_discover_ollama_models, handle_test_provider_connection, handle_update_provider_account,
};
pub use google::{
    handle_configure_google_account, handle_disconnect_google_account,
    handle_disconnect_ollama_account,
};
pub use streaming::{handle_complete_once_streaming, handle_stop_completion};

use super::streaming::expect_full_scope;
use super::ApiContext;
use crate::dtos::*;
use adham_core_types::*;
use adham_provider::adapters::ollama_http::OllamaHttpAdapter;
use adham_provider::adapters::AnyAdapter;
use adham_provider::domain::model::ModelDescriptor;
use adham_provider::registry::LocalAccount;
use adham_provider::transport::HttpTransport;
use serde::Serialize;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Mutex;
use tokio_util::sync::CancellationToken;
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

pub(crate) fn cap_str(status: adham_provider::domain::model::CapabilityStatus) -> &'static str {
    use adham_provider::domain::model::CapabilityStatus::*;
    match status {
        Supported => "supported",
        Unsupported => "unsupported",
        Unknown => "unknown",
    }
}

pub(crate) async fn local_account(
    ctx: &ApiContext,
    account_id: &str,
) -> Result<LocalAccount, String> {
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

pub(crate) fn ollama_adapter(account: &LocalAccount) -> Result<OllamaHttpAdapter, String> {
    OllamaHttpAdapter::new(HttpTransport::default(), &account.base_url).map_err(|e| e.to_string())
}

/// Loopback host base_url (the same trust boundary the Ollama adapter trusts
/// for the local daemon). Used to admit mirror endpoints for Google kinds
/// without opening the external-host surface: official HTTPS is always
/// allowed; anything else must loop back.
pub(crate) fn is_loopback_base(base_url: &str) -> bool {
    let no_scheme = base_url
        .trim_start_matches("https://")
        .trim_start_matches("http://");
    let host = no_scheme.split(['/', '?', ':']).next().unwrap_or_default();
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// Kind-routed adapter construction: the single branching point for dispatch.
/// Ollama stays loopback-only (its own policy); Google accepts only the
/// official endpoint or a loopback mirror — external hosts never construct.
pub(crate) fn any_adapter(
    account: &LocalAccount,
    credential: Option<String>,
) -> Result<AnyAdapter, String> {
    match account.kind {
        adham_provider::domain::account::ProviderKind::OllamaLocal => {
            Ok(AnyAdapter::Ollama(ollama_adapter(account)?))
        }
        adham_provider::domain::account::ProviderKind::GoogleGemini => {
            let key = credential.ok_or_else(|| {
                "VALIDATION_FAILED: no stored credential for this Google account — set the API key in settings first".to_string()
            })?;
            let key = adham_provider::adapters::gemini_http::GoogleApiKey::new(&key)
                .map_err(|e| format!("VALIDATION_FAILED: {e}"))?;
            let transport = HttpTransport::default();
            let base = account.base_url.trim_end_matches('/');
            let is_official =
                base == adham_provider::adapters::gemini_http::GeminiHttpAdapter::OFFICIAL_BASE_URL;
            if !is_official && !is_loopback_base(base) {
                return Err(format!(
                    "VALIDATION_FAILED: Google endpoints accept only the official host or a loopback mirror, got '{base}'"
                ));
            }
            let adapter = if is_official {
                adham_provider::adapters::gemini_http::GeminiHttpAdapter::new(transport, base, key)
            } else {
                adham_provider::adapters::gemini_http::GeminiHttpAdapter::new_unchecked(
                    transport, base, key,
                )
            }
            .map_err(|e| e.to_string())?;
            Ok(AnyAdapter::Gemini(adapter))
        }
        other => Err(format!(
            "VALIDATION_FAILED: account '{}' kind '{other:?}' is not dispatchable yet",
            account.account_id.0
        )),
    }
}

pub(crate) fn ok_result<T: Serialize + TS>(request_id: String, data: T) -> CommandResult<T> {
    CommandResult {
        protocol_version: 1,
        request_id,
        correlation_id: CorrelationId::new_v7().to_string(),
        data,
    }
}

pub(crate) fn provider_model_dto(descriptor: &ModelDescriptor, digest: &str) -> ProviderModelDto {
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

pub(crate) fn serde_plain_repr<T: Serialize>(value: &T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Dispatch-scope plumbing shared by discovery, streaming, and accounts.
pub(crate) struct StreamIds {
    ws_id: WorkspaceId,
    proj_id: ProjectId,
    sess_id: SessionId,
}

/// Provider-management commands are app-level: the settings surface has no
/// active conversation session. A scope is validated only when supplied
/// (all three ids present), never inferred from a partial one.
pub(crate) fn optional_full_scope(context: &CommandContext) -> Result<Option<StreamIds>, String> {
    if context.workspace_id.is_none()
        && context.project_id.is_none()
        && context.session_id.is_none()
    {
        return Ok(None);
    }
    expect_full_scope(context).map(Some)
}

pub(crate) async fn validate_session_scope(
    ctx: &ApiContext,
    ids: &StreamIds,
) -> Result<(), String> {
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
