use adham_provider::adapters::mock::MockProviderAdapter;
use adham_provider::domain::account::{PrivacyClass, ProviderAccountId};
use adham_provider::domain::endpoint::{EndpointDescriptor, EndpointId, ServiceKind};
use adham_provider::domain::error::ProviderError;
use adham_provider::domain::model::{ModelId, ModelSelectionSnapshot};
use adham_provider::domain::request::ProviderRequestV1;
use adham_provider::gateway::ProviderGateway;

#[test]
fn test_endpoint_loopback_validation() {
    // Valid loopback HTTP endpoints
    assert!(EndpointDescriptor::new(
        EndpointId::new("local-1"),
        "http://localhost:11434",
        ServiceKind::OllamaLocal,
    )
    .is_ok());

    assert!(EndpointDescriptor::new(
        EndpointId::new("local-2"),
        "http://127.0.0.1:11434",
        ServiceKind::OllamaLocal,
    )
    .is_ok());

    // Invalid non-loopback HTTP endpoint
    let res = EndpointDescriptor::new(
        EndpointId::new("remote-insecure"),
        "http://api.external.com",
        ServiceKind::OfficialCloudApi,
    );
    assert!(res.is_err());
    match res.unwrap_err() {
        ProviderError::EndpointPolicyViolation(msg) => {
            assert!(msg.contains("Plain HTTP is prohibited"));
        }
        err => panic!("Unexpected error: {err:?}"),
    }

    // Valid HTTPS cloud endpoint
    assert!(EndpointDescriptor::new(
        EndpointId::new("cloud-secure"),
        "https://api.openai.com/v1",
        ServiceKind::OfficialCloudApi,
    )
    .is_ok());
}

#[test]
fn test_privacy_class_boundary_enforcement() {
    let cloud_endpoint = EndpointDescriptor::new(
        EndpointId::new("cloud-ep"),
        "https://api.openai.com/v1",
        ServiceKind::OfficialCloudApi,
    )
    .expect("cloud endpoint");

    let mock_adapter = MockProviderAdapter::new(vec!["response".to_string()]);
    let gateway = ProviderGateway::new(cloud_endpoint, mock_adapter);

    // Requesting LocalOnly inference on a cloud endpoint must be rejected
    let local_only_req = ProviderRequestV1::simple_prompt(
        "op-1",
        ModelSelectionSnapshot {
            account_id: ProviderAccountId::new("acc-1"),
            endpoint_id: EndpointId::new("cloud-ep"),
            model_id: ModelId::new("llama3.2"),
            privacy_class: PrivacyClass::LocalOnly,
        },
        "Classified prompt",
    );

    let res = gateway.execute(&local_only_req);
    assert!(res.is_err());
    match res.unwrap_err() {
        ProviderError::PrivacyBoundaryViolation(msg) => {
            assert!(msg.contains("LocalOnly request prohibited"));
        }
        err => panic!("Unexpected error: {err:?}"),
    }

    // Requesting CloudStandard inference on cloud endpoint succeeds
    let cloud_req = ProviderRequestV1::simple_prompt(
        "op-2",
        ModelSelectionSnapshot {
            account_id: ProviderAccountId::new("acc-1"),
            endpoint_id: EndpointId::new("cloud-ep"),
            model_id: ModelId::new("gpt-4o"),
            privacy_class: PrivacyClass::CloudStandard,
        },
        "Public prompt",
    );

    let cloud_res = gateway.execute(&cloud_req);
    assert!(cloud_res.is_ok());
}
