# P0-13 Skills and MCP Capability Contract Plan

**Specification:** [`docs/spec/p0/P0-13 — Skills and MCP capability contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-13%20%E2%80%94%20Skills%20and%20MCP%20capability%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`P0 — Implementation decisions & execution order.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0%20%E2%80%94%20Implementation%20decisions%20&%20execution%20order.md), [`P0-09 — Tools, policy, and sandbox execution contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-09%20%E2%80%94%20Tools%2C%20policy%2C%20and%20sandbox%20execution%20contract.md), [`P0-10 — Verification gate and evidence-backed completion contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-10%20%E2%80%94%20Verification%20gate%20and%20evidence-backed%20completion%20contract.md)  
**Date:** 2026-10-07  
**Status:** **COMPLETED**  

---

## 1. Objective & Non-Negotiable Invariants

P0-13 establishes the extension architecture for skills and MCP capabilities (`adham-extensions`):
- **Lazy capability discovery & progressive loading:** Skills and tools are not loaded wholesale into prompt contexts. Progressive loading operates in 3 distinct tiers: metadata shortlist (max 20 candidates), activation manifest (full `SKILL.md` body up to 64 KiB), and supporting resources (bounded, inert, on-demand).
- **Skills teach workflows, but cannot grant tools:** `allowed-tools` in skill frontmatter is an untrusted request/constraint evaluated against existing user grants, never an authority grant.
- **Individually enabled MCP tools:** Authenticating or connecting to an MCP server enables **zero** tools by default. Every tool requires individual explicit enablement with an exact schema generation and effect classification.
- **Strict identity and immutable pinning:** Canonical identity binds source kind, owner, ID, revision hash, and assignment scope. Server self-descriptions or friendly names are untrusted display metadata.
- **Untrusted inputs & containment:** Tool descriptions, skill bodies, server-returned URLs, and schemas are untrusted inputs. Scripts and resources are inert files; running them requires full `P0-09` action normalization and sandbox execution.
- **Fault and revocation boundaries:** Schema, account, or endpoint modifications invalidate existing tool grants. Protocol transport errors are strictly distinguished from tool execution `isError` flags.

---

## 2. Technical Architecture

```mermaid
flowchart TD
    subgraph Registry[Extension Registry]
        SR[Skill Root / Snapshot] -->|Parse & Sanitize| SM[SkillMetadata]
        MCP[MCP Server Binding] -->|Connect & Inspect| TD[Discovered Tools (Disabled By Default)]
    end

    subgraph ProgressiveLoading[Progressive Loading Pipeline]
        Query[Task / User Intent] -->|Search & Filter| Shortlist[Metadata Shortlist (Max 20)]
        Shortlist -->|Exact Selection| Activation[Activation Manifest (Max 64KB Body)]
        Activation -->|Inert References| Resources[Supporting Resources (Max 256KB)]
    end

    subgraph ExecutionGate[P0-09 / P0-13 Invocation Gate]
        Proposal[Model ToolProposal] --> Resolve[Resolve Canonical Tool Binding]
        Resolve --> CheckEnabled{Tool Individually Enabled?}
        CheckEnabled -->|No| BlockDisabled[Reject: ToolNotEnabled]
        CheckEnabled -->|Yes| CheckSchema{Matches Pinned Schema Generation?}
        CheckSchema -->|No| BlockStale[Reject: StaleSchemaGeneration]
        CheckSchema -->|Yes| Dispatch[Execute via P0-09 Sandbox / Broker]
        Dispatch --> Normalize[Normalize Result to P0-09 ToolResult]
    end
```

---

## 3. Implementation Tasks

### Task 1: Create `adham-extensions` Crate & Workspace Setup
- Add `crates/adham-extensions` to root `Cargo.toml`.
- Dependencies: `adham-core-types`, `adham-tools`, `adham-platform`, `serde`, `serde_json`, `thiserror`, `uuid`, `blake3`, `tokio`.

### Task 2: Domain Layer (`crates/adham-extensions/src/domain/`)
- `identity.rs`: `CanonicalSkillId` (`user:`, `workspace:`, `project:`, `plugin:`), `McpConnectionId`, `CanonicalToolId`.
- `skill.rs`: `SkillMetadata`, `SkillSnapshot`, `InertResourceRef`, `allowed_tools` constraint modeling.
- `activation.rs`: `ActivationManifest`, progressive context budgets (metadata shortlist <= 20, body <= 64 KiB, resource <= 256 KiB).
- `connection.rs`: `McpConnectionState` (Proposed, Reviewed, ConfiguredDisabled, DiscoveryReady, ActiveForSelectedTools, Suspended), `McpTransportKind` (`Stdio`, `StreamableHttp`).
- `binding.rs`: `ToolBinding`, `ToolSchemaSnapshot`, `ToolGrantState` (Disabled by default, EnabledWithPolicy), `ToolEffectClass` (Read, SideEffect, Destructive).
- `lifecycle.rs`: Invalidation on schema change, revocation, quarantine.

### Task 3: Application Services & Normalization (`crates/adham-extensions/src/service/`)
- `skill_loader.rs`: Safe frontmatter parsing, path traversal / escape rejection, immutable snapshot generation.
- `router.rs`: Bounded metadata candidate search (top 20), conflict resolution, activation manifest creation.
- `mcp_gateway.rs`: Connection management, discovery of tools starting disabled, individual tool enablement, schema pinning.
- `invocation_gate.rs`: Proposal validation against exact enabled binding, protocol error vs `isError` normalization into `ToolResult`.

### Task 4: Comprehensive Test Suite (`crates/adham-extensions/tests/`)
- `skill_parsing_and_isolation_tests.rs`: Frontmatter parsing, traversal/escape rejection, `allowed-tools` non-grant semantics.
- `mcp_tool_enablement_tests.rs`: Zero tools enabled on connection, individual enablement, schema modification invalidating grants.
- `progressive_loading_tests.rs`: Shortlist bounding (max 20), body budget cap (64 KiB), inert resource handling.
- `invocation_normalization_tests.rs`: Protocol errors vs application `isError`, schema mismatch rejection.

### Task 5: Verification & Evidence
- Workspace verification (`cargo test --workspace`).
- File size audit (`node scripts/check-file-size.mjs` strictly <300 lines).
- Record evidence report in `docs/reports/p0-13-test-evidence.md`.

---

## 4. Execution Checklist

- [x] **Step 1:** Create `crates/adham-extensions` and workspace registration.
- [x] **Step 2:** Implement domain entities (canonical identity, skill, activation, connection, binding, lifecycle).
- [x] **Step 3:** Implement application services (skill loader, capability router, MCP gateway, invocation gate).
- [x] **Step 4:** Implement comprehensive isolation, security, and progressive loading tests.
- [x] **Step 5:** Run workspace verification, file-size audit, and record evidence report.
