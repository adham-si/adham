# PDF island — Stage 1 evidence (dependency-free extractor-process prototype)

Date: 2026-10-22. Branch: `feat/conversation-02-pdf`, base `f10f907` (PR #36 merge). The changeset carrying this report is the revision for all gate claims below. All data is synthetic — no user content, no secrets, no raw app-data paths.

## Scope

**What Stage 1 was authorized to build:** a dependency-free extractor-process prototype — synthetic worker + real supervisor — proving the process boundary before any PDF parser exists. Nothing was installed; no upstream exploit fixtures were created; no production wiring was touched. Per PM's six proof items, each pinned by a test in `crates/adham-pdf-island/tests/island_tests.rs`.

**What Stage 1 explicitly does NOT claim:** parser behavior on hostile PDFs, `pdfEncrypted`/`pdfCorrupt`/`pdfScanOnly` semantics, Windows runtime behavior (compile-gated only), and everything gated on the accept-risk sign-off.

## Proof matrix (all from `cargo test -p adham-pdf-island`)

| # | Proof item | Test | Outcome |
|---|---|---|---|
| 1 | Memory limit enforced before any parsing | `memory_limit_enforced_before_parsing` | PASS — `--alloc-bomb` ⇒ `Refused{MemoryLimit, detail="physical footprint over cap (kill-on-limit watcher)"}` on macOS; rlimit/JobObject on Linux/Windows; child reaped (follow-up run) |
| 2 | Bounded input + incremental output | `input_is_bounded_and_refused`, `healthy_run_streams_pages_in_caps` | PASS — 5 MiB+1 stdin ⇒ `InputExceeded`; healthy run streams 1-indexed pages under caps, no stderr chatter |
| 3 | Timeout/cancel terminates and reaps | `timeout_terminates_and_reaps`, `explicit_cancel_terminates_and_reaps` | PASS — 300 ms clock kill and explicit `Cancel` both reap (follow-up healthy run succeeds) |
| 4 | Restricted fs/network + secrets | `island_sources_contain_no_net_or_fs_io`, `island_refuses_filesystem_actions`, `no_secrets_reach_the_island` | PASS — source tripwire (no `std::net`/fs APIs in island-owned sources); `--fs-forbidden` ⇒ `FsPolicy`; env audit shows child env == planted list only; `PARENT_SECRET_CANARY`/`host-side-only` never travel |
| 5 | Crash / excessive output / malformed | `crash_refuses_without_partial_success`, `late_crash_never_leaks_partial_pages`, `garbage_output_refuses_without_partial_success`, `per_page_cap_is_enforced`, `total_char_cap_is_enforced` | PASS — abort, mid-stream abort, non-protocol garbage, per-page and total over-cap all ⇒ refusals; `Pages` never materializes (partial pages dropped) |
| 6 | No partial attachment success | asserted inside all fault tests | PASS — every fault outcome is `Refused{..}` |

Total: **13/13 tests green** (1 source-policy unit + 12 boundary integration), `clippy --all-targets -D warnings` clean, `cargo fmt --check` clean.

## Platform demonstration

| Platform | Mechanism | Result |
|---|---|---|
| macOS (declared dev host) | host run, `cargo test -p adham-pdf-island` + clippy + fmt | green (13/13, 0.66 s) |
| Linux — **declared target Ubuntu 24.04** | `ubuntu:24.04` container, Rust **1.96.0** = CI-pinned toolchain; suite + clippy `-D warnings` + fmt, run **3×** (default parallel threads) | green each time (12/12, ~0.53 s) |
| Windows x86_64-pc-windows-msvc | `cargo check --target x86_64-pc-windows-msvc` + `windows-sys 0.59` compile gate (declared feature set incl. `Win32_Security`) | compile-green; **no local runtime** |

Windows runtime gap: the required `windows-latest` CI job already runs the workspace test command, so pushing this branch executes the identical suite on Windows. Push approval is with the human (AGENTS rule). This is the only report row not closed by direct execution.

## Findings that revised the design (recorded in the design doc)

1. **Darwin enforces no per-process memory rlimit** — `setrlimit(RLIMIT_AS/DATA)` returns EINVAL on macOS (measured on this host). The macOS wall became a supervisor-side physical-footprint watcher (`proc_pid_rusage`, 10 ms cadence, SIGKILL over 512 MiB). Linux keeps kernel `RLIMIT_AS`; Windows self-assigns a Job Object. **Observed** (not claimed) kill granularity: the watcher tripped at 538–584 MiB across 6 runs of `--alloc-bomb` on this host (538378984–583516928 bytes; cap 512 MiB); no deterministic tighter bound is demonstrated — the guaranteed semantics are "SIGKILL at the first observation ≥ cap", with growth between 10 ms polls theory-unbounded.
2. **Island input became stdin-bytes**, not an argv path: the parent already owns bounded path reads (5 MiB), so the island needs **zero filesystem capabilities** (stronger than the draft's "path-only").
3. **Kill semantics corrected during Linux runs:** instrumentation (env-gated `ISLAND_TRACE`) showed kill-first-then-claim-timeout mislabeled exit-0 children under scheduler races. Final semantics: the stream's refusal (clock/cancel/breach) is the outcome; on clean streams the reap only kills if the island lingers >200 ms after drain, and the OS-reported status (SIGKILL ⇒ 137 `islandFailure`, SIGABRT ⇒ 134, 0 ⇒ `Pages`) drives classification.

## Enforcement reality per OS (a source tripwire is not access control)

| Control | macOS | Linux | Windows | Actually enforced by |
|---|---|---|---|---|
| Memory cap 512 MiB | **not kernel-set** — parent watcher reads kernel accounting (`proc_pid_rusage`) and SIGKILLs over cap | `RLIMIT_AS` — **kernel** | Job Object `ProcessMemoryLimit` — **kernel** | OS (3 different shades) |
| Wall clock / cancel kill | parent | parent | parent | parent |
| Reap on every fault path (no zombie, no lingering worker) | parent `child.wait()`/poll+grace | same | same | parent |
| Environment: child sees only the deliberate plant list | spawn attribute (`env_clear`) | same | same | parent at spawn, not a sandbox |
| No filesystem/network capability | **by construction** — no fs/net code compiled; tripwire test guards silent additions; **the OS denies nothing** | same | same | codebase review, not OS |
| Process-group isolation (`process_group(0)`) | yes | yes | n/a (Job) | parent at spawn |

An island process that gained fs/net code could still call `open`/`socket` — the wiped environment (no secrets, nothing user-chosen in argv, stdin-only bytes) reduces exposure but confers **no confinement**. OS-level confinement (macOS seatbelt/sandbox profile, Linux seccomp/AppArmor/namespace, Windows AppContainer/restricted token) is **not implemented**; it is listed as an open Stage-2 authorization question in the design doc.

Also honest about the tripwire: it scans island-owned sources for imports/APIs (`std::net`, fs APIs) at test time — a compile-time guard against accidental additions, not a runtime control.

## Commands (reproducible)

```sh
# macOS
cargo test -p adham-pdf-island
cargo clippy -p adham-pdf-island --all-targets -- -D warnings
cargo fmt -p adham-pdf-island --check

# Linux (declared target, CI toolchain)
docker run --rm -v "$PWD":/src -e CARGO_TARGET_DIR=/tmp/td -e CARGO_HOME=/tmp/ch -w /src ubuntu:24.04 bash -c \
  "<apt/rustup bootstrap> && cargo test -p adham-pdf-island && cargo clippy -p adham-pdf-island --all-targets -- -D warnings && cargo fmt -p adham-pdf-island --check"

# Windows compile gate
cargo check --target x86_64-pc-windows-msvc -p adham-pdf-island

# PDF still disabled at ingest (in adham-desktop-api)
cargo test -p adham-desktop-api still_refuses_pdf_attachments   # PASS
```

## Unverified / open

- Windows runtime execution (pending CI push approval).
- Parser-behavior statuses (`pdfEncrypted` vs `pdfCorrupt` distinguishability), fixtures, fuzz, wiring — Stage 2+, authorization-gated.
- The dependency-risk decision itself — record at `docs/reports/dependency-record-pdf-inspector.md` awaits the PM's sign-off.

## Files

| Path | Nature |
|---|---|
| `crates/adham-pdf-island/*` (new crate: protocol, caps, supervisor, reap, worker, 13 tests) | stage-exclusive |
| `crates/adham-desktop-api/src/service/attachment.rs` (+1 test) | test-only |
| `Cargo.toml` / `Cargo.lock` | workspace-shared with history lane — **append-only verified** (0 removed lines in lock diff) |
| `docs/superpowers/specs/…design.md`, `docs/superpowers/plans/…stage1.md`, this report | docs-exclusive |
