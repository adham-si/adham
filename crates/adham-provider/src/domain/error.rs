use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderError {
    #[error("Privacy boundary violation: {0}")]
    PrivacyBoundaryViolation(String),

    #[error("Endpoint policy violation: {0}")]
    EndpointPolicyViolation(String),

    #[error("Model capability mismatch: {0}")]
    ModelCapabilityMismatch(String),

    #[error("Protocol parse error: {0}")]
    ProtocolParseError(String),

    #[error("Transport error: {0}")]
    TransportError(String),

    #[error("Rate limit exceeded: {0}")]
    RateLimitExceeded(String),

    #[error("Authentication error: {0}")]
    AuthenticationError(String),
}
