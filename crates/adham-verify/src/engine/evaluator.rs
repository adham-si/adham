use crate::domain::check::{CheckExecution, CheckResultState};
use crate::domain::contract::CompletionContract;
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

    // 2. Blocked takes precedence over verdict pass
    if !blocked_checks.is_empty() {
        return VerificationVerdict::Blocked {
            reason: "Mandatory check blocked, missing, or stale".to_string(),
            blocked_checks,
        };
    }

    // 3. Failed checks
    if !failed_checks.is_empty() {
        return VerificationVerdict::Fail {
            reason: "One or more mandatory checks failed".to_string(),
            failed_checks,
        };
    }

    // 4. Evaluate findings / warnings
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
