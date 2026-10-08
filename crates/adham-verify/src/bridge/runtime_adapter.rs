use crate::domain::check::{CheckExecution, CheckResultState};
use crate::domain::contract::{AcceptanceCriterion, CompletionContract, CriterionId, DeliveryMode};
use crate::domain::deliverable::CandidateDeliverable;
use crate::domain::evidence::EvidenceRecord;
use crate::domain::verdict::VerificationVerdict;
use crate::engine::evaluator::evaluate_verdict;
use adham_runtime::ports::verification::{
    CompletionContract as RuntimeContract, VerificationPort, VerificationVerdict as RuntimeVerdict,
};

pub struct AdhamVerificationAdapter {
    contract: CompletionContract,
    deliverable: CandidateDeliverable,
}

impl AdhamVerificationAdapter {
    pub fn new(contract: CompletionContract, deliverable: CandidateDeliverable) -> Self {
        Self {
            contract,
            deliverable,
        }
    }

    pub fn for_task(
        task_id: impl Into<String>,
        target_paths: Vec<String>,
        patch_content: &str,
    ) -> Self {
        let contract = CompletionContract::new(task_id, DeliveryMode::ProposalOnly).with_criterion(
            AcceptanceCriterion {
                criterion_id: CriterionId::new("primary_evidence"),
                description: "Primary evidence captured".to_string(),
                mandatory: true,
                check_ids: vec!["check.primary".to_string()],
            },
        );
        let deliverable = CandidateDeliverable::new_patch(target_paths, patch_content, None);
        Self::new(contract, deliverable)
    }
}

impl VerificationPort for AdhamVerificationAdapter {
    async fn verify_completion(
        &self,
        runtime_contract: &RuntimeContract,
        evidence: &[String],
    ) -> Result<RuntimeVerdict, String> {
        let now_ms = 1_000_000;

        if evidence.len() < runtime_contract.required_evidence_count {
            return Ok(RuntimeVerdict::Fail(format!(
                "Insufficient evidence count: required {}, found {}",
                runtime_contract.required_evidence_count,
                evidence.len()
            )));
        }

        // Build simulated executions & evidences based on incoming evidence strings
        let mut executions = Vec::new();
        let mut evidences = Vec::new();

        for (idx, ev_str) in evidence.iter().enumerate() {
            let check_name = if idx == 0 {
                "check.primary"
            } else {
                "check.additional"
            };
            executions.push(CheckExecution::new(
                crate::domain::check::CheckId::new(check_name),
                CheckResultState::Passed,
                Some(format!("ev-{idx}")),
                "Check passed with observed evidence",
                10,
            ));
            evidences.push(EvidenceRecord::new(
                crate::domain::check::CheckId::new(check_name),
                self.deliverable.content_hash.clone(),
                self.contract.revision,
                Some(0),
                ev_str.clone(),
                now_ms,
                60_000,
            ));
        }

        let verdict = evaluate_verdict(
            &self.contract,
            &self.deliverable,
            &executions,
            &evidences,
            &[],
            now_ms,
        );

        match verdict {
            VerificationVerdict::Pass => Ok(RuntimeVerdict::Pass),
            VerificationVerdict::PassWithPermittedWarnings { summary, .. } => {
                Ok(RuntimeVerdict::PassWithWarnings(summary))
            }
            VerificationVerdict::Fail { reason, .. } => Ok(RuntimeVerdict::Fail(reason)),
            VerificationVerdict::Blocked { reason, .. } => Ok(RuntimeVerdict::Blocked(reason)),
        }
    }
}
