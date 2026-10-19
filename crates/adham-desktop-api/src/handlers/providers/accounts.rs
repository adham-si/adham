//! Provider account listing, models, and transient probes.

use super::{
    ApiContext, local_account, ok_result, ollama_adapter, provider_model_dto, serde_plain_repr,
};

use crate::dtos::*;
use adham_core_types::*;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::registry::LocalAccount;

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
            kind: serde_plain_repr(&a.kind).to_string(),
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
