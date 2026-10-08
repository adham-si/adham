//! Shared verdict-test fixtures: one green-path world plus small builders.
//! Every helper mirrors the production constructors with fixed, reviewable
//! values so individual tests stay a few lines long.

use adham_verify::domain::check::{CheckExecution, CheckId, CheckResultState};
use adham_verify::domain::contract::{
    AcceptanceCriterion, CompletionContract, CriterionId, DeliveryMode,
};
use adham_verify::domain::deliverable::CandidateDeliverable;
use adham_verify::domain::evidence::EvidenceRecord;

pub const NOW_MS: u64 = 1_000_000;
const TTL_MS: u64 = 60_000;
const STALE_AGE_MS: u64 = 500_000;
const WRONG_HASH: &str = "deadbeef-wrong-candidate";

pub fn test_deliverable() -> CandidateDeliverable {
    CandidateDeliverable::new_patch(vec!["src/lib.rs".to_string()], "pub fn hello() {}", None)
}

pub fn base_contract_and_deliverable() -> (CompletionContract, CandidateDeliverable) {
    let contract = CompletionContract::new("task-123", DeliveryMode::ProposalOnly)
        .with_criterion(AcceptanceCriterion {
            criterion_id: CriterionId::new("crit-build"),
            description: "Must compile cleanly".to_string(),
            mandatory: true,
            check_ids: vec![CheckId::BUILD.to_string()],
        })
        .with_criterion(AcceptanceCriterion {
            criterion_id: CriterionId::new("crit-test"),
            description: "Must pass tests".to_string(),
            mandatory: true,
            check_ids: vec![CheckId::TEST.to_string()],
        });
    (contract, test_deliverable())
}

pub fn passed_execution(check: &str, evidence_tag: &str, detail: &str) -> CheckExecution {
    CheckExecution::new(
        CheckId::new(check),
        CheckResultState::Passed,
        Some(evidence_tag.to_string()),
        detail,
        100,
    )
}

pub fn failed_execution(check: &str, detail: &str) -> CheckExecution {
    CheckExecution::new(
        CheckId::new(check),
        CheckResultState::Failed,
        None,
        detail,
        200,
    )
}

pub fn fresh_evidence(check: &str, content_hash: &str, label: &str) -> EvidenceRecord {
    EvidenceRecord::new(
        CheckId::new(check),
        content_hash,
        1,
        Some(0),
        label,
        NOW_MS,
        TTL_MS,
    )
}

pub fn stale_evidence(check: &str, content_hash: &str, label: &str) -> EvidenceRecord {
    EvidenceRecord::new(
        CheckId::new(check),
        content_hash,
        1,
        Some(0),
        label,
        NOW_MS - STALE_AGE_MS,
        TTL_MS,
    )
}

pub fn mismatched_evidence(check: &str, label: &str) -> EvidenceRecord {
    EvidenceRecord::new(
        CheckId::new(check),
        WRONG_HASH,
        1,
        Some(0),
        label,
        NOW_MS,
        TTL_MS,
    )
}

/// Full green-path world: two mandatory checks passed with fresh evidence.
pub fn all_pass_inputs() -> (
    CompletionContract,
    CandidateDeliverable,
    Vec<CheckExecution>,
    Vec<EvidenceRecord>,
) {
    let (contract, deliverable) = base_contract_and_deliverable();
    let executions = vec![
        passed_execution(CheckId::BUILD, "ev-1", "Build clean"),
        passed_execution(CheckId::TEST, "ev-2", "Tests 10/10 passed"),
    ];
    let evidences = vec![
        fresh_evidence(CheckId::BUILD, &deliverable.content_hash, "Build success"),
        fresh_evidence(CheckId::TEST, &deliverable.content_hash, "Test success"),
    ];
    (contract, deliverable, executions, evidences)
}
