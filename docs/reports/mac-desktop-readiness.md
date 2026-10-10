# Mac desktop-readiness verification (follow-up from 91ae6b3)

Bounded scope: TS2883 fix + live Tauri boot + message save/reload/restart
proof. P0-AUDIT-05 still paused. No merge performed. All data synthetic —
no user content, secrets, raw home paths, or key bytes.

## Revision

- Base: `origin/main` at `91ae6b3` (PR #5 merge).
- Worktree: clean `git worktree add ../adham-desktop-readiness -b
  mac-desktop-readiness origin/main` (other worktrees left untouched).
- Toolchains: macOS arm64, Node `v24.13.0` exact pin (per-shell PATH),
  pnpm `10.33.2`, local Rust `1.99.0` (CI pin `1.96.0` unchanged).

## TS2883: repro, cause, fix (Option A as approved)

- Repro on clean `91ae6b3`: `pnpm --filter @adham/desktop build` → exit 1,
  single error `conversation-test-utils.ts(3,17): error TS2883`, tree left clean.
- Cause chain: `packages/tsconfig/base.json:17-18` sets `declaration: true`;
  `apps/desktop/tsconfig.json` extends it without overriding, so the desktop
  `tsc --noEmit` performs declaration-portability checking. Root
  `tsconfig.json` sets `declaration: false`, so root `pnpm typecheck`
  (verified exit 0 on the same tree) and CI never see it — CI also never runs
  the desktop build. Failure is cross-platform, not Mac-specific, but it
  blocks the Mac desktop-flow proof.
- Affected files: exactly 1 — the shared (non-`*.test.*`, hence compiled)
  helper `apps/desktop/src/features/conversation/conversation-test-utils.ts`.
  Sibling `*.test.ts(x)` fakes are excluded from the desktop compile, which is
  why only one error surfaces.
- Fix (approved Option A, 1 file, +33/−3, no tsconfig/gate change):
  explicit `ConversationFakeBackend` interface using only public `Mock` types
  from `vitest`, with precise argument tuples (call-indexing and hook
  assignability preserved) and `any` returns. Returns are exactly as
  permissive as the previous inference — a first attempt with precise payload
  types broke the deferred-resolve pattern in the test files
  (`mockImplementation(() => Promise<unknown>)`, resolve captures typed
  `(value: unknown) => void`; root typecheck listed 10 errors), so payloads
  were widened to `any` while keeping precise args. `ConversationTestBackend`
  alias kept, so no test file was touched.

## Gate results at fix (no weakening)

| Command | Exit | Observed |
|---|---|---|
| `pnpm --filter @adham/desktop build` (tsc `declaration:true` + vite) | 0 | bundle emitted |
| `pnpm typecheck` / `lint` / `format:check` | 0 | clean (one biome self-format of the touched file) |
| `pnpm test` | 0 | 22 files, 348 tests passed |
| `node scripts/check-file-size.mjs` | 0 | 0 errors |
| `cargo check -p adham-desktop --locked` | 0 | Tauri shell compiles |
| `cargo deny` / `pnpm audit` | — | covered by CI |

## Live Tauri boot (actual app, synthetic first-run)

- Pre-launch verified: no `~/Library/Application Support/Adham`, no
  `adham-content-key` Keychain item.
- `pnpm --filter @adham/desktop tauri dev` built and ran
  `target/debug/adham-desktop`: vite ready (`HTTP 200` on `:11111`),
  migrations (`Database schema initialized successfully`),
  `installation` row count = 1, one `adham-content-key` Keychain item, live
  WAL (`adham.db` + `-shm` + `-wal`) in the real macOS data dir. App
  processes exited cleanly; log contains zero errors/panics (two `error`
  greps were crate names `thiserror`/`stable_deref_trait` in build output).
- Cleanup verified: Keychain item deleted, data dir removed — pre-launch
  state restored (dir absent, item not found).

## Message save/reload/restart proof (production handlers, fresh processes)

Ephemeral binary outside the repo (since removed): temp SQLite file,
synthetic service `adham-readiness-proof`, production `handle_*` handlers.

- `SAVE_OK … m1=01a126a8-…-791b82 m2=01a126a8-…-8db51`: scope IDs asserted
  UUIDv7; same-`request_id` duplicate replay returned the identical
  `message_id`; distinct requests got distinct UUIDv7 ids.
- Fresh-process `READ_OK … texts=[readiness-canary-<tag>,
  readiness-canary-<tag>-2] ids_stable=true dups=false`: exactly 2 items, exact
  texts in order, identical ids, no duplicates.
- Cleanup verified: credential deleted, temp DB/sidecar/crate removed.

## Explicit gaps (not claimed)

- In-window display/reload clicks were **not** automated: no WebView
  automation exists in this environment (osascript assistive access denied),
  so on-screen rendering confirmation remains manual. Message assertions ran
  one layer down, through the exact handlers the Tauri commands invoke.
- The boot proof used the production service name on first run (normal app
  behavior); residue was fully removed afterward.

## Reviewer / follow-ups

- Reviewer: pending. CI must go green on the pushed head (both required
  checks); no merge without approval.
