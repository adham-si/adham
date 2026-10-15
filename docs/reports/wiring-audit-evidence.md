# Wiring audit — evidence report

Revision: `9e13fd9cf95dc209888e7836e2ffb73be09d8746` — final ONBOARDING-01
candidate (`94b52e4` onboarding layout, `a22c6aa` platform data-root override,
`9e13fd9` IPC contract tests; this evidence update rides on top). Original
audit revision: `9c93df1f4ea923ff7dd5be3adc3aa4fcbf263055`.
Comparison target for branch state: `origin/main` `6a50d86ca8cae9aa4f849c5b03249fcd14f47191`
(unchanged at update time; the branch includes it via merge `a6699f7`). All
data synthetic canary only; no user content, secrets, app-data copies, or key
material anywhere in this report. All audit and walk work was read-only apart
from app launches; no data was modified or deleted.

This report separates **automated backend/frontend results** (repeatable
suites, re-run at the revision above) from **native acceptance** (walk W1,
§7).

## 1. Repository state (branch history)

| Item | Value |
|------|-------|
| Checked-out branch | `feat/onboarding-01` |
| HEAD SHA | `9c93df1f4ea923ff7dd5be3adc3aa4fcbf263055` at original audit; candidate now `9e13fd9cf95dc209888e7836e2ffb73be09d8746` |
| Local `main` | `4547b74c45bf17c1ba0ff3f4f0f89f8a85c1b9e1` — merge-base, stale (unchanged) |
| `origin/main` | `6a50d86ca8cae9aa4f849c5b03249fcd14f47191` *(audit-time divergence: HEAD was +11 / −13; now +15 / −0 — the branch merged `origin/main` in `a6699f7`)* |
| Merge feasibility | **Textually clean at the candidate.** `git merge-tree --write-tree origin/main HEAD` re-run 2026-10-15: exit 0, zero conflicts (result tree `ef298db8`). At the audit revision it was also clean (result tree `5da5d42a`; theirs = 11 files CI/Cargo/toolchain/Linux platform, ours = 54 frontend/docs files, intersection empty). GitHub reports the PR `MERGEABLE` (`BEHIND` only because the pre-push head predates the `origin/main` merge). |
| Candidate touch surface | The 11 original onboarding commits changed only `.ts/.tsx/.json/.png/.md` — zero Rust. The candidate adds two Rust-touching commits (`a22c6aa` platform data-root override, `9e13fd9` src-tauri IPC contract tests), so backend suites were re-run at the candidate (§3). |

Uncommitted files at audit time (unrelated to the journey; preserved, never
staged): modified `AGENTS.md`, `package.json` (adds a `sync:notion` script);
untracked `.env.example`, `scripts/sync-notion.mjs`, `docs/adham-localization-delivery/`,
`docs/adham-localization-delivery.zip`.

Environment at audit time: macOS 27.0.1 (26A434) arm64 · Node v26.2.0 ·
pnpm 10.33.2 · cargo/rustc 1.99.0 · dirty tree.

## 2. Wiring map

Entry: `apps/desktop/src/routes/index.tsx` gates on `onboarding.phase !== 'complete'`.
Onboarding is a phase gate inside `/`, not a route (`routeTree.gen.ts` has only `/`
and `/gallery`).

| Action | UI entry | Typed IPC | Backend service | Persisted effect |
|---|---|---|---|---|
| Create workspace | `workspace-step.tsx` | `create_workspace` | `service/workspace.rs` | `events`+`streams` (`WorkspaceCreated`), `command_receipts`, active scope → `(ws, null)` — one transaction |
| Create project | `project-step.tsx` | `create_project` | `service/workspace.rs` | `events`+`streams` (`ProjectCreated`), receipt, active scope → `(ws, proj)` — one transaction |
| Select existing | `project-step.tsx` | `select_project` | `service/selection.rs` | receipt only — **appends no event**; updates installation scope — one transaction |
| Basic send | `conversation-panel.tsx` | `submit_message` | `service/message.rs` | content (AEAD), event, stream, projection, checkpoint, receipt — **one transaction, this command only** |
| Durable pending send | `conversation-panel.tsx` | `record_pending_operation` → `create_session` → `submit_message` → `clear_pending_operation` | `service/pending.rs`, `session.rs`, `message.rs` | **Four IPC commands, four transactions.** Each command is internally atomic; the chain is not. Crash-safety comes from the pending-operation marker, not from chain atomicity (see §4) |
| Session list | `primary-sidebar.tsx` | `list_sessions` | `service/session.rs` | read-only, `project_id`-scoped |
| Open session / history | `use-conversation.ts` | `get_conversation` | `handlers/conversation.rs` | read-only, decrypts content |
| Switch session | `primary-sidebar.tsx` | none | none | nothing — in-app event + durable preference only (see §5) |

Sessions have no table; a session exists iff a `SessionCreated` event sits at
`stream_sequence=1`. DB is `<data-dir>/adham.db` with WAL +
`synchronous=Full`.

Scope isolation is enforced at four layers: ownership proof from `events`
seq-1 before every write; query-level `WHERE` filters; scope columns on every
event/content row; AEAD associated data binding
`v/content_id/kind/installation/workspace/project/session` — a row copied
across sessions fails authentication.

## 3. Automated results — backend (Rust)

`cargo test --workspace` → **248 passed, 0 failed** at the candidate revision
(243 at the original audit, +3 `data_root_override_*` debug-profile tests,
+2 `ipc_contract_tests`). `cargo fmt --all --check`, `cargo check --workspace
--all-targets --locked`, `cargo clippy --workspace --all-targets --locked
-- -D warnings`, `cargo xtask contracts` (no generated diff) and the desktop
production build (`tsc --noEmit && vite build`) also pass at the candidate.

| # | Scenario | Verdict | Evidence (test file :: test) |
|---|---|---|---|
| 1 | Create workspace | Pass | `bootstrap_selection` (6 tests, incl. zero-row selection-update rollback), `creation_validation` (4) |
| 2 | Create project | Pass | `bootstrap_selection`, `creation_validation` (4) |
| 3 | Select existing workspace/project | Pass | `selection_validation` (9 tests, incl. `restart_restores_confirmed_selection`, `valid_selection_persists_and_writes_no_event`) |
| 4 | Basic send | Pass | `scenarios_1_to_4::test_scenario_1_create_and_display` |
| 5 | Session list (project-scoped) | Pass | `session_discovery_restoration::test_list_sessions_returns_chronological_order_and_project_scoped` |
| 6 | Open session / history content | Pass | `scenarios_1_to_4::test_scenario_1_create_and_display` (display), `test_scenario_2_restart_and_replay` (reload), `conversation_save_reload::test_backend_issued_ids_survive_restart_reload` (restart). Note: `session_discovery_restoration::test_conversation_ownership_and_existence_validation` proves *validation* (valid context loads; `SESSION_NOT_FOUND`/`CONTEXT_MISMATCH` rejections), not history content |
| 7 | Quit/relaunch + history | Pass | `conversation_save_reload::test_backend_issued_ids_survive_restart_reload`, `p0_repair_regression::test_installation_identity_stable_across_reopen` |
| 8 | Unresolved-send recovery | Pass | `pending_recovery_reopen_tests::test_persistent_db_reopen_preserves_and_decrypts_pending_operations` |
| 9 | Explicit resend, zero duplicates | Pass | `pending_recovery_reopen_tests::test_context_reopen_recovers_pending_operation_and_resend_zero_duplicates` |
| 10 | Duplicate prevention / idempotency | Pass | `scenarios_1_to_4::test_scenario_4_duplicate_request_idempotency` (identical replay), `pending_recovery_contract_tests::test_lost_response_receipt_replay_zero_duplicate_events`. Distinct property: `scenarios_5_to_8::test_scenario_5_conflicting_request_reuse` — same request id with a *different* payload conflicts and mutates nothing (conflict handling, not duplicate suppression) |
| 11 | A/B scope isolation | Pass | `session_discovery_restoration::test_list_sessions_rejects_mismatched_workspace`, `p0_repair_regression::test_cross_scope_reuse_conflicts_without_mutation`, `scenarios_5_to_8::test_scenario_7_wrong_project_context_mismatch` |
| 12 | No cleartext at rest | Pass | `p0_repair_regression::test_persisted_state_contains_no_cleartext` |
| 13 | Interrupted-transaction atomicity | Pass (storage layer only) | `scenarios_5_to_8::test_scenario_8_interrupted_transaction_atomicity` is a raw `pool.begin()` + manual INSERT + explicit `rollback()` + count==0 — it demonstrates SQLite rollback semantics, **not** an interrupted service-path append. Service-path rollback is covered separately by `bootstrap_selection::test_selection_update_failure_rolls_back_entire_creation` (zero-row selection update ⇒ no receipt, no stream, no event survive) |

All backend tests run on disposable SQLite databases under the system temp
directory with `InMemoryProvider::generate()` — no real data, no credential
store touched.

## 4. Basic send vs durable pending-send recovery

These are two different chains and must not be conflated:

- **Basic send** (`submit_message` alone): one command, one transaction
  covering content, event, stream, projection, checkpoint, receipt. It either
  fully commits or fully rolls back.
- **Durable pending-send recovery** (first send under uncertainty): four
  commands, four transactions. `record_pending_operation` freezes intent →
  `create_session` → `submit_message` → `clear_pending_operation`. There is no
  chain-level transaction; recovery correctness rests on the pending-operation
  marker plus request-id idempotency. Chain-level evidence:
  `pending_recovery_contract_tests::test_first_send_replay_creation_and_submit_zero_duplicates`
  (whole-chain replay produces zero duplicates).

## 5. Session selection — existing restoration preference

Switching sessions is **not a backend operation** and this report recommends
**no new selection events**. The current, backend-validated design:
`use-project-sessions.ts` dispatches an in-app `adham:session-select` event;
`use-conversation.ts` handles it; the selected session is persisted as a
durable preference keyed
`adham:session:selected:{installationId}:{workspaceId}:{projectId}` in
`localStorage` (`durable-session-storage.ts`), with a `sessionStorage` cache
(`adham:compose:session`) for remounts. Restoration resolves durable
preference → session cache → discovery, and a missing/mismatched preference
self-invalidates while a transient storage error surfaces as an error.
Automated coverage: `durable-session-storage.test.ts`, `session-restoration.test.ts`
(jsdom). There is no SQLite record that a session was ever "current"; that is
a deliberate scoping choice, not a defect. The switch survives relaunch only
via the durable preference.

## 6. Visible placeholders (unchanged from prior rounds)

No `TODO`/`Coming soon` in code. Unbacked UI, in priority order: Windows path
shown on macOS in Settings/data page; "Rebuild Index" button only reads
storage status; "Clear Cache" has no `onClick`; four hardcoded model options
incl. `cloud:` entries with no provider wiring; "Zero data leaves this
machine" is a UI assertion with no backend command; telemetry strip always
`Unknown` (5 props never passed); simulated attachment chip; Stop unreachable
(`status="idle"` pinned); approval bar unreachable (`approvalRequest={null}`);
`pending_operations.status` write-only `"pending"` and `reason` validated but
not persisted; pagination stubbed (`next_cursor: None`, row-count position);
seven orphaned workspace crates with no dependents. No mock backend ships in
production paths — every backend defaults to the real singleton, injectable
only by tests.

Walk W1 additionally observed (screenshots owner-held): the inspector's Plan
tab shows a staged EXECUTION PLAN on a scope with zero sessions/messages and
no plan data in the event log; and the composer's model/mode controls show
configured-looking defaults (`local:qwen2.5-coder:32b`, Plan mode, `Unknown`
chips) with no provider configured — adjacent to an honest text-only
submission notice. UI-truthfulness fixes (hide/disable/correct rather than
fabricate) are **out of scope** for the ONBOARDING-01 delivery and deferred.

## 7. Native acceptance — walk W1 (2026-10-15, macOS arm64)

Binary under test: sha256 `884b7fe1…`, built from the candidate tree.
Synthetic canary data only; the full walk log is owner-held outside the repo —
this section is the sanitized in-repo record. Automated results at the same
revision are §3 (`pnpm` 46 files / 554 tests; cargo 248 passed).

| # | Scenario | Status |
|---|---|---|
| S1 | Onboarding → empty conversation | **PASS (DB-verified)** — workspace + project created, active scope persisted, 0 sessions / 0 messages / 0 pending markers, receipts `success`, checksum chain intact |
| S2 | First send | **PASS (DB-verified; second attempt)** — one session, one `user_text` message (29 B protected content), all four chain receipts `success`, pending marker cleared, UI matched the DB. The first attempt left no trace anywhere and is logged as an unresolved observation |
| S3 | Session switching | **Owner-observed pass — not independently corroborated** (no second session/message in the final DB snapshot); treated as not independently verified |
| S4 | Quit/relaunch restore (selection + history, no duplicates) | **Deferred — not run** |
| S5 | Crash-mid-first-send → pending recovery (no silent resend) | **Deferred — not run** |
| S6 | Recovery resend path (exactly one session/message, pending cleared) | **Deferred — not run** |
| S7 | A/B scope isolation | **Deferred — not run** |
| S8 | AEAD failure handling (corrupt `protected_bytes` → fail closed; restore → recoverable) | **Deferred — not run** |

Item 15 (frontend against real backend) is now covered by the committed
cross-language contract tests (`9e13fd9`): the TS client's exact invoke
payloads are pinned in a fixture and replayed through the real Rust dispatch.
Item 16 (switch/restart under real webview storage) is only partly exercised
(session renders after send) and remains deferred with S3 corroboration / S4.

Item-14 walk isolation (see §8): **PASS** — dedicated fake `HOME`, a dedicated
OS-credential-store item for the walk's fresh installation, and a tagged
binary copy with its own WebKit container. The pre-existing production
keychain item's attributes were byte-identical at S1 against the pre-walk
baseline. Walk resources (processes, credential item, WebKit container) are
preserved; no cleanup has been performed.

Platform coverage: **macOS arm64 only**. Windows and Ubuntu 24.04 native
results are not established and must be run on those platforms.

**No release acceptance is claimed.**

## 8. Native-test isolation (resolved in walk W1)

Facts constraining a real launch:

1. **App data**: macOS storage root derives from `$HOME`, so a disposable
   `HOME` redirects SQLite (`<fake-home>/Library/Application Support/Adham/data/adham.db`).
2. **Credential store**: the content key lives in the OS credential store
   (service `adham-content-key`, account = installation id). A fresh database
   creates a fresh installation id, and first initialization writes **one new
   entry** into the real login keychain; existing entries are never read or
   overwritten.
3. **Renderer storage is NOT redirected by `$HOME`.** WKWebView stores
   localStorage/sessionStorage under the real user's WebKit container
   (process-name/bundle-derived). Full renderer key inventory:

   | Key | Store | Written by |
   |---|---|---|
   | `adham.appearance` | localStorage | theme preference (+ pre-render no-flash script) |
   | `adham.language` | localStorage | language preference |
   | `adham:session:selected:{installationId}:{workspaceId}:{projectId}` | localStorage | durable session selection |
   | `adham:compose:draft:{sessionId}` / `…:draft:pending` | localStorage | composer drafts |
   | `adham:compose:history:{sessionId}` | localStorage | composer prompt history |
   | `adham:compose:session` | sessionStorage | frozen session cache |
   | `adham:compose:create-intent` | sessionStorage | frozen create intent |
   | `adham:compose:pending-send` | sessionStorage | frozen pending send |
   | `adham:compose:pending-first-send` | sessionStorage | frozen first-send intent |
   | `adham:provision:workspace` / `…:project` | sessionStorage | frozen provisioning intents |
   | `adham:select:intent` | sessionStorage | frozen selection intent |

   With a shared store, "fresh setup" would read the real `adham.appearance`
   and `adham.language` preferences and could modify real keys. Walk W1
   resolved this with an equivalent demonstrated method: a tagged copy of the
   binary (process-name-derived WebKit container) kept renderer storage
   separate. Isolation: **PASS**. The walk's fresh installation wrote exactly
   one new credential-store item of its own; the pre-existing production item
   was byte-identical before/after. No credential or app-data deletion has
   been performed; cleanup of walk resources is owner-scoped and pending
   confirmation.
