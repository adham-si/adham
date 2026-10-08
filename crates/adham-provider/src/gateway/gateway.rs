use crate::adapters::mock::MockProviderAdapter;
use crate::domain::account::PrivacyClass;
use crate::domain::endpoint::EndpointDescriptor;
use crate::domain::error::ProviderError;
use crate::domain::request::ProviderRequestV1;
use crate::domain::stream::NormalizedStreamEvent;
use adham_runtime::ports::model::{ModelPort, ModelResponse};

pub struct ProviderGateway {
    endpoint: EndpointDescriptor,
    adapter: MockProviderAdapter,
}

impl ProviderGateway {
    pub fn new(endpoint: EndpointDescriptor, adapter: MockProviderAdapter) -> Self {
        Self { endpoint, adapter }
    }

    /// Dispatches a provider request through policy verification and adapter execution.
    pub fn execute(
        &self,
        request: &ProviderRequestV1,
    ) -> Result<Vec<NormalizedStreamEvent>, ProviderError> {
        // Enforce privacy class boundary
        if request.model_selection.privacy_class == PrivacyClass::LocalOnly {
            let lower = self.endpoint.base_url.to_lowercase();
            let is_loopback = lower.contains("localhost")
                || lower.contains("127.0.0.1")
                || lower.contains("[::1]");

            if !is_loopback {
                return Err(ProviderError::PrivacyBoundaryViolation(format!(
                    "LocalOnly request prohibited from targeting non-loopback endpoint: '{}'",
                    self.endpoint.base_url
                )));
            }
        }

        self.adapter.execute_stream(request)
    }
}

impl ModelPort for ProviderGateway {
    async fn request_completion(&self, prompt: &str) -> Result<ModelResponse, String> {
        use crate::domain::account::{PrivacyClass, ProviderAccountId};
        use crate::domain::model::{ModelId, ModelSelectionSnapshot};

        let req = ProviderRequestV1::simple_prompt(
            "gateway_completion_op",
            ModelSelectionSnapshot {
                account_id: ProviderAccountId::new("default-local"),
                endpoint_id: self.endpoint.endpoint_id.clone(),
                model_id: ModelId::new("local-default-model"),
                privacy_class: PrivacyClass::LocalOnly,
            },
            prompt,
        );

        let events = self.execute(&req).map_err(|e| e.to_string())?;

        let mut aggregated_text = String::new();
        let mut tokens_used = 0;

        for event in events {
            match event {
                NormalizedStreamEvent::TextDelta(delta) => {
                    aggregated_text.push_str(&delta);
                }
                NormalizedStreamEvent::Progress(usage) => {
                    tokens_used = usage.total_tokens;
                }
                _ => {}
            }
        }

        Ok(ModelResponse {
            text: aggregated_text,
            tokens_used: if tokens_used > 0 { tokens_used } else { 1 },
        })
    }
}
