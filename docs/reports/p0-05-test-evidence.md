# P0-05 Project-Isolation Threat Model Evidence Report

**Specification:** [`docs/spec/p0/P0-05 — Project-isolation threat model.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-05%20%E2%80%94%20Project-isolation%20threat%20model.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-05-project-isolation-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-05-project-isolation-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Project-Isolation Threat Model** milestone (P0-05).

P0-05 establishes the project as Adham's primary security boundary:
- Path resolution and directory boundary validation (`validate_project_relative_path`) hardened against traversal (`..`), Alternate Data Streams (ADS), reserved DOS device names, drive/UNC/device namespaces, and malformed inputs.
- Immutable execution identity and context scoping preventing cross-workspace and cross-project session confusion.
- Strict segregation of private user content from structural canonical events and public logs.
- Safe error sanitization preventing raw filesystem paths or internal SQL leakage.

---

## 2. Threat Mitigation & Security Matrix Verification

### 1. Path Traversal & Root Escapes
- **Verified in `test_path_traversal_rejection` (`isolation_tests.rs`):**
  - Traversal sequences (`..`, `../secret.txt`, `foo/../../bar`, `nested/dir/../..`) are strictly rejected.
  - Lexical normalization prevents parent directory escape before any handle resolution.

### 2. Absolute, Drive-Relative & Namespace Paths
- **Verified in `test_absolute_and_drive_path_rejection` and `test_unc_and_device_namespace_rejection` (`isolation_tests.rs`):**
  - Unix and Windows absolute paths (`/etc/passwd`, `\Windows\System32`) rejected.
  - Drive-letter paths (`C:\secret\doc.txt`, `C:relative`) rejected.
  - Device namespaces and UNC shares (`\\?\C:\Windows`, `\\.\COM1`, `\\server\share`) rejected.

### 3. Windows Alternate Data Streams (ADS) Abuse
- **Verified in `test_alternate_data_streams_rejection` (`isolation_tests.rs`):**
  - Colon stream syntax (`normal.txt:hidden`, `script.ps1:$DATA`, `sub/folder/file.json:metadata`) rejected.
  - Prevents covert data storage or unauthorized stream execution.

### 4. Windows Reserved DOS Device Names
- **Verified in `test_windows_dos_devices_rejection` (`isolation_tests.rs`):**
  - Reserved legacy device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`..`COM9`, `LPT1`..`LPT9`) with or without extensions (`con.txt`, `prn.log`, `aux.dat`) are strictly rejected at all directory levels.

### 5. Malformed Components & Trailing Chars
- **Verified in `test_trailing_dots_and_spaces_rejection` and `test_nul_byte_and_empty_path_rejection` (`isolation_tests.rs`):**
  - Trailing dots and spaces (`foo. `, `bar.`) rejected to prevent NTFS auto-normalization aliasing.
  - NUL bytes (`foo\0bar.txt`) and empty paths rejected.

### 6. Context Relationship & Session Scope Isolation
- **Verified in `test_scenario_7_wrong_project_context_mismatch` (`scenarios_5_to_8.rs`):**
  - Sessions targeting mismatched project or workspace IDs rejected with `CONTEXT_MISMATCH`.
  - Frontend query keys partitioned strictly by `[workspaceId, projectId, sessionId]`.

### 7. Sensitive Content Segregation
- **Verified in `test_sensitive_content_segregation` (`store_tests.rs`) & `test_sensitive_content_segregation_invariant` (`taxonomy_tests.rs`):**
  - Message text and prompts stored in segregated content records, never exposed in canonical events.

---

## 3. Test & Governance Results

- **Isolation Tests (`isolation_tests.rs`):** **8/8 passed.**
- **Full Rust Workspace (`cargo test --workspace`):** **60/60 passed.**
- **Frontend Client Tests (`pnpm exec vitest run apps/desktop`):** **6/6 passed.**
- **Contract Drift Check (`cargo xtask contracts --check`):** **PASSED (0 drift).**
- **File-Size Policy (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - `crates/adham-platform/src/isolation.rs`: 105 lines (< 300).
  - `crates/adham-platform/tests/isolation_tests.rs`: 178 lines (< 300).
- **Formatters & Linters:** Biome 2.5, Oxlint, and rustfmt clean with 0 errors/warnings.
