# P0-03 SQLite Storage, Content & Projections Hardening Evidence Report

**Specification:** [`docs/spec/p0/P0-03 — SQLite event store, content & projections.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-03%20%E2%80%94%20SQLite%20event%20store,%20content%20&%20projections.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-03-storage-contract-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-03-storage-contract-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **SQLite Event Store, Content & Projections Hardening** milestone (P0-03).

P0-03 establishes SQLite as Adham's durable journal with:
1. Runtime storage health verification (`verify_storage_health`) asserting effective PRAGMAs:
   - `journal_mode = WAL`
   - `foreign_keys = ON`
   - `busy_timeout >= 5000ms`
   - `PRAGMA quick_check(1) = ok`
2. Strict projection checkpoint tracking on append and deterministic replay via `projection_checkpoints`.
3. Atomic transaction rollback guarantees ensuring no partial state or dangling records persist on fault.
4. Segregated content records and tombstone transitions on erasure.

---

## 2. Verified Storage Invariants

### 1. Storage Health Verification & Effective PRAGMAs
- Verified in `test_storage_health_verification` (`storage_contract_tests.rs`):
  - Validates active pool configuration against runtime SQLite PRAGMAs.
  - Asserts `is_healthy: true`, `journal_mode: "wal"`, `foreign_keys: true`, `busy_timeout_ms >= 5000`, and `quick_check_ok: true`.
  - Wired directly into Desktop API status query (`handle_get_storage_status`).

### 2. Foreign Key Constraint Enforcement
- Verified in `test_foreign_key_enforcement` (`storage_contract_tests.rs`):
  - Asserts foreign key violations are rejected with constraint error when referencing non-existent parent rows.

### 3. Transaction Rollback & Atomicity Guarantees
- Verified in `test_transaction_rollback_guarantee` (`storage_contract_tests.rs`):
  - Injected transaction rollback after writing content and canonical event rows.
  - Verified 0 rows persisted across `content_records` and `events`.
  - A committed command is either completely visible or not visible at all.

### 4. Projection Checkpoint Tracking & Deterministic Recovery
- Verified in `test_projection_checkpoints_upsert_and_recovery` (`storage_contract_tests.rs`) and `test_conversation_projection_and_deterministic_rebuild` (`projection_tests.rs`):
  - Checkpoint advances synchronously with each projected message.
  - Checkpoint query helper (`ConversationProjection::get_checkpoint`) reflects exact global sequence position.
  - Checkpoint is re-established deterministically upon projection rebuild from canonical events.

### 5. Content Record Segregation & Tombstones Lifecycle
- Verified in `test_content_tombstone_lifecycle` (`storage_contract_tests.rs`):
  - Protected content is stored separately from structural events.
  - Content erasure permanently purges protected payload while creating a non-sensitive audit tombstone with reason code.

---

## 3. Test & Governance Results

- **Storage Contract Tests (`storage_contract_tests.rs`):** **5/5 passed.**
- **Event Store Tests (`store_tests.rs`):** **3/3 passed.**
- **Projection Tests (`projection_tests.rs`):** **1/1 passed.**
- **Full Rust Workspace (`cargo test --workspace`):** **52/52 passed.**
- **Frontend Client Tests (`pnpm exec vitest run apps/desktop`):** **6/6 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All modified/created Rust files strictly `<300` lines.
- **Formatters & Linters:** Biome 2.5, Oxlint, and rustfmt clean with 0 errors/warnings.
