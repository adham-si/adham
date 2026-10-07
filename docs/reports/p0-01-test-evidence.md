# P0-01 Vertical Slice Test Evidence Report

**Contract:** [`docs/spec/p0/P0-01 — First vertical-slice contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-01%20%E2%80%94%20First%20vertical-slice%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-01-vertical-slice-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-01-vertical-slice-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report provides the formal verification evidence for the **8 Required Scenarios** specified in [`P0-01 — First vertical-slice contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-01%20%E2%80%94%20First%20vertical-slice%20contract.md) §8.

All 8 scenarios have been implemented and executed using synthetic test data in isolated SQLite test instances. 100% of scenarios passed without regressions across the workspace.

---

## 2. Test Execution Matrix (8 Required Scenarios)

| # | Scenario | Test Target | Assertions & Invariants | Result | Duration |
|---|---|---|---|---|---|
| **1** | **Create & Display** | `test_scenario_1_create_and_display` | Workspace → Project → Session → Message `"Hello Adham"` created. Monotonic stream sequences verified. 4 canonical events persisted. Conversation projection returns 1 user message. | **PASSED** | 0.08s |
| **2** | **Restart & Replay** | `test_scenario_2_restart_and_replay` | Connection pool closed & dropped. New pool reopened on the same database path. Projection re-queried without re-ingestion: exact message ID, content, and timestamp restored. | **PASSED** | 0.06s |
| **3** | **Projection Rebuild** | `test_scenario_3_projection_rebuild` | `conversation_messages` projection truncated to 0 rows. `admin_rebuild_projections` invoked. Projection rebuilt with complete fidelity from canonical event stream & content store. | **PASSED** | 0.05s |
| **4** | **Duplicate Request (Idempotency)** | `test_scenario_4_duplicate_request_idempotency` | Identical `RequestId` and payload resubmitted. Cached receipt matched and returned. Zero duplicate events or duplicate projection items created. | **PASSED** | 0.04s |
| **5** | **Conflicting Request Reuse** | `test_scenario_5_conflicting_request_reuse` | Identical `RequestId` resubmitted with differing payload text. BLAKE3 fingerprint mismatch triggers rejection with `REQUEST_ID_CONFLICT`. Zero events or projections created. | **PASSED** | 0.04s |
| **6** | **Malformed Request Validation** | `test_scenario_6_malformed_request_validation` | Rejected invalid `protocol_version` (!= 1) with `INVALID_COMMAND_VERSION`. Rejected empty/whitespace-only message with `VALIDATION_FAILED`. No state mutation. | **PASSED** | 0.03s |
| **7** | **Wrong-Project Context Mismatch** | `test_scenario_7_wrong_project_context_mismatch` | Message targeted to Session in Project A dispatched with Project B context. Rejected with `CONTEXT_MISMATCH`. Cross-project boundary strictly enforced. | **PASSED** | 0.04s |
| **8** | **Interrupted Transaction Atomicity** | `test_scenario_8_interrupted_transaction_atomicity` | Explicit transaction abort/rollback during content/event insert. 0 orphan rows in `content_records` or event streams. Atomic all-or-nothing guarantee satisfied. | **PASSED** | 0.04s |

---

## 3. Security & Domain Integrity Hardening

### Idempotency & Request Fingerprinting
- In [`crates/adham-event-log/src/sqlite/store.rs`](file:///c:/Users/IronMan/Desktop/adham.si/crates/adham-event-log/src/sqlite/store.rs), `check_receipt` returns a typed `CommandReceiptRecord` including the stored `request_fingerprint`.
- Every incoming command computes a BLAKE3 fingerprint of normalized payload content.
- Same `RequestId` + same fingerprint $\rightarrow$ returns cached command result.
- Same `RequestId` + divergent fingerprint $\rightarrow$ returns `REQUEST_ID_CONFLICT`.

### Relational Context Authorization
- In [`crates/adham-desktop-api/src/handlers/message.rs`](file:///c:/Users/IronMan/Desktop/adham.si/crates/adham-desktop-api/src/handlers/message.rs) and [`session.rs`](file:///c:/Users/IronMan/Desktop/adham.si/crates/adham-desktop-api/src/handlers/session.rs), commands verify stream lineage:
  - Session stream sequence 1 defines the owning `workspace_id` and `project_id`.
  - Dispatches failing contextual scope match return `CONTEXT_MISMATCH`.

---

## 4. Quality & Governance Verification

1. **Workspace Test Suite (`cargo test --workspace`):**
   - **43 tests executed** across 7 crates and test binaries.
   - **43 passed, 0 failed, 0 ignored.**
2. **File Size Policy (`node scripts/check-file-size.mjs`):**
   - **0 warnings (>400 lines), 0 errors (>600 lines).**
   - Handlers modularized: `workspace.rs` (214 lines), `session.rs` (149 lines), `message.rs` (198 lines), `conversation.rs` (46 lines).
   - Test suites modularized: `tests/common/mod.rs` (74 lines), `scenarios_1_to_4.rs` (176 lines), `scenarios_5_to_8.rs` (150 lines).
3. **Format & Lint Quality:**
   - Biome 2.5: **Clean (32 files checked, 0 errors).**
   - Oxlint: **Clean (0 warnings, 0 errors across 52 files).**
