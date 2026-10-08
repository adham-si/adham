use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CheckId(pub String);

impl CheckId {
    pub const BUILD: &'static str = "check.build";
    pub const TEST: &'static str = "check.test";
    pub const TYPECHECK: &'static str = "check.typecheck";
    pub const LINT: &'static str = "check.lint";
    pub const SCOPE: &'static str = "check.scope_preservation";
    pub const CONTRACT_DRIFT: &'static str = "check.contract_drift";

    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckKind {
    StructuralPredicate,
    CommandExecution,
    ContractDrift,
    ScopePreservation,
    LinterCheck,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CheckResultState {
    Passed,
    Failed,
    Blocked,
    Skipped,
    Stale,
    Invalid,
    NotApplicable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckDefinition {
    pub check_id: CheckId,
    pub kind: CheckKind,
    pub name: String,
    pub mandatory: bool,
    pub command_preview: Option<String>,
}

impl CheckDefinition {
    pub fn new(
        check_id: impl Into<String>,
        kind: CheckKind,
        name: impl Into<String>,
        mandatory: bool,
    ) -> Self {
        Self {
            check_id: CheckId::new(check_id),
            kind,
            name: name.into(),
            mandatory,
            command_preview: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CheckExecution {
    pub execution_id: String,
    pub check_id: CheckId,
    pub state: CheckResultState,
    pub evidence_id: Option<String>,
    pub explanation: String,
    pub duration_ms: u64,
}

impl CheckExecution {
    pub fn new(
        check_id: CheckId,
        state: CheckResultState,
        evidence_id: Option<String>,
        explanation: impl Into<String>,
        duration_ms: u64,
    ) -> Self {
        Self {
            execution_id: Uuid::now_v7().to_string(),
            check_id,
            state,
            evidence_id,
            explanation: explanation.into(),
            duration_ms,
        }
    }
}
