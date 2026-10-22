# PDF extraction — extractor island design (issue #33)

Status: direction approved; **Stage 1 (dependency-free island prototype) authorized and implemented**; dependency + shipping-risk sign-off still held open per PM. Written 2026-10-22, revised same day after Stage-1 evidence. No parser dependency was added; `.pdf` stays refused at ingest.

## Intent

Extend the #32 attachment pipeline from text/code files to PDFs: **local text extraction only**, page references preserved, honest statuses, and the extracted text enters the same protected content store and dispatch budget as every other attachment. No OCR, no viewer, no cloud fallback, no rendered pages. Scanned PDFs say exactly that.

The parser candidate is `pdf-inspector` (Firecrawl, 1.25.2, MIT, pure Rust). **The dependency itself is not the safe boundary — the process around it is.** Everything hostile runs inside a disposable child process; a crash fails the one attachment, never the app.

## Current state (facts, not proposals)

The #32 pipeline already enforces the caps the PM named:

| Fact | Location |
|---|---|
| 5 MiB input cap (`MAX_ATTACHMENT_BYTES`), 200k char output cap (`MAX_EXTRACTED_CHARS`) | `crates/adham-desktop-api/src/service/attachment.rs:18,20` |
| Extension allowlist + NUL sniff + UTF-8 check (`extract_text`) | same file |
| Sealed content store under session scope (`put_content_tx`, blake3, `retention: "session"`) | same file + `adham-event-log` |
| DTO already carries `extracted_chars` / `truncated` / `retention` | `dtos/attachment.rs` |
| UI chips + drop + picker | `apps/desktop/src/features/conversation/attachments/` |
| Cap constants were load-bearing in contract tests | `crates/adham-desktop-api/tests/attachments.rs` |

Nothing PDF-specific is wired; a regression test now pins `.pdf` out of `classify_text`/`extract_text` (Stage-1 task).

## Failure mode being designed against

Upstream, as of 2026-10-22 (researcher re-check against primary sources):

| Item | Status |
|---|---|
| PR #610 — flate-bomb OOM (fix: shared 64 MiB page-content budget) | **open**, `mergeable_state: clean`, revalidated against 1.25.2 |
| PR #611 — 20k-deep Form chain → hard stack overflow (fix: depth cap 64) | **open**, stacked on #610, revalidated against 1.25.2 |
| Latest release | **1.25.2** (2026-09-28) — **predates both fixes**; release notes mention neither |

So on every published version, untrusted PDFs can OOM or abort the parsing process. That is exactly why extraction must not run in-process: one aborted extract inside the island costs the user one attachment refusal, never the session.

## Design: one island, four walls (revised by Stage 1)

New workspace crate `crates/adham-pdf-island` — a small disposable bin. The main process never links PDF code, so the app binary carries no new parser attack surface and the build graph stays isolated.

```
desktop-api (ingest path)
  └─ read_bounded_file (5 MiB, unchanged — parent owns all path access)
  └─ supervisor::run(): spawn island
     island = own binary (Stage 1: synthetic worker; later: links pdf-inspector)
       wall 1: memory cap ~512 MiB, kill-on-limit (see platform note)
       wall 2: no filesystem or network capability by island code —
               by construction (nothing net/fs compiles in; the tripwire
               test guards it), NOT OS-enforced in Stage 1;
               the PDF arrives as STDIN bytes, argv carries nothing user-chosen
       wall 3: output streamed page-lines with hard char caps + line-length
               guard enforced by the SUPERVISOR (island is untrusted)
       wall 4: wall-clock kill 30 s, then reap; cancel supported
  └─ outcomes: Pages{pages,truncated} | Refused{code,detail}
```

Changes from the draft design, forced by Stage-1 findings:

- **Input is stdin, not an argv path.** The parent already reads the file bounded (5 MiB); handing bytes over stdin removes every filesystem capability from the island instead of "path-only" use. The island has no fs code by construction (source-scan tripwire test).
- **Memory wall is per-OS, honestly:**
  | OS | Mechanism | Enforced by |
  |---|---|---|
  | Linux (declared: Ubuntu 24.04) | `setrlimit(RLIMIT_AS, 512 MiB)` at island startup | kernel |
  | Windows | self-assigned Job Object with `ProcessMemoryLimit` at startup | kernel |
  | macOS | Darwin **refuses** memory rlimits (EINVAL — measured); supervisor runs a physical-footprint watcher (`proc_pid_rusage`, 10 ms cadence) that SIGKILLs the island over the cap | parent kill-on-limit |
  This is `caps::Impose::{Enforced, WatchBySupervisor, Failed}`; on `Failed` the worker refuses to parse at all (fail-closed).

Caps (numbers unchanged pending the owner nod):

| Cap | Value | Where |
|---|---|---|
| Input bytes | existing 5 MiB | parent + island both bound stdin |
| Chars per page | 20 000, truncate honored | island emits; supervisor guards, exceeds ⇒ refusal |
| Chars total | existing 200k | supervisor guard; island never exceeds (else refusal) |
| Line guard | 1 MiB/line | supervisor (over ⇒ refusal, not buffered) |
| Wall clock | 30 s kill | parent |
| Island memory | ~512 MiB | platform walls above |
| Pages | uncapped — chars + clock + memory are the real bounds | — |

Exit map: 0 ok; 42 memoryLimit; 43 inputExceeded; 44 fsPolicy; 65 usage; stream violations → malformedOutput/outputCap; SIGKILL → timeout (or memoryLimit under the watcher); SIGABRT/other → islandFailure. Refusal codes are protocol constants reused by the later waves (`protocol.rs`).

## Stage 1 — authorized and done (what was proven)

A dependency-free synthetic worker stands in for the parser; **the supervisor code path tested here is the exact code the parser waves inherit** (only the island's payload changes). Six proof items from the PM, each pinned by a test in `crates/adham-pdf-island/tests/island_tests.rs`:

- [x] memory-limit enforced before any parsing — `--alloc-bomb` dies at the wall ⇒ `MemoryLimit` (rlimit on Linux/host macOS watcher/Job on Windows)
- [x] bounded input + incremental output — over-cap stdin ⇒ `InputExceeded`; healthy input streams 1-indexed page-lines under caps
- [x] timeout/cancel that terminates and reaps the worker — clock kill and explicit `Cancel` both reap; follow-up healthy run proves no residue
- [x] restricted filesystem/network access + no inherited application secrets — island sources contain no net/fs IO (source-scan tripwire); `--fs-forbidden` probe refused (`FsPolicy`); env audit shows child env == planted list only, host canaries wiped by `env_clear()`
- [x] clean handling of crash / excessive output / malformed responses — `--crash`, `--late-crash`, `--garbage`, `--spam` all ⇒ refusals, never partial pages, child reaped
- [x] no partial attachment marked successful or dispatched — every fault outcome is `Refused{..}`; `Pages` only ever materializes on a clean exit code with a clean stream

Demo matrix (commands + outputs in `docs/reports/pdf-island-stage1-evidence.md`):

| Platform | What ran | Result |
|---|---|---|
| macOS (aarch64, host) | full island test suite + clippy `-D warnings` + fmt | green |
| Linux — **declared target Ubuntu 24.04** | same suite in `ubuntu:24.04` container (Rust 1.96.0, matching CI) | green |
| Windows x86_64-msvc | `cargo check --target x86_64-pc-windows-msvc` + clippy subset locally (no local runtime; the required `windows-latest` CI job already runs the workspace test command and will execute the same suite on push) | compile-green |

## Cross-lane shared-file ownership (measured, not guessed)

Branches: this lane `feat/conversation-02-pdf` (= main + PR #36 merge), teammate `feat/conversation-03-history`, both cut from current `main` head; PR #36 is **not on main yet**.

- Files changed by both lanes vs main since their common base: **245** (the whole conversation-01 lineage is in both).
- Files that actually **differ between the two lane tips**: **75** — the real rebase surface. Among them: core-types events/identifiers, event-log, projections, desktop-api dtos/handlers/service, ipc contract tests, extensions/tooling, event schema JSON — all history-lane owned; none are mine to touch.
- **Attachment files are identical across lane tips** (`git diff` empty for `service/attachment.rs`, `dtos/attachment.rs`) — converged content, zero conflict.
- This lane's Stage-1 footprint: new crate `crates/adham-pdf-island/*` (exclusive), root `Cargo.toml` + `Cargo.lock` (workspace-shared, **append-only** member + exactly the island crate's dep nodes), two attachment-module tests (test-only), docs (exclusive).
- Owned integration points for later waves: `service/attachment.rs` + wrappers, `dtos/attachment.rs`, i18n attachment locales, UI `features/conversation/attachments/` — **merge order stays history → pdf rebase**.

## Dependency record (section-9, ready for the risk decision)

`docs/reports/dependency-record-pdf-inspector.md` covers: exact pin 1.25.2 (newest; published 2026-09-28), MIT, MSRV 1.88, pure-Rust (no dylib), default features only (11 direct non-optional crates, 86 resolved — measured today; the 10 optional feature crates incl. `ocr`/`python`/`render-pdfium` stay unused), 1-person crates.io publish bus (GitHub-trust-published from `firecrawl/pdf-inspector`), `RUSTSEC-2026-0192` (ttf-parser unmaintained; informational, affects every published pdf-inspector release), PR #610/#611 open 24 days with no maintainer timeline, and the re-open-on-bump rule. The isolated-parser/PoC-test proposal is in the same file, waiting on authorization.

## Remaining stages (each requires fresh authorization)

- **Stage 2 (needs sign-off):** add `pdf-inspector` 1.25.2 behind the island walls; PoC fixtures from upstream #610/#611; Windows CI run of the island suite; fuzz target on the stdin/protocol boundary; statuses (`pdfScanOnly`, `pdfUnreadable` for encrypted/corrupt-collapse, `islandTimeout`, `islandFailure`, `islandMissing`).
- **Stage 3 (needs sign-off):** wire-in — allowlist pdf, ingest path spawns supervisor, status strings in DTOs + i18n + chips, page markers `[page N]` through the sealed store, truncated flag reuse.
- **Stage 4:** contract tests vs `crates/adham-desktop-api/tests/attachments.rs` style + P0-10-style evidence report at the logged revision.

## Teammate coordination (as instructed)

The parallel teammate is on `feat/conversation-03-history` (issue #32 history; worktree `.kilo/worktrees/conversation-01-lifecycle`; history events in core-types, event-log schema, projections, settings/conversation UI). Measured ownership above replaces the draft's warnings: Stage-1 files cannot collide; wave 3 files are exactly where the 75-file divergence ends (dtos/handlers/i18n) — rebase after history merges, do not rebase the teammate.

## Open decisions for the human (still blocked on 1–3; unchanged by Stage 1)

1. **Accept-risk sign-off** for 1.25.2 behind the island walls (recommended: walls hold against today's known PoCs; alternative: wait for a fixed release — PDF stays honestly unavailable meanwhile).
2. **Numbers nod**: 30 s clock, ~512 MiB RSS (kill-on-limit on macOS; observed trips 538–584 MiB across 6 run-measurements, no tighter bound demonstrated), 20k/page, 1 MiB line guard as contract.
3. **Merge order**: history (teammate) before pdf; pdf rebases onto merged history.
4. **OS-level confinement** (deferred, unimplemented): Stage-1 fs/network restraint is by-construction (no such code compiles into the island) plus a sources tripwire — not OS access control. Real confinement (macOS seatbelt profile, Linux seccomp/AppArmor/namespace, Windows AppContainer/restricted token) needs its own design + authorization before the parser stage.
