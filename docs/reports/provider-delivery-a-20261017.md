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
