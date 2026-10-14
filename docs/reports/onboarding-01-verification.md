# ONBOARDING-01 verification evidence

Issue: adham-si/adham#27 (first-run setup journey), branch `feat/onboarding-01`,
base `4547b74c45bf17c1ba0ff3f4f0f89f8a85c1b9e1`, head `9387911e436b875858e425bfa0e7a2c33310c4a8`
(+ this report update). Synthetic canary data only throughout; no user content,
secrets, or raw app-data paths.

## Scope

- Commit `015b102` — behavior-preserving boundary repair (cross-feature imports via feature public APIs; extracted `use-provision-flow`; frozen `preferredLanguage` in provisioning intent).
- Commit `27197a2` — new onboarding UX (`features/onboarding`: model hook, journey surface, step rail, workspace/project/ready steps, compact language selector; route gating in `routes/index.tsx`).

## Gate results (macOS 15 arm64, this machine)

| Gate | Result |
|------|--------|
| `pnpm check` (format:check, lint, typecheck, test, magic-values ×2, deny-exceptions ×2) | Pass, exit 0 |
| Full vitest suite | 46 files / 546 tests passed |
| Focused: `features/onboarding/onboarding.test.tsx` | 12/12 passed |
| Focused: `features/conversation/provisioning.test.tsx` (incl. new frozen-locale retry test) | Passed |
| `routes-migration.test.ts`, localization 4-locale coverage (new `onboarding.*` keys in en/ar/ru/zh-CN) | Passed |

## Visual review — browser-shimmed captures (NOT native proof)

Method: vite dev server (port 11111) driven by Playwright/Chromium with
`window.__TAURI_INTERNALS__.invoke` shimmed to a synthetic canary backend
before any app script runs. The real UI code renders; only the transport is
mocked. The reviewer's reference images were unavailable on #27, so layout
follows the amendment's textual spec. Captures in `docs/reports/evidence/`:

| State | File | Result |
|-------|------|--------|
| Loading / checking | `onboarding-01-loading.png` | "Checking your setup…" with step rail |
| Workspace step (existing + create) | `onboarding-01-workspace-step.png` | Rail, heading, hint, existing list, name input, primary action |
| Focus / keyboard | `onboarding-01-focus-keyboard.png` | Tab reaches existing-workspace entry; Enter selects it; Enter in name field submits form |
| Project step | `onboarding-01-project-step.png` | Target-workspace card, existing project list, create form |
| Ready step | `onboarding-01-ready-step.png` | Confirmed scope summary, compact language selector, "Open Adham" |
| Error + retry | `onboarding-01-error-retry.png` | `role=alert` + Retry; retry recovers to workspace step |
| Storage degraded | `onboarding-01-storage-degraded.png` | Blocker message + Retry |
| Arabic RTL | `onboarding-01-arabic-rtl.png` | Full RTL mirroring (rail, alignment, titlebar), Arabic copy |
| Narrow 700 px | `onboarding-01-narrow-700px.png` | No horizontal overflow, layout intact |

Automated assertions in the same run: no create/select dispatch on mount;
language switch to Arabic sets `document lang/dir` and survives reload;
Retry recovers a failed read; 700 px viewport has no horizontal overflow.

Caveat: the error-state screenshot shows the shim's raw error text; the real
client throws serialized error envelopes that the hooks map to localized
messages (`selection.workspacesFailed` etc.).

## Architecture review

### Path/import map (before → after)

| Importer | Before | After |
|----------|--------|-------|
| `routes/index.tsx` | `@/features/conversation/conversation-panel`, `.../use-project-sessions`, `@/features/workspace-selection/{use-selection,workspace-selection,provision-dialog}`, `announceScopeChanged` from `conversation-identity` | `@/features/conversation` + `@/features/workspace-selection` barrels only; `@/features/onboarding` |
| `conversation-panel.tsx` | `../workspace-selection/use-selection` | `../workspace-selection` |
| `conversation-setup-slot.tsx` | `../workspace-selection/workspace-selection`, `use-selection` | `../workspace-selection` |
| `provision-dialog.tsx` | `../conversation/use-provisioning` | `../conversation` |
| `use-selection.ts` | `../conversation/conversation-identity` | `../conversation` |
| pending-recovery tests, `workspace-selection.test.tsx`, `selection-journey.test.tsx` | feature internals | feature barrels |
| new `features/onboarding/*` | — | `../../conversation`, `../../workspace-selection` barrels; `@/shared/i18n`, `@/shared/api` |

### Boundary properties

- Barrels are explicit named-export lists (no `export *`): they define the
  supported surface per feature. Honest limit: enforcement is by convention +
  review — oxlint has no import-boundary rule configured in this repo yet.
- Authority stays where it was: provisioning (frozen-identity creation) in
  `features/conversation/use-provisioning.ts`; selection (frozen-identity
  selection + discovery) in `features/workspace-selection/use-selection.ts`;
  sessions in `features/conversation/use-project-sessions.ts`. The onboarding
  model composes these public hooks and adds only journey state (current step,
  resume seeding, storage-blocker read) — no backend calls are re-implemented.
- `routes/index.tsx` composes and gates only: it wires feature results into
  the shell and swaps to the journey while setup is incomplete. Dialog/scope
  orchestration that previously lived in the route moved into
  `useProvisionFlow` (workspace-selection) in commit 1.
- One selection-discovery instance is live at a time: during setup the app
  body (and its `useProvisionFlow` instance) is unmounted; after "Open Adham"
  the journey's instance is disabled (`enabled: !entered`).

## Real-backend native verification — BLOCKED on all platforms

No native run was executed. Named next action per platform (exact commands):

| Platform | Status | Next action |
|----------|--------|-------------|
| macOS (arm64) | Not tested natively | On a Mac: `pnpm install && pnpm tauri dev`, then walk: fresh setup, relaunch (resumes at project step if workspace exists), kill mid-create + relaunch (frozen-identity replay), corrupt/lock storage (degraded blocker), restart persistence, duplicate-creation check |
| Windows (x64) | Not tested | Same flow on a Windows host with MSVC toolchain via `pnpm tauri dev` |
| Linux (declared target) | Not tested | Same flow on a Linux host with webkit2gtk via `pnpm tauri dev` |

What native proof must still show (per review checklist): fresh setup,
existing setup, interruption/relaunch, failed-read recovery, restart
persistence, no duplicate workspace/project/session creation, no stale-scope
sending. The first five have automated analogues (jsdom, injected backends);
duplicate-creation and stale-scope protection are covered by the
frozen-identity unit tests (`provisioning.test.tsx`,
`use-selection` journey tests) but **not** by a native end-to-end run.
Browser mocks do not substitute for this.

## Copy and interaction review

- Copy limited to the amendment: "Set up your workspace", "Create your first
  project", "Your workspace is ready", Back/Continue/Create workspace/Create
  project/Open Adham, short one-line descriptions. No AI slogans, surveys, or
  preferences step. Verified in all four locales by the coverage test.
- Optional settings stay outside onboarding: the only in-journey setting is
  the compact language selector on the ready step (explicitly permitted);
  theme and everything else remain in Settings.
- Focus/keyboard: Tab reaches journey controls (focus ring visible in
  capture), Enter selects the focused entry and submits the name form,
  buttons are real `<button>`/`<form>` semantics; `aria-current="step"` on
  the rail, `aria-pressed` on picks, `role="alert"` on failures, `aria-busy`
  while checking.
- Scrolling/resize: 700×760 viewport has no horizontal overflow; step content
  is `max-w-md` centered with `overflow-y-auto` on the journey region.
- Language persistence: switching language at the ready step sets
  `document lang/dir` (RTL for Arabic) and survives reload (localStorage
  `adham.language`) — verified in the shimmed run.

## Remaining not tested

- Native end-to-end on any OS (see matrix above).
- Screen-reader session (NVDA/VoiceOver) — semantics asserted in DOM only.
- Touch-only input paths.
