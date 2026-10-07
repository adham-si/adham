I've completed Phase 0 inspection and pulled the official sources. Here is the full wiring plan.

---

# 🗺️ Adham — Initial Wiring Plan
*(Phase 0 inspection → scaffold → first vertical slice → quality gates)*

## 0. Inspection report (done)

| Item | Status |
|---|---|
| Rust / Cargo | ✅ `1.96.0` stable, `x86_64-pc-windows-msvc` |
| MSVC C++ toolset | ✅ **Visual Studio Build Tools 2026** with `VC.Tools.x86.x64` |
| WebView2 Runtime | ✅ `154.0.4258.53` (required by Tauri on Windows) |
| Node / pnpm / npm / git | ✅ `v26.4.0` / `10.33.2` / `11.17.0` / `2.55.0` |
| corepack | ⚠️ not installed — **optional** per Tauri docs (pnpm already global) |
| Repository | ✅ git initialized, **0 commits**, everything untracked; no `Cargo.toml`, no `package.json`, no `apps/` → pure greenfield |
| `CONTEXT7_API_KEY` | ⚠️ not set → Context7 MCP will fall back to direct web fetch (works, used above) |

**Official sources used:** Tauri 2 → *Prerequisites*, *Create a Project*, *Project Structure*; TanStack Router → *Installation with Vite*; TanStack Query → *Overview*; Tailwind v4 → *Installing with Vite*. Skills loaded: `vite`, `react-vite-expert`, `design-system` (+ available: `react-vite-best-practices`, `vitest`, `agent-browser`).

---

## 1. Non-negotiable constraints this plan obeys (from your docs)

1. Domain-driven **modular monolith**, Cargo + pnpm workspaces, **Tauri 2 thin shell** (no business logic in commands or React).
2. Scaffold **only the first vertical slice**: *launch desktop → workspace/project identity → one typed command → one canonical event in SQLite → rebuild projection → show in UI.* **No placeholder crates** (Engineering §15, rule 10).
3. Files: target **<300 lines**, review >400, hard fail >600. Functions <40.
4. Strict TS (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`); **Oxlint** (lint) + **Biome** (format) — no ESLint/Prettier.
5. Frontend: feature-oriented folders, TanStack Query for async state, components never call `invoke` directly (typed API client), **all visible text via i18n keys from day 1** (EN/AR/ZH/RU, RTL tested).
6. Identifier `si.adham.desktop`; global data on Windows in `%LOCALAPPDATA%\Adham\data` (paths doc); secrets never in repo/project files.
7. **No installs until the dependency proposal (§5 below) is approved** (Engineering §10).

---

## 2. Target skeleton (create now vs. defer)

```
adham.si/
├── AGENTS.md  README.md  LICENSE  SECURITY.md  CONTRIBUTING.md  CODE_OF_CONDUCT.md
├── Cargo.toml  rust-toolchain.toml  rustfmt.toml  clippy.toml  deny.toml
├── package.json  pnpm-lock.yaml  pnpm-workspace.yaml  tsconfig.base.json
├── biome.json  oxlint.json  justfile  .editorconfig  .gitignore
├── .github/workflows/ci.yml            # pinned by commit SHA
├── apps/
│   └── desktop/
│       ├── src/                         # React app (feature-oriented, §6)
│       │   ├── app/{bootstrap,providers,router,styles}/
│       │   ├── routes/                  # TanStack file-based routes
│       │   ├── widgets/  features/  entities/  shared/{ui,api,lib,config,i18n,types}/
│       │   ├── routeTree.gen.ts         # generated → ignored by Biome/VSCode
│       │   ├── index.html  vite.config.ts  tsconfig.json  package.json
│       └── src-tauri/                   # thin shell (part of ROOT Cargo workspace)
│           ├── Cargo.toml  tauri.conf.json  build.rs
│           ├── src/{main.rs,lib.rs,commands/}
│           ├── capabilities/default.json  icons/
├── crates/
│   ├── adham-core-types/               # IDs, errors, value objects (near-zero deps)
│   ├── adham-event-log/                # append/replay/checksums + SQLite/WAL + migrations
│   └── adham-projections/              # rebuildable views over the log
├── packages/
│   ├── design-tokens/                  # @theme tokens (#2B2BFF, neutrals)
│   ├── ui/                             # Adham UI primitives (design-system skill)
│   ├── contracts-generated/            # TS bindings — NEVER hand-edited
│   └── tsconfig/                       # shared strict base configs
├── schemas/{events,ipc}/               # event/IPC JSON schemas
├── tests/{contract,integration,fixtures}/
├── docs/{architecture,adr,reports}/    # toolchain/dependency inventories live here
└── scripts/                            # e.g. file-size guard
```

**Explicitly deferred (add only when the slice needs them):** `services/plugin-host`, `services/sandbox-runner`, `adham-provider/router/tools/policy/context/memory/agents/verify/artifacts/platform/secrets/extensions`, `packages/eslint-config`, Playwright/WebdriverIO, Zustand, Hugeicons, Floating UI.

---

## 3. Step-by-step execution

### Phase A — Root foundation (no dependencies yet)
1. `.gitignore` (target/, dist/, node_modules/, `routeTree.gen.ts`? — **no**: commit generated route tree? → keep ignored from VCS *only* if team agrees; recommendation: commit it so CI typechecks without codegen — flag as open decision), `.editorconfig`, `rust-toolchain.toml` (pin stable channel), `rustfmt.toml`, `clippy.toml` (`-D warnings`), `deny.toml` (licenses: MIT/Apache/ISC/BSD; bans: unwrap-by-policy later).
2. Root `Cargo.toml`:
   ```toml
   [workspace]
   resolver = "2"
   members = ["apps/desktop/src-tauri", "crates/adham-core-types",
              "crates/adham-event-log", "crates/adham-projections"]
   [workspace.package] edition = "2024" license = "MIT" # license = OPEN DECISION
   [workspace.dependencies] serde = { version = "1", features = ["derive"] } # …
   ```
3. `pnpm-workspace.yaml`:
   ```yaml
   packages: ["apps/*", "packages/*"]
   ```
4. Root `package.json` with the doc's recommended scripts:
   ```json
   { "scripts": {
       "format": "biome format --write .",
       "format:check": "biome format .",
       "lint": "oxlint --type-aware --deny-warnings .",
       "typecheck": "tsc --noEmit",
       "test": "vitest run",
       "check": "pnpm format:check && pnpm lint && pnpm typecheck && pnpm test"
   }, "packageManager": "pnpm@10.33.2" }
   ```
   (Verify exact Oxlint flags against the pinned version before committing — Engineering §9.)
5. `tsconfig.base.json` with the three strict flags; `biome.json` (formatter + import organize **only**, `files.ignore: ["**/routeTree.gen.ts"]`); `oxlint.json` with type-aware rules on.
6. **Skill use:** `vite` skill for `vite.config.ts` conventions & `VITE_` env-prefix rules (`react-vite-best-practices/rules/env-vite-prefix.md`).
7. ✅ *Gate:* `pnpm install` at root succeeds (lockfile created), `cargo metadata --format-version 1` succeeds with members stubbed.

### Phase B — Frontend scaffold (`apps/desktop`)
8. Create Vite app manually (preferred over the CTA template so we own the structure):
   ```powershell
   cd c:\Users\IronMan\Desktop\adham.si\apps\desktop
   pnpm create vite . --template react-ts     # React + strict TS
   ```
9. **`vite.config.ts` — official wiring (in this exact plugin order):**
   ```ts
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'
   import tailwindcss from '@tailwindcss/vite'
   import { tanstackRouter } from '@tanstack/router-plugin/vite'

   export default defineConfig({
     plugins: [
       tanstackRouter({ target: 'react', autoCodeSplitting: true }), // BEFORE react()
       react(),
       tailwindcss(),
     ],
     resolve: { alias: { '@': '/src' } },
     server: { port: 5173, watch: { ignored: ['**/src-tauri/**'] } },
     build: { target: 'esnext' },
   })
   ```
   *Sources: TanStack “Installation with Vite” (plugin must precede `react()`), Tailwind “Using Vite”, Tauri “Manual Setup” (`watch.ignored`).*
10. Tailwind v4: `src/styles/index.css` → `@import "tailwindcss";` + `@theme { --color-brand: #2B2BFF; … }` (tokens later promoted to `packages/design-tokens`).
11. TanStack Router: create `src/routes/__root.tsx` + `src/routes/index.tsx`; add `.vscode/settings.json` (`files.readonlyInclude/watcherExclude/search.exclude` for `**/routeTree.gen.ts`) per official docs.
12. TanStack Query: `src/app/providers/query-provider.tsx` wrapping `<QueryClientProvider client={queryClient}>` (official pattern), devtools in dev only.
13. i18n: `src/shared/i18n/` with `i18next` + `react-i18next`, resources `en/ar/zh/ru` from commit #1; language detector = explicit setting only (no auto-RTL surprises).
14. Restructure to the doc's §6 tree (`app/ routes/ widgets/ features/ entities/ shared/`) — **Skill: `react-vite-expert`** (feature-based architecture, path aliases, barrel-export rules).
15. ✅ *Gate:* `pnpm dev` renders; `pnpm typecheck && pnpm lint && pnpm format:check` green.

### Phase C — Tauri shell
16. `pnpm add -D @tauri-apps/cli@latest` in `apps/desktop`, then:
    ```powershell
    pnpm tauri init
    #  app name: Adham            window title: Adham
    #  web assets: ../dist        dev server:   http://localhost:5173
    #  dev command: pnpm dev      build command: pnpm build
    ```
    (This is exactly the official *Manual Setup* path from the Tauri docs.)
17. Edit `src-tauri/tauri.conf.json`:
    ```jsonc
    { "productName": "Adham",
      "identifier": "si.adham.desktop",
      "build": { "beforeDevCommand": "pnpm dev", "devUrl": "http://localhost:5173",
                 "beforeBuildCommand": "pnpm build", "frontendDist": "../dist" },
      "app": { "windows": [{ "title": "Adham", "width": 1280, "height": 840 }],
               "security": { "csp": "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'" } },
      "bundle": { "active": true, "targets": ["nsis", "msi"] } }
    ```
18. Keep the official **`main.rs` → `app_lib::run()` / `lib.rs` pattern** (don't touch `main.rs`); `capabilities/default.json` = **`core:default` only** — no fs, shell, http, dialog plugins for the slice (Engineering §7: no generic “read any path / run command” endpoint).
19. **Cargo workspace integration (watch-out):** CTA generates an empty `[workspace]` table in `src-tauri/Cargo.toml` to make it standalone — **remove it**, otherwise the root workspace errors with “multiple workspace roots”. Then the root `members` entry from Phase A applies.
20. ✅ *Gate:* `pnpm tauri dev` opens the window with the Vite app; first full Rust build (~1–3 min) succeeds.

### Phase D — First vertical slice (typed command → event → projection → UI)
*This is the heart of Engineering §15 / DeepSeek audit §6 items 1–3.*
21. **`crates/adham-core-types`**: newtype IDs (`SessionId`, `ProjectId`, `WorkspaceId`…), `DomainError`, `Sequence` — no Tauri/SQLx/HTTP imports.
22. **`crates/adham-event-log`**: internal layout `src/{lib.rs,domain/,application/,ports/,adapters/}`; SQLx + SQLite **WAL**, migrations folder, `append()` with monotonic sequence + checksum, `replay()`, crash-safe transactions. DB path: `%LOCALAPPDATA%\Adham\data\adham.db` (paths doc; create dir on demand). Use **runtime query API** (not `query!` macros) to avoid `DATABASE_URL`/offline-mode build coupling — flagged in the dependency proposal.
23. **`crates/adham-projections`**: `conversation` projection rebuilt purely from the log (delete + rebuild test in Phase E).
24. **Thin commands in `src-tauri/src/commands/`** (not a separate crate yet — “no placeholder crates”):
    `append_session_event(req) -> Result<AppendResult, ErrorEnvelope>` — validates transport input (version, request_id, workspace/project/session/actor identity, payload, optional idempotency key), calls the event-log application service, returns stable error envelope `{ code, message, retryable, correlationId, fieldErrors? }`. **Zero business logic.**
25. **IPC type generation (⛔ decision needed):** Rust is the source of truth; emit TS to `packages/contracts-generated/`.
    - **Recommended: `tauri-specta`** — native Tauri 2 command/event binding generation.
    - Alternatives: `ts-rs` (tiny, types only) or `schemars → JSON Schema → ts-codegen` (matches the doc's listed `jsonschema/schemars` candidate but needs a generation pipeline).
26. **Typed API client** `src/shared/api/adham-client.ts` wrapping `invoke` — the **only** module allowed to import `@tauri-apps/api/core`; Zod-validates responses at the boundary.
27. **UI slice:** route `routes/compose` renders the projected conversation via TanStack Query; a “send” action calls `appendSessionEvent`; event appears after projection rebuild. i18n keys for all strings; skeleton styled with Tailwind tokens (brand `#2B2BFF` on actions only).
28. ✅ **Seeded and superseded.** `packages/design-tokens` shipped a flat, single-namespace token block and `packages/ui` one `Button`. Both were replaced by the three-tier system and eight components (Button, Input, Textarea, SidebarItem, Menu, Dialog, MessageCard, AdhamIcon) — see `docs/Design system — tokens & components.md`. The flat `--color-brand` / `--color-bg-canvas` names and `prefers-color-scheme` dark mode are gone; dark mode is now a `.dark` class on `<html>` so a user setting can override the OS. `#2B2BFF` remains reserved primarily for actions (`--action`), with `--brand` kept for identity only. RTL-safe logical utilities are enforced by `scripts/check-magic-values.mjs`.
29. ✅ *Gate (mirrors DoD §14):* app launches; command appends; kill & restart replays the event; malformed IPC returns the error envelope; no secrets/unrestricted FS exposed; `cargo fmt --check`, `clippy -D warnings`, `tsc --noEmit`, `biome`, `oxlint`, `vitest` all pass.

### Phase E — Tests, guardrails, CI
30. **Vitest** (root config, `environment: happy-dom/jsdom`) + Testing Library + axe-core for the slice component — **Skill: `vitest`**; Rust unit tests for event replay/migrations + a property test for sequence monotonicity; contract test: generated TS types ↔ serde structs.
31. File-size guard `scripts/check-file-size.mjs` (>300 warn, >400 review, >600 fail; exceptions list) wired into `pnpm check`.
32. `justfile`: `dev`, `check`, `test-rust`, `test-fe`, `db-replay` convenience recipes.
33. `.github/workflows/ci.yml`: `cargo fmt/clippy/test/audit/deny` + `pnpm format:check/lint/typecheck/test/build`; **actions pinned by commit SHA**, lockfiles committed, SBOM job deferred to release.
34. **Reports (required by §10):** `docs/reports/toolchain-inventory.md`, `dependency-inventory.md`, `dependency-proposal.md` (+ short ADRs: “Vertical slice scope”, “IPC binding tool”, “src-tauri inside root workspace”).
35. ✅ *Final verification:* run the full DoD list from Engineering §14, then make the **initial commit** (I will ask before any `git push`).

### Phase F — Smoke verification of the running app
36. Run `pnpm tauri dev` and drive the UI with the **`agent-browser` skill** (Playwright MCP is already configured in `opencode.json`) to confirm: window opens, composer visible, event round-trip, error path shows envelope — capturing screenshots as evidence (reliability principle #8: no “success” claims without evidence).

---

## 4. Skill → phase mapping

| Skill | Used in |
|---|---|
| `vite` (Vite 8/Rolldown) | B9 config, env rules, build target/sourcemaps |
| `react-vite-expert` | B14 folder architecture, aliases, code-splitting, perf |
| `react-vite-best-practices` | B (env-vite-prefix, build-*, asset rules) |
| `design-system` | D28 tokens + `packages/ui` components, audits |
| `vitest` | E30 test setup & patterns |
| `agent-browser` | F36 live UI smoke test |
| AGENTS.md research rule | Phase 0 + all official-doc fetches (done) |

---

## 5. Initial dependency proposal (⚠️ approval required before install, per §10)

**Required now — frontend:** `vite`, `@vitejs/plugin-react`, `react@19`, `react-dom`, `typescript`, `@tanstack/react-router`, `@tanstack/router-plugin`, `@tanstack/react-query`, `tailwindcss`, `@tailwindcss/vite`, `i18next`, `react-i18next`, `zod`, `@tauri-apps/api`, dev: `@tauri-apps/cli`, `@biomejs/biome`, `oxlint`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `axe-core`, `happy-dom`.
**Required now — Rust:** `tauri@2`, `tauri-build`, `serde`, `serde_json`, `thiserror`, `tracing`, `tracing-subscriber`, `uuid`, `time`, `sqlx` (sqlite, runtime-tokio), `anyhow` (composition root only); **decision:** `tauri-specta` *vs* `ts-rs`.
**Already installed (no action):** pnpm, rustc, git.
**Later:** `reqwest+rustls`, `keyring`, `notify`, `tokio-util`, `futures`, Zustand, Hugeicons, Floating UI, MSW, Playwright, WebdriverIO.
**Rejected:** ESLint (Oxlint covers it), Prettier (Biome), Radix/third-party component kit (custom Adham UI per §9).

---

## 6. Open decisions I need from you (defaults in bold)

1. **IPC bindings: `tauri-specta`** (recommended) vs `ts-rs` vs schemars→JSON-Schema pipeline.
2. **Scaffold route:** **manual Vite + `pnpm tauri init`** (recommended, full control of §3/§6 layout) vs `pnpm create tauri-app --template react-ts` then refactor.
3. **License file:** `adham.md` lists this as open — create `LICENSE` now with a placeholder note, or wait?
4. Minor: commit `routeTree.gen.ts` to git (**yes**, so CI typechecks without codegen) — confirm.

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Vite 8 (Rolldown) vs Tauri template/plugin compatibility | Manual init (we pin versions); verify `@vitejs/plugin-react`, `router-plugin`, `@tailwindcss/vite` against Vite 8 at install time |
| Nested Cargo workspace conflict (`[workspace]` in src-tauri) | Step 19 removes it; `cargo metadata` gate in Phase A |
| sqlx compile-time macros break CI without `DATABASE_URL` | Runtime query API for the slice |
| First-clone build times | `cargo` target cache in CI; watch `server.watch.ignored` |
| Scope creep | Slice boundary fixed at §2 “deferred” list; anything else → ADR first |

**Out of scope for this plan:** providers/routing, sandbox, policy engine, memory, skills/MCP/plugins, marketplace, onboarding wizard UI, packaging/signing, cross-platform CI matrices.

---

No files were changed — this is the plan only. Want me to **start executing Phase A** (and if so, with `tauri-specta` + manual init as recommended), or adjust any part of the plan first?