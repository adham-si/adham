use adham_verify::domain::check::{CheckExecution, CheckId, CheckResultState};
use adham_verify::domain::contract::{
    AcceptanceCriterion, CompletionContract, CriterionId, DeliveryMode,
};
use adham_verify::domain::deliverable::CandidateDeliverable;
use adham_verify::domain::evidence::EvidenceRecord;
use adham_verify::domain::finding::Finding;
use adham_verify::domain::verdict::VerificationVerdict;
use adham_verify::engine::evaluator::evaluate_verdict;

fn setup_base_contract_and_deliverable() -> (CompletionContract, CandidateDeliverable) {
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

    let deliverable =
        CandidateDeliverable::new_patch(vec!["src/lib.rs".to_string()], "pub fn hello() {}", None);

    (contract, deliverable)
}

#[test]
fn test_deterministic_verdict_all_pass() {
    let (contract, deliverable) = setup_base_contract_and_deliverable();
    let now_ms = 1_000_000;

    let executions = vec![
        CheckExecution::new(
            CheckId::new(CheckId::BUILD),
            CheckResultState::Passed,
            Some("ev-1".to_string()),
            "Build clean",
            100,
        ),
        CheckExecution::new(
            CheckId::new(CheckId::TEST),
            CheckResultState::Passed,
            Some("ev-2".to_string()),
            "Tests 10/10 passed",
            200,
        ),
    ];

    let evidences = vec![
        EvidenceRecord::new(
            CheckId::new(CheckId::BUILD),
            &deliverable.content_hash,
            1,
            Some(0),
            "Build success",
            now_ms,
            60_000,
        ),
        EvidenceRecord::new(
            CheckId::new(CheckId::TEST),
            &deliverable.content_hash,
            1,
            Some(0),
            "Test success",
            now_ms,
            60_000,
        ),
    ];

    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[],
        now_ms,
    );
    assert_eq!(verdict, VerificationVerdict::Pass);
    assert!(verdict.is_success());
}

#[test]
fn test_mandatory_check_failure() {
    let (contract, deliverable) = setup_base_contract_and_deliverable();
    let now_ms = 1_000_000;

    let executions = vec![
        CheckExecution::new(
            CheckId::new(CheckId::BUILD),
            CheckResultState::Passed,
            Some("ev-1".to_string()),
            "Build clean",
            100,
        ),
        CheckExecution::new(
            CheckId::new(CheckId::TEST),
            CheckResultState::Failed,
            None,
            "1 test failed",
            200,
        ),
    ];

    let evidences = vec![EvidenceRecord::new(
        CheckId::new(CheckId::BUILD),
        &deliverable.content_hash,
        1,
        Some(0),
        "Build success",
        now_ms,
        60_000,
    )];

    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[],
        now_ms,
    );
    assert!(matches!(verdict, VerificationVerdict::Fail { .. }));
    assert!(verdict.is_failure());
}

#[test]
fn test_missing_or_stale_evidence_blocks_completion() {
    let (contract, deliverable) = setup_base_contract_and_deliverable();
    let now_ms = 1_000_000;

    let executions = vec![
        CheckExecution::new(
            CheckId::new(CheckId::BUILD),
            CheckResultState::Passed,
            Some("ev-1".to_string()),
            "Build clean",
            100,
        ),
        CheckExecution::new(
            CheckId::new(CheckId::TEST),
            CheckResultState::Passed,
            Some("ev-2".to_string()),
            "Tests passed",
            200,
        ),
    ];

    // Evidence for test check is stale (recorded 500s ago, TTL 60s)
    let evidences = vec![
        EvidenceRecord::new(
            CheckId::new(CheckId::BUILD),
            &deliverable.content_hash,
            1,
            Some(0),
            "Build success",
            now_ms,
            60_000,
        ),
        EvidenceRecord::new(
            CheckId::new(CheckId::TEST),
            &deliverable.content_hash,
            1,
            Some(0),
            "Test success",
            now_ms - 500_000,
            60_000,
        ),
    ];

    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[],
        now_ms,
    );
    assert!(matches!(verdict, VerificationVerdict::Blocked { .. }));
    assert!(verdict.is_blocked());
}

#[test]
fn test_permitted_and_unpermitted_warnings() {
    let (mut contract, deliverable) = setup_base_contract_and_deliverable();
    contract = contract.with_permitted_warning("W001_UNUSED_VAR");
    let now_ms = 1_000_000;

    let executions = vec![
        CheckExecution::new(
            CheckId::new(CheckId::BUILD),
            CheckResultState::Passed,
            Some("ev-1".to_string()),
            "Build clean",
            100,
        ),
        CheckExecution::new(
            CheckId::new(CheckId::TEST),
            CheckResultState::Passed,
            Some("ev-2".to_string()),
            "Tests passed",
            200,
        ),
    ];

    let evidences = vec![
        EvidenceRecord::new(
            CheckId::new(CheckId::BUILD),
            &deliverable.content_hash,
            1,
            Some(0),
            "Build success",
            now_ms,
            60_000,
        ),
        EvidenceRecord::new(
            CheckId::new(CheckId::TEST),
            &deliverable.content_hash,
            1,
            Some(0),
            "Test success",
            now_ms,
            60_000,
        ),
    ];

    // 1. Permitted warning
    let permitted_finding = Finding::warning(
        CheckId::new(CheckId::BUILD),
        "W001_UNUSED_VAR",
        "Variable is unused",
        true,
    );
    let v_warn = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[permitted_finding],
        now_ms,
    );
    assert!(matches!(
        v_warn,
        VerificationVerdict::PassWithPermittedWarnings {
            warnings_count: 1,
            ..
        }
    ));

    // 2. Unpermitted warning causes failure
    let unpermitted_finding = Finding::warning(
        CheckId::new(CheckId::BUILD),
        "W999_SECURITY_WARN",
        "Potentially unsafe call",
        false,
    );
    let v_fail = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[unpermitted_finding],
        now_ms,
    );
    assert!(matches!(v_fail, VerificationVerdict::Fail { .. }));
}
