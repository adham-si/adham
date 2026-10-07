# P0-02 Canonical Event Taxonomy & Schema Evidence Report

**Specification:** [`docs/spec/p0/P0-02 — Canonical event taxonomy & schema​.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-02%20%E2%80%94%20Canonical%20event%20taxonomy%20&%20schema%E2%80%8B.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-02-event-taxonomy-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-02-event-taxonomy-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Canonical Event Taxonomy & Schema** milestone (P0-02).

All initial event payload schemas, the envelope schema, the checked-in event registry, domain validation constraints, and serialization/privacy invariants have been implemented and verified with 100% pass rate.

---

## 2. Event Registry & Schema Catalog

Checked-in at [`schemas/events/registry.json`](file:///c:/Users/IronMan/Desktop/adham.si/schemas/events/registry.json):

| Event Type | Version | Scope Level | Schema File | Constraints Verified |
|---|:---:|---|---|---|
| `workspace/created` | 1 | Workspace | [`schemas/events/workspace/created/v1.json`](file:///c:/Users/IronMan/Desktop/adham.si/schemas/events/workspace/created/v1.json) | `name` (1..120), `kind: "personal"`, `preferred_language`: `en`, `ar`, `zh-CN`, `ru`. |
| `project/created` | 1 | Project | [`schemas/events/project/created/v1.json`](file:///c:/Users/IronMan/Desktop/adham.si/schemas/events/project/created/v1.json) | `name` (1..120), `storage_kind: "isolated"`. Zero raw paths exposed. |
| `session/created` | 1 | Session | [`schemas/events/session/created/v1.json`](file:///c:/Users/IronMan/Desktop/adham.si/schemas/events/session/created/v1.json) | `title` (optional, <= 120), parent `project_id`. |
| `user/message-submitted` | 1 | Session | [`schemas/events/user/message-submitted/v1.json`](file:///c:/Users/IronMan/Desktop/adham.si/schemas/events/user/message-submitted/v1.json) | `content_id` reference, `content_kind: "user_text"`, `size_bytes` (1..65536). |
| *Envelope* | 1 | Universal | [`schemas/events/envelope/v1.json`](file:///c:/Users/IronMan/Desktop/adham.si/schemas/events/envelope/v1.json) | UUIDv7 IDs, RFC 3339 timestamps, monotonic sequence, BLAKE3 checksums. |

---

## 3. Verified Core Invariants

### 1. Sensitive-Content Segregation
- Verified in `test_sensitive_content_segregation_invariant`:
  - `MessageSubmittedV1` contains only `message_id`, `content_id`, `content_kind`, and `size_bytes`.
  - Serialized JSON event payloads strictly omit `text`, `body`, and `prompt` fields, guaranteeing that personal content lives exclusively in the segregated content store.

### 2. Domain Validation Invariants
- Verified in `test_payload_validation_invariants`:
  - Rejection of empty/whitespace-only names.
  - Rejection of unauthorized language codes (e.g. `fr`).
  - Rejection of non-personal workspace kinds (e.g. `enterprise`).
  - Rejection of non-isolated storage kinds (e.g. `shared`).
  - Rejection of oversized message sizes (>64KB).

### 3. Schema Registry Consistency
- Verified in `test_schema_registry_consistency`:
  - Automated check confirms `registry.json` is well-formed and references existing, valid schema files on disk.

---

## 4. Test & Governance Results

- **Taxonomy Tests (`taxonomy_tests.rs`):** **5/5 passed.**
- **Full Rust Workspace (`cargo test --workspace`):** **51/51 passed.**
- **Frontend Client Tests (`pnpm --filter @adham/desktop test`):** **6/6 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
- **Formatters & Linters:** Biome 2.5 and Oxlint clean with 0 errors/warnings.
