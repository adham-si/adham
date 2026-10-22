# PDF island — Stage 1 Implementation Plan (synthetic worker, no parser)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the extractor-island process boundary end to end with a synthetic worker — before any PDF parser exists or is installed.

**Architecture:** New crate `crates/adham-pdf-island` with one bin (synthetic worker v0: stdin bytes → page-marker text lines out; fault/audit modes by flag) and one lib (supervisor: spawn, cap, stream, kill, reap). The supervisor is the exact code path the real parser waves will reuse; the producer swaps later.

**Tech Stack:** Rust (std + `libc` for unix rlimits + `windows-sys` for Job Objects). No net/fs APIs in the island by construction, no serde yet, no PDF parser.

**Spec:** `docs/superpowers/specs/2026-10-22-pdf-extractor-island-design.md` (revise its Stage-1 scope first; each task below pins the tests the spec's open decisions will be wielded against when they are re-asked).

## Global Constraints

- NO PDF parser dependency, NO exploit fixtures, NO production wiring (attach allowlist change, ingest-path patch, or PDF functionality visible in the UI) — Stage-1 authorization only. Enforce via test asserting `classify_text` still refuses `.pdf`.
- Output marker/contract in island: pages emitted 1-indexed, per page caps 20k, total 200k, line guard, wall clock 30 s, self-imposed RSS 512 MiB.
- No application secrets/UI/User content in evidence; synthetic canaries only.
- Shared-file rule with teammate's `feat/conversation-03-history`: do not touch `crates/*` beyond the new island crate; workspace `Cargo.toml`+`Cargo.lock` shared — append-only, no removals (recorded in design doc).

## Review Focus

Sunset (ordered): (1) leaking contact info via env inheritance — pinned by secret-canary env test (Task 5); (2) surviving an island crash with undelivered "success" — pinned by crash/malformed/spam tests (Task 6); (3) zombie processes on kill — pinned by reaping assertions in every fault test (Task 6); (4) rlimit AS-not-enforced on macOS — test tolerates both node-source kill paths but must detect either `exit 42` or SIGKILL (Task 5); (5) `.pdf` accidentally accepted at ingest — pinned by `classify_text` refusal test (Task 7).

---

## Task list

### Task 1: Revise design doc + shared-file ownership record

**Files:** Modify `docs/superpowers/specs/2026-10-22-pdf-extractor-island-design.md`

- [x] Add Stage-1-authorized scope section (six proof items, verbatim from PM, in checker form). Revise waves to match the stage gate order. Record the actual cross-lane diff facts: 245 shared-with-main files, 75 files differing between lane tips, attachment service/dto identical across lanes (diff empty), `Cargo.toml`+`Cargo.lock` workspace files shared (append-only), `.github/workflows/ci.yml` already has windows-latest required + ubuntu-24.04 + macos-latest jobs.

### Task 2: Island crate skeleton

**Files:** Create `crates/adham-pdf-island/Cargo.toml`, `src/main.rs` (worker), `src/lib.rs` (supervisor re-export), `src/caps.rs` (self-imposed memory cap: unix `setrlimit(RLIMIT_AS, 512 MiB)` / windows Job-Object ProcessMemory before any servicing), `src/protocol.rs` (line framing + caps).

**Interfaces (produced for later tasks):**
- Worker CLI: `adham-pdf-island [--page-chars N] [--total-chars N] [--sleep S] [--alloc-bomb] [--crash] [--garbage] [--spam] [--late-crash] [--self-audit] [--forbidden-path P]`; reads stdin only; writes one line per page `PAGE <n> <chars>`.
- Supervisor: `adham_pdf_island::supervisor::run(spec: SpawnSpec) -> PdfIslandOutcome` where `SpawnSpec { binary_path: PathBuf, input: Vec<u8>, caps: Caps (defaults PageChars=20_000; TotalChars=200_000; LineBytes; Clock=30 s; RssBytes=512 MiB) }`, `PdfIslandOutcome::Pages { pages: Vec<(u32, String)>, truncated: bool }` or `Refused(RefusalCode)`, `RefusalCode { MemoryLimit, InputExceeded, MalformedOutput, OutputCap, Timeout, Crash, SpawnFailed }`.

- [x] Cargo.toml with bin+lib, deps `libc` (unix only) & `windows-sys` (win only, minimal features); workspace member registration in root `Cargo.toml` (append-only).

### Task 3: Worker behaviors

**Files:** Create `src/worker.rs` (bodies own mode dispatch), tests in Task 5.

- [x] Implement every CLI flag + self-audit output `ENV <k>=<v>` block and the stdin-only read; no std::fs reads beyond the explicit `--forbidden-path` deny probe, no std::net at all.

### Task 4: Supervisor

**Files:** Create `src/supervisor.rs` (spawn + env_clear + args + pipe caps + wallclock kill + reap; thread async safety optional — std thread + channels only), `src/exit.rs` (exit-code mapping incl. unix kill detection / windows job-kill).

- [x] env_clear() always; inherited-Uname nothing (dirs still spawn).
- [x] Read stdout line-by-line with per-line size guard; accumulate total with total-guard; per-page and full-truncation exactly. during guard breach: abort + kill + reap immediately, outcome `Refused(OutputCap|MalformedOutput)`.
- [x] Kill on wallclock takeover + explicit `cancel()`; kill entire process group (unix) / job (windows); `wait()` reaped verified. *(Implementation note: kill became a reap mechanism only — the stream refusal is the semantic authority; kill-on-clean-drain happens only after a 200 ms linger grace, because kill-first-then-claim mislabeled exit-0 children under Linux scheduler races.)*

### Task 5: Tests — memory wall, env/fs restraint, healthy path

**Files:** Create `tests/island_tests.rs` (runs against CARGO_BIN_EXE bin).

- [x] `memory_limit_enforced_before_parsing`: `--alloc-bomb` → `Refused(MemoryLimit)`, reaped; works identically under rlimit (unix), Job-Object (win) and the macOS footprint watcher (Darwin rejects memory rlimits, measured).
- [x] `input_is_bounded`: oversized stdin bytes → `Refused(InputExceeded)`; no pages.
- [x] `healthy_run_streams_increments`: reasonable input → Pages emitted page-marked 1-indexed within caps.
- [x] `no_secrets_inherited`: host canaries in the parent process env → island `--self-audit` shows only the deliberate plant list; canaries never travel.
- [x] `restricted_fs_and_net_by_construction`: `--fs-forbidden` denies; source scan test asserting island sources contain no net/fs IO.
### Task 6: Tests — faults remain unrewarded

**Files:** Extend `tests/island_tests.rs`.

- [x] `timeout_terminates_and_reaps`: `--sleep 60` clock 300 ms → `Refused(Timeout)`; wait() returned; no child in process table.
- [x] `explicit_cancel_reaps`: cancel mid-run → same guarantee.
- [x] `crash_refuses_not_succeeds_partial`: `--crash` → `Crash`; no Pages.
- [x] `garbage_output_refuses`: `--garbage` → `MalformedOutput`; no Pages.
- [x] `late_crash_refuses_without_partial`: `--late-crash` valid pages then abort → `Crash` and no `Pages` surface (partial output dropped, never half-success).
- [x] `output_spam_guard`: `--spam` oversized line → OutputCap/MalformedOutput fast; no OOM in supervisor.

### Task 7: Demo matrix + evidence report

**Files:** Create `docs/reports/pdf-island-stage1-evidence.md`; update checkboxes in this plan. Test: modify `crates/adham-desktop-api/src/service/attachment.rs` tests module (test-only change).

- [x] `still_refuses_pdf_attachments`: PDF (`report.pdf`, `%PDF-1.7` body) refused by both `classify_text` and `extract_text` — PDF stays out of the ingest allowlist in Stage 1.
- [x] Test runs under the existing `crates/adham-desktop-api` crate test command (no island dependency needed).

- [x] macOS (aarch64): full `cargo test -p adham-pdf-island` + clippy + fmt.
- [x] Linux, declared target Ubuntu 24.04: Docker container (image `ubuntu2404-rust:1.96`, Dockerfile bootstrap recorded), Rust 1.96.0 = CI-pinned; suite + clippy + fmt, 3× parallel green (also re-verified after the reap-module split).
- [x] Windows x86_64-msvc: `cargo check --target x86_64-pc-windows-msvc -p adham-pdf-island` compile-green (no local runtime); CI note: `.github/workflows/ci.yml` windows-latest job already runs the workspace test command — same matrix runs on push (pending push approval).
- [x] Evidence: synthetic canaries only; per-proof-item PASS matrix with commands; explicit unverified claims list (parser behavior, Windows runtime, real-PDF statuses). `docs/reports/pdf-island-stage1-evidence.md`.

### Task 8: Dependency record + isolated parser/PoC proposal (no install)

**Files:** Create `docs/reports/dependency-record-pdf-inspector.md` (exact 1.25.2 facts + advisories + owners, sourced live) with a second section: "Proposal for isolated parser/PoC testing" — fixture acquisition policy, fuzz target plan, per-OS pipeline, explicit authorization-needed line for install/fixtures/wiring/risk-accept.

- [x] Dependency record written from the researcher subagent's live-sourced facts (crates.io API, docs.rs, GitHub, RustSec, upstream source at `v1.25.2`); no crates.io install for any proof (read-only API/docs sources only).
