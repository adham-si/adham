<aside>
🏗️

Build the smallest trustworthy repository—not the future product in miniature. Every execution stage requires recorded evidence. A scaffold is complete only when the real desktop persists a scoped message, restarts, rebuilds its projection, and passes the required safety and quality gates.

</aside>

## Purpose and authorization

This runbook converts the approved Adham wiring direction into an ordered implementation checklist. It is an execution specification, not a record that implementation has occurred. All checkboxes begin unchecked.

Approval to draft this document does not authorize package installation, machine changes, repository creation, commits, pushes, or publication. The implementation owner must obtain the execution approvals below in the actual development environment.

### Governing specifications

- Engineering — Initial repository architecture & setup instructions.
- P0 — Implementation decisions & execution order.
- P0-01 — First vertical-slice contract.
- P0-02 — Canonical event taxonomy & schema.
- P0-03 — SQLite event store, content & projections.
- P0-04 — Typed IPC, capabilities & frontend sync.
- P0-05 — Project-isolation threat model.

Specialized contracts govern their respective areas. P0-04 governs wire names, public errors, pagination, and the seven-command surface; do not copy earlier illustrative P0-01 DTOs literally. A remaining contradiction blocks the affected implementation until a reviewed decision resolves it.

## 1. Scope and completion levels

### Included

One backend-owned local installation actor, personal workspace, Adham-owned isolated project, session, and text message; canonical structural events; separately protected content; SQLite receipts and projections; typed IPC; a minimal localized interface; restart, replay, negative tests, and CI.

### Excluded

Providers, generated AI responses, agent loops, graphs, subagents, user-folder access, file tools, shell execution, browser/desktop control, memory, skills, MCP, plugins, marketplace, remote accounts, cloud synchronization, telemetry collection, updater integration, and public distribution.

Do not install dependencies or create empty crates for excluded features.

| Level | Meaning | Claim allowed |
| --- | --- | --- |
| Foundation compiles | Root workspaces, frontend, and thin shell compile | Scaffold foundation only |
| Fixture slice verified | End-to-end slice passes with disposable synthetic content | Development fixture slice only |
| Protected slice verified | Reviewed content protection and key lifecycle work; all required gates pass | P0-06 complete for recorded platforms |
| Cross-platform validated | Native evidence exists for each declared OS/architecture | Only those platforms are validated |

A disposable test protector may support fixture development. It must be explicitly enabled, impossible to select silently in a production build, and restricted to test storage. Real user content requires approved authenticated protection. Linux-only evidence cannot satisfy the Windows native gate in P0-01. No P0 completion claim implies public-alpha readiness.

## 2. Gate and evidence protocol

Each gate has one implementation owner and one reviewer. Record status as **not started**, **running**, **passed**, **failed**, or **blocked**. Required skipped checks count as blocked—not passed.

Evidence must include:

- Gate/test ID, source requirement, and expected outcome.
- Repository revision or worktree snapshot identifier.
- OS, architecture, exact toolchain versions, and relevant configuration.
- Command, working directory, exit status, and start/end time.
- Redacted output or artifact reference; expected versus observed result.
- Reviewer, unresolved findings, and remediation reference.

Use only synthetic canary messages in screenshots, logs, and fixtures. Never attach user content, secrets, raw app-data paths, protected bytes, or key material. Store private raw machine details outside the repository when necessary.

Required report locations:

```
docs/reports/toolchain-inventory.md
docs/reports/dependency-inventory.md
docs/reports/dependency-proposal.md
docs/reports/p0-06-gate-register.md
docs/reports/p0-06-test-matrix.md
docs/reports/p0-06-native-smoke.md
docs/reports/p0-06-final-evidence.md
```

Command blocks below define the intended interface. Install nothing merely because a command is shown. Verify flags against pinned versions. Implement repository scripts before invoking them; report a missing script as a blocker rather than replacing it with an undocumented shortcut.

## G0 — Inspect and establish authority

- [ ]  Confirm the approved repository location, branch, owner, allowed read/write scope, and machine.
- [ ]  Inspect existing AGENTS.md, manifests, lockfiles, ADRs, security rules, and uncommitted work before changing anything.
- [ ]  Record repository state without printing secret-bearing remotes or configuration.
- [ ]  Inventory Rust, Cargo, rustup, Node, pnpm, Git, and native Tauri prerequisites on the actual target OS.
- [ ]  Mark tools unavailable instead of installing them automatically.
- [ ]  Separate pre-existing changes from this task. Preserve all unrelated files and work.
- [ ]  Record explicit approval or delegated authority for dependency installation and repository-local changes.
- [ ]  Record license decision. Apache-2.0 remains a recommendation until human confirmation; never create a placeholder LICENSE.
- [ ]  Confirm the six wiring decisions: modular monolith, thin Tauri 2, Node 24 LTS, manual Vite setup, ts-rs, backend-owned domain events.

Safe baseline commands, when applicable:

```bash
git status --short
rustc -Vv
cargo -V
rustup show
node --version
pnpm --version
git --version
```

Run Cargo/pnpm inventory commands only after relevant manifests exist. Do not dump environment variables or credentials.

**Evidence:** initial state, inventory, authorization record, and unresolved-decision list.

**Stop:** wrong directory, unknown repository ownership, destructive overwrite required, unexplained existing scaffold, conflicting requirements, missing approval, or unresolved license/installation authority. Read-only planning may continue; installation may not.

## G1 — Freeze contracts and implementation blockers

- [ ]  Review P0-01 through P0-05 and record the accepted baseline in ADRs.
- [ ]  Use backend-resolved actor/installation identity; renderer context contains only validated references.
- [ ]  Adopt P0-04 protocolVersion/camelCase wire shapes, decimal-string sequences/positions, localized error keys, and limits.
- [ ]  Approve BLAKE3 framing/canonicalization and the initial event registry from P0-02; store event type and version separately.
- [ ]  Define one transaction-owning application operation covering content, event, stream, projection, checkpoint, and receipt.
- [ ]  Resolve illustrative storage-port signatures into an executable transaction/unit-of-work design. Independent port calls must not commit independently; SQLx transaction types remain confined to infrastructure.
- [ ]  Resolve private-content duplication in command receipts: store identifiers and non-content result metadata, then hydrate authorized text from ContentId when returning a result. Do not persist the SubmitMessage response text in unprotected response_json.
- [ ]  Define receipt behavior after content erasure: retain structural identity/idempotency and return the permitted tombstone state, never resurrect text.
- [ ]  Use the same privacy rule for request fingerprints: approve protection/keying of low-entropy content-derived fingerprints before real data; plain hashes are not encryption.
- [ ]  Approve content-protection mode, key availability/locking behavior, and fixture-versus-real-data restrictions.
- [ ]  Define uncertain-result reconciliation using the existing surface: retry the original mutation with the same RequestId and payload so the backend resolves the receipt. Do not silently add a receipt-query command.
- [ ]  Assign owners and values to remaining storage limits. Carry P0-04 values unchanged unless a reviewed amendment changes them.

Minimum ADRs cover architecture, scaffolding/toolchains, generated contracts/routes, SQLite atomicity, event integrity, content protection, command/window authorization, and license.

**Evidence:** contract baseline, ADRs, command/event registries, limits table, and privacy/transaction decisions.

**Stop:** unresolved atomicity, wire compatibility, receipt privacy, key lifecycle, checksum framing, or timeout semantics. Do not invent an implementation that weakens a written contract.

## G2 — Approve and pin dependencies

- [ ]  Pin an exact Node 24 LTS patch, exact pnpm version, and exact stable Rust toolchain after compatibility review. The prior pnpm baseline is 10.33.2; changing it requires an explicit record.
- [ ]  Record Rust MSRV and native compiler/SDK prerequisites separately from the developer toolchain.
- [ ]  Specify exact direct package versions; commit Cargo.lock and pnpm-lock.yaml.
- [ ]  For every new dependency, record purpose, owner, registry/source, version, license, release maturity, compatibility, vulnerabilities, transitive/native impact, enabled features, lifecycle/build scripts, and exit strategy.
- [ ]  Add only packages consumed by this slice. Include hashing, schema-generation, test, and content-protection dependencies only after their specific roles are approved.
- [ ]  Review SQLx features and crypto/vault dependencies carefully. Do not enable all features by convenience.
- [ ]  Review package build scripts and allow only specifically required scripts; no blanket lifecycle-script approval.
- [ ]  Record audit-tool versions and their own installation authority.
- [ ]  Obtain approval before the first install or lockfile-generating resolution.

Use frozen/locked installation for subsequent clean builds:

```bash
pnpm install --frozen-lockfile
cargo fetch --locked
```

The first approved resolution necessarily creates lockfiles; frozen commands apply afterward. Do not use unbounded latest, remote install scripts, force audit fixes, or global configuration changes.

**Evidence:** reviewed dependency proposal, lockfiles, feature inventory, and compatibility report.

**Stop:** unreviewed dependency, unexplained lockfile churn, incompatible Node/Rust/Tauri versions, unaccepted vulnerability/license, or unexpected install script.

## G3 — Create the root and smallest module tree

- [ ]  Create the Cargo workspace and pnpm workspace from the approved tree.
- [ ]  Add packageManager and supported Node declarations; use one authoritative version source and check consistency.
- [ ]  Add rust-toolchain.toml with exact channel plus rustfmt and clippy.
- [ ]  Add strict shared TypeScript configuration, editor settings, formatting/lint configuration, and root scripts.
- [ ]  Add AGENTS.md with architecture, privacy, generation, file-size, approval, and evidence rules.
- [ ]  Add README, SECURITY, and CONTRIBUTING with actual local setup and validation instructions. Include LICENSE only after the decision.
- [ ]  Ignore targets, node_modules, runtime databases/WAL/SHM, logs, backups, vault data, environment files, and scratch artifacts. Do not ignore committed generated contracts/routes.
- [ ]  Do not create eslint-config, services, provider crates, marketplace packages, or other unused placeholders.

Minimum intended ownership:

```
apps/desktop/                 React renderer
apps/desktop/src-tauri/       thin shell and composition root
crates/adham-core-types/      identifiers and small value objects
crates/adham-session/         workspace/project/session use cases
crates/adham-event-log/       events, storage ports, SQLite adapter
crates/adham-projections/     deterministic projection rules
crates/adham-platform/        approved local path/permission adapters
crates/adham-desktop-api/     transport DTOs and public error contract
packages/contracts-generated/ committed generated bindings
schemas/events/              versioned event schemas
xtask/                        deterministic generation/check tooling
```

Create a crate only when it owns real code. Domain use cases may initially use cohesive workspace/project modules inside adham-session; record that scope instead of introducing generic global helpers. A UI package is created only once shared primitives justify it.

**Evidence:** tree, workspace metadata, initial successful resolution, and ownership map.

**Stop:** empty future crates, nested conflicting workspaces, domain dependencies on Tauri/SQLx, or unrelated changes.

## G4 — Scaffold the frontend manually

- [ ]  Create Vite/React 19/strict TypeScript files directly; do not overwrite the tree with a template generator.
- [ ]  Add TanStack Router with its Vite plugin before React transformation; commit routeTree.gen.ts.
- [ ]  Add TanStack Query for backend state and scoped query keys.
- [ ]  Configure Tailwind v4 with a small token set. Reserve #2B2BFF primarily for actions.
- [ ]  Implement only bootstrap, creation, session conversation, submit state, and safe storage/error views.