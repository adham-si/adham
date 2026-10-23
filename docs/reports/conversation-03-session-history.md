# Conversation 03 — session-history delivery evidence

- **Date:** 2026-10-23
- **Branch:** `feat/conversation-03-history`
- **Verified code revision:** `7880332` (`fix(deps): patch zod collection advisory`), built on `0b4e9ec` (delete-cancel test), `dea4a7b` (search-results split), and `f968f1d` (native Save As). The native binary was built from `dea4a7b`; `0b4e9ec` adds only a test and `7880332` only the existing zod patch.
- **Scope:** session list/fold, rename/pin/archive, message bookmarks, user summaries, search and filters, duplicate, Markdown export, delete, rebuild exclusion, null-session pending cleanup, and late-write rejection.
- **Data:** all fixtures, logs, and screenshots in this report are synthetic canary data. No user content, secrets, raw app-data paths, or key material are recorded.
- **Dependency statement:** Markdown export now uses `tauri-plugin-dialog = "=2.8.3"` for the native Save As panel. The section 9 record is `docs/reports/dependency-record-tauri-plugin-dialog.md`; transitive `tauri-plugin-fs 2.7.1` is not registered and grants no filesystem capability. The existing zod dependency is patched from 4.6.5 to 4.6.7 for a high collection-size advisory. No PDF, OCR, image/vision, audio/video, or cursor dependency was added.

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
- Search rows distinguish attachment text from attachment file names and show the matched source filename on the combined source line.

### 1.5 Duplicate

- Duplicate copies every persisted transcript row (all branches), linked attachment records and references, the user summary, and message bookmarks.
- Feedback, active-branch choices, pin, archive, and session-scoped pending state are reset.
- New session/message/content ids are minted and content is re-sealed under the new session scope. Source pending operations block duplication with `SESSION_BUSY`; a null-session first send is matched by `create_request_id`.
- Limits: 500 messages and 5 MB of plaintext; exceeding either fails with `DUPLICATE_TOO_LARGE`.
- Missing or unreadable content fails with `STORAGE_REPAIR_REQUIRED`. Receipt replay returns the same new session without duplicating again.

### 1.6 Markdown export

- Export opens the operating system's native Save As panel. The user chooses the filename and destination; there is no fixed export folder and no webview filesystem access.
- Before the panel opens, the Rust command validates session ownership, active/tombstone state, and live-operation state. The export service validates the same conditions again after a destination is chosen, so a session deleted while the panel is open cannot be exported.
- The suggested filename is `{sanitized-title}-{full-session-id}.md`. Empty/control-only titles become `session-{id}.md`; path separators, control characters, and other non-slug characters are removed. The default always ends in `.md`.
- Cancellation returns `null`; it does not call the export service, write a file, or show an error. The export dialog remains open so the user can retry or close it.
- The native Save As panel owns overwrite confirmation. A confirmed replacement uses a unique sibling temporary file, `sync_all`, and an atomic replacement. A failed write or failed replacement removes the temporary file and leaves any existing destination untouched.
- The export has a 5 MB plaintext cap (`EXPORT_TOO_LARGE`). The dialog keeps the plaintext warning; the service refuses deleted, busy, or unreadable sessions and content-repair failures.
- Unix files are created with mode `0o600`. Windows file permissions are not described as `0600`; they follow the destination directory's OS ACLs.
- The success path closes the export dialog and shows a non-modal status card with the saved path, byte count, copy action, and close action. There is no second dialog and no modal success card.
- The rendered Markdown includes the plaintext warning, the summary, and every branch row. Exported files are outside Adham and remain after session deletion.

### 1.7 Delete

- Delete requires explicit confirmation, appends `SessionDeleted` plus a receipt, then purges session content, messages, attachments, feedback, bookmarks, branch selections, projections, and matching pending rows.
- Events, streams, and receipts remain. The receipt is replayed before the active-session guard, so a retry after tombstone returns the stored response.
- A live first-send pending row may have `session_id = NULL`; it is matched by `create_request_id` against the `SessionCreated` event request id. The delete first refuses while pending and can purge the resolved null-session row.
- Late writes (submit, pending first send, attachment ingestion, create receipt replay) are rejected after delete; `lock_session_stream_tx` plus `ensure_session_active_tx` prevent resurrection.
- Projection rebuild skips message events whose session has a `SessionDeleted` event; migration re-applies tombstones after legacy projection rebuilds.
- Exported Markdown remains after delete. Delete is not forensic erasure: SQLite journals, backups, and exported files may retain copies. The dialog says "Delete from history", cannot be undone, and discloses those limits, including that exported Markdown files remain on disk.

## 2. Synthetic test evidence

### 2.1 Targeted backend suite

Command:

```bash
cargo test -p adham-desktop-api --test session_history_export --locked
```

Result at the final head: 8 passed, 0 failed.

Coverage includes destination selection, overwrite, Unix `0o600`, the 5 MB cap preserving an existing destination, a write failure preserving an existing destination, preflight rejection for foreign/deleted/busy sessions, preflight acceptance after a busy row resolves, and filename sanitization/default `.md`.

### 2.2 Targeted frontend suites

Command:

```bash
pnpm exec vitest run \
  apps/desktop/src/features/history/delete-session-dialog.test.tsx \
  apps/desktop/src/features/history/export-session-dialog.test.tsx \
  apps/desktop/src/features/history/export-session-toast.test.tsx \
  apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.history.test.tsx
```

Result: 4 files, 12 tests passed. Coverage includes export dialog warning, auto-close on success, cancel without a result, toast path/bytes/copy/dismiss, and delete-dialog caveats plus cancel-without-delete.

### 2.3 Full verification set

Commands:

```bash
node scripts/check-file-size.mjs
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo xtask contracts
cargo test --workspace --locked
cargo deny check
pnpm check
pnpm audit --audit-level=high
```

| Check | Result at final code head |
|---|---|
| File-size gate | exit 0; 0 errors over 600 lines, 53 warnings over 400 lines. |
| `cargo fmt --all -- --check` | exit 0 |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | exit 0 |
| `cargo xtask contracts` | generated; no outstanding `packages/contracts-generated` diff |
| `cargo test --workspace --locked` | 515 passed, 0 failed across 106 test binaries |
| `cargo deny check` | advisories, bans, licenses, and sources all ok |
| `pnpm check` | 89 files / 863 tests passed; format, lint, typecheck, magic-values, and deny-exceptions passed |
| `pnpm audit --audit-level=high` | no known vulnerabilities |

Rust checks were run at `0b4e9ec`; the pnpm checks were rerun at `7880332` after the zod patch. The export test file carries a documented size exception because its cases share one disposable database fixture and cleanup. The history panel was split so the search-results component stays below the 600-line gate.

### 2.4 Review result

The final diff was reviewed against the security, correctness, performance, and maintainability dimensions. No critical issue was found.

- The webview cannot pass an arbitrary destination path: the command opens the native panel and only the selected path reaches the export service.
- Session ownership/active/busy checks run both before the panel and inside the export transaction; the write holds the per-session lock, so a concurrent delete cannot be interleaved.
- Filename input is reduced to a slug plus the validated session id; path separators, control characters, and traversal fragments do not survive.
- Replacement is atomic, a failed write/replacement preserves the existing destination, and no `tauri-plugin-fs` capability or JS filesystem API is registered.
- The export dialog closes on success; the status card is non-modal and the close/copy controls have labels.

Residual platform limits are listed in section 3: the Windows/Linux panels are not interactively exercised, and the native overwrite prompt is the operating system's behavior rather than an app-level second confirmation.

### 2.5 Contract and dependency drift

- `cargo xtask contracts` regenerated the committed TypeScript contracts; no diff remained.
- `Cargo.toml` pins `tauri-plugin-dialog = "=2.8.3"`; `Cargo.lock` resolves `tauri-plugin-dialog 2.8.3`, `tauri-plugin-fs 2.7.1`, and `rfd 0.16.1`.
- `tauri-plugin-fs` is not initialized in `lib.rs` and has no `fs:` capability; the default capability contains only core window permissions.
- `Cargo.lock` also carries the `tokio 1.53.3` patch used to clear RUSTSEC-2026-0386.
- `apps/desktop/package.json` and `pnpm-lock.yaml` update the existing zod dependency from 4.6.5 to 4.6.7 to clear the high collection-size advisory (patched in 4.6.6); `pnpm audit --audit-level=high` is clean. The lock refresh also picked up `@babel/runtime 7.29.10` within its existing range. No new package or new dependency record was added.
- No PDF, OCR, image/vision, audio/video, or cursor package is present.

## 3. Native GUI acceptance (synthetic canary)

- **Environment:** macOS 27.0.1 (26A434), native debug build via `pnpm --dir apps/desktop tauri build --debug --no-bundle --ci`, isolated synthetic data root. No real data, secrets, or key material were used.
- **Build:** the running binary was built from `dea4a7b`; `0b4e9ec` adds only the delete-cancel test and `7880332` only the zod patch. No production bundle (`.app`) was produced.

Confirmed in the native app:

- A first send with no selected model created a session, added it to history, and switching between sessions worked.
- Rename (`hello` → `Alpha`), duplicate (original unchanged; duplicate opened), delete duplicate, pin/unpin, archive/unarchive, bookmark, and Markdown export.
- Marking an unfinished generation interrupted resolved the pending operation and unblocked export.
- Custom summary `Summary one` persisted; the previous content was tombstoned; a no-op rename did not overwrite it.
- Attachment provenance: the `Alpha` attachment row showed `نص المرفق`, the attachment filename, and the expanded filter disclosure. Search rows distinguish attachment text from file names.
- History rows fill the panel at a fixed height; the selected and unselected rows match. The source/filename line, long-token wrapping, title alignment, session-icon removal, and accessible filter trigger were checked.
- Native Save As: the default filename was `Alpha-<session-id>.md`, the destination was the user's Downloads folder, the saved file was 5,235 bytes, mode `0600`, SHA-256 `78ff241cdd1fafc5360247c807d31a69d845835ecc4e89226c0e323cb7872306`.
- Re-exporting the same filename showed the macOS replace prompt; confirming it replaced the file safely and left the same bytes and hash. The export dialog closed and the non-modal status card showed the path and bytes.
- Cancelling the native panel wrote nothing: the existing file stayed at 5,235 bytes, SHA-256 `78ff241c...`, and modification time `2026-10-23 20:33:17`; no error was shown.
- Delete `djfhvbhsbv` was confirmed. The event store contains one `SessionDeleted`; messages, attachments, bookmarks, feedback, branch selections, and pending rows for that session are zero.
- The original 67-byte export `<synthetic-data-root>/data/exports/djfhvbhsbv-<session-id>.md` was not touched by deletion: 67 bytes, mode `0600`, SHA-256 `44cf69a90bd40251ed89f94c778ea12b9372e67b44ed97b198661fdddea4ff1b`, timestamp `2026-10-23 18:35:45`. The separate backup was not used as the survival proof.
- After restart, the deleted session remained gone from session history.

Not separately exercised in the native app:

- A read-only destination write failure. The service test covers a read-only directory; the UI maps `EXPORT_WRITE_FAILED` to the localized `error.exportWriteFailed` storage error.
- Delete-dialog Cancel. A component test now clicks Cancel and asserts `onClose` runs and `onDelete` does not; the native confirmation path was exercised.
- The Windows and Linux native panels themselves. Windows, macOS, and Linux CI compile and test the code, but headless runners do not open a GUI dialog.

**Automation limits:** the WKWebView exposes only native window controls to macOS accessibility, not the rendered DOM, so the remaining interactions are operator-driven. `screencapture` is unavailable in this environment; visual evidence is operator confirmation plus filesystem/database inspection.

## 4. Honest limits and blocked tracks

| Item | Status | Reason |
|---|---|---|
| PDF input/extraction (#33) | Not implemented | No approved parser. Rust candidates need subprocess isolation and resource caps; `pdfjs-dist` does not meet the Safari 18.2/WebView floor. |
| Images/vision, OCR, audio/video, artifacts (#34) | Not implemented | No adapter/policy decisions and no approved dependencies. No control fabricates support. |
| Stable turn/attempt ids, cursors, pagination (#35) | Not implemented | Blocked on the P0 durable-identity repair. The existing cursor fields remain placeholder-only. |
| Agents, participants, task status, model/provider, tags/folders, cost, artifacts, cross-project filters | Not available | The durable data does not exist. The filter panel says so and renders no fake control. |
| Native Windows/Linux dialog interaction | Not GUI-tested | CI compiles and tests both targets; only macOS was exercised interactively. |
| Forensic deletion | Not claimed | Delete purges active database content and appends a tombstone, but SQLite journals, backups, and exported Markdown may retain copies. |
| Real-data use | Blocked | P0 content protection is still under repair. This evidence uses disposable synthetic data only. |

## 5. Operator acceptance

- Export, overwrite, cancel, delete confirmation, and restart persistence are confirmed.
- The remaining requirements are final green CI at the evidence head, code review, and explicit operator approval to merge.
- The branch has not been merged. The open-conversation tabs feature is not part of this branch or PR.
