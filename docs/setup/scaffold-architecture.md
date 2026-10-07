# Scaffold Architecture & Wiring Specification

**Date:** 2026-10-06  
**Status:** Implemented & Verified  

---

## 1. Monorepo Structural Blueprint

The repository is structured as a domain-driven modular monolith combining a Cargo workspace for Rust crates and a pnpm workspace for TypeScript packages and desktop frontend:

```
adham.si/
├── Cargo.toml                    # Root Rust workspace (resolver = "2")
├── package.json                  # Root pnpm monorepo manifest
├── pnpm-workspace.yaml           # Monorepo packages selector
├── biome.json                    # Biome 2.5 formatter & import sorter
├── oxlint.json                   # Oxlint 1.87 type-aware linter
├── tsconfig.base.json            # Strict TypeScript 7 configuration
├── rust-toolchain.toml           # Stable 1.96.0 toolchain pinning
├── clippy.toml & rustfmt.toml    # Clippy (-D warnings) & rustfmt config
├── deny.toml                     # Cargo deny license allowlist
│
├── apps/
│   └── desktop/                  # Desktop application
│       ├── package.json          # React 19 + TanStack + Tauri client
│       ├── vite.config.ts        # Vite 8 bundler configuration
│       ├── src/                  # React 19 UI
│       │   ├── app/providers/    # QueryProvider, ThemeProvider
│       │   ├── shared/api/       # adhamClient typed Tauri IPC boundary
│       │   ├── shared/i18n/      # i18next resources (en, ar, zh-CN, ru)
│       │   └── routes/           # TanStack file-based routing
│       └── src-tauri/            # Tauri 2 Desktop Shell
│           ├── Cargo.toml        # Workspace member (no isolated [workspace])
│           ├── tauri.conf.json   # si.adham.desktop, strict CSP, core:default
│           ├── capabilities/     # default.json allowlist
│           ├── icons/            # Generated Windows ICO & PNG assets
│           └── src/lib.rs        # State injection & IPC command routing
│
├── crates/
│   ├── adham-core-types/         # Strongly-typed UUIDv7 IDs, errors, events
│   ├── adham-platform/           # Storage path resolution (%LOCALAPPDATA%\Adham)
│   ├── adham-event-log/          # SQLite WAL event store, BLAKE3, segregation
│   ├── adham-projections/        # Synchronous conversation projection & replay
│   └── adham-desktop-api/        # Transport DTOs (ts-rs) & domain handlers
│
├── packages/
│   ├── contracts-generated/      # Auto-generated TypeScript types (xtask)
│   ├── design-tokens/            # Core CSS custom properties & brand tokens
│   ├── tsconfig/                 # Shared TypeScript base configs
│   └── ui/                       # Accessible Button & UI primitives
│
├── scripts/
│   ├── check-file-size.mjs       # Strict file-size policy enforcement
│   └── generate-icons.mjs        # Native Windows ICO and PNG generator
│
└── xtask/                        # `cargo xtask contracts` generator
```

---

## 2. First Vertical Slice Wiring

The first vertical slice implements an unbroken end-to-end data flow:

1. **User Action:** Human inputs a message on the Desktop UI (`apps/desktop/src/routes/index.tsx`).
2. **IPC Boundary:** Message is encapsulated in typed `CommandEnvelope` by `adhamClient` (`shared/api/adham-client.ts`) and submitted via `submit_message`.
3. **Idempotency Guard:** `handle_submit_message` in `adham-desktop-api` inspects `command_receipts` in SQLite. If duplicate, cached result is immediately returned.
4. **Sensitive Content Segregation:** Message plaintext is stored directly in `content_records` (keyed by `ContentId`), completely isolated from the event metadata.
5. **Event Log Appending:** Canonical `MessageSubmittedV1` event is constructed, hashed with previous event hash using **BLAKE3**, and inserted into `events` table with monotonic sequence checks in `streams`.
6. **Synchronous Projection:** `conversation_messages` projection is populated with message metadata and indexed for zero-latency queries.
7. **Idempotency Receipt:** Outcome code and response JSON are committed to `command_receipts`.
8. **UI Presentation:** `adhamClient` resolves the result; TanStack Query updates the conversation view seamlessly.
9. **Deterministic Rebuild:** Calling `admin_rebuild_projections` wipes `conversation_messages` and replays all events from `events` table in strict `global_position` order, restoring projection state with 100% fidelity.
