# Adham (`adham.si`)

**The only AI application you need** — a private, extensible desktop workspace where people and intelligent agents work together safely.

---

## Architecture Overview

Adham is built as a **domain-driven modular monolith** in a Cargo + pnpm monorepo:
- **Desktop Shell:** Tauri 2 thin command layer validating transport input.
- **Backend Core:** Memory-safe Rust with strict bounded contexts.
- **Durable Event Log:** SQLite in WAL mode with BLAKE3 previous-checksum chaining.
- **Frontend UI:** React 19, strict TypeScript, Vite, TanStack Router, TanStack Query, and Tailwind CSS v4.
- **Security & Privacy:** Local-first by default; project-isolated filesystem roots; no ambient cloud egress.

---

## Repository Structure

```
adham.si/
├── apps/
│   └── desktop/                 # React 19 / Vite UI & src-tauri shell
├── crates/
│   ├── adham-core-types/        # Stable newtype IDs, domain errors, value objects
│   ├── adham-session/           # Workspace, project, and session lifecycle
│   ├── adham-event-log/         # Append-only journal, SQLite WAL adapter
│   ├── adham-projections/       # Deterministic rebuildable projections
│   ├── adham-platform/          # OS paths, credentials, directory capabilities
│   └── adham-desktop-api/       # Transport DTOs & error envelopes
├── packages/
│   ├── contracts-generated/     # Committed TypeScript DTOs from ts-rs
│   ├── design-tokens/           # Brand (#2B2BFF) and neutral color tokens
│   └── ui/                      # Custom accessible Adham UI components
├── schemas/                     # Versioned JSON schemas for events and IPC
└── docs/                        # Architecture contracts and evidence reports
```

---

## Prerequisites

- **Rust:** `1.85+` stable with MSVC toolchain on Windows.
- **Node.js:** Node 24 LTS (`24.x`).
- **pnpm:** `10.33.2`.
- **Windows Prerequisites:** Visual Studio Build Tools (C++ tools) and Microsoft Edge WebView2 runtime.

---

## Development

```bash
# Install frontend dependencies
pnpm install

# Run static quality checks
pnpm check

# Launch the desktop app in development
pnpm --filter @adham/desktop dev
```

---

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.
