# PDF island — Stage 1 evidence (dependency-free extractor-process prototype)

Date: 2026-10-22. Branch: `feat/conversation-02-pdf`, base `f10f907` (PR #36 merge). The changeset carrying this report is the revision for all gate claims below. All data is synthetic — no user content, no secrets, no raw app-data paths.

## Scope

**What Stage 1 was authorized to build:** a dependency-free extractor-process prototype — synthetic worker + real supervisor — proving the process boundary before any PDF parser exists. Nothing was installed; no upstream exploit fixtures were created; no production wiring was touched. Per PM's six proof items, each pinned by a test in `crates/adham-pdf-island/tests/island_tests.rs`.

**What Stage 1 explicitly does NOT claim:** real-PDF acceptance; parser behavior on hostile PDFs; `pdfEncrypted`/`pdfCorrupt`/`pdfScanOnly` semantics; and **os-level filesystem/network confinement — this is a tested resource-containment prototype, not a sandbox** (see "Enforcement reality" below for what each OS actually denies).

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

## Platform demonstration (final matrix, revision-tagged `df8230a`, run [39835989412](https://github.com/adham-si/adham/actions/runs/39835989412))

| Platform | Mechanism | Runtime suite result | Worker left-alive sweep |
|---|---|---|---|
| macOS (dev host) | host run: `cargo test -p adham-pdf-island` + clippy + fmt | **13/13 green** (0.82 s) | "OK: no adham-pdf-island processes remain" |
| Linux — **declared target Ubuntu 24.04** | `ubuntu2404-rust:1.96` container (CI-pinned Rust 1.96.0), 3× parallel | **12/12 green** (+1 tripwire) | "OK: no adham-pdf-island processes remain" |
| Linux CI lane (`ubuntu-24.04`) | CI validation job, Rust 1.96.0 | suite executed green (workspace run) | "OK: no adham-pdf-island processes remain" (job log 19:02:14) |
| macOS CI lane (`macos-latest`) | CI validation job | suite executed green (workspace run) | "OK: no adham-pdf-island processes remain" (job log 19:03:43) |
| **Windows x86_64-msvc — runtime executed on `windows-latest`** | CI `validate` job: `cargo test --workspace --locked` | **13/13 green on the runner** — lib tripwire 1/1 (19:05:43.05) + 12 boundary tests at 19:05:43.080–43.818 (0.74 s): `memory_limit_enforced_before_parsing` (Job-Object heap growth ⇒ MemoryLimit), `input_is_bounded_and_refused`, `healthy_run_streams_pages_in_caps`, `timeout_terminates_and_reaps`, `explicit_cancel_terminates_and_reaps`, `island_refuses_filesystem_actions`, `no_secrets_reach_the_island`, `per_page_cap_is_enforced`, `total_char_cap_is_enforced`, `crash_refuses_without_partial_success`, `late_crash_never_leaks_partial_pages`, `garbage_output_refuses_without_partial_success` | "OK: no adham-pdf-island processes remain" (job log 19:05:54) |

The Windows sweep also covers cold cleanup: after every fault path (memory exhaustion, cancellation, timeout kill, spam-over-cap, crash/abort), the runner process table contained zero `adham-pdf-island` workers.

## CI execution record

| Run | Head | Result | Notes |
|---|---|---|---|
| [39832719445](https://github.com/adham-si/adham/actions/runs/39832719445) | `3380b1c` | 2 failures, both corrected | (1) windows-lane clippy: `Ordering` unused on non-macOS cfg — fixed `9e80a32` (local clippy now run for all three target triples). (2) cargo-deny `advisories`: advisory-DB refresh surfaced `RUSTSEC-2026-0382` (rustls-webpki 0.103.15, pre-existing `adham-provider`→reqwest→rustls chain — **not** introduced by the island); fixed by lock-only bump `424fa41`. Windows runtime tests did not execute in this run. |
| [39835989412](https://github.com/adham-si/adham/actions/runs/39835989412) | `df8230a` | **all three jobs success** | Definitive run: Windows runtime suite + left-alive sweep (`Get-Process`/`pgrep -x`, read-only, added in `df8230a`). |

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

- Parser behavior on real PDFs (`pdfEncrypted` vs `pdfCorrupt` distinguishability), PoC-style fixtures, fuzz, and production wiring — Stage 2+, authorization-gated. Not attempted in Stage 1.
- The dependency-risk decision itself — `docs/reports/dependency-record-pdf-inspector.md` awaits the PM's sign-off.
- fs/network **confinement** remains unimplemented (by-construction only); OS sandboxing is a separate design decision (design doc "Open decisions" #4).

## Files

| Path | Nature |
|---|---|
| `crates/adham-pdf-island/*` (new crate: protocol, caps, supervisor, reap, worker, 13 tests) | stage-exclusive |
| `crates/adham-desktop-api/src/service/attachment.rs` (+1 test) | test-only |
| `Cargo.toml` / `Cargo.lock` | workspace-shared with history lane — **append-only verified** (0 removed lines in lock diff) |
| `docs/superpowers/specs/…design.md`, `docs/superpowers/plans/…stage1.md`, this report | docs-exclusive |
