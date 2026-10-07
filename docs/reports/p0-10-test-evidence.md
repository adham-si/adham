# P0-10 Verification Gate & Evidence-Backed Completion Contract Evidence Report

**Specification:** [`docs/spec/p0/P0-10 — Verification gate and evidence-backed completion contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-10%20%E2%80%94%20Verification%20gate%20and%20evidence-backed%20completion%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-10-verification-gate-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-10-verification-gate-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Verification Gate & Evidence-Backed Completion Contract** milestone (P0-10).

P0-10 establishes Adham's trusted verification gate subsystem (`adham-verify`):
- **Completion is a Trusted Determination, Not a Model Assertion:** Models propose completion; only trusted verification engines evaluate observable evidence and determine success.
- **Contract & Delivery Modes:** Explicit support for `ProposalOnly` (verifying patches against candidate baseline without modifying user workspace), `ApplyAndVerify` (verifying broker-applied filesystem changes), and `ArtifactOnly`.
- **Deterministic Verdict Calculation:**
  - `Pass`: Every mandatory acceptance criterion is satisfied by fresh, valid, matching evidence.
  - `PassWithPermittedWarnings`: All mandatory criteria satisfied; only explicitly permitted optional warnings exist.
  - `Fail`: Applicable evidence contradicts at least one mandatory requirement or contains unpermitted warnings.
  - `Blocked`: Mandatory evidence is missing, stale, invalid, or check was blocked/skipped.
- **Runtime Bridge:** `AdhamVerificationAdapter` bridges directly to `adham-runtime`'s `VerificationPort`, governing agent driver execution loops and terminal state transitions.

---

## 2. Verified Invariants & Test Scenarios

### 1. Deterministic Verdict Evaluation (All Pass)
- **Verified in `test_deterministic_verdict_all_pass` (`verdict_tests.rs`):**
  - Evaluates mandatory criteria across multiple checks (`check.build`, `check.test`).
  - Correlates check executions with cryptographically matching evidence records.
  - Verifies that fresh evidence records with `exit_code: Some(0)` yield `VerificationVerdict::Pass`.

### 2. Mandatory Check Failure
- **Verified in `test_mandatory_check_failure` (`verdict_tests.rs`):**
  - If any mandatory check fails (e.g. failing unit tests), the verdict deterministically transitions to `VerificationVerdict::Fail`.
  - Captures the exact list of failing checks for remediation without suppressing errors.

### 3. Evidence Freshness & Integrity Enforcement
- **Verified in `test_missing_or_stale_evidence_blocks_completion` (`verdict_tests.rs`):**
  - If evidence was recorded beyond the declared TTL (stale evidence), completion is strictly blocked (`VerificationVerdict::Blocked`).
  - Missing evidence records for mandatory checks block completion rather than assuming implicit success.
  - Candidate hash mismatches (evidence collected against a different deliverable revision) block completion.

### 4. Permitted vs. Unpermitted Warning Policy
- **Verified in `test_permitted_and_unpermitted_warnings` (`verdict_tests.rs`):**
  - Warnings present in `contract.permitted_warning_codes` result in `VerificationVerdict::PassWithPermittedWarnings`.
  - Unpermitted warnings cause the verdict to fail with `VerificationVerdict::Fail`.

### 5. Runtime Driver Integration
- **Verified in `test_verification_adapter_runtime_driver_integration` (`runtime_bridge_tests.rs`):**
  - Connects `AdhamVerificationAdapter` to `AgentDriver` from `adham-runtime`.
  - Executes a single-agent turn where candidate code is submitted, evidence is validated, and the driver terminates with `RunLifecycle::Terminal` and `TerminalOutcome::Completed`.

---

## 3. Test & Governance Results

- **Verification Gate Tests (`adham-verify`):** **5/5 passed.**
  - `verdict_tests.rs`: 4/4 passed.
  - `runtime_bridge_tests.rs`: 1/1 passed.
- **Full Rust Workspace (`cargo test --workspace`):** **94/94 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All files in `adham-verify` strictly `<120` lines.
- **Formatters & Linters:** `cargo fmt --check` clean.
