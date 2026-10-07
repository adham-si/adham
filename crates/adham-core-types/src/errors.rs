use serde::{Deserialize, Serialize};
use thiserror::Error;
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum PublicErrorCode {
    InvalidProtocolVersion,
    InvalidRequest,
    PayloadTooLarge,
    RateLimited,
    WorkspaceNotFound,
    ProjectNotFound,
    SessionNotFound,
    ContextMismatch,
    RequestIdConflict,
    ConcurrencyConflict,
    StorageStarting,
    StorageUnavailable,
    StorageRepairRequired,
    ProjectionUnavailable,
    CommandTimedOut,
    InternalError,
}

#[derive(Debug, Error)]
pub enum DomainError {
    #[error("Workspace not found: {0}")]
    WorkspaceNotFound(String),

    #[error("Project not found: {0}")]
    ProjectNotFound(String),

    #[error("Session not found: {0}")]
    SessionNotFound(String),

    #[error("Context mismatch: {0}")]
    ContextMismatch(String),

    #[error("Request ID conflict: {0}")]
    RequestIdConflict(String),

    #[error("Concurrency conflict on stream {0}: expected sequence {1}, found {2}")]
    ConcurrencyConflict(String, u64, u64),

    #[error("Storage error: {0}")]
    Storage(String),

    #[error("Integrity error: {0}")]
    Integrity(String),

    #[error("Validation error: {0}")]
    Validation(String),
}
