<aside>
🧭

The wiring plan is approved in direction, but execution should begin only after the corrections and P0 contract order below are accepted. The repository scaffold may start before the full agent runtime specifications; the runtime itself may not.

</aside>

## Decision summary

| Question | Decision |
| --- | --- |
| Architecture | Domain-driven modular monolith in one Cargo + pnpm monorepo |
| Desktop shell | Tauri 2 with a thin command/composition layer |
| Scaffold method | Manual Vite/React setup, then `pnpm tauri init` |
| Node line | Pin Node 24 LTS for reproducible development; test Node 26 separately |
| IPC type generation | `ts-rs` for P0; reconsider `tauri-specta` after its Tauri 2 line is stable |
| Persistent schemas | Serde DTOs plus explicit versioned event schemas; add Schemars when schemas are authored |
| Route tree | Commit `routeTree.gen.ts`; exclude it from manual editing and formatting |
| License | Recommend Apache-2.0; do not create a placeholder license |
| Frontend checks | Oxlint + Biome + strict TypeScript |
| Unit/component tests | Vitest + Testing Library + axe, using jsdom initially |
| Browser flow tests | Playwright after the first complete UI flow |
| Native desktop E2E | WebdriverIO Tauri service before public alpha |

# 1. Required corrections to the proposed wiring plan

## 1.1 Do not expose `append_session_event`

The frontend must not choose canonical event names or append arbitrary events. That would let renderer code bypass domain invariants.

Use a domain command such as:

```
submit_message(SubmitMessageRequest)
```

The application service validates workspace, project, session, actor, idempotency, and payload; then the trusted backend decides which events to append:

```
command accepted
→ user/message-submitted
→ projection updated
```

Only internal application services may call the event store’s generic `append` port.

## 1.2 Pin Node 24 LTS

The inspected Node 26 installation is a Current release on the inspection date, while Node 24 is the LTS line. Use Node 24 for the repository baseline and CI until Node 26 reaches LTS and the frontend toolchain is verified against it.[[1]](https://nodejs.org/en/blog/release)

Add one version declaration accepted by the development environment, such as `.node-version` or Volta configuration, and keep `packageManager: pnpm@10.33.2`.

## 1.3 Use Tauri’s supported Vite target

Do not set `build.target: "esnext"`. Tauri’s Vite guidance uses the platform-aware target because Windows uses Chromium/WebView2 while macOS and Linux use WebKit-based webviews:[[2]](https://v2.tauri.app/start/frontend/vite/)

```tsx
build: {
  target:
    process.env.TAURI_ENV_PLATFORM === "windows"
      ? "chrome105"
      : "safari13",
  minify: !process.env.TAURI_ENV_DEBUG,
  sourcemap: Boolean(process.env.TAURI_ENV_DEBUG),
}
```

Also set `clearScreen: false`, `server.strictPort: true`, and the documented Tauri environment prefix.

## 1.4 Resolve data paths through the trusted platform adapter

Do not construct `%LOCALAPPDATA%\\Adham\\data` directly in the event-log crate. The Tauri composition root resolves `app_local_data_dir`, passes an authorized database path into the platform adapter, and records the actual path policy. Tauri resolves its app-local directory from the platform location and application identifier.[[3]](https://docs.rs/tauri/latest/tauri/path/struct.PathResolver.html)

The event-log domain and application layers receive a storage port; they do not know about Windows, macOS, Linux, or Tauri.

## 1.5 Commit the generated route tree

Commit `routeTree.gen.ts`. TanStack describes it as part of application runtime rather than an ordinary disposable build artifact.[[4]](https://tanstack.com/router/latest/docs/framework/react/guide/decisions-on-dx)

Rules:

- Generated only by the Router plugin/CLI.
- Never edited manually.
- Excluded from Biome formatting, search noise, and file-size limits.
- CI regenerates it and fails when the committed file is stale.

## 1.6 Correct the first-launch language behavior

The existing product decision is:

- Detect the operating system’s preferred language on first launch.
- Use Arabic and RTL automatically when Arabic is the preferred language.
- Persist the user’s explicit choice afterward.

“Explicit setting only” conflicts with the approved onboarding and settings specifications.

## 1.7 Treat CSP as a tested security contract

Do not copy a CSP string as a final decision. Begin with the narrowest policy that permits the compiled application and Tauri IPC. Add `style-src 'unsafe-inline'` only if the actual Tailwind/Tauri build requires it and document the reason. Tauri recommends tailoring the CSP to the application and trusted asset origins.[[5]](https://v2.tauri.app/security/csp)

Create automated checks that production HTML contains no unexpected remote scripts, inline scripts, or network origins.

## 1.8 Correct the smoke-test boundary

`agent-browser` or ordinary Playwright can test the Vite renderer in a browser with mocked IPC. It does not prove the native Tauri window, filesystem resolver, or real IPC behavior.

Phase F should be split into:

1. Browser smoke test against Vite with mocked typed IPC.
2. Manual native Tauri smoke test during the slice.
3. WebdriverIO Tauri E2E before public alpha.

## 1.9 Keep the event-log crate independent of SQLx

The event-log context needs:

- Domain events and stream rules.
- Event-store port.
- Append/replay application services.
- SQLite adapter using SQLx.

Do not mix SQL rows and migrations into domain types. Runtime SQL queries are acceptable for the initial adapter; embedded SQLx migrations remain useful and do not require the same live compile-time database contract as `query!` validation.[[6]](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html)

## 1.10 Verify WAL activation

Configure WAL through `SqliteConnectOptions` and confirm the returned/effective journal mode. SQLite retains WAL once enabled, but activation can fail when the filesystem does not support the required behavior.[[7]](https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html)[[8]](https://sqlite.org/wal.html)

The storage health check records:

- Journal mode.
- Foreign-key enforcement.
- Busy timeout.
- Schema version.
- Database path class.

# 2. Open-decision resolutions

## IPC binding tool — `ts-rs` for P0

Use `ts-rs` to generate TypeScript DTO types from the transport structures and keep a small handwritten typed client in `shared/api`.

Reasons:

- P0 has very few commands.
- It avoids coupling domain contracts to Tauri command macros.
- Generated TypeScript can be tested and committed.
- `tauri-specta` is attractive, but its Tauri 2/Specta 2 line is still documented as a release-candidate series.[[9]](https://github.com/specta-rs/tauri-specta)

Revisit `tauri-specta` when its v2 line is stable or when command volume makes generated wrappers materially valuable.

Rules:

- Generate DTOs from transport types—not domain entities.
- Commit generated bindings.
- CI regenerates and checks for drift.
- Zod validates untrusted runtime responses where useful; TypeScript generation alone is not runtime validation.

## Scaffold route — manual setup

Use manual Vite/React setup followed by `pnpm tauri init`. This preserves the agreed monorepo structure and avoids deleting or reorganizing a generated full template.

Do not run `pnpm create vite` until the exact dependency proposal is approved and versions are pinned.

## License — Apache-2.0 recommendation

Apache-2.0 is the recommended initial license because it is permissive, sponsor-friendly, and includes an explicit patent grant. Do not create a placeholder `LICENSE`; a placeholder creates ambiguity about whether copying and redistribution are permitted.

This remains a human governance decision. If dual licensing or a stronger copyleft strategy is planned, decide before the first public repository release.

## Route tree — commit it

Confirmed: commit `routeTree.gen.ts` and verify regeneration in CI.

# 3. Dependency proposal disposition

## Approve in principle for the first slice

### Frontend runtime

- React 19 and React DOM.
- Vite and the React plugin.
- TanStack Router and Router Vite plugin.
- TanStack Query.
- Tailwind CSS v4 and Vite plugin.
- i18next and react-i18next.
- Zod.
- Tauri JavaScript API.

### Frontend development

- Tauri CLI.
- TypeScript.
- Biome.
- Oxlint plus its matching type-aware engine when required by the selected release.
- Vitest.
- Testing Library packages.
- axe-core.
- jsdom.

### Rust

- Tauri 2 and tauri-build.
- Serde and serde_json.
- thiserror.
- tracing and tracing-subscriber.
- uuid.
- time.
- SQLx with only the SQLite, Tokio runtime, migrations, UUID, and time features actually needed.
- anyhow in the binary/composition root only.
- ts-rs for transport DTO generation.

## Require verification before installation

For every package, the implementation agent must record:

- Exact version and source registry.
- License.
- Release status: stable, RC, beta, or alpha.
- Node/Rust/Tauri/Vite compatibility.
- Transitive dependency count and native build impact.
- Known vulnerabilities and maintenance signals.
- Features enabled and features deliberately disabled.

The approval is for the dependency roles, not permission to use unbounded `latest` versions. Commit exact lockfiles.

## Continue deferring

- Zustand.
- Hugeicons until the first interface needs icons.
- Floating UI until the first complex overlay.
- MSW until several mocked IPC/backend flows exist.
- Playwright until one complete renderer flow exists.
- WebdriverIO until native critical flows exist.
- Provider, routing, tools, sandbox, policy, memory, agent, verification, MCP, and plugin dependencies.

# 4. P0 specification and implementation order

## P0-00 — Decision baseline

Before package installation:

- Accept this decision register.
- Decide the public license.
- Pin Node, pnpm, Rust, and package versions.
- Record ADRs for Tauri 2, modular monolith, manual scaffold, `ts-rs`, route-tree policy, and initial database.

**Gate:** no unresolved contradiction across the project brief, paths specification, and engineering instructions.

## P0-01 — First vertical-slice contract

Define exactly:

- `CreateWorkspace`.
- `CreateProject` or isolated no-file project.
- `CreateSession`.
- `SubmitMessage`.
- Required IDs and who creates them.
- Success and error results.
- Events produced by each command.
- Projection fields displayed by the UI.

**Gate:** one written Given/When/Then scenario for create, restart/replay, duplicate request, malformed request, and wrong-project request.

## P0-02 — Canonical event contract

Define:

- Event envelope and version.
- Stream identity and per-stream sequence.
- Event ID, request ID, correlation ID, causation ID, actor, timestamp, payload, and checksum policy.
- Optimistic concurrency rule.
- Initial workspace, project, session, and message events.
- Unknown-version and corrupted-event behavior.

**Gate:** Serde round-trip, schema snapshot, replay determinism, and forward-compatibility tests.

## P0-03 — Storage and projection contract

Define:

- SQLite schema and migrations.
- Transaction boundaries.
- Idempotency table/index.
- WAL and health configuration.
- Projection cursor/checkpoint strategy.
- Rebuild and corruption recovery.
- Backup-safe file set.

**Gate:** kill/reopen tests, duplicate command tests, concurrent append tests, delete/rebuild projection tests, and migration tests.

## P0-04 — IPC contract

Define:

- Command envelope.
- Safe error envelope.
- Generated TypeScript DTO pipeline.
- Allowed command list.
- Window/capability mapping.
- Payload size limits.
- Cancellation and timeout behavior.
- Logging and redaction.

**Gate:** malformed, oversized, stale-version, unauthorized-context, and generated-binding drift tests.

## P0-05 — Project isolation threat model

Define:

- Global application data versus project-local data.
- Workspace/project/session identity enforcement.
- Renderer compromise assumptions.
- Database, log, and diagnostics sensitivity.
- Symlink, path traversal, junction, and alternate-stream threats on Windows.
- Future provider credentials, tools, plugins, and sandbox boundaries.

**Gate:** the first slice exposes no generic filesystem, shell, HTTP, credential, or arbitrary-event endpoint.

## P0-06 — Repository scaffold and vertical slice

Only after P0-00 through P0-05 are sufficient:

1. Root workspaces and pinned toolchains.
2. Frontend foundation.
3. Thin Tauri shell.
4. `adham-core-types`.
5. `adham-event-log` with storage port and SQLite adapter.
6. `adham-projections`.
7. Domain-specific commands and generated transport DTOs.
8. UI projection.
9. Tests and CI.

**Gate:** launch → create identities → submit message → persist → restart → replay → display.

## P0-07 — Agent runtime state machine

After the storage vertical slice is stable, specify and implement:

- Inbox and instruction queue.
- Turn, step, and attempt states.
- Streaming persistence policy.
- Retry, cancellation, pause, resume, and checkpoint behavior.
- Iteration, time, token, and cost budgets.
- Repetition and no-progress detection.

## P0-08 — Provider gateway

Implement one local provider first—Ollama Local—behind a normalized provider port. Then implement one cloud adapter to prove privacy-boundary routing.

Define model capability metadata, stream events, normalized errors, availability, rate limits, cancellation, and fallback constraints.

## P0-09 — Tools, policy, and sandbox

Implement only the first controlled tool set after the agent loop works without tools:

- Project-scoped read.
- Patch proposal.
- Sandboxed command execution.

Define authorization, idempotency, exclusive/parallel behavior, exact-action escalation, timeouts, result artifacts, and uncertain-side-effect recovery.

## P0-10 — Verification gate

Implement completion contracts before coding agents can claim completion. The first coding contract covers diff scope, build, typecheck, lint, tests, and unresolved warnings.

## P0-11 — Graph and subagents

Add the task graph and child sessions only after single-agent crash recovery and verification pass. The graph service owns state transitions; models submit proposals.

## P0-12 — Memory

Add governed local memory only after project isolation is proven. Define provenance, authority, mutability, retrieval, writes, expiration, export, and deletion before creating a vector index.

## P0-13 — Skills and MCP

Add lazy skill discovery and individually granted MCP tools after tool policy is stable. Do not load every installed capability into context.

## P0-14 — Plugins

Add Agent Plugin installation and isolated execution only after signing, manifest validation, component permissions, sandboxing, updates, rollback, and quarantine exist.

# 5. Execution authorization boundary

The AI development agent may begin Phase A only after the human confirms:

1. Apache-2.0 or another license.
2. Node 24 LTS baseline.
3. `ts-rs` for P0.
4. Manual Vite + Tauri initialization.
5. The corrected domain-specific command boundary.
6. Permission to install the reviewed dependency set.

Phase A authorization does not authorize:

- Publishing or pushing the repository.
- Adding providers, tools, plugins, MCP, or network permissions.
- Reading outside the repository.
- Creating credentials.
- Changing global machine configuration.
- Using `latest` without recording the resolved version.

# 6. Immediate next documents

Create these in order while the scaffold proceeds:

1. P0 first vertical-slice contract.
2. Canonical event taxonomy and schema.
3. SQLite event-store and projection specification.
4. IPC contract and generated-binding specification.
5. Project-isolation threat model.
6. Runtime state-transition specification.
7. Provider trait and normalized stream schema.
8. Tool, policy, and idempotency contract.
9. Crash/retry/cancellation test matrix.
10. Verification contract.

The first five are blockers for merging the initial persistent vertical slice. The remaining five are blockers for beginning the agent runtime.