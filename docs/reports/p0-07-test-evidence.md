# P0-07 Agent Runtime State Machine Evidence Report

**Specification:** [`docs/spec/p0/P0-07 — Agent runtime state machine.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-07%20%E2%80%94%20Agent%20runtime%20state%20machine.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-07-agent-runtime-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-07-agent-runtime-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Agent Runtime State Machine** milestone (P0-07).

P0-07 defines Adham's single-agent execution kernel (`adham-runtime`):
- **Runtime State Authority:** Pure deterministic reducer (`reduce_run`) enforcing lifecycle states, execution phases, and terminal state immutability.
- **Control Intent Precedence:** Enforces `Cancel > Pause > Advance` priority.
- **Driver Epoch Fencing:** Monotonic epoch validation preventing duplicate or stale driver execution.
- **Durable Inbox Model:** Class-prioritized queue (`Steering > Objective > FollowUp`) with explicit lifecycle dispositions.
- **Resource Budgets:** Strict tracking and blocking on exhaustion across turn, step, attempt, duration, and output byte limits.
- **Verification-Gated Completion:** Evaluates proposals against completion contracts; models cannot unilaterally declare success.

---

## 2. Verified Invariants & Test Scenarios

### 1. State Machine Legality & Immutability
- **Verified in `test_legal_lifecycle_flow` & `test_terminal_immutability` (`transition_tests.rs`):**
  - Linear flow from `Queued` -> `Running(Preparing)` -> `Requesting` -> `Streaming` -> `Observing` -> `Verifying` -> `Terminal(Completed)`.
  - Terminal states (`Completed`, `Canceled`, `Failed`, `FailedVerification`) are strictly immutable and reject subsequent transitions with `TerminalImmutable`.

### 2. Control Intent Precedence & Epoch Fencing
- **Verified in `test_control_intent_precedence` & `test_pause_and_resume_cycle` (`transition_tests.rs`):**
  - Cancel intent takes precedence over pause and normal advancement.
  - Driver epoch advancement fences out stale callbacks and prior driver epochs.

### 3. Agent Execution Driver Loop
- **Verified in `test_driver_happy_path_completes` & `test_driver_verification_failure` (`driver_tests.rs`):**
  - Happy path executes model request, advances through phases, verifies completion evidence, and terminates with `Completed`.
  - Unmet completion contracts produce `FailedVerification` and do not allow false completion.

### 4. Cancellation & Budget Exhaustion Defense
- **Verified in `test_driver_cancellation_honored` & `test_driver_budget_exhaustion` (`driver_tests.rs` & `budget_tests.rs`):**
  - Pending cancel transitions directly to `Canceled` without issuing external model calls.
  - Exceeding turn, step, attempt, duration, or output byte budgets transitions to `Blocked(BudgetExhausted)`.

### 5. Durable Checkpoints
- **Verified in `test_checkpoint_create_and_restore` (`driver_tests.rs`):**
  - Checkpoint captures snapshot of epoch, revision, lifecycle, phase, and budget counters, safely restoring state without data loss.

### 6. Inbox Prioritization
- **Verified in `test_inbox_item_prioritization_and_disposition` (`inbox_tests.rs`):**
  - Steering items take priority over objectives and follow-ups.
  - Dispositions progress deterministically from `Queued` to `Claimed`.

---

## 3. Test & Governance Results

- **Runtime Tests (`adham-runtime`):** **12/12 passed.**
  - `transition_tests.rs`: 5/5 passed.
  - `driver_tests.rs`: 5/5 passed.
  - `inbox_tests.rs`: 1/1 passed.
  - `budget_tests.rs`: 1/1 passed.
- **Full Rust Workspace (`cargo test --workspace`):** **72/72 passed.**
- **Frontend Client Tests (`pnpm exec vitest run apps/desktop`):** **6/6 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All files in `adham-runtime` strictly `<200` lines.
- **Formatters & Linters:** Biome 2.5, Oxlint, and rustfmt clean with 0 errors/warnings.
