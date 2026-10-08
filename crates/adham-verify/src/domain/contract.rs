use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CompletionContractId(pub String);

impl CompletionContractId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for CompletionContractId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeliveryMode {
    ProposalOnly,
    ApplyAndVerify,
    ArtifactOnly,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CriterionId(pub String);

impl CriterionId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AcceptanceCriterion {
    pub criterion_id: CriterionId,
    pub description: String,
    pub mandatory: bool,
    pub check_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CompletionContract {
    pub contract_id: CompletionContractId,
    pub task_id: String,
    pub revision: u32,
    pub delivery_mode: DeliveryMode,
    pub criteria: Vec<AcceptanceCriterion>,
    pub permitted_warning_codes: Vec<String>,
}

impl CompletionContract {
    pub fn new(task_id: impl Into<String>, delivery_mode: DeliveryMode) -> Self {
        Self {
            contract_id: CompletionContractId::new(),
            task_id: task_id.into(),
            revision: 1,
            delivery_mode,
            criteria: Vec::new(),
            permitted_warning_codes: Vec::new(),
        }
    }

    pub fn with_criterion(mut self, criterion: AcceptanceCriterion) -> Self {
        self.criteria.push(criterion);
        self
    }

    pub fn with_permitted_warning(mut self, code: impl Into<String>) -> Self {
        self.permitted_warning_codes.push(code.into());
        self
    }

    pub fn mandatory_criteria(&self) -> impl Iterator<Item = &AcceptanceCriterion> {
        self.criteria.iter().filter(|c| c.mandatory)
    }
}
