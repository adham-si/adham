# P0-14 Plugin Package Trust, Isolated Execution, and Lifecycle Contract Plan

**Specification:** [`docs/spec/p0/P0-14 — Plugin package trust, isolated execution, and lifecycle contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-14%20%E2%80%94%20Plugin%20package%20trust,%20isolated%20execution,%20and%20lifecycle%20contract.md)  
**Governing Documents:** [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md), [`P0 — Implementation decisions & execution order.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0%20%E2%80%94%20Implementation%20decisions%20&%20execution%20order.md), [`P0-13 — Skills and MCP capability contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-13%20%E2%80%94%20Skills%20and%20MCP%20capability%20contract.md), [`P0-09 — Tools, policy, and sandbox execution contract.md`](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0-09%20%E2%80%94%20Tools%2C%20policy%2C%20and%20sandbox%20execution%20contract.md)  
**Date:** 2026-10-07  
**Status:** **COMPLETED**  

---

## 1. Objective & Non-Negotiable Invariants

P0-14 establishes Adham's plugin package trust, sandboxed isolation, and lifecycle subsystem, extending `adham-extensions`:
- **Inert Discovery & Parsing:** Parsing, loading, or installing a package executes zero install/postinstall scripts. Third-party code never runs inside the trusted core or renderer.
- **Strict Package Conformance & Path Containment:** Conforms to Agent Plugins 1.0.0 layout (`plugin.json`, `skills/`, `mcp.json`). Nonfatal unknown fields are ignored; fatal violations (traversal `..`, absolute paths, symlink escapes, drive letters) block installation.
- **Immutable Package Content vs Scoped Mutable Data:** Installed package files are read-only and verified by a BLAKE3 digest. Mutable data (`PLUGIN_DATA`) is strictly isolated and partitioned by runtime instance.
- **Installed != Enabled:** Installing a plugin registers components (skills, MCP tools) in a disabled-by-default state. Every component requires explicit user grant and scope binding.
- **Trust Tiers & Permission Overlays:** Clear separation of trust dimensions (Unverified, Community, Reviewed, Organization Approved). Badges and signatures never bypass P0-09 sandbox and policy enforcement.
- **Lifecycle & Quarantine:** Ordered state transitions (`Staged` -> `Validated` -> `InstalledDisabled` -> `Active`). Revocation and quarantine immediately stop admission and invalidate instance tokens. Safe rollback protects data generation compatibility.

---

## 2. Technical Architecture

```mermaid
flowchart TD
    subgraph Acquisition[Package Acquisition & Ingestion]
        PkgDir[Local Plugin Source / Archive] -->|Inert Scan & Parse| Manifest[plugin.json Validator]
        Manifest --> Containment{Path Containment & Escape Check?}
        Containment -->|Escape Detected| Quarantine[Quarantine Artifact & Block]
        Containment -->|Safe| Digest[Compute Canonical Package Digest]
    end

    subgraph TrustAndReview[Trust & Permission Review]
        Digest --> Review[Permission Overlay: Skills, MCP, Endpoints]
        Review --> TrustTier{Determine Trust Tier: Unverified / Reviewed}
        TrustTier --> Receipt[Generate Immutable InstallReceipt]
    end

    subgraph Installation[Immutable Registration]
        Receipt --> Reg[Register PluginInstallation: DisabledByDefault]
        Reg --> BindComponents[Bind Components to Named Scopes]
    end

    subgraph Lifecycle[Lifecycle & Quarantine Controller]
        Reg --> Enable[Explicit Component Enablement]
        Enable --> Active[Active Runtime Instance (Partitioned PLUGIN_DATA)]
        Active -->|Anomaly / Revocation| Revoke[Revocation / Quarantine Event]
        Revoke --> Invalidate[Invalidate Instance Grants & Stop Admission]
    end
```

---

## 3. Implementation Tasks

### Task 1: Domain Entities (`crates/adham-extensions/src/domain/`)
- `package.rs`: `PackageId`, `PackageManifest`, `PluginVersion`, `PackageDigest`, `PackageComponentInventory`.
- `publisher.rs`: `PublisherIdentity`, `TrustTier` (`Unverified`, `CommunityVerified`, `AdhamReviewed`, `OrganizationApproved`).
- `receipt.rs`: `InstallReceipt`, `PluginInstallationState` (`Staged`, `Validated`, `InstalledDisabled`, `Active`, `Quarantined`, `Revoked`).
- `instance.rs`: `PluginInstanceId`, `PluginRuntimeInstance`, `DataGeneration`, path containment for `PLUGIN_DATA` vs read-only `PLUGIN_ROOT`.

### Task 2: Application Services (`crates/adham-extensions/src/service/`)
- `plugin_validator.rs`: Agent Plugins 1.0.0 conformance, path containment enforcement, safe nonfatal unknown-field handling.
- `installer.rs`: Immutable package registration, generation of `InstallReceipt`, disabled-by-default component binding.
- `lifecycle_controller.rs`: State machine (enable, suspend, quarantine, rollback, uninstall), grant invalidation, and data generation checks.

### Task 3: Comprehensive Test Suite (`crates/adham-extensions/tests/`)
- `plugin_validation_tests.rs`: Conformance checks, fatal traversal / path escapes blocked, nonfatal unknown fields ignored.
- `plugin_install_and_isolation_tests.rs`: Zero code executed during install, installed-disabled by default, read-only root vs partitioned mutable data.
- `plugin_lifecycle_tests.rs`: Quarantine and revocation immediately invalidate tokens; rollback checks compatible data generation; uninstallation preserves user forks.

### Task 4: Verification & Evidence
- Workspace verification (`cargo test --workspace`).
- File size audit (`node scripts/check-file-size.mjs` strictly <300 lines).
- Record evidence report in `docs/reports/p0-14-test-evidence.md`.

---

## 4. Execution Checklist

- [x] **Step 1:** Implement plugin domain models (package, publisher, receipt, instance).
- [x] **Step 2:** Implement plugin validator, installer, and lifecycle controller services.
- [x] **Step 3:** Implement comprehensive test suite (validation, isolation, lifecycle).
- [x] **Step 4:** Run workspace verification, file-size audit, and record evidence report.
