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

### Step 2: Settings Modal Widget (`apps/desktop/src/widgets/settings/`)
- Create `SettingsModal` in `apps/desktop/src/widgets/settings/settings-modal.tsx`:
  - Full-featured overlay with accessible backdrop scrim, dialog focus trapping, and `Esc` close.
  - Left navigation column:
    * Search filter input.
    * Category sections: Personal (General, Appearance), Intelligence (Models & Providers), Privacy & Storage, Extensions.
    * Active tab indicator.
  - Right content pane with tab views:
    * **Appearance & Language:** Live theme switcher (Light / Dark / System), Language selector (EN / AR / ZH-CN / RU with automatic RTL switching), Density selector.
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
