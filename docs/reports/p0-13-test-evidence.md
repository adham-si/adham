# P0-13 Skills and MCP Capability Contract Evidence Report

**Specification:** [`docs/spec/p0/P0-13 — Skills and MCP capability contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-13%20%E2%80%94%20Skills%20and%20MCP%20capability%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`p0-13-skills-mcp-plan.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/setup/p0-13-skills-mcp-plan.md)  
**Date:** 2026-10-07  
**Status:** **100% PASSED & VERIFIED**  

---

## 1. Executive Summary

This report documents the verification evidence for the **Skills and MCP Capability Contract** milestone (P0-13).

P0-13 establishes Adham's extension and capability containment subsystem (`adham-extensions`):
- **Lazy Progressive Loading:** Capabilities are never loaded wholesale into LLM prompts. A 3-tiered model enforces strict bounds:
  - Shortlist: at most 20 metadata candidates.
  - Activation: at most 64 KiB `SKILL.md` body for 1 primary skill and up to 2 helper skills.
  - Supporting resources: loaded inertly on demand, capped at 256 KiB per load, 10 total loads, and 1 MiB cumulative.
- **Skills Teach, Never Grant:** The frontmatter `allowed-tools` field is modeled as an untrusted constraint/request evaluated against user grants—never an ambient capability grant.
- **MCP Tools Disabled by Default:** Authenticating or connecting to an MCP server enables **zero** tools by default. Every tool requires individual explicit enablement.
- **Schema Mutation Invalidation:** Modifying a tool's schema increments its schema generation and immediately invalidates existing grants, resetting state back to `DisabledByDefault`.
- **Invocation Gate & Error Distinction:** The invocation gate verifies exact enabled status and schema generation, strictly distinguishing protocol/transport errors (`EffectCertainty::Unknown`) from application execution failures (`EffectCertainty::Settled`).

---

## 2. Verified Invariants & Test Scenarios

### 1. Skill Parsing & Isolation
- **Verified in `skill_parsing_and_isolation_tests.rs`:**
  - `test_safe_frontmatter_parsing_and_snapshot_creation`: Correctly extracts metadata, captures requested tools without granting authority, and preserves source provenance.
  - `test_rejection_of_path_traversal_in_resources`: Rejects `..`, absolute paths (`/etc/passwd`), and Windows drive letters (`C:\...`).
  - `test_rejection_of_oversized_resources_and_bodies`: Rejects resource refs exceeding 256 KiB and skill bodies exceeding 64 KiB.

### 2. MCP Tool Individual Enablement & Schema Invalidation
- **Verified in `mcp_tool_enablement_tests.rs`:**
  - `test_mcp_tools_strictly_disabled_by_default`: All discovered tools start in `ToolGrantState::DisabledByDefault`. Explicitly enabling tool A leaves tool B disabled.
  - `test_schema_change_invalidates_prior_tool_grant`: Updating a tool's input schema increments generation to 2 and resets grant state back to `DisabledByDefault`.
  - `test_connection_suspension_disables_all_associated_tools`: Suspending a connection immediately disables and invalidates all its registered tools.

### 3. Progressive Loading Budgets & Shortlists
- **Verified in `progressive_loading_tests.rs`:**
  - `test_metadata_shortlist_strictly_capped_at_max`: Searching a pool of 25 matching skills strictly caps results at 20 candidates.
  - `test_helper_skill_limit_enforced`: Up to 2 helper skills permitted; requesting 3 helper skills returns `ActivationError::HelperLimitExceeded`.
  - `test_resource_count_and_byte_budget_enforcement`: Rejects more than 10 resource loads and rejects loads exceeding the cumulative 1 MiB budget.

### 4. Invocation Gate Normalization & Error Distinction
- **Verified in `invocation_normalization_tests.rs`:**
  - `test_invocation_gate_enforces_enablement_and_schema_generation`: Denies proposals for disabled tools; blocks proposals holding stale schema generations.
  - `test_mcp_response_normalization_and_error_distinction`:
    - Protocol errors map to `EffectCertainty::Unknown` and `ToolOutcome::Failure`.
    - Application execution errors (`is_error: true`) map to `EffectCertainty::Settled` and `ToolOutcome::Failure`.
    - Successful execution maps to `EffectCertainty::Settled` and `ToolOutcome::Success`.

---

## 3. Test & Quality Audit Results

- **Extensions Subsystem Tests (`adham-extensions`):** **11/11 passed.**
  - `skill_parsing_and_isolation_tests.rs`: 3/3 passed.
  - `mcp_tool_enablement_tests.rs`: 3/3 passed.
  - `progressive_loading_tests.rs`: 3/3 passed.
  - `invocation_normalization_tests.rs`: 2/2 passed.
- **Full Rust Workspace (`cargo test --workspace`):** **116/116 passed.**
- **File-Size Audit (`node scripts/check-file-size.mjs`):** **0 warnings (>400 lines), 0 errors (>600 lines).**
  - All files in `adham-extensions` strictly `<150` lines.
- **Formatters & Linters:** `cargo fmt --check` clean.
