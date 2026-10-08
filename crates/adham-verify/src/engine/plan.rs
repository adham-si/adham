use crate::domain::check::{CheckDefinition, CheckId, CheckKind};
use crate::domain::contract::{CompletionContract, CompletionContractId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VerificationPlan {
    pub plan_id: String,
    pub contract_id: CompletionContractId,
    pub checks: Vec<CheckDefinition>,
}

impl VerificationPlan {
    pub fn new(contract_id: CompletionContractId, checks: Vec<CheckDefinition>) -> Self {
        Self {
            plan_id: Uuid::now_v7().to_string(),
            contract_id,
            checks,
        }
    }

    pub fn for_contract(contract: &CompletionContract) -> Self {
        let checks = vec![
            CheckDefinition::new(
                CheckId::BUILD,
                CheckKind::CommandExecution,
                "Build Verification",
                true,
            ),
            CheckDefinition::new(
                CheckId::TEST,
                CheckKind::CommandExecution,
                "Automated Test Suite",
                true,
            ),
            CheckDefinition::new(
                CheckId::TYPECHECK,
                CheckKind::CommandExecution,
                "Static Type Check",
                true,
            ),
            CheckDefinition::new(
                CheckId::LINT,
                CheckKind::LinterCheck,
                "Linter & Code Standards",
                false,
            ),
            CheckDefinition::new(
                CheckId::SCOPE,
                CheckKind::ScopePreservation,
                "Diff Scope Preservation",
                true,
            ),
        ];

        Self::new(contract.contract_id.clone(), checks)
    }
}
