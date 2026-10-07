# Dependency Proposal Report

**Date:** 2026-10-06  
**Scope:** Initial repository scaffold & First Vertical Slice (P0-06)  

---

## 1. Summary Classification

### 1.1 Already Installed (Global System)
- `rustc 1.96.0` (MSVC)
- `cargo 1.96.0`
- `node 26.4.0` (repository baseline pinned to Node 24 LTS)
- `pnpm 10.33.2`
- `git 2.55.0`
- `WebView2 154.0.4258.53`
- `Visual Studio Build Tools 2026`

### 1.2 Declared but Unused
- None (pure greenfield repository).

---

## 2. Missing and Required Now

### 2.1 Frontend Runtime (`apps/desktop`)

| Package | Role & Owner | License | Features / Notes | Exit Strategy |
|---|---|---|---|---|
| `react` | UI rendering / Meta | MIT | React 19 core | Standard web standard |
| `react-dom` | DOM renderer / Meta | MIT | React 19 DOM bindings | Paired with React |
| `@tanstack/react-router` | Client-side routing / TanStack | MIT | Type-safe file-based routing | TanStack Router is decoupled |
| `@tanstack/router-plugin` | Vite routing codegen plugin | MIT | Generates `routeTree.gen.ts` before React plugin | Vite standard |
| `@tanstack/react-query` | Server state sync / TanStack | MIT | Async query caching & mutations | Standard state container |
| `tailwindcss` | Utility-first CSS / Tailwind Labs | MIT | Tailwind CSS v4 | Standard CSS engine |
| `@tailwindcss/vite` | Vite integration plugin | MIT | Fast compilation via lightningcss | Standard Vite plugin |
| `i18next` | Localization engine / i18next | MIT | Monorepo i18n core | Portable JSON keys |
| `react-i18next` | React bindings / i18next | MIT | React hooks & RTL support | Standard integration |
| `zod` | Runtime schema validation / Colin McDonnell | MIT | Validates untrusted IPC responses at boundary | Decoupled validator |
| `@tauri-apps/api` | Tauri IPC client / Tauri Team | MIT/Apache-2.0 | Version 2; typed `core.invoke` | Tauri official client |

### 2.2 Frontend Dev, Toolchain & Quality

| Package | Role & Owner | License | Notes |
|---|---|---|---|
| `@tauri-apps/cli` | Desktop bundler CLI / Tauri Team | MIT/Apache-2.0 | Tauri 2 CLI for build and dev |
| `vite` | Desktop bundler / Vite Core | MIT | Fast ESM development & build |
| `@vitejs/plugin-react` | React Babel/SWC transform / Vite Core | MIT | Fast Refresh and JSX |
| `typescript` | Static type checker / Microsoft | Apache-2.0 | Strict typecheck (`tsc --noEmit`, v7) |
| `@biomejs/biome` | Formatting & import sorting / Biome | MIT/Apache-2.0 | Replaces Prettier; formatting only (v2) |
| `oxlint` | Fast linter / Oxc Team | MIT | Replaces ESLint; type-aware lint rules enabled (v1.87) |
| `vitest` | Unit/component runner / Vitest Core | MIT | Fast Vite-native test runner (v4) |
| `@testing-library/react` | Component testing / Testing Library | MIT | User-centric DOM testing |
| `@testing-library/jest-dom` | DOM assertions / Testing Library | MIT | Matchers for Testing Library |
| `axe-core` | Accessibility engine / Deque Systems | MPL-2.0 | Automated WCAG/a11y checks |
| `jsdom` | Headless DOM for tests | MIT | Test environment for Vitest |

### 2.3 Design token system (PROPOSED — approval required before planning)

Source: `docs/superpowers/specs/2026-10-07-design-token-system-design.md` §2.

| Package | Role & Owner | License | Size / Notes | Exit Strategy |
|---|---|---|---|---|
| `class-variance-authority` | Type-safe component variant composition / Function + Shadcn | MIT | Tiny; builds class strings only | Replace with plain object maps in `packages/ui` |
| `clsx` | Conditional className joining / Luke Edwards | MIT | ~300 B | Replace with a local helper |
| `tailwind-merge` | Deduplicates conflicting Tailwind classes so caller `className` overrides work / danielwe | MIT | Needed by `cn()` | Drop `cn()` merging; caller classes then conflict |

**Why not conflicting with §4:** `radix-ui` / `shadcn` were rejected for *external design system coupling and bloated DOM*. None of these three ship components, DOM, or visual design — they only compose class strings. `packages/ui` remains fully custom, semantic-HTML-first, and Adham-owned.

**What is deliberately NOT requested here:**

- `@floating-ui/react` stays deferred (§3). The `Menu` component positions with plain CSS (`position: absolute` inside a `position: relative` anchor) for v1.
- No icon package. `AdhamIcon` ships as a wrapper contract only.
- `axe-core` (already listed in §2.2) is **not** used for the contrast gate — the token test computes WCAG luminance directly from `tokens.css`, because `axe-core` needs computed styles that jsdom cannot produce for CSS variables.

**Status:** approved 2026-10-07 (design-token work). Cleared decision 6 in `docs/spec/p0/P0 — Implementation decisions & execution order.md` §5.

### 2.4 Rust Workspace Crates

| Crate | Role & Scope | License | Features Enabled | Deliberately Disabled |
|---|---|---|---|---|
| `tauri` | Desktop shell / `src-tauri` | Apache-2.0/MIT | `wry` | Unused plugins, dialog, shell |
| `tauri-build` | Tauri build script / `src-tauri` | Apache-2.0/MIT | default | — |
| `serde` | Serialization / Serde Team | Apache-2.0/MIT | `derive` | Default |
| `serde_json` | JSON format / Serde Team | Apache-2.0/MIT | `raw_value` | Unused features |
| `thiserror` | Domain error typing / David Tolnay | Apache-2.0/MIT | default | — |
| `anyhow` | Composition error handling | Apache-2.0/MIT | default | Restricted to composition roots only |
| `tracing` | Structured diagnostics | MIT | default | Log/max-level overrides |
| `tracing-subscriber` | Tracing collector | MIT | `env-filter`, `fmt` | JSON formatter (if not needed yet) |
| `uuid` | Strongly-typed IDs | Apache-2.0/MIT | `v7`, `serde` | `v1`, `v3`, `v5` |
| `time` | UTC timestamp storage | Apache-2.0/MIT | `serde`, `formatting` | Deprecated APIs |
| `sqlx` | SQLite adapter / Launchbadge | Apache-2.0/MIT | `sqlite`, `runtime-tokio`, `migrate`, `uuid`, `time` | `postgres`, `mysql`, `tls` |
| `blake3` | Content & event checksums | Apache-2.0/CC0 | default | — |
| `ts-rs` | TypeScript DTO generation | MIT | `uuid-impl`, `time-impl` | — |

---

## 3. Recommended Later (Explicitly Deferred)

The following dependencies are noted in architecture documentation but **must not be installed** in Phase 0 / P0-06:
- `reqwest` / HTTP clients (no network in slice)
- `keyring` (no credential storage in slice)
- `notify` (no file watching in slice)
- `tokio-util` (no complex task trees in slice)
- `futures` / `tokio-stream` (no streaming in slice)
- `zustand` (local React state is sufficient for slice)
- `hugeicons` / `@hugeicons/react` (no iconography needed for slice)
- `@floating-ui/react` (no complex dropdowns in slice)
- `msw` (mocking deferred until multiple backend flows exist)
- `playwright` (deferred until first complete UI journey)
- `webdriverio` (deferred until public alpha)
- Provider SDKs (Ollama HTTP, OpenAI, Anthropic)
- Sandbox libraries (AppContainer/Job Object wrappers)

---

## 4. Rejected or Replaced

| Rejected Dependency | Reason for Rejection | Approved Replacement |
|---|---|---|
| `eslint` | Slower performance, complex config overlap | `oxlint` (with type-aware rules enabled) |
| `prettier` | Slower formatting, duplicate AST passes | `biome` |
| `radix-ui` / `shadcn` | External design system coupling, bloated DOM | Custom native `packages/ui` built on semantic HTML |
| `tauri-specta` | Specta v2/Tauri 2 line still in release-candidate series | `ts-rs` (simple, deterministic, committed DTOs) |
| `pnpm create tauri-app` | Generates bloated default files needing cleanup | Manual Vite scaffold + `pnpm tauri init` |
| `esnext` build target | Incompatible with native WebViews | Target `chrome105` (Windows) / `safari13` (macOS) |
| Raw SQL `query!` macro | Requires live database at compile time | SQLx runtime query API with embedded migrations |

---

## 5. Approval

Human confirmation for the original proposal was granted via approval of `initial_setup_plan.md`.
All packages will be installed with pinned versions and committed lockfiles.

**Resolved 2026-10-07:** the three packages in §2.3 are approved. The design-token work may
proceed to planning. This satisfies decision 6 (dependency approval) in
`docs/spec/p0/P0 — Implementation decisions & execution order.md` §5.
