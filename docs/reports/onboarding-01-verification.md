# ONBOARDING-01 verification evidence

Issue: adham-si/adham#27 (first-run setup journey), branch `feat/onboarding-01`,
base `4547b74c45bf17c1ba0ff3f4f0f89f8a85c1b9e1`. Synthetic canary data only
throughout; no user content, secrets, or raw app-data paths.

## Scope

- `015b102` — behavior-preserving boundary repair (feature public-API barrels; extracted `use-provision-flow`; frozen `preferredLanguage` in provisioning intent).
- `27197a2` — onboarding UX (`features/onboarding`; route gating).
- `9387911` / `22a5e28` — evidence reports + screenshots.
- Reviewer round 2 (this update) — desktop side-rail layout, journey-header
  language selector, fail-closed storage readiness, architecture analysis.

## Gate results (macOS 15 arm64, this machine)

| Gate | Result |
|------|--------|
| `pnpm check` (format:check, lint, typecheck, test, magic-values ×2, deny-exceptions ×2) | Pass, exit 0 |
| Full vitest suite | Passed (see per-file counts below) |
| Focused: `features/onboarding/onboarding.test.tsx` | 17/17 passed |
| Focused: `features/conversation/provisioning.test.tsx` (frozen-locale retry) | Passed |
| `routes-migration.test.ts`, localization 4-locale coverage (`onboarding.storageUnavailable` added in en/ar/ru/zh-CN) | Passed |

## Reviewer round 2 — implemented changes

### 1. Desktop two-column layout with side progress rail

The journey now renders a compact vertical progress rail beside the step
content on `md` and wider; below `md` it collapses to the previous horizontal
row above the content. Pure responsive classes, RTL-safe (flex logical
axes). Minimal content unchanged.

### 2. Language selector in the journey header

The compact selector moved from the Ready step to the journey header, so the
whole setup can be read in the user's language before anything is created.

Tests (`onboarding.test.tsx`):

- `switches language from the first screen and dispatches the new locale` —
  switches to Arabic on the workspace step, verifies Arabic copy, creates a
  workspace, asserts the dispatched payload carries `preferredLanguage: 'ar'`.
- `keeps the frozen request identity across an uncertain retry under a language switch` —
  first create fails uncertainly (transport error); the user switches to
  Arabic and retries; the second dispatch reuses the **same requestId** and an
  **identical payload** (including the originally frozen `preferredLanguage: 'en'`).
  Proves a live language switch cannot fork the frozen identity.
- Browser-shimmed run additionally verifies switching on the first screen
  dispatches nothing and persists across reload (`document lang/dir`).

### 3. Storage readiness is fail-closed

`readStorage()` previously mapped failed reads to `unknown`, and only
`degraded` blocked setup — leaving failed/unknown readiness non-blocking.
Now, while setup is incomplete, **only an explicit backend `ready` permits
progress**:

- Blocker states: `storage-degraded` (confirmed backend failure) and
  `storage-unavailable` (rejected read or unrecognized status), each with its
  own copy and an explicit Retry.
- Model-level guards: `createWorkspace`, `createProject`, and
  `confirmProject` early-return unless readiness is `ready` — the UI
  replacement is not the only protection.
- Tests: rejected reads → `storage-unavailable` + no mutation dispatched;
  unrecognized status → `storage-unavailable`; degraded → `storage-degraded`;
  recovery via Retry in every case; UI test asserts mutation controls are
  absent while blocked.

This finding concerns onboarding readiness gating only; it is not a claim
that backend protection was bypassed.

### 4. Architecture check — honest state and smallest correction

#### Remaining dependency graph (module-level, features only)

```
conversation ──(conversation-panel, conversation-setup-slot)──▶ workspace-selection
workspace-selection ──(use-selection, provision-dialog, use-provision-flow)──▶ conversation
onboarding ──▶ conversation (useProvisioning, announceScopeChanged)
onboarding ──▶ workspace-selection (useSelection)
routes ──▶ all three features (barrels only)
```

There is a real **module-level cycle** between `conversation` and
`workspace-selection` (panel/slot ⇄ use-selection/provision-dialog/provision-flow).
The conversation barrel's export-ordering comment exists precisely to let
barrel-level cycles resolve — i.e. the public API improves the interface but
does **not** establish domain ownership. `use-provisioning.ts` (workspace and
project creation) living under `conversation` is the concrete ownership gap:
it is consumed by workspace-selection and onboarding, and its only intra-feature
dependency is `conversation-identity.ts`.

#### Smallest correction (proposed, not implemented)

Extract one leaf feature, `features/provisioning/`, containing exactly two
moved files — `use-provisioning.ts` and `conversation-identity.ts` (identity ←
provisioning is the only internal edge) — with its own explicit barrel.
Resulting graph becomes a DAG:

```
provisioning (leaf) ◀── workspace-selection ◀── conversation
provisioning ◀── onboarding, routes
```

Blast radius: ~16 files, mechanical import-line updates only (12 conversation
internals that consume identity/provisioning, 3 workspace-selection modules,
1 onboarding model); no logic changes; the barrel cycle-ordering comment is
deleted. Deliberately NOT implemented in this PR — flagged for reviewer
approval before a follow-up commit, per "avoid a broad restructure".

## Visual review — browser-shimmed captures (NOT native proof)

Method: vite dev server (port 11111) driven by Playwright/Chromium with
`window.__TAURI_INTERNALS__.invoke` shimmed to a synthetic canary backend
before any app script runs. The real UI code renders; only the transport is
mocked. The reviewer's reference images were unavailable on #27, so layout
follows the amendment's textual spec. Captures in `docs/reports/evidence/`:

| State | File | Result |
|-------|------|--------|
| Loading / checking | `onboarding-01-loading.png` | "Checking your setup…" with step rail |
| Workspace step (existing + create, desktop side rail) | `onboarding-01-workspace-step.png` | Two-column: vertical rail + content; header language selector |
| Focus / keyboard | `onboarding-01-focus-keyboard.png` | Tab reaches existing-workspace entry; Enter selects; Enter in name field submits |
| Project step | `onboarding-01-project-step.png` | Target-workspace card, existing project list, create form |
| Ready step | `onboarding-01-ready-step.png` | Confirmed scope summary, "Open Adham" |
| Error + retry | `onboarding-01-error-retry.png` | `role=alert` + Retry; retry recovers |
| Storage degraded | `onboarding-01-storage-degraded.png` | Blocker message + Retry |
| Storage unavailable (failed read) | `onboarding-01-storage-unavailable.png` | Unavailable blocker, no mutation controls; Retry recovers |
| Arabic RTL | `onboarding-01-arabic-rtl.png` | Full RTL mirroring incl. side rail, Arabic copy |
| Narrow 700 px (rail collapsed) | `onboarding-01-narrow-700px.png` | Rail collapses above content; no horizontal overflow |

Automated assertions in the same run: no create/select dispatch on mount;
language switch to Arabic on the first screen dispatches nothing and survives
reload; Retry recovers both error and unavailable states; blocked state shows
no input controls; 700 px viewport has no horizontal overflow.

Caveat: the error-state screenshot shows the shim's raw error text; the real
client throws serialized error envelopes that the hooks map to localized
messages.

## Flow coverage (automated, jsdom)

| Flow | Covered by |
|------|-----------|
| Fresh install → workspace step; nothing dispatched on mount | `useOnboarding` tests |
| Interrupted workspace-without-project → resumes at project step | `useOnboarding` tests |
| Fully provisioned returning install → journey bypassed | `useOnboarding` tests |
| Failed state read → error phase with Retry, never an empty setup | model + journey tests |
| Degraded storage → `storage-degraded` blocker; recovers | model + journey tests |
| Rejected readiness read → `storage-unavailable`; mutations blocked at model; recovers | model + journey tests |
| Unrecognized readiness status → `storage-unavailable` | model test |
| Failed project list → failure + Retry, never shown as empty | model test |
| Happy path: create workspace → create project → ready → Open Adham | `OnboardingJourney` test |
| Existing workspace → confirm existing project (no creation calls) | `OnboardingJourney` test |
| Language switch before creation dispatches the new locale | `OnboardingJourney` test |
| Frozen request identity survives a language switch mid-uncertain-retry | `OnboardingJourney` test |
| Step rail marks and advances the current step | `OnboardingJourney` test |

## Real-backend native verification — BLOCKED on all platforms

No native run was executed. Named next action per platform (exact commands):

| Platform | Status | Next action |
|----------|--------|-------------|
| macOS (arm64) | Not tested natively | On a Mac: `pnpm install && pnpm tauri dev`, then walk: fresh setup, relaunch (resume), kill mid-create + relaunch (frozen-identity replay), lock/corrupt storage (degraded + unavailable blockers), restart persistence, duplicate-creation check |
| Windows (x64) | Not tested | Same flow on a Windows host with MSVC toolchain via `pnpm tauri dev` |
| Linux (declared target) | Not tested | Same flow on a Linux host with webkit2gtk via `pnpm tauri dev` |

What native proof must still show: fresh setup, existing setup,
interruption/relaunch, failed-read recovery, restart persistence, no
duplicate workspace/project/session creation, no stale-scope sending. The
first five have automated analogues (jsdom, injected backends);
duplicate-creation and stale-scope protection are covered by frozen-identity
unit tests but **not** by a native end-to-end run. Browser mocks do not
substitute for this.

## Copy and interaction review

- Copy limited to the amendment; new `storageUnavailable` message added for
  the fail-closed blocker; all four locales covered by the parity test.
- Optional settings stay outside onboarding: the only in-journey setting is
  the compact language selector (now in the journey header, per review);
  theme and everything else remain in Settings.
- Focus/keyboard: Tab reaches journey controls, Enter selects and submits;
  `aria-current="step"`, `aria-pressed`, `role="alert"`, `aria-busy` in place.
- Scrolling/resize: rail collapses below `md`; 700×760 has no horizontal
  overflow; step content `max-w-md`, journey region scrolls internally.
- Language persistence: header switch sets `document lang/dir` (RTL for
  Arabic) and survives reload — verified in the shimmed run.

## Remaining not tested

- Native end-to-end on any OS (see matrix above).
- Screen-reader session (NVDA/VoiceOver) — semantics asserted in DOM only.
- Touch-only input paths.
