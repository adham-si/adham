# Conversation 03 — session-history delivery evidence

- **Date:** 2026-10-22
- **Branch:** `feat/conversation-03-history`
- **Verified code revision:** `ca0f1d0` (`feat(history): add search and history panel`), plus the verification-only test, formatting, and file-size-gate changes described below.
- **Scope:** session list/fold, rename/pin/archive, message bookmarks, user summaries, search and filters, duplicate, Markdown export, delete, rebuild exclusion, null-session pending cleanup, and late-write rejection.
- **Data:** all fixtures and logs in this report are synthetic canary data. No user content, secrets, raw app-data paths, or key material are recorded.
- **Dependency statement:** no new third-party package was added for this suite. The workspace already pins `zeroize = "1.8"`; `adham-desktop-api` only gained the existing workspace dependency for re-sealing duplicated content. No PDF, OCR, image/vision, audio/video, or cursor dependency was added.

## 1. Delivered behavior

### 1.1 Session list and fold

- Session history is folded from events on read; no new session metadata projection table was introduced.
- The default list excludes archived rows and caps at 100. Pinned rows sort first, then activity descending.
- `list_sessions` accepts an optional `active_session_id`: a deleted or foreign id is ignored; an archived active session is inserted before the cap and replaces the tail if needed.
- Summaries are hydrated for the list. Missing or unreadable summary content sets `summary_unavailable`; the list returns an unreadable count instead of failing.
- Legacy create events are accepted in both stored forms (`SessionCreated` and `session/created`).
- Legacy create-receipt replay still works when the stream predates streams, but a receipt whose session has a tombstone is rejected.

### 1.2 Session actions and bookmarks

- Rename, pin, and archive append events with receipt/command idempotency. Rename rejects empty/control-only titles and titles over 120 scalars.
- Every action checks the active-session guard, so a deleted session cannot be changed.
- Per-message bookmarks are persisted, toggled through a command, and returned on `get_conversation` as `bookmarked_message_ids`.
- Bookmark commands reject a message from another session and reject a deleted session.

### 1.3 Editable summaries

- A user summary overrides the local extractive auto summary; reset returns to the auto summary.
- User summaries are capped at 500 scalars, stored through the existing AEAD content path, and receive receipts that contain no summary text.
- Replacing or clearing a summary tombstones the previous content. An unreadable user summary falls back to the auto summary.

### 1.4 Search and filters

- Search is bounded, decrypt-on-read, and scoped to the active project. It matches session titles, hydrated summaries, persisted message text across all branches, and linked attachment file names/extracted text.
- Unlinked attachments are never searched. Unreadable message/attachment content is skipped and counted in `skipped_unreadable`.
- Empty query with no active filter returns `VALIDATION_FAILED:empty_query`; `role` without a query returns `role_requires_query`; one-character queries return `query_too_short`; invalid roles return `VALIDATION_FAILED:role`.
- Supported filters: archived, pinned, bookmarked, role (`user`/`assistant`), has attachments, and a date range. Role and bookmark filters exclude title/summary-only matches.
- Empty-query `bookmarked_only` search returns message-level bookmark results. Role with an empty query is rejected by the backend and is disabled/cleared in the UI when the query empties.
- Bounds: at most 100 matching sessions, 50 results, and 10,000 scanned message rows. The response reports `truncated`, `scanned_sessions`, `scan_limit_reached`, and `skipped_unreadable`.
- Summaries, messages, and attachments share one cached content-key read per search.
- Results sort by session activity descending, then match position. Title/summary rows use negative positions.
- The UI debounces at 250 ms, ignores stale responses, and drops out-of-date errors. Results can open the session and dispatch `adham:session-focus-message` with `{workspaceId, projectId, sessionId, messageId}`; the conversation scrolls to and focuses the matching message, or leaves the session open without an error.
- The filter panel states that agents, participants, task status, model/provider, tags/folders, cost, and artifacts filters are not available; no control is rendered for those missing fields. Cross-project search is not offered.

### 1.5 Duplicate

- Duplicate copies every persisted transcript row (all branches), linked attachment records and references, the user summary, and message bookmarks.
- Feedback, active-branch choices, pin, archive, and session-scoped pending state are reset.
- New session/message/content ids are minted and content is re-sealed under the new session scope. Source pending operations block duplication with `SESSION_BUSY`; a null-session first send is matched by `create_request_id`.
- Limits: 500 messages and 5 MB of plaintext; exceeding either fails with `DUPLICATE_TOO_LARGE`.
- Missing or unreadable content fails with `STORAGE_REPAIR_REQUIRED`. Receipt replay returns the same new session without duplicating again.

### 1.6 Markdown export

- Export writes plaintext Markdown to fixed `<app-data>/exports/{slug}-{session-id}.md`.
- It uses a unique sibling `.tmp`, replacement rename, Unix mode `0o600`, and a 5 MB cap (`EXPORT_TOO_LARGE`).
- The export includes the summary and every branch row, and refuses deleted, busy, or unreadable sessions.
- The filename uses the full session id and a sanitized slug. Re-exporting the same session overwrites the same file.
- Export is not Save As. A native save dialog remains blocked on `tauri-plugin-dialog` and separate approval.

### 1.7 Delete

- Delete requires explicit confirmation, appends `SessionDeleted` plus a receipt, then purges session content, messages, attachments, feedback, bookmarks, branch selections, projections, and matching pending rows.
- Events, streams, and receipts remain. The receipt is replayed before the active-session guard, so a retry after tombstone returns the stored response.
- A live first-send pending row may have `session_id = NULL`; it is matched by `create_request_id` against the `SessionCreated` event request id. The delete first refuses while pending and can purge the resolved null-session row.
- Late writes (submit, pending first send, attachment ingestion, create receipt replay) are rejected after delete; `lock_session_stream_tx` plus `ensure_session_active_tx` prevent resurrection.
- Projection rebuild skips message events whose session has a `SessionDeleted` event; migration re-applies tombstones after legacy projection rebuilds.
- Exported Markdown remains after delete. Delete is not forensic erasure: SQLite journals, backups, and exported files may retain copies. The UI says "Delete from history", cannot be undone, and discloses those limits.

## 2. Synthetic test evidence

### 2.1 Targeted backend suites

Command (working tree based on `ca0f1d0`):

```bash
cargo test -p adham-desktop-api --locked \
  --test session_history_list --test session_history_actions \
  --test session_history_bookmarks --test session_history_summaries \
  --test session_history_search --test session_history_duplicate \
  --test session_history_export --test session_history_delete

cargo test -p adham-projections --locked \
  --test projection_tests rebuild_skips_deleted_sessions
```

Recorded result (`.superpowers/sdd/2026-10-20-session-history/logs/task11-targeted-final.log`, omitted from git):

| Suite | Result |
|---|---|
| `session_history_list` | 8 passed, 0 failed |
| `session_history_actions` | 3 passed, 0 failed |
| `session_history_bookmarks` | 3 passed, 0 failed |
| `session_history_summaries` | 5 passed, 0 failed |
| `session_history_search` | 10 passed, 0 failed |
| `session_history_duplicate` | 7 passed, 0 failed |
| `session_history_export` | 5 passed, 0 failed |
| `session_history_delete` | 8 passed, 0 failed |
| `projection_tests::rebuild_skips_deleted_sessions` | 1 passed, 0 failed |

The delete suite includes `late_submit_after_delete_is_rejected`, `first_send_pending_after_delete_is_rejected`, `attachment_ingestion_after_delete_is_rejected`, and `create_receipt_replay_after_delete_is_rejected`. The duplicate suite includes null-session pending rejection and re-seal coverage. The list suite includes active-archived cap insertion, unreadable summaries, pin ordering, and legacy receipt fallback.

### 2.2 Targeted frontend suites

Command:

```bash
pnpm exec vitest run \
  apps/desktop/src/features/history \
  apps/desktop/src/features/conversation/conversation-panel.history-focus.test.tsx \
  apps/desktop/src/features/conversation/use-project-sessions.test.tsx \
  apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.history.test.tsx
```

Result (`.superpowers/sdd/2026-10-20-session-history/logs/task11-targeted-final.log`): 8 files, 27 tests passed. Coverage includes debounce/stale-response handling, empty-query and role clearing, filter-only search, notices, retry, action-menu compatibility, include-archived refetch, and message focus/absent-message behavior.

### 2.3 Full verification set

Command:

```bash
node scripts/check-file-size.mjs
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo xtask contracts
cargo test --workspace --locked
cargo test -p adham-desktop-api --test p0_repair_regression --locked
pnpm check
```

| Check | Recorded result |
|---|---|
| File-size gate | exit 0; 0 errors over 600 lines; 54 warnings over 400 lines. The gate now honors the AGENTS.md documented-exception marker; eight files carry that marker. |
| `cargo fmt --all -- --check` | exit 0 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | exit 0; finished with no warnings |
| `cargo xtask contracts` | generated `packages/contracts-generated/src/index.ts`; no diff remained |
| `cargo test --workspace --locked` | 520 passed, 0 failed across 107 test binaries |
| `p0_repair_regression` | 8 passed, 0 failed |
| `pnpm check` | exit 0: format, oxlint, tsc, tests, magic-values, and deny-exceptions all passed; 88 test files / 855 tests |

The first full pass exposed five files with formatting drift (all verification-only or earlier history UI files). `biome format --write` was run on the changed paths and `pnpm check` was rerun clean. No test was suppressed and no assertion was weakened.

### 2.4 Contract and dependency drift

- `cargo xtask contracts` regenerated the committed TypeScript contracts; `git status` showed no outstanding `packages/contracts-generated` diff afterward.
- No `package.json` or `pnpm-lock.yaml` change.
- `Cargo.lock` records the existing workspace `zeroize` edge and a patch update of `rustls-webpki` from 0.103.15 to 0.103.16 for RUSTSEC-2026-0382; no new registry package or license entered the lockfile.
- No PDF, OCR, image/vision, audio/video, or cursor package is present.

## 3. Honest limits and blocked tracks

| Item | Status | Reason |
|---|---|---|
| PDF input/extraction (#33) | Not implemented | No approved parser. Rust candidates need subprocess isolation and resource caps; `pdfjs-dist` does not meet the Safari 18.2/WebView floor. |
| Images/vision, OCR, audio/video, artifacts (#34) | Not implemented | No adapter/policy decisions and no approved dependencies. No control fabricates support. |
| Stable turn/attempt ids, cursors, pagination (#35) | Not implemented | Blocked on the P0 durable-identity repair. The existing cursor fields remain placeholder-only. |
| Agents, participants, task status, model/provider, tags/folders, cost, artifacts, cross-project filters | Not available | The durable data does not exist. The filter panel says so and renders no fake control. |
| Export Save As | Not implemented | Requires `tauri-plugin-dialog` and operator approval. Export uses the fixed disclosed folder. |
| Forensic deletion | Not claimed | Delete purges active database content and appends a tombstone, but SQLite journals, backups, and exported Markdown may retain copies. |
| Real-data use | Blocked | P0 content protection is still under repair. This evidence uses disposable synthetic data only. |

## 4. Operator acceptance still required

- Live GUI review of the new history panel and dialogs against a synthetic project remains the operator's acceptance step.
- Pushing the branch and opening/merging the PR require explicit operator approval. Required CI checks must pass at the pushed revision before merge.
