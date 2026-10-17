# Delivery A acceptance — provider model integration (fixture transport)

- **Date**: 2026-10-17
- **Base revision**: `a1033d14a98fbc625053140ee374f559f1661cdd` (Delivery A through A6)
- **Scope of this report**: A7 **automated** acceptance only. The gated live-Ollama E2E (plan A7 Step 2) was **not** run — it requires separate approval. Every scenario the live E2E list names has an automated fixture equivalent included here. Delivery B (OpenAI Responses) remains untouched and gated.
- **Data**: disposable synthetic data only (temp-file SQLite, in-memory content key). No user content, no credentials, no network outside 127.0.0.1 test stubs.

## Scenario coverage (plan A7 Step 2 list → automated fixtures)

All names are in `apps/desktop/src-tauri/src/ipc_contract_tests.rs` (ipc) or `crates/adham-provider/tests/ollama_http_tests.rs` (adapter), or frontend suites under `apps/desktop/src/features/conversation/`.

| Acceptance scenario | Automated pin(s) |
| --- | --- |
| User message → streamed answer → protected terminal persistence → reopen/replay | `complete_once_streams_in_order_and_persists_terminal` (ipc): pending op durable at socket time; Started → deltas → exactly one Completed with usage; assistant turn via protected content store; `getConversation` read-back (replay read); op resolved. Cross-instance reopen is `crates/adham-projections` rebuild tests (A4). |
| Stop mid-stream persists partial as `Interrupted`, halts | `stop_mid_stream_persists_interrupted_partial` (ipc): partial persisted once as `Interrupted`, op resolved. |
| Stop / completion race | `renderer_disconnect_still_persists_terminal` (ipc) + frontend hook regressions (terminal-loss guard, exactly-one reload) in `use-conversation.test.ts`. |
| **Double-stop idempotency** | Extended stop test: second stop → `already-resolved`, no second terminal event, exactly one `Interrupted` row. |
| **Premature EOF** | New `premature_eof_persists_failed_terminal_once` (ipc): stub ends the body without a terminal frame → exactly one `failed` terminal (never a completion), op resolved (no dangling pending), partial persists exactly once as `Failed`, replay readable. Adapter-level: truncated mid-line + abrupt-close pins from A3 (`midstream abort never completes`). |
| **Crash / unresolved-operation recovery** | New `unresolved_pending_operation_surfaces_and_never_autocompletes` (ipc): op recorded durable, never resolved (crash before terminal) → still listed `pending` on reopen (`handle_list_pending_operations`), history has the user turn but **no assistant tail**, and reads never auto-resolve it. |
| Unknown model / blocked-before-socket | `unknown_model_blocked_before_socket` (ipc). |
| **No duplicate canonical terminal events** | Exactly-one-`Completed` scans on the wire in the happy-path, stop, and EOF tests; A4 projections double-terminal single-row first-terminal-wins; frontend `terminalSeen` guard. |
| **No plaintext content at rest** | New scans in the happy-path and EOF tests: no assistant text in any `events.payload_json`; content store rows hold it only inside AEAD `protected_bytes` (`plaintext_size > 0` yet `LIKE` search for plaintext = 0 hits); `protection_scheme != 'none'`. |
| **done_reason variants / missing usage / refusal** | Adapter 9/9 incl. new `done_without_usage_completes_stop_without_progress` and `unknown_done_reason_maps_to_stop` (documented older-daemon mapping), plus existing `length`→truncated, connection-refused. |
| **Terminal success + delayed failed history reload (new product behavior)** | Frontend: recovery-snapshot behavior (below), pinned in `use-conversation.test.ts` and `conversation-panel.test.tsx`. |

## New product behavior (frontend): recovery snapshot on failed history reload

Requirement: terminal success followed by a failed/delayed history reload must keep the answer visible as a **non-authoritative recovery snapshot** until authoritative history replaces it, without duplicate bubbles, with a retryable synchronization error, and without repeating generation.

Implementation (`use-conversation.ts`):
- During the terminal handoff the answer text is captured before the live bubble drops.
- The authoritative reload runs through `loadHistory` so failure is distinguishable from a superseded load.
- On failure the answer becomes `recoverySnapshot` (rendered by the panel as an assistant bubble); history state stays untouched.
- `loadHistory`'s success block clears the snapshot in the **same flush** as the authoritative rows — never two copies of an answer on screen.
- Retry is the existing history-reload affordance; generation is never re-run.
- Snapshot clears on scope/session switches (all wholesale message resets) and is never set for an empty answer.

Pins: hook test "keeps the streamed answer as a recovery snapshot when the terminal reload fails…", "never leaves an empty recovery bubble when the terminal arrived before any delta", panel test asserting the snapshot renders exactly once, the error banner is retryable, and after retry the answer renders exactly once from authoritative history with the dispatch call count unchanged.

Design note: the snapshot carries no separate visual label — the retryable error state is carried by the existing error banner until history reconciles.

## Gates at this revision (all from repo root, locked)

| Gate | Result |
| --- | --- |
| `pnpm check` (format:check → lint --deny-warnings → typecheck → test → magic-values + self-test → deny-exceptions + self-test) | exit 0 |
| Vitest | 55 files, **624/624** passed (+3: 2 hook, 1 panel acceptance tests) |
| TypeScript (`pnpm typecheck`, strict root config) | clean |
| `cargo test --workspace --locked` | **336 passed**, 0 failed (+4: 2 ipc acceptance, 2 adapter fixtures) |
| `cargo clippy --workspace --all-targets --locked` | 0 warnings |
| `cargo fmt --check` | clean |

Typecheck note: running the full `pnpm typecheck` (root config) surfaced pre-existing latent mock-typing debt in the two frontend test files (precise `Mock` signatures for the streaming members, `exactOptionalPropertyTypes` on an optional prop, `StreamEvent` callback contravariance in `emit` captures). Fixed in this change set by typing the shared `ConversationFakeBackend` streaming members from the real backend contract; no production code semantics changed.

## Remaining gaps

1. **Live Ollama E2E (plan A7 Step 2) not run** — approval-gated (model download + live calls). The fixture equivalents above cover every listed scenario except real-socket behavior of the Ollama HTTP/SSE shape beyond the NDJSON/transport stubs.
2. Live native hands-on testing of the running dev app is the user's activity; only their observations can confirm UI-level feel (streaming latency, stop responsiveness) — not an automated gate.

## Evidence hygiene

- No raw app-data paths, key material, or secrets in this file. All test data is synthetic (`Hello world`, `partial answer`, fake ids).
- The A7 E2E section of the plan is intentionally left unticked in `docs/superpowers/plans/2026-10-16-provider-model-integration.md` with its gating noted in place.

---

# Addendum: 2026-10-17 defect investigation (owner-reported, Delivery A)

## Symptom

Owner selected `qwen3.5:0.8b` (Local Ollama) and sent repeated user messages: no
assistant answer ever appeared, and an "Unresolved message" banner (Review &
Resend / Dismiss) persisted.

## Running build verification

- App process: PID alive at the time of inspection, launched 15:11:30Z from
  `target/debug/adham-desktop` (mtime 14:52Z, i.e. post-`a1033d1` non-test
  semantics = A5/A6 handlers; `b8e6f65`'s Rust delta is test-only). Frontend is
  HMR-served from the working tree.
- Data root: `~/Library/Application Support/Adham/data/` (`adham.db` + WAL);
  inspected read-only via copies in the OpenCode scratch dir.

## Model-discovery provenance (question 2)

- `provider_accounts`: one row, kind `ollama_local`, base_url
  `http://localhost:11434`, status active (created 14:39:50Z).
- `provider_models`: `qwen3.5:0.8b`, digest `d9c89605…2402d88f1c` — byte-equal
  to the live daemon's `/api/tags` digest at inspection time. Recorded 14:39:55Z,
  ~30s before the first failed dispatch: real Discover output, not a fixture.
- Capabilities: streaming supported, thinking supported. Dispatch consumed
  exactly this account/model identity (dispatching-log + op correlation).

## Event-log + DB trace (questions 3–5)

- Session scope matches the banner ids. `conversation_messages`: 3 `user`
  rows, 0 assistant rows. `events`: only 3 `MessageSubmitted` at positions 4–6;
  no provider events of any kind.
- `pending_operations`: **two** rows, both `kind='provider-completion'`,
  `status='pending'`, created 14:40:25Z and 14:53:00Z (the 02:40/02:53 sends).
  Not the older message-recovery chain — dispatch DID reach the provider path;
  there was **no silent fallback to text-only recording** (no
  `single_message`/`first_send` op exists for these turns).
- Dev log: both dispatches end in
  `thread 'tokio-rt-worker' panicked at crates/adham-provider/src/adapters/ollama_http.rs:281:56:
  events queued`.
- Provider-completion ops WERE incorrectly entering the older message-recovery
  flow: `listDurablePendingOperations` returned all pending kinds and the
  banner rendered the first one as "unsent message text".

## Root cause

`OllamaChatStream::next_event()` popped its normalized-event queue with
`expect("events queued")`. A structurally valid, contentless frame — thinking
models emit `{"content":"","thinking":"…"}` runs first (`qwen3.5` family) —
parses to an **empty** event list, the queue is empty, the panic fires, the
tokio streaming task aborts, the completion op is never resolved → dangling
`pending` op, no terminal, no answer.

## Fixes (root-cause first, no symptom patching)

1. `ollama_http.rs` `next_event()`: empty parse results are skipped (loop
   continues reading); only EOF-without-terminal and wire errors terminate.
   Session-quoted comment marks the panic-must-not-return invariant.
2. `handlers/providers.rs`: `tracing::warn!` on mid-wire stream errors (the
   boundary was previously silent in logs).
3. `durable-pending-operations.ts`: message-recovery list filters to
   `MESSAGE_RECOVERY_KINDS` (`single_message`, `first_send`);
   `provider-completion` ops no longer enter the Review & Resend banner. The
   stuck rows themselves were **not** dismissed, deleted or resent.

## Regression tests at the failing boundaries

- `crates/adham-provider/tests/ollama_http_tests.rs`:
  `thinking_frames_do_not_panic_and_stream_continues` (live qwen3.5 shape),
  `heartbeat_frames_are_skipped_without_events`. Both fail by panic on the old
  code. Adapter battery: 11 passed.
- `apps/desktop/src-tauri/src/ipc_contract_tests.rs`:
  `thinking_model_stream_persists_answer_and_resolves` — end-to-end through the
  real handler: exactly one user turn + one answer, single `completed`
  terminal, op resolved, thinking run never leaks into the record. 16 passed.
- `apps/desktop/src/features/conversation/pending-recovery/pending-recovery.test.tsx`:
  `excludes provider-completion ops from the message-recovery list and banner`.

## Bounded live verification (authorized: local model + disposable context, no cloud)

A throwaway `#[ignore]` probe drove the real handler against
`http://127.0.0.1:11434` with the real `qwen3.5:0.8b` (disposable temp SQLite,
synthetic prompt, hard 90s cap; transport also enforces a 120s total deadline).
Result (13.9s): exactly one `completed` terminal, exactly 2 rows (1 user + 1
assistant), answer non-empty, reload-stable second read returns the identical
row, op `resolved`. Probe deleted after the run; recorded here only.

## Owner-session expected behavior after the fix

- The running dev app binary already contains the fix at the time of writing
  (watcher relaunched post-fix; bin 15:46Z > adapter fix 15:45Z); the frontend
  filter is live via HMR. The next dev relaunch after further Rust edits
  picks both up regardless.
- The two historical `provider-completion` rows remain in the owner database
  untouched; the banner no longer claims them. Opposite-direction residue to
  verify: new sends stream normally.

## Gate results (final tree)

| Gate | Result |
| --- | --- |
| `cargo test --workspace --locked` | **339 passed**, 0 failed (+3: 2 adapter, 1 ipc) |
| `cargo clippy --workspace --all-targets --locked` | 0 warnings |
| `cargo fmt --all` | clean |
| Vitest affected suites (pending-recovery, use-conversation, panel) | 6 files, **65/65** |
| `pnpm check` (full, repo root) | exit 0 |
