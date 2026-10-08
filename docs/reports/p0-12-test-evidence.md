# P0-12 Governed Local Memory Contract Evidence Report

**Specification:** [`docs/spec/p0/P0-12 — Governed local memory contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-12%20%E2%80%94%20Governed%20local%20memory%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-12-governed-memory-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-12-governed-memory-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Governed Local Memory Contract** milestone (P0-12).

P0-12 establishes Adham's user-owned, scoped local memory subsystem (`adham-memory`):
- **User-Owned Knowledge:** Conversation history is not automatically canonical memory. Memory stores explicitly proposed, vetted facts, decisions, and constraints.
- **Strict Scope Isolation:** Project memory is strictly isolated to its owning `ProjectId`—cross-project queries are forbidden. Session memory is scoped to its `SessionId`.
- **Secret Sanitization:** Automatic rejection of API keys, bearer tokens, passwords, and private keys during memory write proposals.
- **Immediate Tombstone Suppression:** Deleted or forgotten memories are immediately excluded from future retrieval queries.
- **Versioned Mutation:** Updates require expected revision checks, preventing stale overwrite conflicts.

---

## 2. Verified Invariants & Test Scenarios

### 1. Scope Isolation
- **Verified in `scope_isolation_tests.rs`:**
  - `test_project_memory_strict_isolation`: Memory written in Project A returns 0 records when queried from Project B.
  - `test_session_memory_isolation`: Session memory is accessible only within its owning session ID.

### 2. Secret & Sensitive Content Sanitization
- **Verified in `sanitization_tests.rs`:**
  - `test_sensitive_credentials_and_keys_rejected`:
    - Rejects OpenAI / cloud API keys (`sk-proj-...`).
    - Rejects private keys (`BEGIN PRIVATE KEY`).
    - Rejects database and user passwords (`password = "..."`).
    - Permits safe architectural facts and coding constraints.

### 3. Immediate Tombstone Suppression
- **Verified in `tombstone_tests.rs`:**
  - `test_tombstone_immediate_retrieval_suppression`:
    - Memory record is retrievable initially.
    - Calling `forget()` creates a `TombstoneRecord`.
    - Subsequent retrieval immediately returns an empty result set.
    - Attempting to update a tombstoned memory returns `MemoryError::Tombstoned`.

### 4. Versioned Updates & Conflict Handling
- **Verified in `revision_tests.rs`:**
  - `test_versioned_memory_update_and_conflict_resolution`:
    - Updating with `expected_revision: 1` increments revision to 2 and recalculates content hash.
    - Attempting an update with a stale expected revision (1 vs current 2) returns `MemoryError::RevisionConflict`.

---

## 3. Test & Governance Results

- **Memory Subsystem Tests (`adham-memory`):** **5/5 passed.**
  - `scope_isolation_tests.rs`: 2/2 passed.
  - `sanitization_tests.rs`: 1/1 passed.
  - `tombstone_tests.rs`: 1/1 passed.
  - `revision_tests.rs`: 1/1 passed.
- **Full Rust Workspace (`cargo test --workspace`):** **105/105 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All files in `adham-memory` strictly `<120` lines.
- **Formatters & Linters:** `cargo fmt --check` clean.
