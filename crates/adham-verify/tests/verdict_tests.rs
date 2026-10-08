mod common;

use adham_verify::domain::check::CheckId;
use adham_verify::domain::contract::{
    AcceptanceCriterion, CompletionContract, CriterionId, DeliveryMode,
};
use adham_verify::domain::finding::Finding;
use adham_verify::domain::verdict::VerificationVerdict;
use adham_verify::engine::evaluator::evaluate_verdict;
use common::{
    all_pass_inputs, failed_execution, fresh_evidence, mismatched_evidence, stale_evidence,
    test_deliverable, NOW_MS,
};

#[test]
fn test_deterministic_verdict_all_pass() {
    let (contract, deliverable, executions, evidences) = all_pass_inputs();
    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[],
        NOW_MS,
    );
    assert_eq!(verdict, VerificationVerdict::Pass);
    assert!(verdict.is_success());
}

#[test]
fn test_mandatory_check_failure() {
    let (contract, deliverable, mut executions, _) = all_pass_inputs();
    executions[1] = failed_execution(CheckId::TEST, "1 test failed");
    let evidences = vec![fresh_evidence(
        CheckId::BUILD,
        &deliverable.content_hash,
        "Build success",
    )];

    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[],
        NOW_MS,
    );
    assert!(matches!(verdict, VerificationVerdict::Fail { .. }));
    assert!(verdict.is_failure());
}

#[test]
fn test_missing_or_stale_evidence_blocks_completion() {
    let (contract, deliverable, executions, mut evidences) = all_pass_inputs();
    // Evidence for test check is stale (recorded 500s ago, TTL 60s).
    evidences[1] = stale_evidence(CheckId::TEST, &deliverable.content_hash, "Test success");

    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[],
        NOW_MS,
    );
    assert!(matches!(verdict, VerificationVerdict::Blocked { .. }));
    assert!(verdict.is_blocked());
}

#[test]
fn test_permitted_and_unpermitted_warnings() {
    let (mut contract, deliverable, executions, evidences) = all_pass_inputs();
    contract = contract.with_permitted_warning("W001_UNUSED_VAR");

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
        NOW_MS,
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
        NOW_MS,
    );
    assert!(matches!(v_fail, VerificationVerdict::Fail { .. }));
}

#[test]
fn test_error_finding_never_passes() {
    let (contract, deliverable, executions, evidences) = all_pass_inputs();
    let error_finding = Finding::error(
        CheckId::new(CheckId::BUILD),
        "E001_VERIFICATION_ERROR",
        "Checker reported an error",
    );
    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[error_finding],
        NOW_MS,
    );
    assert!(
        matches!(verdict, VerificationVerdict::Fail { .. }),
        "Error finding must fail verification, got: {verdict:?}"
    );
    assert!(!verdict.is_success());
}

#[test]
fn test_error_plus_permitted_warning_fails_with_error_diagnostics() {
    let (mut contract, deliverable, executions, evidences) = all_pass_inputs();
    contract = contract.with_permitted_warning("W001_UNUSED_VAR");

    let findings = vec![
        Finding::warning(
            CheckId::new(CheckId::BUILD),
            "W001_UNUSED_VAR",
            "Variable is unused",
            true,
        ),
        Finding::error(
            CheckId::new(CheckId::TEST),
            "E002_TEST_ERROR",
            "Test harness reported an error",
        ),
    ];
    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &findings,
        NOW_MS,
    );
    match &verdict {
        VerificationVerdict::Fail {
            reason,
            failed_checks,
        } => {
            assert!(
                reason.contains("E002_TEST_ERROR"),
                "reason must preserve the error code, got: {reason}"
            );
            assert!(
                failed_checks.iter().any(|c| c == CheckId::TEST),
                "failed_checks must carry the error check id, got: {failed_checks:?}"
            );
        }
        other => panic!("Error plus permitted warning must Fail, got: {other:?}"),
    }
    assert!(!verdict.is_success());
}

#[test]
fn test_error_plus_failed_mandatory_check_fails_with_both_details() {
    let (contract, deliverable, mut executions, _) = all_pass_inputs();
    executions[1] = failed_execution(CheckId::TEST, "1 test failed");
    let evidences = vec![fresh_evidence(
        CheckId::BUILD,
        &deliverable.content_hash,
        "Build success",
    )];

    let findings = vec![Finding::error(
        CheckId::new(CheckId::BUILD),
        "E001_BUILD_ERROR",
        "Build checker reported an error",
    )];
    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &findings,
        NOW_MS,
    );
    match &verdict {
        VerificationVerdict::Fail {
            reason,
            failed_checks,
        } => {
            assert!(
                failed_checks.iter().any(|c| c == CheckId::TEST),
                "failed_checks must keep the mandatory failure, got: {failed_checks:?}"
            );
            assert!(
                failed_checks.iter().any(|c| c == CheckId::BUILD),
                "failed_checks must keep the error check id, got: {failed_checks:?}"
            );
            assert!(
                reason.contains("E001_BUILD_ERROR"),
                "reason must preserve the error code, got: {reason}"
            );
        }
        other => panic!("Error plus failed check must Fail, got: {other:?}"),
    }
    assert!(!verdict.is_success());
}

#[test]
fn test_error_plus_blocked_evidence_stays_blocked_with_error_details() {
    let (contract, deliverable, executions, mut evidences) = all_pass_inputs();
    // Stale evidence for the test check keeps mandatory verification incomplete.
    evidences[1] = stale_evidence(CheckId::TEST, &deliverable.content_hash, "Test success");

    let findings = vec![Finding::error(
        CheckId::new(CheckId::BUILD),
        "E003_STALE_CONTEXT",
        "Checker error alongside stale evidence",
    )];
    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &findings,
        NOW_MS,
    );
    match &verdict {
        VerificationVerdict::Blocked {
            reason,
            blocked_checks,
        } => {
            assert!(
                !blocked_checks.is_empty(),
                "blocked_checks must keep the blockers"
            );
            assert!(
                reason.contains("E003_STALE_CONTEXT"),
                "reason must preserve the co-present error code, got: {reason}"
            );
        }
        other => panic!("Error plus blocked evidence must stay Blocked, got: {other:?}"),
    }
    assert!(!verdict.is_success());
}

#[test]
fn test_blocked_plus_failed_plus_error_preserves_all_diagnostics() {
    let (contract, deliverable, mut executions, _) = all_pass_inputs();
    // BUILD is blocked (stale evidence); TEST is a different failed check.
    executions[1] = failed_execution(CheckId::TEST, "1 test failed");
    let evidences = vec![stale_evidence(
        CheckId::BUILD,
        &deliverable.content_hash,
        "Build success",
    )];

    let findings = vec![Finding::error(
        CheckId::new(CheckId::BUILD),
        "E004_MIXED_SIGNALS",
        "Checker error alongside blocked and failed checks",
    )];
    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &findings,
        NOW_MS,
    );
    match &verdict {
        VerificationVerdict::Blocked {
            reason,
            blocked_checks,
        } => {
            assert!(
                blocked_checks.iter().any(|b| b.contains(CheckId::BUILD)),
                "blocked_checks must keep the blocker, got: {blocked_checks:?}"
            );
            assert!(
                reason.contains(CheckId::TEST),
                "reason must keep the failed check id, got: {reason}"
            );
            assert!(
                reason.contains("E004_MIXED_SIGNALS"),
                "reason must keep the error code, got: {reason}"
            );
        }
        other => panic!("Blocked plus failed plus error must stay Blocked, got: {other:?}"),
    }
    assert!(!verdict.is_success());
}

#[test]
fn test_wrong_candidate_evidence_blocks() {
    let (contract, deliverable, executions, mut evidences) = all_pass_inputs();
    // Evidence bound to a different candidate hash must not verify this one.
    evidences[0] = mismatched_evidence(CheckId::BUILD, "Build success");

    let verdict = evaluate_verdict(
        &contract,
        &deliverable,
        &executions,
        &evidences,
        &[],
        NOW_MS,
    );
    assert!(matches!(verdict, VerificationVerdict::Blocked { .. }));
    assert!(!verdict.is_success());
}

#[test]
fn test_empty_contract_blocks_in_all_delivery_modes() {
    // Policy: an empty verification contract cannot establish verified
    // completion, in any delivery mode. A draft may still be constructed.
    for mode in [
        DeliveryMode::ProposalOnly,
        DeliveryMode::ApplyAndVerify,
        DeliveryMode::ArtifactOnly,
    ] {
        let contract = CompletionContract::new("task-empty", mode);
        let deliverable = test_deliverable();
        let verdict = evaluate_verdict(&contract, &deliverable, &[], &[], &[], NOW_MS);
        assert!(
            matches!(verdict, VerificationVerdict::Blocked { .. }),
            "empty contract must Block in {mode:?}, got: {verdict:?}"
        );
        assert!(!verdict.is_success());
    }
}

#[test]
fn test_mandatory_criterion_without_check_ids_blocks() {
    let contract = CompletionContract::new("task-draft", DeliveryMode::ProposalOnly)
        .with_criterion(AcceptanceCriterion {
            criterion_id: CriterionId::new("crit-draft"),
            description: "Draft criterion, checks not yet assigned".to_string(),
            mandatory: true,
            check_ids: Vec::new(),
        });
    let deliverable = test_deliverable();

    let findings = vec![Finding::error(
        CheckId::new(CheckId::BUILD),
        "E005_DRAFT_ERROR",
        "Error alongside an incomplete draft contract",
    )];
    let verdict = evaluate_verdict(&contract, &deliverable, &[], &[], &findings, NOW_MS);
    match &verdict {
        VerificationVerdict::Blocked { reason, .. } => {
            assert!(
                reason.contains("E005_DRAFT_ERROR"),
                "reason must preserve co-present error details, got: {reason}"
            );
        }
        other => panic!("criterion without check ids must Block, got: {other:?}"),
    }
    assert!(!verdict.is_success());
}
