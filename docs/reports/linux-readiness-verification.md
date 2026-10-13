# Linux Platform Readiness Verification (PLATFORM-02)

Focused companion to Windows and macOS platform readiness evidence for issue #14.
All data below is synthetic canary material — no user content, secrets, raw host paths, or key bytes.

## Revision & Worktree

- Base: `origin/main` at `4547b74` (Merge PR #6).
- Worktree: `.kilo/worktrees/linux-desktop-readiness` on branch `linux-desktop-readiness` (canonical checkout pristine).
- Declared target baseline: Ubuntu 24.04 LTS (Noble Numbat).
- Actual local container architecture: `Ubuntu 24.04 aarch64` (tested via container runtime on Apple Silicon host).
- Target CI runner architecture: `Ubuntu 24.04 x86_64` (executed via GitHub Actions `ubuntu-24.04`). Local testing was performed on `aarch64`; full `x86_64` parity is established through the new CI workflow.
- Declared credential service: FreeDesktop Secret Service API over D-Bus (`org.freedesktop.secrets`), provided by `gnome-keyring` (or KDE KWallet).
- Declared WebKit / system dependencies:
  - WebKitGTK 4.1 (`libwebkit2gtk-4.1-dev`, WebKitGTK for GTK3 on Ubuntu 24.04)
  - `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev`, `libssl-dev`, `build-essential`, `pkg-config`
  - `gnome-keyring`, `dbus-x11`, `xvfb`

## Toolchains Actually Used

- Rust `1.96.0` (matching repo CI pin in `.github/workflows/ci.yml`).
- Node `v24.13.0` (matching `.node-version`).
- pnpm `10.33.2` (matching `packageManager` in `package.json`).
- `cargo-deny 0.18.x` (locked).

## Diff Summary (Staged Explicitly)

- `Cargo.toml`: `keyring` workspace dependency gains Linux native persistent features:
  `features = ["apple-native", "windows-native", "sync-secret-service", "crypto-rust"]`.
  Pure-Rust cryptography backend (`crypto-rust`) eliminates runtime OpenSSL linkages for Secret Service sessions.
- `Cargo.lock`: Adds `dbus-secret-service 4.1.0`, `zbus 4.4.0`, and pure-Rust crypto primitives (`aes`, `cbc`, `hkdf`). All dependencies reviewed and cleared by `cargo deny check` (`advisories ok, bans ok, licenses ok, sources ok`).
- `.npmrc`: Minimal fix adding `linux` to `supportedArchitectures.os=["win32", "darwin", "linux"]` so native packages are installed on Linux.
- `rust-toolchain.toml`: Adds `x86_64-unknown-linux-gnu` target.
- `crates/adham-platform/src/paths.rs`: Linux storage policy resolution implementing the XDG Base Directory specification:
  - `$XDG_DATA_HOME/adham` when set and non-empty.
  - `$HOME/.local/share/adham` default fallback.
  - Fail-closed validation rejecting empty, relative, or missing roots before any directory creation.
- `crates/adham-platform/tests/paths_resolve_tests.rs`: Tests covering XDG Base Directory resolution and default `$HOME/.local/share/adham` fallback.
- `crates/adham-tools/src/sandbox/profile.rs`: Permits `RUSTUP_HOME` and `CARGO_HOME` in sanitized execution environments for toolchain execution.
  * *Rationale & Security Impact*: When executing safe toolchain binaries (such as `cargo --version`), rustup binary shims locate installed toolchains via `RUSTUP_HOME` and `CARGO_HOME`. On non-standard or containerized installations where toolchains live outside `$HOME/.rustup` (e.g. `/usr/local/rustup`), stripping these causes rustup dispatch failure. These variables represent filesystem directory paths, not secrets or tokens. The sanitizer continues to strip all keys, secrets, tokens, passwords, auth credentials, and cloud provider variables. Permitting these directory paths preserves process sandbox security while enabling toolchain dispatch.
- `crates/adham-event-log/tests/content_key_linux_store.rs`: 5 tests covering real Linux Secret Service lifecycle:
  - `persistent_backend_is_available`
  - `initialize_creates_once_reads_stable_and_never_overwrites`
  - `missing_key_fails_closed_without_mint`
  - `corrupt_key_is_integrity_error_and_not_overwritten`
  - `seal_open_roundtrip_and_scope_binding`
- `crates/adham-desktop-api/tests/startup_matrix_linux.rs`: 3 tests covering real Linux Secret Service startup matrix:
  - `fresh_startup_initializes_key_and_reopen_is_stable`
  - `existing_installation_with_deleted_key_fails_closed`
  - `orphan_content_blocks_startup_regeneration`
- `crates/adham-desktop-api/tests/linux_native_restart_proof.rs`: End-to-end native restart and disposable save/reopen proof.
- `.github/workflows/ci.yml`: Additive `validate-linux` job on `ubuntu-24.04` running system dependency installation, lint, typecheck, tests under `dbus-run-session`, desktop build check, and dependency audits. Existing `validate` (Windows) and `validate-macos` (macOS) jobs unchanged.

## Linux Verification Results

| Command | Exit Code | Observed Result |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | 193 packages installed |
| `node scripts/check-file-size.mjs` | 0 | 0 errors (>600 lines) |
| `pnpm format:check` | 0 | Biome format clean |
| `pnpm lint` | 0 | Oxlint clean |
| `pnpm typecheck` | 0 | TypeScript strict check clean |
| `pnpm test` | 0 | 45 test files, 533 tests passed |
| `pnpm --filter @adham/desktop build` | 0 | Vite + tsc bundle built in 1.41s |
| `cargo fmt --all -- --check` | 0 | Rust format clean |
| `cargo check --workspace --all-targets --locked` | 0 | All crates compile cleanly on Linux |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | 0 | Clippy clean |
| `cargo xtask contracts` + `git diff --exit-code -- packages/contracts-generated` | 0 | Zero contracts drift |
| `cargo test --workspace --locked` | 0 | All workspace tests pass |
| `cargo test -p adham-desktop-api --test p0_repair_regression --locked` | 0 | 8 regression tests pass |
| `cargo test -p adham-event-log --test content_key_linux_store` | 0 | 5 Secret Service lifecycle tests pass |
| `cargo test -p adham-desktop-api --test startup_matrix_linux` | 0 | 3 startup matrix tests pass |
| `cargo test -p adham-desktop-api --test linux_native_restart_proof` | 0 | E2E restart & save/reopen journey passes |
| `cargo deny check` | 0 | advisories ok, bans ok, licenses ok, sources ok |
| `pnpm check:deny-exceptions` (+ `self-test`) | 0 | 22/22 exception self-test cases pass |

## Evidence Separation: Backend, Headless Shell, and Native GUI

### Level 1: Backend Process-Reopen & Secret Service Journey
* **Test:** [`linux_native_restart_proof.rs`](file:///Users/ilyassmotya/software/00.devlab/adham-desktop/.kilo/worktrees/linux-desktop-readiness/crates/adham-desktop-api/tests/linux_native_restart_proof.rs) (Exit code 0).
* **Proof:**
  - Process 1 seeded synthetic workspace, project, session, and canary message encrypted under the Secret Service content key, writing to SQLite.
  - Process 2 re-opened the database in a fresh process context, retrieved the key from Secret Service, confirmed exact Blake3 fingerprint match, and read back the decrypted canary message.
  - Credential deleted on exit; confirmed immediate fail-closed `NoEntry` error.

### Level 2: Headless Tauri Application Boot & Linking
* **Dynamic Linking (`ldd target/debug/adham-desktop`):**
  Successfully links `libwebkit2gtk-4.1.so.0`, `libgtk-3.so.0`, `libsoup-3.0.so.0`, `libjavascriptcoregtk-4.1.so.0`, `libdbus-1.so.3`, and `libsecret-1.so.0`.
* **Execution & Runtime Initialization:**
  Command: `timeout 3s xvfb-run -a target/debug/adham-desktop`
  Actual exit status: `124` (expected timeout from `timeout 3s` terminating Tauri's indefinite window run loop).
  Observed log output:
  ```text
  INFO adham_event_log::sqlite::connection: Running embedded SQLite database schema initialization...
  INFO adham_event_log::sqlite::connection: Database schema initialized successfully.
  (adham-desktop:42): dbind-WARNING **: AT-SPI: Error retrieving accessibility bus address: org.freedesktop.DBus.Error.ServiceUnknown: The name org.a11y.Bus was not provided by any .service files
  ```
  Verified filesystem artifacts created under synthetic `$XDG_DATA_HOME`:
  - Storage: `$XDG_DATA_HOME/adham/data/adham.db`, `adham.db-wal`, `adham.db-shm`
  - WebKit runtime cache: `$XDG_DATA_HOME/si.adham.desktop/WebKitCache/`
  - Secret Service keystore: `$XDG_DATA_HOME/keyrings/login.keyring`, `user.keystore`

### Level 3: Rendered Native GUI Acceptance
* **Status:** **Not tested / Deferred.**
  Headless container environments with Xvfb verify window initialization and GTK/WebKit event-loop startup, but do not establish on-screen pixel rendering or visual GPU/compositor validation. Native visual GUI acceptance remains manual until a physical display session is tested.

## Explicit Limitations and Deferrals

- Distro baseline pinned to Ubuntu 24.04 LTS (Debian derivative); RPM/Arch packaging deferred.
- AppImage / Deb bundle packaging and code signing infrastructure deferred to distribution phases.
- Headless execution requires an active D-Bus session with an unlocked Secret Service collection (`gnome-keyring` or `keepassxc`); locked collections fail closed without plaintext fallback.
- Architectural parity between `aarch64` (locally verified) and `x86_64` relies on the CI job passing on `ubuntu-24.04`.
