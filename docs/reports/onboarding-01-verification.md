# ONBOARDING-01 verification evidence

Issue: adham-si/adham#27 (first-run setup journey), branch `feat/onboarding-01`,
base `4547b74c45bf17c1ba0ff3f4f0f89f8a85c1b9e1`. Synthetic canary data only
throughout; no user content, secrets, or raw app-data paths.

## Scope

- `015b102` — behavior-preserving boundary repair (feature public-API barrels; extracted `use-provision-flow`; frozen `preferredLanguage` in provisioning intent).
- `27197a2` — onboarding UX (`features/onboarding`; route gating).
- `9387911` / `22a5e28` — evidence reports + screenshots.
- Reviewer round 2 — desktop side-rail layout, journey-header language selector, fail-closed storage readiness, architecture analysis.
- Reviewer round 3 — `c892697` behavior-preserving dependency repair (provisioning leaf feature, ownership delimitation, shared helpers, barrel-workaround removal); follow-up evidence commit adds the readiness-recheck regression and the native compile/launch record below.
- Reviewer round 4 — `e034e62` (this revision) — full-context two-column journey page: the route renders the journey inside the shell's `Context` card (app default layout) and the journey splits into a guide column (step rail + per-step showcase + decorative preview) and a form column; showcase copy added in all four locales; guide-column test added.

## Gate results (macOS arm64, this machine)

| Gate | Result |
|------|--------|
| `pnpm check` (format:check, lint, typecheck, test, magic-values ×2, deny-exceptions ×2) | Pass, exit 0 |
| Full vitest suite | **46 test files / 553 tests passed** |
| Focused: `features/onboarding/onboarding.test.tsx` | 19/19 passed (incl. round-3 regression, round-4 guide-column test) |
| Focused: `features/provisioning/provisioning.test.tsx` (frozen-locale retry; moved, unchanged) | Passed |
| `routes-migration.test.ts`, localization 4-locale coverage (`onboarding.storageUnavailable` in en/ar/ru/zh-CN) | Passed |
| Native: `cargo build -p adham-desktop` | **Pass**, exit 0 (see Native verification) |
| Native: launch of `target/debug/adham-desktop` | **Pass**, alive 8 s, backend booted (see Native verification) |

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

#### Dependency graph before the repair (module-level, features only)

```
conversation ──(conversation-panel, conversation-setup-slot)──▶ workspace-selection
workspace-selection ──(use-selection, provision-dialog, use-provision-flow)──▶ conversation
onboarding ──▶ conversation (useProvisioning, announceScopeChanged)
onboarding ──▶ workspace-selection (useSelection)
routes ──▶ all three features (barrels only)
```

There was a real **module-level cycle** between `conversation` and
`workspace-selection` (panel/slot ⇄ use-selection/provision-dialog/provision-flow).
The conversation barrel's export-ordering comment existed precisely to let
barrel-level cycles resolve — i.e. the public API improved the interface but
did **not** establish domain ownership. `use-provisioning.ts` (workspace and
project creation) living under `conversation` was the concrete ownership gap:
it is consumed by workspace-selection and onboarding, and its only intra-feature
dependency was `conversation-identity.ts`.

#### Smallest correction — revised and implemented (`c892697`)

The original proposal moved `conversation-identity.ts` wholesale; the
reviewer correctly rejected that, since the file also owns session caching,
pending sends, session-creation intents, and send-blocking rules. The
revised, responsibility-based split:

| Responsibility | Before | After |
|----------------|--------|-------|
| `useProvisioning` hook + `ProvisioningBackend`/`ProvisionOutcome` | `conversation/use-provisioning.ts` | `features/provisioning/use-provisioning.ts` |
| Frozen workspace/project provisioning intents (`PROVISION_WS_KEY`, `PROVISION_PROJ_KEY`, `read/write/clearWorkspaceIntent`, `read/write/clearProjectIntent`, `ProvisionIntent`) | `conversation/conversation-identity.ts` | `features/provisioning/provision-intent.ts` |
| Shared scope event (`SCOPE_CHANGED_EVENT`, `announceScopeChanged`, `ScopeChangedDetail`) | `conversation/conversation-identity.ts` | `features/provisioning/scope-event.ts` |
| Frozen selection identity (`adham:select:intent`, `read/write/clearSelectIntent`, `SelectIntent`) | `conversation/conversation-identity.ts` | `features/provisioning/select-intent.ts` |
| Session cache, pending send, session-creation intent, `sameScope`, send-blocking rules (`unresolvedSelectionMessage`, `sendBlockedReason`) | `conversation/conversation-identity.ts` | **stays** in `conversation/conversation-identity.ts` (owner unchanged) |
| Generic sessionStorage wrappers (`readStorage`, `writeStorage`, `removeStorage`) | `conversation/conversation-identity.ts` | `shared/lib/session-storage.ts` (no domain rules) |
| Error-envelope classification (`isDefinitePreEffectRejection`, `rejectionMessage`, code/messageKey whitelists) | `conversation/conversation-identity.ts` | `shared/api/error-envelope.ts` (envelope shape only; policy stays with callers) |

Public API map after the repair:

- `features/provisioning/index.ts` — `useProvisioning`, `ProvisioningBackend`,
  `ProvisionOutcome`, `announceScopeChanged`, `SCOPE_CHANGED_EVENT`,
  `ScopeChangedDetail`, `read/write/clearSelectIntent`, `SelectIntent`,
  `read/write/clearWorkspaceIntent`, `read/write/clearProjectIntent`,
  `ProvisionIntent`.
- `features/conversation/index.ts` — **only** `ConversationPanel`,
  `ConversationPanelProps`, `useProjectSessions`. The export-ordering
  comment that anticipated barrel-level cycles is **deleted**; no domain is
  re-exported through it.
- `shared/lib/session-storage.ts`, `shared/api/error-envelope.ts` — imported
  directly by path (no shared barrel exists in this codebase).

Invariant preservation (code motion only): storage key strings
(`adham:provision:*`, `adham:select:intent`, `adham:compose:*`), JSON
payload shapes, `crypto.randomUUID()` request IDs, frozen-retry semantics,
and the event name `adham:scope-changed` are byte-identical to before.

#### Import graph verification (acyclic)

Runtime cross-feature edges resolved from source after the repair:

```
conversation     -> [provisioning, workspace-selection]
onboarding       -> [provisioning, workspace-selection]
workspace-selection -> [provisioning]
provisioning     -> []            (leaf: shared infrastructure only)
```

DFS over this graph reports **no cycle**. Notably, the former
`workspace-selection -> conversation` runtime edge is gone: selection
modules now import provisioning and shared helpers directly. Test-harness
edges that remain are one-directional and do not create module cycles:
`provisioning/provisioning.test.tsx` and
`workspace-selection/selection-journey.test.tsx` render `ConversationPanel`
as integration coverage (tests are never imported by runtime code).

## Reviewer round 4 — full-context page (this revision)

The reviewer walked the journey natively (fresh setup → create workspace →
create project → ready → Open Adham on macOS, all four steps captured in
their own screenshots) and confirmed the business logic works. Layout
feedback: the journey was a narrow centered island; it must be a
**full-context page** inside the app's default layout, two full columns —
one for the showcases/step guides, one for the input form.

Implemented in `e034e62`:

- **Shell integration** — `routes/index.tsx` now renders the journey inside
  the shell's `Context` card, so onboarding occupies the app's content
  region like any other page. This also removes the invalid nested `<main>`
  landmark (the journey root is a `div`; the Shell keeps the `main`).
- **Two full-width columns** — a guide column (vertical `StepRail` +
  per-step `StepShowcase` copy + a static, non-textual `ShowcaseMock`
  preview) beside the form column (the existing step forms, unchanged).
  Below `md` the columns stack (guide first, form second) and the whole
  page scrolls; at `md`+ each column scrolls internally. The divider is a
  logical border, so RTL mirrors correctly.
- **Guide copy** — six new keys (`guideWorkspace/guideProject/guideReady`,
  title + body) in all four locales, complementary to (not duplicating)
  the form copy. The decorative preview is pure geometry with no text, so
  it needs no translation and cannot be mistaken for data.
- **Header** — the journey header row keeps the compact language selector,
  top-right, available before anything is created.
- New journey test `renders the guide column beside the form column`
  asserts showcase copy, step rail, and form field coexist.

Model, copy of record, storage guards, and frozen-identity semantics are
untouched; this is a presentation-layer revision.


Method: vite dev server (port 11111) driven by Playwright/Chromium with
`window.__TAURI_INTERNALS__.invoke` shimmed to a synthetic canary backend
before any app script runs. The real UI code renders; only the transport is
mocked. The reviewer's reference images were unavailable on #27, so layout
follows the amendment's textual spec. Captures in `docs/reports/evidence/`:

| State | File | Result |
|-------|------|--------|
| Loading / checking | `onboarding-01-loading.png` | "Checking your setup…" inside the app Context card |
| Workspace step (existing + create, full-context page) | `onboarding-01-workspace-step.png` | Two full columns: guide (rail + "One workspace for everything" showcase + preview) \| form; header language selector |
| Focus / keyboard | `onboarding-01-focus-keyboard.png` | Tab reaches existing-workspace entry; Enter selects; Enter in name field submits |
| Project step | `onboarding-01-project-step.png` | Guide showcase swaps to "Projects keep their own storage" (two-card isolation preview); target-workspace card, existing project list, create form |
| Ready step | `onboarding-01-ready-step.png` | Guide showcase "You're set to start"; confirmed scope summary, "Open Adham" |
| Error + retry | `onboarding-01-error-retry.png` | `role=alert` + Retry; retry recovers |
| Storage degraded | `onboarding-01-storage-degraded.png` | Blocker message + Retry in the form column; guide column stays visible |
| Storage unavailable (failed read) | `onboarding-01-storage-unavailable.png` | Unavailable blocker, no mutation controls; Retry recovers |
| Arabic RTL | `onboarding-01-arabic-rtl.png` | Full RTL mirroring: guide column right, form left, Arabic showcase copy |
| Narrow 700 px (columns stacked) | `onboarding-01-narrow-700px.png` | Columns stack (guide above form); no horizontal overflow |

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
| Retry → checking: all three mutation methods dispatch nothing while readiness re-read is pending (`blocker === null` ≠ safe to proceed); reopen only after explicit ready | `useOnboarding` regression test (round 3) |
| Step rail marks and advances the current step | `OnboardingJourney` test |
| Guide column (showcase copy, rail, form) renders together | `OnboardingJourney` test (round 4) |

## Real-backend native verification — macOS compile + launch attempted, PASSED

Attempted on the available Mac at the round-3 head; the round-4 revision
(`e034e62`) changed frontend files only, so this record carries over:

| Check | Command | Result |
|-------|---------|--------|
| Compile | `cargo build -p adham-desktop` (after touching `apps/desktop/src-tauri/src/{lib,main}.rs` to force a fresh compile of the app crate) | **Pass**, exit 0 — `Compiling adham-desktop v0.1.0` → `Finished dev profile [unoptimized + debuginfo] in 3.29s`; binary `target/debug/adham-desktop` (46.5 MB) |
| Launch | vite dev on `:11111` (`pnpm --filter @adham/desktop dev`) + run `target/debug/adham-desktop` for 8 s | **Pass** — process alive after 8 s, no panic; real backend booted: embedded SQLite schema initialization logged (`adham_event_log::sqlite`, "Database schema initialized successfully"); terminated by SIGTERM only |

Environment: macOS 27.0.1, arm64 (`uname -m` → `arm64`), rustc/cargo 1.99.0
(2026-08-27/2026-09-28), Node via pnpm 10.33.2. No build or launch failure
occurred on this platform, so none is recorded.

Per-platform status after this attempt:

| Platform | Compile + launch | 7-scenario native walk | Next action for the walk |
|----------|------------------|------------------------|--------------------------|
| macOS (arm64) | **Verified this revision** (above) | **Partially tested** — the reviewer walked fresh setup natively (fresh DB → create workspace → create project → ready → Open Adham; four native screenshots + confirmation that workspace/project exist with no session) | Walk the remaining scenarios natively: relaunch mid-setup (resume), kill mid-create + relaunch (frozen-identity replay), degraded/unavailable storage blockers, restart persistence, duplicate-creation check |
| Windows (x64) | Not tested | Not tested | Same walk on a Windows host with MSVC toolchain via `pnpm tauri dev` |
| Linux (declared target) | Not tested | Not tested | Same walk on a Linux host with webkit2gtk via `pnpm tauri dev` |

What the native walk must still show: fresh setup (**done by the reviewer
natively**, human observation at the round-3 head; screenshots held by the
reviewer), relaunch/interruption, failed-read recovery, restart persistence,
no duplicate workspace/project/session creation, no stale-scope sending. The
first five have automated analogues (jsdom, injected backends);
duplicate-creation and stale-scope protection are covered by frozen-identity
unit tests but **not** by a native end-to-end run. Browser mocks do not
substitute for this.

## Copy and interaction review

- Copy limited to the amendment plus the round-4 guide copy; new
  `storageUnavailable` message added for the fail-closed blocker; all four
  locales covered by the parity test. The six guide keys
  (`guideWorkspace/guideProject/guideReady` title+body) are complementary
  to the form copy, and the decorative preview carries no text at all.
- Optional settings stay outside onboarding: the only in-journey setting is
  the compact language selector (now in the journey header, per review);
  theme and everything else remain in Settings.
- Focus/keyboard: Tab reaches journey controls, Enter selects and submits;
  `aria-current="step"`, `aria-pressed`, `role="alert"`, `aria-busy` in place.
- Scrolling/resize: columns stack below `md` (guide above form) and the
  page scrolls; at `md`+ each column scrolls internally; 700×760 has no
  horizontal overflow; form content `max-w-md`.
- Language persistence: header switch sets `document lang/dir` (RTL for
  Arabic) and survives reload — verified in the shimmed run.

## Remaining not tested

- Native 7-scenario onboarding walk: only the fresh-setup scenario has been
  walked natively (by the reviewer); the rest of the matrix above still
  applies.
- Windows/Linux compile and launch.
- Screen-reader session (NVDA/VoiceOver) — semantics asserted in DOM only.
- Touch-only input paths.
