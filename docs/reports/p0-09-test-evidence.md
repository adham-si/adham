# P0-09 Tools, Policy, and Sandbox Execution Contract Evidence Report

**Specification:** [`docs/spec/p0/P0-09 — Tools, policy, and sandbox execution contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-09%20%E2%80%94%20Tools,%20policy,%20and%20sandbox%20execution%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-09-tools-policy-sandbox-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-09-tools-policy-sandbox-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Tools, Policy, and Sandbox Execution Contract** milestone (P0-09).

P0-09 establishes Adham's governed tool execution engine (`adham-tools`):
- **Models Propose, They Never Authorize:** Actions are proposed as untrusted `ToolProposal` objects, strictly normalized, evaluated against immutable security invariants, and granted scoped capabilities before dispatch.
- **Controlled Toolset:**
  1. `project.read_text`: Bounded brokered read (max 256 KiB excerpt, 8 MiB file) with path traversal and alternate data stream hardening.
  2. `project.propose_patch`: Protected patch artifact creation without mutating user files.
  3. `project.apply_patch`: Atomic per-file replacement with strict cryptographic content hash preconditions.
  4. `project.run_process`: Structured argv execution in an isolated staging workspace with environment stripped of API keys, SSH keys, and cloud credentials.
- **Policy Hierarchy:** Hard denials (path traversal, sensitive files `.env`, `.git/config`, shells, network egress tools) unconditionally override any approval or autonomous preset.
- **Single-Use Grants & Concurrency Bounds:** Grants cannot be consumed twice for `Once` approvals; scheduler strictly bounds concurrent reads (max 4), mutations (max 1), and processes (max 1).

---

## 2. Verified Invariants & Test Scenarios

### 1. Proposal Normalization & Shell Interpretation Prohibition
- **Verified in `test_proposal_normalization_and_shell_prohibition` (`policy_tests.rs`):**
  - Attempts to pass shell binaries (`cmd.exe`, `powershell.exe`, `pwsh`, `sh`, `bash`, `zsh`) are rejected during normalization with `ProposalError::ShellForbidden`.
  - Structured binary calls (`cargo test`) normalize cleanly into structured `NormalizedAction::RunProcess`.

### 2. Hard Denials Override Autonomous Presets
- **Verified in `test_hard_denials_override_approval` (`policy_tests.rs`):**
  - Path traversal sequences (`../../../etc/passwd`) are denied with code `PATH_TRAVERSAL_PROHIBITED` even under `Autonomous` preset.
  - Access to sensitive files (`.env`, `.git/config`, `id_rsa`) is denied with code `SENSITIVE_FILE_RESTRICTED`.

### 3. Filesystem Broker: Bounded Reads & Path Traversal Rejection
- **Verified in `test_brokered_read_happy_path_and_bounds` & `test_brokered_read_rejects_path_traversal` (`broker_tests.rs`):**
  - Authorized reads within the project root succeed.
  - Bounded reads respect `offset` and `length` slices.
  - Files larger than 256 KiB are strictly capped at `MAX_READ_BYTES`.
  - Colon syntax (`C:/Windows`) and relative traversal (`../../`) are rejected by platform isolation.

### 4. Atomic Patch Application & Precondition Verification
- **Verified in `test_patch_apply_precondition_verification_and_atomic_replace` (`patch_tests.rs`):**
  - Applying a patch against a stale/mismatched expected hash fails with `PatchError::PreconditionConflict` and leaves the original file completely untouched.
  - Matching preconditions atomically replaces the target file and calculates the new content hash.
  - New file creation in nested subdirectories is supported when expected hash is `"NEW"`.

### 5. Isolated Staging Sandbox & Environment Sanitization
- **Verified in `profile.rs` & `executor_integration_tests.rs`:**
  - `sanitize_environment` strips all API keys, bearer tokens, SSH credentials, AWS/Azure/GCP credentials, and GitHub tokens, while preserving essential system variables (`PATH`, `SYSTEMROOT`, `TEMP`, `LANG`).
  - Processes execute in isolated copies of project files without direct access to live project files.

### 6. Scheduler Concurrency Limits & Single-Use Grants
- **Verified in `scheduler_tests.rs`:**
  - Permitted up to 4 concurrent read slots; acquiring a 5th returns `ReadCapacityExceeded`. Dropping guards releases capacity.
  - Enforces max 1 mutation slot and max 1 process slot.
  - Single-use (`ApprovalScope::Once`) grants fail with `AlreadyConsumed` on second attempt.
  - Expired grants fail with `GrantError::Expired`.

---

## 3. Test & Governance Results

- **Tool Subsystem Tests (`adham-tools`):** **12/12 passed.**
  - `policy_tests.rs`: 3/3 passed.
  - `broker_tests.rs`: 3/3 passed.
  - `patch_tests.rs`: 2/2 passed.
  - `scheduler_tests.rs`: 2/2 passed.
  - `executor_integration_tests.rs`: 2/2 passed.
- **Full Rust Workspace (`cargo test --workspace`):** **89/89 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All files in `adham-tools` strictly `<120` lines.
- **Formatters & Linters:** `cargo fmt --check` clean.
