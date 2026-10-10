# mac-compat verification (macOS companion to Windows P0 evidence)

Focused diff only. P0-AUDIT-05 untouched and still paused. No merge performed;
push/merge approval is separate. All data below is synthetic canary material —
no user content, secrets, raw home paths, or key bytes.

## Revision

- Base: `origin/main` at `237720e` (Merge PR #3 audit/p0-audit-03).
- Worktree: clean `git worktree add ../adham-mac-compat -b mac-compat origin/main`
  (main worktree left pristine; verified `git status --short` clean except the
  pre-existing untracked Tauri `macOS-schema.json`).
- `isolation.rs` unchanged (lexical checks are not sandbox proof; out of scope).

## Toolchains actually used (pins not quietly changed)

- macOS arm64, OS 27.0.1, Xcode CLT at `/Library/Developer/CommandLineTools`.
- Node `v24.13.0` — exact repo pin from `.node-version`, via official
  `nodejs.org/dist/v24.13.0/node-v24.13.0-darwin-arm64.tar.gz` in a temp dir,
  per-shell `PATH` only. System default (`/usr/local/bin/node` v26.2.0) untouched.
- pnpm `10.33.2` (matches `packageManager`).
- Local Rust `1.99.0` / cargo `1.99.0`. CI still pins `1.96.0` in
  `.github/workflows/ci.yml` — deliberately not changed; the local/CI
  difference is recorded here, not hidden in a pin edit.
- `rust-toolchain.toml` gains only `aarch64-apple-darwin` next to the existing
  `x86_64-pc-windows-msvc`. No `x86_64-apple-darwin`: Intel-Mac testing is
  outside this patch, and the target list alone does not define supported
  platforms.

## Diff summary (staged explicitly, never `git add -A`)

- `crates/adham-platform/src/paths.rs` — `resolve()` now returns
  `Result<Self, PlatformError>` (was `Self` with silent `./Adham` fallback).
  New pure `resolve_base(LOCALAPPDATA, HOME)`: Windows keeps
  `%LOCALAPPDATA%\Adham`; macOS uses `$HOME/Library/Application Support/Adham`.
  Missing/empty/relative roots error **before** any `create_dir_all`; `new()`
  also rejects empty/relative roots. Unsupported OS errors fail-closed.
- `apps/desktop/src-tauri/src/lib.rs` — caller propagates the `Result`
  (`expect` with a fail-closed message; no fallback path remains).
- `Cargo.toml` — `keyring` features `["apple-native", "windows-native"]`
  (was `["windows-native"]`).
- `Cargo.lock` — keyring stays `3.6.3`; adds `security-framework 2.11.1/3.7.0`,
  `security-framework-sys 2.17.0`, `core-foundation 0.9.4`; existing
  `core-foundation` references disambiguated to `0.10.1` (no version change).
  Windows deps (`windows-sys`, `byteorder`) retained.
- Task-04 lifecycle untouched: `git diff` empty for
  `crates/adham-event-log/src/sqlite/content_key.rs`,
  `content_key_windows_store.rs`, `crates/adham-desktop-api/src`
  (create-once/never-rotate, read-only `content_key()`, NoEntry fail-closed,
  corrupt→Integrity, zeroize, `keyring:{service}/{account}:v1` all preserved).
- `.npmrc` — minimal fix: `os=["win32","darwin"]`, `cpu=["x64","arm64"]`
  (was win32/x64 only, which drops darwin native bins on `pnpm install`).
- `.github/workflows/ci.yml` — `validate` job (id/name/runner
  `windows-latest`) byte-identical, so the required Windows check name is
  unchanged and no branch-rule update is needed. Additive `validate-macos`
  job (`Validation and Quality Checks (macOS)`, `macos-latest`, same pins and
  steps). Both jobs must pass; an MSVC target installed on a Mac proves
  compilation only, never Windows runtime.
- New tests (temp roots only, never real HOME, never `resolve()`):
  `crates/adham-platform/tests/paths_resolve_tests.rs` (6 tests),
  `crates/adham-event-log/tests/content_key_macos_store.rs` (5 tests,
  synthetic `adham-audit04-macos-*` service, blake3 fingerprints only).
- NOT staged: `apps/desktop/src-tauri/gen/schemas/macOS-schema.json`
  (local Tauri build artifact, untracked).

## Mac results (worktree cwd, exit codes)

| Command | Exit | Observed |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | ok (3.7s) |
| `pnpm format:check` / `lint` / `typecheck` | 0 | 188 files clean |
| `pnpm test` | 0 | 22 files, 348 tests passed |
| `node scripts/check-file-size.mjs` | 0 | 0 errors (5 pre-existing >400 warnings) |
| `cargo fmt --all -- --check` | 0 | clean after one self-format of new test |
| `cargo check --workspace --all-targets --locked` | 0 | incl. `adham-desktop` Tauri shell |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | clean |
| `cargo test --workspace --locked` | 0 | 76 binaries ok, 0 failed (macOS store 5 passed; windows store 0, cfg-skipped) |
| `cargo test -p adham-desktop-api --test p0_repair_regression` | 0 | 8 passed |
| `cargo xtask contracts` + `git diff --exit-code -- packages/contracts-generated` | 0 | no drift |
| `pnpm check:magic-values(+self-test)`, `check:deny-exceptions(+self-test)` | 0 | passed |
| `cargo deny check` / `pnpm audit` | — | not run locally; covered by both CI jobs |

## Native restart proof (explicit canary read, fresh process)

Ephemeral binary outside the repo (temp dir, since removed) using production
constructors with a temp HOME and synthetic Keychain service
`adham-maccompat-proof` — never the production `adham-content-key` service:

- `save`: `resolve_base`→`new`→`ensure_directories`, `ensure_persistent_backend`,
  `initialize_content_key`, `create_sqlite_pool`+migrations,
  `load_or_create_with_key`, create workspace/project/session, submit
  `maccompat-canary-<tag>` → `SAVE_OK … message_id=01a1266c-…-9ef6a4fe0f68`.
- `read` in a **fresh process**: reopen same DB file + same Keychain account,
  `handle_get_conversation` with session scope →
  `READ_OK … text=maccompat-canary-<tag> message_id=01a1266c-…-9ef6a4fe0f68`
  (same id, exact text — not a row count).
- Cleanup verified: Keychain item deleted (`SecKeychainSearchCopyNext: … could
  not be found`), temp home removed. Gap noted honestly: handler-level
  `load_or_create_with_key` was used instead of `load_or_create` to avoid
  writing the production service name; the Tauri window itself was not
  launched (no display automation in scope).

## Pre-existing issues (not in diff, not fixed here)

- `pnpm --filter @adham/desktop build` fails with
  `TS2883` in `conversation-test-utils.ts` — reproduced identically on the
  clean main worktree; pre-existing and out of scope.
- `pnpm install`+`build` in the main worktree regenerated design-token files
  (`index.css`, `tokens.css`, …); reverted, main verified pristine.

## Reviewer / follow-ups

- Reviewer: pending. Unresolved: Windows + macOS CI must both go green after
  push (Windows proves runtime; Mac MSVC-target check does not).
- Coordinate: require the new `Validation and Quality Checks (macOS)` check
  alongside the unchanged Windows one; no branch-rule change needed for Windows.
