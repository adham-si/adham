# Settings Modal Architecture & Wiring Plan

**Date:** 2026-10-07  
**Status:** Approved & Ready for Execution  
**Source Specs:**
- `docs/Frontend UX — Settings architecture.md` (§1 Modal Structure, §2 Navigation, §7 Providers, §14 Appearance)
- `docs/Engineering — Initial repository architecture-and-setup instructions.md` (§6 Frontend Widgets: `settings-modal/`)
- `docs/Design system — tokens & components.md` (Zero magic values, CVA Dialog & Button primitives)

---

## 1. Intent & Architectural Overview

Implement the Adham Settings modal overlay specified in `docs/Frontend UX — Settings architecture.md`:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ ⚙ Settings                                                              [✕] │
├──────────────────────────┬──────────────────────────────────────────────────┤
│ [🔍 Search settings... ] │ Appearance & Language                            │
│                          │ Customize interface theme, typography, & locale  │
│ PERSONAL                 ├──────────────────────────────────────────────────┤
│ • General                │ Theme                                            │
│ • Appearance & Language  │ [ Light ] [ Dark ] [ System ]                    │
│ • Keyboard Shortcuts     │                                                  │
│                          │ Language                                         │
│ INTELLIGENCE             │ [ English ] [ العربية ] [ 中文 ] [ Русский ]     │
│ • Models & Providers     ├──────────────────────────────────────────────────┤
│ • Routing & Fallbacks    │ Interface Density                                │
│                          │ [ Compact ] [ Default ]                          │
│ WORKSPACE & PRIVACY      ├──────────────────────────────────────────────────┤
│ • Privacy & Data         │ Reduced Motion                                   │
│ • Storage & Backup       │ Respect OS settings                              │
│                          │                                                  │
│ EXTENSIONS               │                                                  │
│ • Skills, MCP & Plugins  │                                                  │
└──────────────────────────┴──────────────────────────────────────────────────┘
```

---

## 2. Step-by-Step Implementation Plan

### Step 1: Layout Context & Navigation Rail Wiring
- Update `ShellLayoutContextValue` in `apps/desktop/src/widgets/shell/layout-context.tsx`:
  - `settingsOpen: boolean`
  - `openSettings: (tab?: string) => void`
  - `closeSettings: () => void`
  - `activeSettingsTab: string` (persisted in session, default `'appearance'`)
- Wire Settings icon in `apps/desktop/src/widgets/shell/navigation-rail.tsx` to `openSettings()`.

### Step 2: Settings Widget (`apps/desktop/src/widgets/settings/`)
- Create `Settings` in `apps/desktop/src/widgets/settings/settings.tsx`:
  - Full-featured overlay using modal presentation with accessible backdrop scrim, dialog focus, and `Esc` close.
  - Left navigation column displaying the list of settings pages:
    * Search filter input.
    * Category sections: Personal (Appearance), Intelligence (Models & Providers), Workspace (Privacy, Storage), Extensions.
    * Active page indicator.
  - Right content pane rendering the selected settings page from `widgets/settings/pages/`:
    * **Appearance & Language (`pages/appearance.tsx`):** Live theme switcher (Light / Dark / System), Language selector (EN / AR / ZH-CN / RU with automatic RTL switching), High contrast note.
    * **Models & Providers (`pages/models.tsx`):** Ollama status, default model, fallback policies.
    * **Privacy & Sandboxing (`pages/privacy.tsx`):** Workspace sandbox boundaries and telemetry policy.
    * **Storage & Recovery (`pages/storage.tsx`):** SQLite WAL mode, schema version, and projection rebuild.
    * **Extensions (`pages/extensions.tsx`):** MCP tool grants and plugin trust verification.
    * **Models & Providers:** Ollama local connection status, provider accounts, fallback policy.
    * **Privacy & Storage:** Project sandbox isolation status, SQLite WAL database path (`%LOCALAPPDATA%\Adham\data`), storage health check.
    * **Extensions:** Installed MCP tools, sandboxed plugins, and skills status.

### Step 3: i18n Localization Keys
- Extend `apps/desktop/src/shared/i18n/index.ts` with settings translations across all 4 supported languages (`en`, `ar`, `zh-CN`, `ru`).

### Step 4: Verification & Quality Gates
- Zero magic values via `node scripts/check-magic-values.mjs`.
- Typecheck via `tsc --noEmit`.
- Lint & format via `oxlint` and `biome`.
- Unit tests via Vitest verifying tab transitions, theme changes, and keyboard accessibility.
