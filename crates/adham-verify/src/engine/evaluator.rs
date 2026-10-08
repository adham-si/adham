use crate::domain::check::{CheckExecution, CheckResultState};
use crate::domain::contract::{AcceptanceCriterion, CompletionContract};
use crate::domain::deliverable::CandidateDeliverable;
use crate::domain::evidence::EvidenceRecord;
use crate::domain::finding::{Finding, FindingSeverity};
use crate::domain::verdict::VerificationVerdict;

pub fn evaluate_verdict(
    contract: &CompletionContract,
    deliverable: &CandidateDeliverable,
    executions: &[CheckExecution],
    evidences: &[EvidenceRecord],
    findings: &[Finding],
    now_ms: u64,
) -> VerificationVerdict {
    let mut failed_checks = Vec::new();
    let mut blocked_checks = Vec::new();

    // 1. Evaluate mandatory criteria
    for criterion in contract.mandatory_criteria() {
        for check_id in &criterion.check_ids {
            let exec = executions.iter().find(|e| e.check_id.as_str() == check_id);
            let Some(exec) = exec else {
                blocked_checks.push(format!("{check_id}: missing execution"));
                continue;
            };

            match exec.state {
                CheckResultState::Passed => {
                    // Verify supporting evidence exists, matches deliverable, and is fresh
                    let ev = evidences.iter().find(|ev| ev.check_id.as_str() == check_id);
                    match ev {
                        Some(ev) => {
                            if !ev.matches_candidate(&deliverable.content_hash) {
                                blocked_checks.push(format!("{check_id}: candidate hash mismatch"));
                            } else if !ev.is_fresh(now_ms) {
                                blocked_checks.push(format!("{check_id}: evidence is stale"));
                            }
                        }
                        None => {
                            blocked_checks.push(format!("{check_id}: missing evidence record"));
                        }
                    }
                }
                CheckResultState::Failed => {
                    failed_checks.push(check_id.clone());
                }
                CheckResultState::Blocked
                | CheckResultState::Skipped
                | CheckResultState::Stale
                | CheckResultState::Invalid => {
                    blocked_checks.push(format!("{check_id}: state {:?}", exec.state));
                }
                CheckResultState::NotApplicable => {
                    // Mandatory check marked NotApplicable without explicit proof blocks completion
                    blocked_checks.push(format!(
                        "{check_id}: mandatory check cannot be not-applicable"
                    ));
                }
            }
        }
    }

    // 2. Collect error findings before choosing the verdict so their
    // diagnostics survive every non-success outcome.
    let error_findings: Vec<&Finding> = findings
        .iter()
        .filter(|f| f.severity == FindingSeverity::Error)
        .collect();
    let error_details: Vec<String> = error_findings
        .iter()
        .map(|f| format!("{}({})", f.code, f.check_id.as_str()))
        .collect();

    // 3. An empty verification contract cannot establish verified completion,
    // in any delivery mode. A draft contract may still be constructed; it
    // just cannot pass verification.
    let mandatory: Vec<&AcceptanceCriterion> = contract.mandatory_criteria().collect();
    let mut contract_gaps: Vec<String> = Vec::new();
    if mandatory.is_empty() {
        contract_gaps.push("contract: no mandatory criteria".to_string());
    } else {
        for criterion in &mandatory {
            if criterion.check_ids.is_empty() {
                contract_gaps.push(format!(
                    "criterion {}: no check ids",
                    criterion.criterion_id.0
                ));
            }
        }
    }
    if !contract_gaps.is_empty() {
        let mut reason = "Mandatory contract incomplete".to_string();
        if !error_details.is_empty() {
            reason.push_str(&format!("; error findings present: {error_details:?}"));
        }
        return VerificationVerdict::Blocked {
            reason,
            blocked_checks: contract_gaps,
        };
    }

    // 4. Deduplicated failed check IDs, reused by both non-success reasons.
    failed_checks.sort();
    failed_checks.dedup();

    // 5. Blocked takes precedence over verdict pass; keeping that precedence
    // avoids an unrelated lifecycle change. Failed check IDs and co-present
    // errors stay visible in the reason while blocked_checks keeps blockers.
    if !blocked_checks.is_empty() {
        let mut reason = "Mandatory check blocked, missing, or stale".to_string();
        if !failed_checks.is_empty() {
            reason.push_str(&format!("; failed checks: {failed_checks:?}"));
        }
        if !error_details.is_empty() {
            reason.push_str(&format!("; error findings present: {error_details:?}"));
        }
        return VerificationVerdict::Blocked {
            reason,
            blocked_checks,
        };
    }

    // 6. Failed checks and error findings both fail; failed_checks carries
    // the deduplicated union of both check-id sets.
    let has_failed_checks = !failed_checks.is_empty();
    if has_failed_checks || !error_findings.is_empty() {
        let mut failed: Vec<String> = failed_checks;
        for f in &error_findings {
            let id = f.check_id.as_str().to_string();
            if !failed.contains(&id) {
                failed.push(id);
            }
        }
        let mut reason = if has_failed_checks {
            "One or more mandatory checks failed".to_string()
        } else {
            "Error findings present".to_string()
        };
        if !error_details.is_empty() {
            reason.push_str(&format!("; error findings present: {error_details:?}"));
        }
        return VerificationVerdict::Fail {
            reason,
            failed_checks: failed,
        };
    }

    // 5. Evaluate findings / warnings
    let unpermitted_warnings: Vec<&Finding> = findings
        .iter()
        .filter(|f| {
            f.severity == FindingSeverity::Warning
                && !contract.permitted_warning_codes.contains(&f.code)
        })
        .collect();

    if !unpermitted_warnings.is_empty() {
        return VerificationVerdict::Fail {
            reason: format!(
                "Unpermitted warnings found: {:?}",
                unpermitted_warnings
                    .iter()
                    .map(|w| &w.code)
                    .collect::<Vec<_>>()
            ),
            failed_checks: Vec::new(),
        };
    }

    let permitted_warnings: Vec<&Finding> = findings
        .iter()
        .filter(|f| {
            f.severity == FindingSeverity::Warning
                && contract.permitted_warning_codes.contains(&f.code)
        })
        .collect();

    if !permitted_warnings.is_empty() {
        return VerificationVerdict::PassWithPermittedWarnings {
            warnings_count: permitted_warnings.len(),
            summary: format!(
                "Passed with {} permitted warnings",
                permitted_warnings.len()
            ),
        };
    }

    VerificationVerdict::Pass
}
