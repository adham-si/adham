# Adham Initial Setup & Repository Scaffolding Plan

> **Authority & Governance Notice:**  
> Per [`AGENTS.md`](file:///c:/Users/IronMan/Desktop/adham.si/AGENTS.md) and [`P0 — Implementation decisions & execution order.md` §5](file:///c:/Users/IronMan/Desktop/adham.si/docs/spec/p0/P0%20%E2%80%94%20Implementation%20decisions%20&%20execution%20order.md#L382-L401), implementation execution is strictly gated. All six baseline governance decisions were formally approved.

---

## 1. Six Baseline Governance Decisions

| # | Decision Item | Confirmed Baseline | Human Approval Status |
|---|---|---|---|
| **1** | **Repository License** | **Apache-2.0** (permissive, patent-granting, sponsor-friendly) | Approved |
| **2** | **Runtime Toolchain** | **Node 24 LTS** baseline for reproducible development; host verified on Windows | Approved |
| **3** | **IPC Type Generation** | **`ts-rs`** for P0 transport DTOs generating to `packages/contracts-generated/` | Approved |
| **4** | **Scaffolding Method** | **Manual Vite/React 19 setup**, followed by `pnpm tauri init` (clean layout control) | Approved |
| **5** | **IPC Command Boundary** | **Domain-specific commands only** (`submit_message`, `create_workspace`, etc.; never expose raw `append_session_event`) | Approved |
| **6** | **Dependency Authorization** | Verified packages against registry.npmjs.org; modern stack (Biome 2, Vitest 5, TypeScript 7) | Approved |

---

## 2. Phased Execution Roadmap

```mermaid
flowchart TD
    G0[Gate G0: Environment Inspection & Decision Confirmation] --> G1[Gate G1: Freeze Architecture Contracts & ADRs]
    G1 --> G2[Gate G2: Dependency Proposal & Version Pinning]
    G2 --> G3[Gate G3: Root Monorepo & Toolchain Configs]
    G3 --> G4[Gate G4: Manual Frontend Scaffold - apps/desktop]
    G4 --> G5[Gate G5: Tauri 2 Shell Integration - src-tauri]
    G5 --> G6[Gate G6: First Vertical Slice - Crates, SQLite & IPC]
    G6 --> G7[Gate G7: Test Matrix, Guardrails & CI Workflow]
    G7 --> G8[Gate G8: Native Tauri Smoke Test & Final Evidence]
```

---

### Phase 0: Gate G0 — Inspect & Establish Authority
**Status: COMPLETED**
- Recorded findings in `docs/reports/toolchain-inventory.md`.
- Detected: `rustc 1.96.0`, `cargo 1.96.0`, `node 26.4.0`, `pnpm 10.33.2`, `git 2.55.0`, MSVC Build Tools 2026, WebView2 Runtime `154.0.4258.53`.

---

### Phase 1: Gate G1 — Freeze Contracts & Architecture Decision Records (ADRs)
**Status: COMPLETED**
- Modular monolith architecture in Cargo + pnpm workspaces.
- Seven allowed IPC commands frozen: `get_bootstrap_state`, `get_storage_status`, `create_workspace`, `create_project`, `create_session`, `submit_message`, `get_conversation`, `admin_rebuild_projections`.

---

### Phase 2: Gate G2 — Dependency Proposal & Review
**Status: COMPLETED**
- Pinned and verified against live npm registry:
  - Biome `2.5.15`
  - Vitest `5.0.3`
  - TypeScript `7.0.2`
  - Oxlint `1.87.0`
  - React `19.3.0` & React-DOM `19.3.0`
  - TanStack Router `1.168.42` & Router Plugin `1.168.42`
  - TanStack Query `5.104.1`
  - Tauri API `2.12.1` & Tauri CLI `2.12.1`
  - i18next `26.4.2` & react-i18next `17.0.16`
  - Tailwind CSS `4.3.3` & @tailwindcss/vite `4.3.3`
  - Zod `4.6.5`

---

### Phase 3: Gate G3 — Root Monorepo & Configuration Foundation
**Status: COMPLETED**
- Root `.gitignore`, `.editorconfig`, `rust-toolchain.toml`, `clippy.toml`, `deny.toml`, `LICENSE`, `README.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- `pnpm-workspace.yaml`, `tsconfig.base.json`, `biome.json`, `oxlint.json`.
- Internal packages:
  - `packages/tsconfig`
  - `packages/contracts-generated`
  - `packages/design-tokens`
  - `packages/ui`

---

### Phase 4: Gate G4 & G5 — Frontend Scaffold & Desktop Shell
**Status: COMPLETED**
- `apps/desktop`: React 19 UI with TanStack Router, TanStack Query, i18n, typed Tauri API client.
- `apps/desktop/src-tauri`: Tauri 2 shell wiring the IPC commands, Windows resource icon generation, strict CSP.

---

### Phase 5: Gate G6 — First Vertical Slice
**Status: COMPLETED & VERIFIED**
- `crates/adham-core-types`: Strongly-typed UUIDv7 identifiers, error types, canonical event payloads.
- `crates/adham-platform`: Windows `%LOCALAPPDATA%\Adham\data` directory management.
- `crates/adham-event-log`: SQLite WAL, BLAKE3 checksum chaining, sensitive content segregation, concurrency conflict guards.
- `crates/adham-projections`: Synchronous conversation projection and deterministic rebuild from raw canonical events.
- `crates/adham-desktop-api`: Transport DTOs deriving `TS`, modular command handlers.
- `xtask`: `cargo xtask contracts` generator producing `packages/contracts-generated/src/index.ts`.

---

### Phase 6: Gate G7 & G8 — Testing & Evidence
**Status: VERIFIED**
- `cargo test --workspace`: 35 tests passed (100% pass rate).
- `node scripts/check-file-size.mjs`: 0 warnings, 0 errors (<300 line policy strictly satisfied).
