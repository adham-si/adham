# ONBOARDING-01 verification evidence

Issue: adham-si/adham#27 (first-run setup journey), branch `feat/onboarding-01`.
Synthetic canary data only throughout; no user content, secrets, or raw app-data paths.

## Scope

- Commit `015b102` — behavior-preserving boundary repair (cross-feature imports via feature public APIs; extracted `use-provision-flow`; frozen `preferredLanguage` in provisioning intent).
- Commit `27197a2` — new onboarding UX (`features/onboarding`: model hook, journey surface, step rail, workspace/project/ready steps, compact language selector; route gating in `routes/index.tsx`).

## Gate results (macOS, this machine)

| Gate | Result |
|------|--------|
| `pnpm check` (format:check, lint, typecheck, test, magic-values ×2, deny-exceptions ×2) | Pass, exit 0 |
| Full vitest suite | 46 files / 546 tests passed |
| Focused: `features/onboarding/onboarding.test.tsx` | 12/12 passed |
| Focused: `features/conversation/provisioning.test.tsx` (incl. new frozen-locale retry test) | Passed |
| `routes-migration.test.ts`, localization 4-locale coverage (new `onboarding.*` keys in en/ar/ru/zh-CN) | Passed |

## Flow coverage (automated, jsdom)

| Flow | Covered by |
|------|-----------|
| Fresh install → workspace step; nothing dispatched on mount | `useOnboarding` tests |
| Interrupted workspace-without-project → resumes at project step (backend-confirmed) | `useOnboarding` tests |
| Fully provisioned returning install → journey bypassed (phase `complete`) | `useOnboarding` tests |
| Failed state read → error phase with Retry, never an empty setup | model + journey tests |
| Degraded storage → blocker with Retry; recovers | model + journey tests |
| Failed project list → `targetListFailed` + empty list + Retry, never shown as empty state | model test |
| Happy path: create workspace → create project → ready → Open Adham (local acknowledgment) | `OnboardingJourney` test |
| Existing workspace → Continue → existing project → confirm selection (no creation calls) | `OnboardingJourney` test |
| Step rail marks current step and moves forward | `OnboardingJourney` test |
| Uncertain creation retry reuses frozen request identity/payload | `provisioning.test.tsx` (commit 1) |

## Not tested

- **Screenshots of the running app (macOS/Windows/Linux): not captured.** The Tauri
  shell has no debug build cache on this machine and no browser mock for
  `@tauri-apps/api/core` invoke, so journey states were verified through the
  automated DOM tests above rather than pixel captures. If reviewer evidence
  requires screenshots, the app must be run once (`pnpm tauri dev`) on each OS.
- **Windows and Linux: not executed.** All checks ran on macOS only. No
  platform-specific code paths were touched (UI + Tauri IPC contract reuse
  only), but per-OS runtime behavior is unverified here.
- **Real backend end-to-end run: not executed.** The journey talks exclusively
  through existing `SelectionBackend`/`ProvisioningBackend`/`getStorageStatus`
  contracts, which have their own backend test suites; the onboarding tests use
  injected fake backends.
- **Keyboard/focus/resize/scroll/RTL: verified by construction and unit-level
  assertions only** (semantic roles, `aria-current`, `aria-pressed`,
  `role="alert"`, RTL-safe logical layout via existing tailwind tokens and
  `isRTL`-mirrored conventions). No manual screen-reader or multi-viewport
  session was run.
- **Reviewer's reference screenshots from the design amendment were not
  available** (not attached to issue #27); the UI follows the amendment's
  textual spec.

## Notes for review

- The journey gate derives only from `getBootstrapState()` + `getStorageStatus()`;
  "Open Adham" is a session-local acknowledgment (`entered` state), not persisted.
- No session creation, no send path, and no new backend surface were touched;
  scope fences and fail-closed send behavior are unaffected.
- During setup the shell keeps only `Titlebar`; nav rail, sidebars, panel, and
  settings overlay are hidden until the journey completes.
