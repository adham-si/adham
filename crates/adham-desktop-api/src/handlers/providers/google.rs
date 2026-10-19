//! Google Gemini account configuration and disconnect (G2).

use super::{ApiContext, local_account, ok_result, serde_plain_repr};

use crate::dtos::*;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::registry::LocalAccount;

// ===== Google Gemini account configuration (G2) =====

/// Fixed official endpoint. Accounts never record a user-editable Google URL:
/// the hard host allowlist lives in the adapter (adapter-side enforcement), but
/// the stored base_url is the same constant so registry data cannot drift.
pub const GOOGLE_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com";

pub const GOOGLE_GEMINI_ENDPOINT_ID: &str = "google-gemini-cloud";

/// Write-only Google account configuration: consent gate, mint-or-rotate,
/// seal the API key into the vault. The key is echoed back to nobody.
pub async fn handle_configure_google_account(
    ctx: &ApiContext,
    env: CommandEnvelope<ConfigureGoogleAccountPayload>,
) -> Result<CommandResult<ProviderAccountDto>, String> {
    let payload = env.payload;
    if !payload.acknowledge_cloud_transfer {
        return Err(
            "VALIDATION_FAILED: cloud transfer consent (acknowledgeCloudTransfer) is required before configuring a Google account".into(),
        );
    }
    let api_key = payload.api_key.trim().to_string();
    if api_key.is_empty() {
        return Err("VALIDATION_FAILED: apiKey must not be empty".into());
    }
    let alias = payload
        .alias
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("Google Gemini")
        .to_string();
    let account = match payload.account_id.as_deref().filter(|s| !s.is_empty()) {
        Some(id) => {
            let mut existing = local_account(ctx, id).await?;
            if existing.kind != adham_provider::domain::account::ProviderKind::GoogleGemini {
                return Err(format!(
                    "VALIDATION_FAILED: account '{id}' is not a Google Gemini account"
                ));
            }
            existing.alias = alias;
            existing
        }
        None => LocalAccount {
            account_id: ProviderAccountId::new(uuid::Uuid::now_v7().to_string()),
            kind: adham_provider::domain::account::ProviderKind::GoogleGemini,
            alias,
            privacy_class: PrivacyClass::CloudStandard,
            endpoint_id: EndpointId::new(GOOGLE_GEMINI_ENDPOINT_ID),
            base_url: GOOGLE_GEMINI_BASE_URL.to_string(),
            approved_destination: true,
        },
    };
    ctx.registry
        .upsert_account(&account)
        .await
        .map_err(|e| e.to_string())?;
    adham_event_log::put_provider_credential(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &account.account_id.0,
        &api_key,
        &ctx.installation_id.0.to_string(),
    )
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

/// Disconnect: remove the Google account row; its model rows and sealed
/// credential cascade away in the store.
pub async fn handle_disconnect_google_account(
    ctx: &ApiContext,
    env: CommandEnvelope<DisconnectGoogleAccountPayload>,
) -> Result<CommandResult<GoogleAccountDisconnected>, String> {
    let account = local_account(ctx, &env.payload.account_id).await?;
    if account.kind != adham_provider::domain::account::ProviderKind::GoogleGemini {
        return Err(format!(
            "VALIDATION_FAILED: account '{}' is not a Google Gemini account",
            env.payload.account_id
        ));
    }
    ctx.registry
        .delete_account(&account.account_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ok_result(
        env.request_id,
        GoogleAccountDisconnected {
            account_id: account.account_id.0.clone(),
        },
    ))
}

/// Disconnect a Local Ollama account. The store cascades the pinned models
/// and any sealed credential with the account row.
pub async fn handle_disconnect_ollama_account(
    ctx: &ApiContext,
    env: CommandEnvelope<DisconnectOllamaAccountPayload>,
) -> Result<CommandResult<OllamaAccountDisconnected>, String> {
    let account = local_account(ctx, &env.payload.account_id).await?;
    if account.kind != adham_provider::domain::account::ProviderKind::OllamaLocal {
        return Err(format!(
            "VALIDATION_FAILED: account '{}' is not a Local Ollama account",
            env.payload.account_id
        ));
    }
    ctx.registry
        .delete_account(&account.account_id)
        .await
        .map_err(|e| e.to_string())?;
    Ok(ok_result(
        env.request_id,
        OllamaAccountDisconnected {
            account_id: account.account_id.0.clone(),
        },
    ))
}
