use crate::domain::check::CheckId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FindingId(pub String);

impl FindingId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for FindingId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FindingSeverity {
    Error,
    Warning,
    Info,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Finding {
    pub finding_id: FindingId,
    pub check_id: CheckId,
    pub code: String,
    pub message: String,
    pub severity: FindingSeverity,
    pub permitted: bool,
}

impl Finding {
    pub fn error(check_id: CheckId, code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            finding_id: FindingId::new(),
            check_id,
            code: code.into(),
            message: message.into(),
            severity: FindingSeverity::Error,
            permitted: false,
        }
    }

    pub fn warning(
        check_id: CheckId,
        code: impl Into<String>,
        message: impl Into<String>,
        permitted: bool,
    ) -> Self {
        Self {
            finding_id: FindingId::new(),
            check_id,
            code: code.into(),
            message: message.into(),
            severity: FindingSeverity::Warning,
            permitted,
        }
    }
}
