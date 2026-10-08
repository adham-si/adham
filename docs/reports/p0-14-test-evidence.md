# P0-14 Plugin Package Trust, Isolated Execution, and Lifecycle Contract Evidence Report

**Specification:** [`docs/spec/p0/P0-14 — Plugin package trust, isolated execution, and lifecycle contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-14%20%E2%80%94%20Plugin%20package%20trust,%20isolated%20execution,%20and%20lifecycle%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-14-plugin-lifecycle-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-14-plugin-lifecycle-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Plugin Package Trust, Isolated Execution, and Lifecycle Contract** milestone (P0-14). P0-14 represents the completion of the foundational **P0 contract series (P0-01 through P0-14)**.

P0-14 establishes Adham's plugin package trust, sandboxed containment, and lifecycle subsystem (`adham-extensions`):
- **Inert Acquisition & Zero Hook Execution:** Discovery, parsing, and installation are strictly inert. No install or postinstall scripts execute during package registration. Third-party code never loads into the trusted core or renderer.
- **Agent Plugins 1.0.0 Conformance:** Fully conforms to portable manifest layout (`plugin.json`, `skills/`, `mcp.json`). Nonfatal unknown top-level fields are safely captured and ignored without elevating privileges.
- **Strict Path Containment:** Rejects directory traversal (`..`), absolute paths, Windows drive letters, and link escapes in manifest paths and package artifacts.
- **Immutable Package Content vs Isolated Mutable Data:** Package files are read-only and checksummed via BLAKE3 digests. Mutable instance data (`PLUGIN_DATA`) is strictly partitioned and isolated per runtime instance.
- **Installed != Enabled:** Installing a plugin registers components in `PluginInstallationState::InstalledDisabled` by default. Every component requires explicit user grant and scope binding.
- **Lifecycle & Quarantine Controls:** State transitions (`Staged` -> `Validated` -> `InstalledDisabled` -> `Active`). Quarantine immediately halts admission and invalidates tokens. Safe rollback protects data generation compatibility.

---

## 2. Verified Invariants & Test Scenarios

### 1. Portable Manifest Conformance & Nonfatal Unknown Fields
- **Verified in `plugin_validation_tests.rs`:**
  - `test_agent_plugins_conformance_and_unknown_fields_handling`: Validates Agent Plugins 1.0.0 schema, captures nonfatal unknown fields (`future_spec_field`, `custom_metadata`) without failing.
  - `test_invalid_schema_and_name_rejection`: Rejects missing `$schema`, unsupported schema versions, and invalid/traversal package names.
  - `test_path_containment_violation_in_manifest`: Rejects relative path escapes in `skills` or `mcp` declarations.

### 2. Inert Installation & Scoped Data Isolation
- **Verified in `plugin_install_and_isolation_tests.rs`:**
  - `test_plugin_installation_starts_strictly_disabled`: New package installs in `InstalledDisabled` state with zero scripts executed; instance data is partitioned under `instances/<id>/data/gen_1`.
  - `test_rejection_of_path_escapes_in_package_artifacts`: Blocks installation when package archive entries contain traversal sequences (`../../system/malicious.bat`).
  - `test_instance_data_path_containment_and_isolation`: Resolves paths inside isolated instance data; rejects traversal escapes (`../sibling_instance/keys.json`) and absolute paths (`/etc/passwd`).

### 3. Lifecycle, Quarantine, and Rollback Compatibility
- **Verified in `plugin_lifecycle_tests.rs`:**
  - `test_plugin_explicit_activation_lifecycle`: Allows explicit activation from `InstalledDisabled` or `Suspended` to `Active`.
  - `test_quarantine_blocks_activation`: Quarantining an instance immediately blocks subsequent activation attempts.
  - `test_safe_rollback_and_generation_compatibility`: Permits legal downgrade to compatible generation 1; rejects incompatible future generation 3; rejects rollback of quarantined packages.
  - `test_uninstallation_transitions_to_removed`: Sets state to `Removed` while preserving user-owned files and forks.

---

## 3. Test & Quality Audit Results

- **Extensions Subsystem Tests (`adham-extensions`):** **21/21 passed.**
  - `skill_parsing_and_isolation_tests.rs`: 3/3 passed.
  - `mcp_tool_enablement_tests.rs`: 3/3 passed.
  - `progressive_loading_tests.rs`: 3/3 passed.
  - `invocation_normalization_tests.rs`: 2/2 passed.
  - `plugin_validation_tests.rs`: 3/3 passed.
  - `plugin_install_and_isolation_tests.rs`: 3/3 passed.
  - `plugin_lifecycle_tests.rs`: 4/4 passed.
- **Full Rust Workspace (`cargo test --workspace`):** **125/125 passed.**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All files in `adham-extensions` strictly `<160` lines.
- **Formatters & Linters:** `cargo fmt --check` clean.
