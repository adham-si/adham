//! A2 (provider side): the registry wrapper validates every stored model
//! descriptor against `ModelDescriptor` on read — corrupt storage surfaces an
//! error and is never served as live configuration.

use adham_event_log::create_sqlite_pool;
use adham_event_log::provider_registry as store;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId, ProviderKind};
use adham_provider::domain::endpoint::EndpointId;
use adham_provider::domain::error::ProviderError;
use adham_provider::domain::model::{
    CapabilityStatus, ModelCapabilities, ModelDescriptor, ModelId,
};
use adham_provider::registry::{LocalAccount, ProviderRegistry};
use std::path::PathBuf;

fn db_path() -> PathBuf {
    let mut p = std::env::temp_dir();
    p.push(format!("adham_provider_reg_{}.db", uuid::Uuid::now_v7()));
    p
}

fn local_account(id: &str, base_url: &str) -> LocalAccount {
    LocalAccount {
        account_id: ProviderAccountId::new(id),
        kind: ProviderKind::OllamaLocal,
        alias: "Local Ollama".into(),
        privacy_class: PrivacyClass::LocalOnly,
        endpoint_id: EndpointId::new("ep-ollama-local"),
        base_url: base_url.into(),
        approved_destination: true,
    }
}

fn descriptor(id: &str) -> ModelDescriptor {
    ModelDescriptor {
        model_id: ModelId::new(id),
        human_label: id.into(),
        privacy_class: PrivacyClass::LocalOnly,
        capabilities: ModelCapabilities {
            streaming: CapabilityStatus::Supported,
            ..Default::default()
        },
        evidence: Default::default(),
        context_limit: None,
        configured_context: None,
    }
}

#[tokio::test]
async fn account_and_models_roundtrip_through_registry() {
    let pool = create_sqlite_pool(&db_path()).await.expect("pool");
    let registry = ProviderRegistry::new(pool.clone());

    registry
        .upsert_account(&local_account("acct-local", "http://127.0.0.1:11434"))
        .await
        .expect("upsert account");

    registry
        .replace_models(
            &ProviderAccountId::new("acct-local"),
            &[(
                ModelId::new("llama3.2"),
                "sha256:abc".to_string(),
                descriptor("llama3.2"),
            )],
        )
        .await
        .expect("replace models");

    let models = registry
        .list_models(&ProviderAccountId::new("acct-local"))
        .await
        .expect("list models");
    assert_eq!(models.len(), 1);
    assert_eq!(models[0].descriptor.model_id, ModelId::new("llama3.2"));
    assert_eq!(models[0].digest, "sha256:abc");
    assert_eq!(
        models[0].descriptor.capabilities.streaming,
        CapabilityStatus::Supported
    );
    let _ = pool;
}

#[tokio::test]
async fn valid_json_but_wrong_descriptor_shape_is_an_error_not_live_config() {
    let pool = create_sqlite_pool(&db_path()).await.expect("pool");
    let registry = ProviderRegistry::new(pool.clone());

    registry
        .upsert_account(&local_account("acct-local", "http://127.0.0.1:11434"))
        .await
        .expect("account");

    // valid JSON, wrong ModelDescriptor shape (private string for an enum)
    let bad = r#"{"model_id":"m","human_label":"m","privacy_class":"totally_unknown","capabilities":{"streaming":"supported","structured_output":"unknown","tool_proposals":"unknown","thinking":"unknown"}}"#;
    adham_event_log::upsert_provider_models(
        &pool,
        "acct-local",
        &[store::ProviderModelRow {
            account_id: "acct-local".into(),
            model_id: "m".into(),
            digest: "sha256:ok".into(),
            descriptor_json: bad.into(),
            verified_revision: 1,
        }],
    )
    .await
    .expect("storage accepts syntactically valid JSON");

    let err = registry
        .list_models(&ProviderAccountId::new("acct-local"))
        .await
        .expect_err("shape-validated read must fail");
    assert!(
        matches!(err, ProviderError::ProtocolParseError(_)),
        "corrupt descriptor must map to integrity/protocol error, got {err:?}"
    );
}

#[tokio::test]
async fn registry_sees_endpoint_invalidation_done_elsewhere() {
    let pool = create_sqlite_pool(&db_path()).await.expect("pool");
    let registry = ProviderRegistry::new(pool.clone());

    registry
        .upsert_account(&local_account("acct-local", "http://127.0.0.1:11434"))
        .await
        .expect("account");
    registry
        .replace_models(
            &ProviderAccountId::new("acct-local"),
            &[(
                ModelId::new("llama3.2"),
                "sha256:d".into(),
                descriptor("llama3.2"),
            )],
        )
        .await
        .expect("models");

    // first read caches; then a different writer invalidates (endpoint moved)
    adham_event_log::upsert_provider_account(
        &pool,
        &store::ProviderAccountRow {
            account_id: "acct-local".into(),
            kind: "ollama_local".into(),
            alias: "Local Ollama".into(),
            privacy_class: "local_only".into(),
            endpoint_id: "ep-ollama-local".into(),
            base_url: "http://127.0.0.1:9999".into(),
            approved_destination: true,
            status: "active".into(),
            created_at_us: 1,
            updated_at_us: 1,
        },
    )
    .await
    .expect("endpoint-moving account write");

    let models = registry
        .list_models(&ProviderAccountId::new("acct-local"))
        .await
        .expect("read after invalidation");
    assert!(
        models.is_empty(),
        "stale cache must be dropped once the registry revision moves"
    );
}
