# Frontend Application Shell & Layout Plan

**Date:** 2026-10-07  
**Status:** Approved & Ready for Execution  
**Source Specs:** 
- `docs/Frontend UX — Compose & agent workspace.md` (§1 Shell, §20 Responsive, §21 Acceptance)
- `docs/Design system — tokens & components.md` (Design tokens, CVA primitives, 0 magic values)

---

## 1. Intent & Architectural Overview

Transform the single-column desktop prototype into Adham's 3-pane responsive desktop application shell specified in `docs/Frontend UX — Compose & agent workspace.md`:

```
┌────┬──────────────────────┬─────────────────────────────────────┬──────────────────┐
│ R  │  PRIMARY SIDEBAR     │        CENTRAL WORKSPACE            │  CONTEXT PANEL   │
│ A  │  (247px - 600px)     │                                     │  (300px, opt)    │
│ I  ├──────────────────────┼─────────────────────────────────────┼──────────────────┤
│ L  │ • Workspace switcher │ • Header Chrome (Breadcrumb/Status) │ • Tab bar:       │
│    │ • Current Project    │ • Empty calm state / Timeline       │   Plan, Activity,│
│ 40 │ • [+ New Task]       │ • Docked Expanding Composer         │   Graph, Agents, │
│ px │ • Sessions list      │   - Upper row: agent chip           │   Context, Cost  │
│    │ • Pinned / Recent    │   - Input: multiline text           │ • Tab inspector  │
│    │ • Resize handle      │   - Lower row: mode, model, send    │ • Close button   │
│    ├──────────────────────┴─────────────────────────────────────┴──────────────────┤
│    │ [⚙ Settings / Theme]                                                          │
└────┴───────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Step-by-Step Implementation Plan

### Step 1: Layout State & i18n Strings
- Create `useShellLayout` context / hook in `apps/desktop/src/widgets/shell/layout-context.tsx`:
  - `sidebarOpen: boolean` (persisted in `localStorage`, default `true`)
  - `sidebarWidth: number` (clamped 247px–600px, persisted, default `260px`)
  - `contextPanelOpen: boolean` (persisted, default `false`)
  - `contextPanelTab: string` (default `'plan'`)
  - `focusMode: boolean` (default `false`; when active, hides rail, sidebar, and context panel)
- Add comprehensive i18n keys to `apps/desktop/src/shared/i18n/index.ts` across `en`, `ar`, `zh-CN`, and `ru`:
  - Rail: `compose`, `search`, `projects`, `agents`, `activity`, `marketplace`, `settings`, `toggleSidebar`, `focusMode`
  - Sidebar: `workspace`, `project`, `newTask`, `recentSessions`, `noSessions`
  - Context Panel: `tabs.plan`, `tabs.activity`, `tabs.graph`, `tabs.agents`, `tabs.context`, `tabs.artifacts`, `tabs.cost`

### Step 2: Navigation Rail (`40px` Fixed Start Rail)
- Create `NavigationRail` component (`apps/desktop/src/widgets/shell/navigation-rail.tsx`):
  - Fixed `w-10` (`40px`), positioned on the logical start edge.
  - Top: Brand icon + sidebar toggle button (`SidebarItem` / button with `AdhamIcon`).
  - Middle: Destination icons (Compose, Search, Projects, Agents, Activity, Marketplace).
  - Bottom: Focus mode toggle, theme switcher, settings icon.
  - Direction-safe: Uses logical borders (`border-e border-border-subtle`) and logical spacing (`ps-`, `pe-`).

### Step 3: Primary Collapsible & Resizable Sidebar (`247px` - `600px`)
- Create `PrimarySidebar` component (`apps/desktop/src/widgets/shell/primary-sidebar.tsx`):
  - Collapsible container with animated transition and `aria-expanded`.
  - Workspace selector & Current project badge.
  - Primary "+ New session / task" button (`Button` variant `secondary` or `primary`).
  - Session items list using `@adham/ui` `SidebarItem` with active indicator.
  - Draggable resize handle on the end boundary (`w-1 cursor-col-resize hover:bg-focus`).

### Step 4: Central Workspace & Refined Composer
- Refactor `apps/desktop/src/routes/index.tsx` into a composed workspace:
  - Header: Breadcrumb (Workspace > Project > Session), Status badge ("Ready" / "Loading"), Focus mode toggle, and Context panel trigger.
  - Calm Empty State: Centered greeting (`What would you like to work on?`), brand icon, suggestion prompts ("Analyze code", "Plan release", "Audit tests").
  - Conversation Timeline: Message stream with role labels, markdown reading typography, timestamp.
  - Docked Composer:
    - Upper row: Active agent / manager chip (`CTO / Manager`).
    - Input: Textarea with `min-h-control-md` and `Enter` to send.
    - Lower control row: Mode selector badge (`Ask` / `Plan` / `Execute`), Model selector (`Auto route`), Privacy indicator (`Local`), and Send button.

### Step 5: Collapsible Context Panel (`300px` Right Inspector)
- Create `ContextPanel` component (`apps/desktop/src/widgets/shell/context-panel.tsx`):
  - Header with tab buttons: Plan, Activity, Graph, Agents, Context, Artifacts.
  - Tab body showing current task plan checklist, runtime activity feed, or context files.
  - Collapse / close affordance with `Esc` or header button.

### Step 6: Responsive Adaptation & Quality Verification
- Responsive rules (§20):
  - Below `1024px`, context panel automatically collapses.
  - Below `768px`, primary sidebar overlays rather than compressing center width.
  - Rail remains accessible at all sizes.
- Verification gates:
  - Magic-value checks (`pnpm check:magic-values`) — ensure 100% semantic token compliance.
  - Strict typecheck (`tsc --noEmit`).
  - Linter & formatter (`oxlint`, `biome`).
  - Test suite (`vitest run`).
