<aside>
🏗️

**Architecture decision:** build Adham as a domain-driven modular monolith in a Cargo + pnpm monorepo. Do not begin with network microservices. Preserve strict bounded contexts, then extract only security-sensitive or independently failing workloads into separate local processes.

</aside>

## Purpose

This document is the execution brief for the AI development team responsible for creating Adham’s initial repository. It defines how to inspect the machine, approve dependencies, scaffold the frontend and Rust backend, enforce domain boundaries, and prevent giant files or tightly coupled modules.

Adham’s desktop shell should use Tauri 2 with a React/Vite frontend and an intentionally narrow typed IPC layer. Tauri supports web frontends with Rust application logic, while its isolation pattern is designed to reduce the risk of unwanted frontend calls into the trusted core.[[1]](https://v2.tauri.app/start)[[2]](https://v2.tauri.app/concept/inter-process-communication/isolation/)

Cargo workspaces should manage the Rust crates, and pnpm workspaces should manage frontend packages in the same repository.[[3]](https://doc.rust-lang.org/cargo/reference/workspaces.html)[[4]](https://pnpm.io/workspaces)

# 1. Non-negotiable architecture rules

1. **Domain-driven modular monolith first.** A desktop application does not need network microservices for every feature.
2. **Separate process only for a real boundary:** untrusted code, OS sandboxing, crash isolation, privilege separation, or independently managed lifecycle.
3. **The Tauri command layer remains thin.** It validates transport input, calls application services, and returns typed results. It contains no business logic.
4. **The frontend never accesses files, credentials, providers, databases, or tools directly.**
5. **Business rules belong to their bounded context.** Do not create global helper modules containing unrelated behavior.
6. **Dependencies point inward.** Domain code cannot import Tauri, SQLx, HTTP clients, filesystem implementations, or frontend concepts.
7. **Contracts are explicit and versioned.** IPC commands, events, persisted events, plugin contracts, and provider responses are typed.
8. **No implicit global project.** Every command carries immutable workspace, project, session, and actor identity where applicable.
9. **No provider mega-file.** Each provider is an adapter composed from small modules implementing common ports.
10. **No premature generalization.** Create an abstraction when two real implementations need it or when it protects a trust boundary.

# 2. Monolith versus microservices

## Use modules and crates for

- Sessions and event log.
- Agent runtime and loop.
- Task graph.
- Model routing.
- Provider adapters.
- Tools.
- Context and memory.
- Policy and approvals.
- Verification.
- Artifacts.
- Workspace and project configuration.

These communicate through in-process typed ports and domain events. This provides microservice-quality boundaries without network latency, deployment complexity, distributed transactions, or dozens of background services.

## Use separate local processes for

- **Plugin host:** untrusted or third-party plugin execution.
- **Sandbox runner:** terminal commands and executable tools.
- **Model runner:** only if Adham later embeds a local inference runtime rather than connecting to Ollama.
- **Updater helper:** atomic replacement when the main application cannot update itself safely.
- **Crash reporter:** only if implemented with explicit consent and redaction.

MCP servers may already run as external local processes or remote HTTPS services. Do not wrap each one in a new Adham microservice.

## Extraction rule

A module becomes a process only when at least one condition is true:

- It executes untrusted code.
- It requires different OS privileges.
- A crash must not terminate the trusted core.
- It requires independent scaling or lifecycle.
- Its protocol must be reusable outside the desktop process.

Every extraction requires an ADR covering threat model, protocol, authentication, failure handling, versioning, observability, and rollback.

# 3. Repository structure

```
adham/
├── AGENTS.md
├── README.md
├── LICENSE
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── Cargo.toml
├── Cargo.lock
├── rust-toolchain.toml
├── rustfmt.toml
├── clippy.toml
├── deny.toml
├── package.json
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── biome.json
├── oxlint.json
├── justfile
├── .editorconfig
├── .gitignore
├── .github/
│   ├── workflows/
│   └── dependabot.yml
├── apps/
│   └── desktop/
│       ├── src/                     # React application
│       ├── public/
│       ├── src-tauri/               # Thin Tauri shell and capabilities
│       ├── index.html
│       ├── vite.config.ts
│       └── package.json
├── crates/
│   ├── adham-core-types/
│   ├── adham-session/
│   ├── adham-event-log/
│   ├── adham-projections/
│   ├── adham-runtime/
│   ├── adham-graph/
│   ├── adham-provider/
│   ├── adham-router/
│   ├── adham-tools/
│   ├── adham-policy/
│   ├── adham-context/
│   ├── adham-memory/
│   ├── adham-agents/
│   ├── adham-verify/
│   ├── adham-artifacts/
│   ├── adham-platform/
│   ├── adham-secrets/
│   ├── adham-extensions/
│   └── adham-desktop-api/
├── services/
│   ├── plugin-host/                 # Add only when first required
│   └── sandbox-runner/              # Add only when first required
├── packages/
│   ├── ui/
│   ├── design-tokens/
│   ├── contracts-generated/
│   ├── eslint-config/
│   └── tsconfig/
├── schemas/
│   ├── events/
│   ├── ipc/
│   ├── plugins/
│   └── policy/
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── isolation/
│   ├── crash-recovery/
│   └── fixtures/
├── docs/
│   ├── architecture/
│   ├── adr/
│   ├── threat-models/
│   ├── development/
│   └── reports/
├── scripts/
└── xtask/
```

Do not create empty crates merely to match this future tree. Scaffold only the first required vertical slice, but reserve these names in the architecture document.

# 4. Backend bounded contexts

## Foundation

### Core types

Owns stable identifiers, timestamps, domain errors, capability descriptors, and shared value objects. It must remain small and have almost no dependencies.

### Session and event log

Owns session lifecycle, canonical events, sequence numbers, persistence transactions, replay, forks, migrations, and checkpoints.

### Projections

Builds conversation, task, approval, usage, artifact, and execution views from canonical events. A projection can be deleted and rebuilt.

## Intelligence

### Provider

Defines provider ports and normalized streaming events. Provider-specific implementation details never enter the runtime.

Recommended provider adapter structure:

```
crates/adham-provider/src/
├── lib.rs
├── port.rs
├── capability.rs
├── request.rs
├── response.rs
├── stream.rs
├── error.rs
├── registry.rs
└── adapters/
    ├── ollama/
    │   ├── mod.rs
    │   ├── client.rs
    │   ├── models.rs
    │   ├── request.rs
    │   ├── response.rs
    │   ├── stream.rs
    │   ├── error.rs
    │   └── tests.rs
    └── openai/
        └── ...
```

No provider file should grow into a 5,000-line implementation. Authentication, model discovery, conversion, streaming, errors, and tests are separate cohesive modules.

### Router

Owns default selection, fallback chains, capability matching, budgets, availability, and privacy boundaries. It depends on provider ports—not concrete provider clients.

## Execution

### Runtime

Owns the turn/step/attempt state machine, queue, cancellation, retry coordination, and checkpoints. It does not implement provider HTTP or tool internals.

### Graph

Owns goals, tasks, dependencies, status transitions, scheduling, leases, deadlock detection, and replanning proposals. The model proposes graph changes; the graph service validates and applies them.

### Tools

Owns normalized tool definitions, calls, results, scheduling metadata, idempotency, parallel/exclusive classification, and timeouts.

### Policy

Owns inherited rules, frozen decision context, approval requests, scoped grants, denials, and audit reasons. Tools cannot authorize themselves.

### Verification

Owns completion contracts and evidence. It decides whether the task is completed, completed with warnings, blocked, or failed verification.

## Knowledge

### Context

Owns authorized context assembly, token budgets, compaction references, artifact-backed tool outputs, and model-visible redaction.

### Memory

Owns memory proposals, authority, provenance, retrieval, write approval, retention, and deletion. Memory writes are never a hidden side effect of generating a response.

## Extensibility

### Agents

Owns agent definitions, versions, assignments, delegation contracts, child-session creation, reports, and budgets.

### Extensions

Owns Agent Skills, MCP, Agent Plugins, manifests, trust, installation, grants, and lifecycle. It does not execute untrusted code inside the core process.

## Platform

### Artifacts

Owns immutable large outputs, hashes, metadata, retention, and references.

### Platform and secrets

Own OS paths, filesystem adapters, secure credential storage, notifications, process management, and platform capabilities.

# 5. Internal crate structure

Each nontrivial bounded context follows this pattern:

```
src/
├── lib.rs              # Public API only
├── domain/             # Entities, value objects, invariants
├── application/        # Use cases and orchestration
├── ports/              # Traits required from other contexts/infrastructure
├── adapters/           # Implementations of those ports
└── tests/              # Context-level tests when needed
```

Rules:

- `domain` cannot import `adapters`.
- `application` depends on domain and ports.
- `adapters` implement ports and may use SQLx, reqwest, keyring, or OS APIs.
- Other crates consume only exports from `lib.rs`.
- Concrete adapters are wired in the composition root, not constructed throughout the codebase.
- Cross-context writes occur through application services or domain commands—not direct database access.

# 6. Frontend architecture

Use feature-oriented folders rather than grouping the entire application into giant `components`, `hooks`, and `utils` directories.

```
apps/desktop/src/
├── app/
│   ├── providers/
│   ├── router/
│   ├── styles/
│   └── bootstrap/
├── routes/
│   ├── compose/
│   ├── agents/
│   ├── projects/
│   ├── activity/
│   └── marketplace/
├── widgets/
│   ├── navigation-rail/
│   ├── primary-sidebar/
│   ├── context-panel/
│   └── settings-modal/
├── features/
│   ├── compose-message/
│   ├── select-model/
│   ├── manage-context/
│   ├── approve-action/
│   ├── control-running-task/
│   ├── inspect-tool-call/
│   └── edit-task-graph/
├── entities/
│   ├── workspace/
│   ├── project/
│   ├── session/
│   ├── agent/
│   ├── task/
│   ├── model/
│   └── approval/
└── shared/
    ├── ui/
    ├── api/
    ├── lib/
    ├── config/
    ├── i18n/
    └── types/
```

Each feature may contain:

```
feature-name/
├── ui/
├── model/
├── api/
├── lib/
├── tests/
└── index.ts
```

Frontend rules:

- Routes compose widgets and features; they do not contain domain logic.
- TanStack Query owns async backend state.
- Local UI state stays local; use Zustand only for genuinely shared ephemeral UI state.
- Do not duplicate event-log state in multiple stores.
- Components do not call Tauri `invoke` directly. They call a typed API client.
- Features import shared modules and entity public APIs, not another feature’s internals.
- UI primitives contain no Adham business rules.
- All visible text uses localization keys from the beginning.
- RTL behavior is tested at component and route level.

# 7. IPC and contract rules

Use Rust as the source of truth for trusted command and event structures. Generate TypeScript bindings into `packages/contracts-generated`; never hand-edit generated files.

Each command includes:

- Version.
- Request ID.
- Workspace/project/session identity as required.
- Actor identity.
- Payload.
- Optional idempotency key.

Each result uses a stable error envelope with:

- Public code.
- Safe user message.
- Retryability.
- Correlation ID.
- Optional field errors.

Private diagnostics, credentials, prompts, and sensitive paths never cross to the frontend unless an explicit diagnostic view is authorized.

Tauri capabilities must be allowlisted per window. Do not expose a generic “execute Rust,” “read any path,” or “run command” endpoint.

# 8. File-size and complexity policy

Line count is a warning signal, not the only design rule.

## Default limits

- Production source file target: **under 300 lines**.
- Review required: **over 400 lines**.
- Hard failure without documented exception: **over 600 lines**.
- Function target: under 40 lines.
- Review required: over 70 lines.
- One file owns one cohesive responsibility.

Exceptions:

- Generated files.
- Static lookup tables.
- Schema snapshots.
- Tests where splitting would reduce readability.

A large file must be split by behavior—not into meaningless `part1`/`part2` files. Prefer modules such as `request`, `stream`, `error`, `auth`, and `capability`.

# 9. Initial dependency policy

Do not install the entire future stack on day one. Add a dependency only when the current vertical slice uses it.

## Rust candidates

| Need | Preferred candidate | Rule |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Shell and IPC only |
| Async runtime | Tokio | Central runtime configuration |
| Serialization | Serde / serde_json | Persisted formats require versioning |
| Domain errors | thiserror | Use typed errors |
| Application boundaries | anyhow | Binary/composition boundaries only |
| Observability | tracing / tracing-subscriber | Structured, redacted fields |
| IDs | uuid | Newtypes around raw UUIDs |
| Time | time | Store UTC; render locale in UI |
| Local database | SQLx + SQLite | WAL, migrations, transactions |
| HTTP | reqwest with rustls | No native TLS unless justified |
| Async streams | futures / tokio-stream | Normalize provider streams |
| Cancellation | tokio-util | Hierarchical cancellation tokens |
| URLs | url | Never concatenate URLs manually |
| Secrets in memory | secrecy / zeroize | Still minimize secret lifetime |
| OS credentials | keyring | Hide behind Adham secret port |
| Content hashing | blake3 or sha2 | Choose one per contract |
| Schema validation | jsonschema / schemars | Review exact generation flow |
| Temporary files | tempfile | Secure cleanup behavior |
| File watching | notify | Add only when required |

## Frontend candidates

| Need | Preferred candidate | Rule |
| --- | --- | --- |
| UI | React + strict TypeScript | No `any` without justification |
| Build | Vite | Desktop renderer only |
| Routing | TanStack Router | Typed route parameters |
| Async state | TanStack Query | Backend/event-derived state |
| Styling | Tailwind CSS v4 | Tokens, not scattered magic values |
| Runtime validation | Zod | Validate data at untrusted boundaries |
| Forms | React Hook Form | Pair with schema validation |
| Local shared UI state | Zustand | Use sparingly |
| Localization | i18next + react-i18next | English, Arabic, Chinese, Russian |
| Component system | Adham UI | Custom, native-first components in `packages/ui` |
| Floating overlays | Floating UI, only if needed | Positioning only; Adham owns rendering and design |
| Icons | Hugeicons | Import through an Adham icon wrapper |
| Linting | Oxlint with type-aware rules | Primary linter; add ESLint only for a proven missing rule |
| Formatting | Biome | Formatting and import organization; do not duplicate lint rules |
| Type checking | TypeScript compiler | Strict `tsc --noEmit` remains mandatory |
| Unit/component tests | Vitest + Testing Library | Test behavior, accessibility, and state boundaries |
| API mocking | MSW | Contract-shaped mocks |
| Browser workflow tests | Playwright | Fast renderer flows with mocked typed IPC |
| Native desktop E2E | WebdriverIO Tauri service | Small critical suite against the packaged application |
| Accessibility | axe-core | Automated checks plus manual review |

## Frontend toolchain decision

### Adham UI instead of Radix

Build a dedicated component system in `packages/ui`. Start from semantic HTML and browser behavior rather than wrapping a third-party visual system. Adham owns design tokens, variants, motion, density, RTL, and accessibility contracts.

Simple components—buttons, inputs, badges, separators, cards, and switches—should be implemented directly. Complex interaction components—dialogs, menus, comboboxes, tooltips, drag-and-drop, focus traps, virtual lists, and tree views—must ship only after keyboard, focus, screen-reader, reduced-motion, high-contrast, RTL, and cross-webview tests pass. A small headless utility such as Floating UI may be used for positioning without surrendering Adham’s component design.

### Hugeicons

Use the maintained `@hugeicons/react` renderer with `@hugeicons/core-free-icons`, not the deprecated `hugeicons-react` package.[[1]](https://hugeicons.com/docs/integrations/react/quick-start)[[2]](https://github.com/hugeicons/hugeicons-react)

All icons pass through one `AdhamIcon` wrapper that enforces size tokens, stroke width, `currentColor`, accessible labels, decorative `aria-hidden` behavior, and RTL mirroring where appropriate. Import only named icons so unused icons can be removed from the bundle.

### Oxlint, Biome, and TypeScript

Use three tools with separate responsibilities:

```
Oxlint              code-quality and type-aware lint rules
Biome               formatting and import organization
TypeScript compiler semantic type checking with strict settings
```

Oxlint is the primary linter. Its type-aware mode supports rules that require TypeScript’s type system, including promise and unsafe-assignment checks.[[3]](https://oxc.rs/docs/guide/usage/linter/type-aware.html) Do not keep ESLint in parallel by default; introduce it only when a required plugin or rule has no reliable Oxlint equivalent.

Biome replaces Prettier for this repository. Use its formatter and import organization, but avoid enabling duplicate lint rules already owned by Oxlint. Biome supports JavaScript, TypeScript, JSX, JSON, CSS, and GraphQL formatting from one configuration.[[4]](https://biomejs.dev/)

Recommended scripts:

```json
{
  "scripts": {
    "format": "biome format --write .",
    "format:check": "biome format .",
    "lint": "oxlint --type-aware --deny-warnings .",
    "typecheck": "tsc --noEmit",
    "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test"
  }
}
```

Verify the exact CLI flags against the pinned Oxlint version before committing the scripts.

### Testing pyramid and E2E decision

**Playwright is useful, but it is not the complete native Tauri E2E solution.**

1. **Rust unit tests:** domain invariants, state machines, policy, event replay, migrations, and adapters.
2. **Rust integration tests:** application services using Tauri’s mock runtime where appropriate. Tauri supports unit and integration tests without executing the native webview.[[5]](https://v2.tauri.app/develop/tests)
3. **Vitest:** TypeScript functions, stores, hooks, contracts, and component behavior.
4. **Testing Library + axe:** keyboard, accessible names, focus, RTL, and component integration.
5. **Playwright browser mode:** onboarding, settings, compose, approvals, and recovery flows using a mocked typed IPC adapter. These tests are fast and cross-platform, but they do not prove that native Tauri IPC and OS behavior work.
6. **WebdriverIO Tauri E2E:** a small suite against the real application for native IPC, window behavior, persistence, filesystem picker boundaries, restart/recovery, and packaging. Tauri’s official WebDriver guidance recommends its WebdriverIO Tauri service and supports macOS through the service.[[6]](https://v2.tauri.app/develop/tests/webdriver)[[7]](https://tauri.app/develop/tests/webdriver/example/webdriverio)
7. **Manual platform verification:** permission dialogs, accessibility APIs, signing, installers, updates, and OS-specific security behavior.

Do not try to duplicate every component test in E2E. The first real desktop E2E suite needs only these critical journeys:

- First launch creates a workspace and bounded project.
- Closing and reopening preserves and replays the session.
- A malformed or unauthorized IPC call is rejected.
- A project cannot read outside its approved root.
- Provider credentials never appear in frontend state or logs.
- A running task can pause, stop, and recover from its checkpoint.
- Local-to-cloud fallback requires the configured policy or approval.
- An update or application restart does not duplicate a side effect.

Adoption timing:

- Install Vitest, Testing Library, and axe with the initial frontend.
- Add Playwright when the first complete onboarding or compose flow exists.
- Add WebdriverIO Tauri E2E before the first public alpha.

Before accepting any dependency, record:

- Purpose and owner.
- License.
- Maintenance activity.
- Security history.
- Transitive dependency impact.
- Native build implications.
- Cross-platform support.
- Whether a standard-library solution is sufficient.
- Exit strategy if abandoned.

# 10. Required environment and dependency inventory

The development agent must inspect before installing or changing anything.

```bash
uname -a
rustc -Vv
cargo -V
rustup show
node --version
corepack --version
pnpm --version
git --version
cargo metadata --format-version 1
cargo tree --workspace -e features
pnpm list -r --depth 0
pnpm outdated -r
```

When configuration exists, also run:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo audit
cargo deny check
pnpm lint
pnpm typecheck
pnpm test
pnpm audit --prod
```

The agent must create:

- `docs/reports/toolchain-inventory.md`
- `docs/reports/dependency-inventory.md`
- `docs/reports/dependency-proposal.md`

The proposal clearly separates:

- Already installed.
- Declared but unused.
- Missing and required now.
- Recommended later.
- Rejected or replaced.

Do not run an install command until the proposal is reviewed, unless the human explicitly delegated dependency approval.

# 11. AI development-team execution protocol

## Phase 0 — Inspect

1. Read `AGENTS.md`, architecture docs, ADRs, security policy, and existing manifests.
2. Inventory the operating system, toolchains, package managers, dependencies, and lockfiles.
3. Detect an existing scaffold before creating new files.
4. Report conflicts between the requested stack and the current repository.
5. Do not delete, move, or replace files to make the scaffold easier.

## Phase 1 — Propose

Before coding, produce:

- Proposed tree.
- First vertical slice.
- Crates and packages required now.
- Dependency additions with reasons.
- IPC contract.
- Security boundaries.
- Tests and acceptance criteria.
- Risks and unresolved decisions.

## Phase 2 — Scaffold

Create the smallest compiling structure that supports one end-to-end vertical slice:

```
Open desktop
→ create local workspace/project record
→ submit a typed command
→ append a session event
→ rebuild a projection
→ display the result
```

Do not begin with every provider, plugin marketplace, multi-agent system, or full graph engine.

## Phase 3 — Verify

The scaffold is not complete until:

- Rust formatting, Clippy, tests, and dependency policy pass.
- TypeScript formatting, lint, strict typecheck, and tests pass.
- The desktop application launches on the current platform.
- IPC rejects malformed data.
- Database migration and replay tests pass.
- No secret or unrestricted filesystem API is exposed.
- Architecture and dependency reports are updated.

# 12. Initial quality gates

## Rust

- `#![forbid(unsafe_code)]` by default; isolate and document any required unsafe crate/module.
- Deny warnings in CI.
- No `unwrap` or `expect` in runtime paths without a proven invariant.
- Property-based tests for state transitions and event replay where useful.
- Crash-recovery tests around transactions and tool side effects.
- Cargo audit and cargo deny in CI.

## TypeScript

- `strict: true` plus `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`.
- No direct imports from feature internals.
- No unvalidated `unknown` data crossing IPC.
- Accessibility checks for reusable UI.
- RTL story/test for layout components.

## Supply chain

- Commit lockfiles.
- Pin GitHub Actions by commit SHA.
- Restrict package lifecycle scripts where practical; pnpm supports controls intended to reduce supply-chain risk.[[5]](https://pnpm.io/)
- Review new native dependencies carefully.
- Generate an SBOM for release artifacts.
- Sign release binaries and update manifests.

# 13. Branch and commit policy

- One architectural change per branch.
- Use conventional commit categories where useful: `feat`, `fix`, `refactor`, `test`, `docs`, `build`, `security`.
- A refactor does not silently change behavior.
- Generated contract changes must be committed with their Rust source change.
- Schema or persistent-event changes require a migration and compatibility test.
- Every new dependency appears clearly in the pull-request summary.

# 14. Definition of done for initial setup

- Cargo workspace and pnpm workspace resolve from the repository root.
- Tauri desktop shell opens with the React/Vite application.
- Strict TypeScript and Rust linting are active.
- The Tauri layer contains no domain logic.
- One typed command and one typed event work end to end.
- SQLite database opens in the correct Adham application-data path.
- One canonical session event can be appended, replayed, and projected.
- Workspace and project identity are required in the vertical slice.
- No unrestricted filesystem, terminal, browser, provider, or secret access exists.
- Dependency inventory and security checks pass.
- File-size and module-boundary rules are documented and enforced where practical.
- CI runs formatting, lint, typecheck, tests, audit, and build checks.

# 15. Copyable instruction for the implementation agent

> Set up the initial Adham repository as a domain-driven modular monolith using a Cargo workspace and pnpm workspace. Use Tauri 2 as a thin desktop shell, React with strict TypeScript and Vite for the renderer, TanStack Router and Query, and Tailwind CSS v4.
> 
> 
> Before changing files, inspect the repository, toolchains, manifests, lockfiles, and installed dependencies. Write toolchain, dependency, and dependency-proposal reports. Do not install packages until required dependencies and their security/license impact are documented.
> 
> Preserve bounded contexts for sessions/events, runtime, graph, providers/routing, tools/policy, context/memory, agents, verification, artifacts, extensions, and platform adapters. Keep business logic out of Tauri commands and React components. Use typed ports and generated IPC bindings. Never infer the active project from UI state.
> 
> Do not create network microservices. Use crates for domain boundaries. Create separate processes only for untrusted plugins, sandbox execution, embedded model runtime, or updater isolation. Do not create unused placeholder crates.
> 
> Implement only the first vertical slice: launch the desktop, create or load a local workspace and project, submit one typed command, append one canonical session event to SQLite, rebuild a projection, and show it in the UI.
> 
> Keep production files under 300 lines when practical, require review above 400, and prohibit files above 600 without a documented exception. Split by cohesive responsibilities. A provider adapter must separate client, authentication, models, requests, responses, streaming, capability mapping, errors, and tests.
> 
> Finish only when formatting, Rust Clippy, strict TypeScript typecheck, tests, dependency audits, database migration/replay tests, IPC validation, and the desktop launch all pass. Report every command run, file changed, unresolved risk, and acceptance criterion result. Do not claim completion when a required check is skipped or failing.
>