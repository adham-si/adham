use crate::domain::error::ProviderError;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct EndpointId(pub String);

impl EndpointId {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }
}

impl fmt::Display for EndpointId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ServiceKind {
    OllamaLocal,
    OllamaCloud,
    OfficialCloudApi,
    SelfHosted,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct EndpointDescriptor {
    pub endpoint_id: EndpointId,
    pub base_url: String,
    pub service_kind: ServiceKind,
}

impl EndpointDescriptor {
    pub fn new(
        endpoint_id: EndpointId,
        base_url: impl Into<String>,
        service_kind: ServiceKind,
    ) -> Result<Self, ProviderError> {
        let url = base_url.into();
        Self::validate_url(&url)?;
        Ok(Self {
            endpoint_id,
            base_url: url,
            service_kind,
        })
    }

    /// Validates that HTTP is only permitted for loopback addresses,
    /// and that remote endpoints strictly require HTTPS.
    pub fn validate_url(url: &str) -> Result<(), ProviderError> {
        let lower = url.to_lowercase();
        if lower.starts_with("http://") {
            let without_proto = &lower["http://".len()..];
            let host_part = without_proto.split(['/', ':']).next().unwrap_or("");
            let is_loopback = host_part == "localhost"
                || host_part == "127.0.0.1"
                || host_part == "[::1]"
                || host_part == "0.0.0.0";

            if !is_loopback {
                return Err(ProviderError::EndpointPolicyViolation(format!(
                    "Plain HTTP is prohibited for non-loopback endpoint: '{url}'"
                )));
            }
        } else if !lower.starts_with("https://") {
            return Err(ProviderError::EndpointPolicyViolation(format!(
                "Endpoint must use HTTPS or loopback HTTP: '{url}'"
            )));
        }

        Ok(())
    }
}
