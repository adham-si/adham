//! Discovery, connection probes, and account management (Delivery A).

use super::{
    any_adapter, local_account, ok_result, ollama_adapter, optional_full_scope, provider_model_dto,
    serde_plain_repr, transient_probe, validate_session_scope, ApiContext,
};

use crate::dtos::*;
use adham_provider::adapters::AnyAdapter;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::model::{ModelDescriptor, ModelId};
use adham_provider::registry::LocalAccount;

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
    // kind-routed probe: Ollama → /api/tags; Google → metadata-only models
    // count (same policy surface as dispatch: official or loopback mirror,
    // sealed credential required).
    let reachable_count: Result<usize, String> = match account.kind {
        adham_provider::domain::account::ProviderKind::GoogleGemini => {
            let credential = adham_event_log::read_provider_credential_plaintext(
                &ctx.pool,
                ctx.content_key.as_ref(),
                &account.account_id.0,
                &ctx.installation_id.0.to_string(),
            )
            .await
            .map_err(|e| {
                format!("VALIDATION_FAILED: no usable credential for this Google account: {e}")
            });
            match credential.and_then(|c| any_adapter(&account, Some(c))) {
                Ok(adapter) => {
                    let count = adapter.connection_test().await;
                    Ok(count.map_err(|e| e.to_string())?)
                }
                Err(e) => Err(e),
            }
        }
        _ => ollama_adapter(&account)?
            .connection_test()
            .await
            .map_err(|e| e.to_string()),
    };
    let response = match reachable_count {
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
    // kind-routed discovery: Google kinds load the sealed credential the same
    // way dispatch does; official-host or loopback-mirror only.
    let pinned = match account.kind {
        adham_provider::domain::account::ProviderKind::GoogleGemini => {
            let credential = adham_event_log::read_provider_credential_plaintext(
                &ctx.pool,
                ctx.content_key.as_ref(),
                &account.account_id.0,
                &ctx.installation_id.0.to_string(),
            )
            .await
            .map_err(|e| {
                format!("VALIDATION_FAILED: no usable credential for this Google account: {e}")
            })?;
            any_adapter(&account, Some(credential))?
        }
        _ => {
            let adapter = ollama_adapter(&account)?;
            AnyAdapter::Ollama(adapter)
        }
    };
    let pinned = pinned.discover().await.map_err(|e| e.to_string())?;
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
            kind: serde_plain_repr(&account.kind).to_string(),
        },
    ))
}
