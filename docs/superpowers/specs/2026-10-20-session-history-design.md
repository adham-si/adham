# Session history — actions, bookmarks, summaries, search, filters

Date: 2026-10-20
Status: Proposed — builder-check resolved, awaiting approval
Scope: CONVERSATION-01 follow-up, `docs/Frontend UX — Compose & agent workspace.md` §17
Branch: `feat/conversation-03-history`

## 1. Intent

Conversation history is currently a bounded, read-only list. Sessions are append-only
`SessionCreated` events; the sidebar shows the newest 100 and filters titles in the
renderer. There is no rename, pin, archive, duplicate, export, delete, bookmark,
summary, or backend search.

This design makes history usable without rewriting history or weakening content
protection:

- The user can name, pin, archive, duplicate, export, and delete sessions.
- The user can bookmark persisted messages.
- Every session with readable messages gets an auto summary; unreadable content is
  marked, not hidden. The user can replace the summary.
- Search covers titles, summaries, saved messages, and attachment text.
- Filters cover the dimensions the data actually supports.
- Search decrypts on read; no plaintext index is created.

The work is one suite, delivered in phases. #33 (PDF), #34 (other modalities), and
#35 (stable ids/cursors) stay out of scope and blocked.

## 2. Goals

1. Session actions: rename, pin/unpin, archive/unarchive, duplicate, export Markdown,
   delete.
2. Message bookmarks, visible in the conversation and searchable.
3. Session summaries: deterministic auto summary plus user-editable summary for
   sessions with messages.
4. Search: title, effective summary, message text, attachment file name and extracted
   text; case-insensitive substring matching.
5. Filters: current project, date, pinned, archived, role, has attachments,
   bookmarked. Unsupported filters are disclosed, not faked.
6. Honest destructive behavior: delete removes the session from the active database
   and purges its content; it is not a forensic-erasure promise.
7. No new dependency. All UI uses existing components and icons.

## 3. Non-goals / honest limits

- **No PDF or other modality work.** #33/#34 remain blocked.
- **No stable cursor or full pagination.** The list and search stay bounded; #35
  remains blocked on the P0 durable-identity repair.
- **No semantic/model-generated summary.** The auto summary is extractive and local.
- **No plaintext search index, embeddings, or background indexer.**
- **No cross-project search.** Search is scoped to the active project; switching
  projects switches the scope.
- **No agents, human participants, task status, model/provider, tags/folders, cost,
  or artifacts filters.** The data does not exist yet. The filter panel says so.
- **No session/task status chips.** There is no durable Draft/Planning/Running/
  Waiting/Blocked/Completed/Failed/Canceled field; showing a partial status would
  overstate it. Turn-level outcomes remain in the conversation.
- **No native “Save As” dialog.** Export writes to a fixed, shown folder. A dialog
  needs `tauri-plugin-dialog` and a separate dependency approval.
- **No event-log erasure.** Delete appends a tombstone and purges content; event
  metadata (including the plaintext session title) remains.
- **Exported Markdown is not deleted with the session.** It is a separate plaintext
  file; the export and delete dialogs say so.
- **No real-data evidence.** Until the P0 foundation repair lands, implementation
  and evidence use synthetic canary data only.

## 4. Constraints and invariants

- Every session-scoped command validates workspace/project/session scope.
- Message content and user summaries are AEAD-protected and scope-bound to the
  session. Duplicating a session must re-seal content under the new session; it
  cannot share content ids across sessions.
- Mutation receipts never store message text or summary text. Responses that need
  text are hydrated after the receipt lookup, as `submit_message` already does.
- Session titles remain plaintext event metadata, as they are today. This design
  does not expand that exposure, but it does not fix it either.
- All event-mutating writes are atomic: event + receipt (+ projection rows/content)
  in one transaction. Bookmarks are single-row local writes; a refused command writes
  nothing.
- SQLite writer serialization makes one `ensure_session_active` check per command
  sufficient; no per-event check is needed.
- Search and list read a consistent snapshot. Snippets are rendered as text, never
  as HTML or Markdown.
- File-size policy applies to new modules: target <300 lines, split by service.

## 5. Decisions

### 5.1 Event-sourced session metadata, no new projection table

Session actions append small events to the existing `session:{id}` stream:

| Event type | Payload | Meaning |
|---|---|---|
| `SessionRenamed` | `SessionRenamedV1 { title: String }` | Last write wins |
| `SessionPinChanged` | `SessionPinChangedV1 { pinned: bool }` | Explicit desired state |
| `SessionArchiveChanged` | `SessionArchiveChangedV1 { archived: bool }` | Explicit desired state |
| `SessionSummaryUpdated` | `SessionSummaryUpdatedV1 { content_id: Option<ContentId> }` | `Some` = user summary; `None` = revert to auto |
| `SessionDeleted` | `SessionDeletedV1 {}` | Tombstone; no further events |

Event type strings use the persisted PascalCase convention (`SessionCreated`), not
the unused slash constants. Payloads validate before append: title 1–120 Unicode
scalar values with no control characters; summary content id non-empty; booleans
accepted as-is.

`list_sessions` folds these events in global order per session. It does not add a
session metadata table. At the current 100-session cap the event set is small, and
a second source of truth (plus a projection rebuild) buys little. Add a session
projection later only if history grows past this bound.

To keep pins visible, the fold happens before the 100-row cap: all non-deleted
sessions in the project are folded, sorted, then capped. `truncated` means more than
100 remain. `last_activity_at` is the latest persisted message timestamp, falling
back to `created_at`; metadata edits do not reorder history.

`list_sessions` also accepts an optional `active_session_id`, validated against the
project. If that session is archived and `include_archived` is false, it is still
included, because the active session must remain visible and restorable after a
restart. It is inserted before the cap; if it would fall outside the top 100, it
replaces the last row. The response stays at 100 (or fewer), and `truncated` is true
when any other session was omitted. A deleted or foreign id is ignored, not included.
Search follows the normal archived filter; it does not force-include the active
session. The active row carries an Archived badge until the user restores it or
navigates away.

A new index `events(project_id, event_type, global_position)` supports the fold.

### 5.2 Effective summary: auto is derived, user summary is stored

- **Auto summary** is computed on read. It joins the first user message and the
  latest assistant message for the session, collapses whitespace, clips the user part
  to 120 and the assistant part to 140 characters, and caps the result at 240
  characters. If one side is absent, the other is used. If a user message is
  attachment-only, its file names stand in for the text. It is labelled “Auto
  summary”.
- **User summary** is sealed as `content_records` with kind `session_summary`, under
  the session scope. Only its content id is stored in the event. `SessionSummaryUpdated`
  with `None` reverts to auto.
- User summaries trim whitespace, reject more than 500 Unicode scalar values with
  `VALIDATION_FAILED:summary_too_long`, and treat an empty result as `None` (revert to
  auto). Replacing or clearing a summary erases the old summary content record and
  tombstones it in the same transaction.
- A user summary takes precedence. If its content record is missing or unreadable,
  the list falls back to auto and does not fail.
- No messages means no summary (`summary: None`, `summary_origin: None`); the row
  shows the localized “No messages yet” placeholder.
- No terminal write path changes; the summary is a read-time view, not derived state
  written on every turn.

The list reads at most two content records per session for auto summary, plus one for
a user summary. It never loads full transcripts to render the sidebar.

All history read views operate on the full persisted transcript, including superseded
edited-branch rows: auto summary selects the first user and newest assistant rows,
search scans every row, and export renders every row. Active-branch selection is UI
state, not part of the transcript; duplicate copies every row but resets the selection
to the default newest-edit choice. Export labels superseded rows.

### 5.3 Bookmarks are local state, not events

`message_bookmarks(session_id, message_id, created_at_us, PRIMARY KEY(session_id,
message_id))`. The service validates the message belongs to the session before any
write. `get_conversation` returns `bookmarked_message_ids`. Toggling is a plain
command (no event), like answer feedback. Bookmarks survive projection rebuilds
because message ids survive; they are purged with the session.

### 5.4 Delete = tombstone + content purge; not forensic erasure

`delete_session` requires `confirm: true` and refuses a session with a live operation
(`pending_operations.status = 'pending'`; resolved rows are not busy). In one
transaction it appends `SessionDeleted` + receipt, then:

1. Collects every content id scoped to the session (`content_records.session_id`),
   including messages, attachments, user summaries, and pending-operation text.
2. Inserts a `content_tombstones` row for each with `reason_code = 'session_deleted'`.
3. Deletes the content records.
4. Deletes `message_attachments`, `attachment_records`, `conversation_messages`,
   `answer_feedback`, `branch_selections`, `message_bookmarks`, and all
   `pending_operations` rows for the session (including resolved rows and null-session
   first-send rows matched by `create_request_id`).
5. Commits; best-effort `PRAGMA wal_checkpoint(TRUNCATE)` after commit.

First-send operations can predate the session row and carry `session_id = NULL`.
Busy/purge matching therefore also includes pending rows whose `create_request_id`
equals the `SessionCreated` event's request id. Delete collects their
`content_id`/`title_content_id` and deletes those rows; duplicate and export treat
such a row as live.

Exported Markdown files are separate plaintext copies and are not deleted by this
command; both dialogs disclose that. The delete claim is about database content, not
files the user exported.

The event log and receipts remain. A rebuild skips message events for tombstoned
sessions, so deleted messages cannot resurrect. The UI says “Delete from history”,
explains that it cannot be undone, and states that storage-level copies (SQLite
journals/backups) and exported Markdown files may remain. It never says “secure
erase” or “permanent” without that qualifier.

`resolve_scoped_session` rejects a tombstoned session, so reads and the commands that
use it cannot reopen it. Every direct write path that bypasses it audits and calls
`ensure_session_active` before writing (`submit_message`, `record_pending_operation`,
provider completion start/finish, and any other `append_event_tx` caller). A stale
write after delete fails with `SESSION_DELETED`.

### 5.5 Duplicate = a new, independent transcript

`duplicate_session` creates a new `SessionCreated` and copies the persisted transcript
as new events, not as projection-only rows:

- Read and decrypt each source message; re-seal it under the new session with a new
  content id.
- Copy every persisted row, including superseded edited-branch rows. Do not copy
  active-branch selections, so the copy opens on the default newest-edit choice.
- Append a new `MessageSubmitted`/`MessageCompleted` event for each copied message
  (new message id, new operation id for assistant turns, same completion outcome and
  usage). Content ids and message ids are never shared with the source.
- Copy attachments by re-sealing their extracted text under the new session, with new
  attachment ids and links.
- Remap references and bookmarks to the new message ids.
- Copy a user summary (re-sealed) if one exists; auto summaries are derived.
- Do not copy feedback. Do not copy pin/archive state.
- New message timestamps are now + a small monotonic offset, so the copy sorts as
  recent while preserving order.

Only attachments linked to a persisted message are copied; unlinked ingestion chips
are not part of the conversation. Missing or unreadable source content fails the
whole copy with `STORAGE_REPAIR_REQUIRED`; no partial transcript is written.

Caps: refuse sources over 500 messages or 5 MB of plaintext (message text, attachment
extracted text, and a user summary, measured from `content_records.plaintext_size`
and verified while copying), and refuse while a live operation exists
(`pending_operations.status = 'pending'`, including null-session first-send rows
matched by `create_request_id`). Errors are `DUPLICATE_TOO_LARGE` and `SESSION_BUSY`.
The whole copy is one transaction with one receipt; replay returns the new session
id.

### 5.6 Export = Markdown in a fixed folder, no dependency

`export_session_markdown` writes plaintext Markdown to
`<app-data>/exports/{slug}-{session-id}.md`, creating the folder. The full session id
keeps two sessions with the same slug from overwriting each other; re-exporting the
same session overwrites its file. The slug is built from the title using Unicode
alphanumerics, spaces, `-`, and `_`; other characters become `-`, collapsed, and
capped at 40 scalar values and 120 UTF-8 bytes; an empty slug becomes `session`. It
never contains path separators. On Unix, the file is created owner-only (`0o600`) where
supported. The command writes a unique sibling `.tmp` file and replaces the target, so
a failed write leaves no partial export and concurrent exports do not share a temp
path.

The command refuses deleted sessions and sessions with a live operation. It also
refuses when the rendered Markdown exceeds 5 MB of UTF-8 (`EXPORT_TOO_LARGE`) rather
than truncating. It returns `{ path, bytes }`; the UI shows the path with a copy
button. No file dialog, no new plugin. Exported files are not deleted by
`delete_session`; the warning and the delete dialog say so.

The UI warns before export: the file is unencrypted and readable by anyone with
access to that folder. Export includes title, effective summary, message text,
completion and edited-branch labels, and attachment names/sizes; it does not embed
attachment bytes (only extracted text is stored), bookmarks, feedback, usage, or
model provenance.

### 5.7 Search = decrypt-on-read, bounded

`search_history` is project-scoped and read-only. It selects up to 100 sessions
matching session-level filters, then scans every persisted message row (including
superseded edited-branch rows) and attachment text, decrypting through the existing
content key. It never writes an index or logs plaintext. The result is anchored to the
matched message id, so the conversation can focus it.

- Minimum query: 2 non-whitespace characters. Empty query is allowed when a filter
  other than `include_archived` is active, returning one `session` result per matching
  session; `bookmarked_only` instead returns the bookmarked messages. Empty query
  with no filter (or only `include_archived`) is the normal list, not a search;
  calling the search command that way fails `VALIDATION_FAILED:empty_query`.
- Session filters: include archived, pinned only, bookmarked only, has attachments,
  date range (inclusive, applied to session `last_activity_at`).
- Match filters: role (`user`/`assistant`) applies to message/attachment results and
  excludes title/summary results; bookmarked-only likewise excludes title/summary.
  Role with an empty query is invalid (`VALIDATION_FAILED:role_requires_query`); the
  UI disables it until a query is entered.
- Search fields: stored title, effective summary, message text, attachment file name
  and extracted text. Unlinked attachments are excluded; an attachment is anchored to
  its earliest linked persisted message.
- Results: flat, ordered by session last activity then match position; 50 maximum;
  `truncated` when more. Snippets are at most 180 characters around the first
  case-insensitive match, rendered as text.
- Scan cap: 10,000 message rows. If reached, `scan_limit_reached = true`; the UI says
  to narrow the date range.
- Missing or unreadable content is skipped in read views and counted in
  `skipped_unreadable`; export and duplicate fail instead of producing a partial
  result.
- Search reads in one deferred transaction for a consistent snapshot. Stale renderer
  responses are ignored by a sequence guard.
- List, search, export, and duplicate use a per-command cached content-key provider:
  one OS credential read, zeroized on drop. No process-wide key cache is added.

No full-text tokenizer is added. “Search” means case-insensitive substring matching,
which works for the current languages without a new dependency.

## 6. Data and contracts

### 6.1 Migration

New migration `20261020000000_session_history.sql`:

```sql
CREATE TABLE IF NOT EXISTS message_bookmarks (
    session_id   TEXT NOT NULL,
    message_id   TEXT NOT NULL,
    created_at_us INTEGER NOT NULL,
    PRIMARY KEY (session_id, message_id)
);
CREATE INDEX IF NOT EXISTS message_bookmarks_session_idx
    ON message_bookmarks(session_id, created_at_us);
CREATE INDEX IF NOT EXISTS events_project_type
    ON events(project_id, event_type, global_position);
```

### 6.2 DTO changes

`SessionSummary` gains, with `#[serde(default)]` for old create-session receipts:

- `summary: Option<String>`
- `summary_origin: Option<String>` — `"auto"` | `"user"`
- `summary_unavailable: bool` — messages exist but no effective summary could be read
- `pinned: bool`
- `archived: bool`
- `last_activity_at: String` — empty in an old receipt; the replay path falls back
  to `created_at`.

`SessionList` keeps `truncated` and adds `unreadable_summaries` (the number of
sessions with messages but no readable effective summary). `list_sessions` takes
optional `include_archived` and `active_session_id` flags; the active session is
included even when archived.

`ConversationPage` gains `bookmarked_message_ids: Vec<String>`.

New commands/DTOs:

| Command | Shape |
|---|---|
| `rename_session` | envelope; `{ title }`; returns structural session metadata |
| `set_session_pinned` | envelope; `{ pinned }`; returns structural metadata |
| `set_session_archived` | envelope; `{ archived }`; returns structural metadata |
| `set_session_summary` | envelope; `{ summary: Option<String> }`; returns metadata without text |
| `duplicate_session` | envelope; `{ title: Option<String> }`; returns new session metadata |
| `delete_session` | envelope; `{ confirm: bool }`; returns `{ session_id, deleted }` |
| `export_session_markdown` | plain; returns `{ path, bytes }` |
| `search_history` | plain; query + filters + limit; returns results/limits |
| `set_message_bookmark` | plain; `{ session_id, message_id, bookmarked }`; returns ids |

Mutation responses use `SessionMetadata` — session id, title, `summary_origin` (no
summary text), pinned, archived, created/last-activity timestamps — not the list’s
`SessionSummary`. All mutation commands use a receipt. The response stored in the
receipt is structural only — no summary text, no message text. The UI refreshes the
list after a summary edit to obtain decrypted text.

### 6.3 Search DTOs

`SessionSearchFilters`: `include_archived`, `pinned_only`, `bookmarked_only`,
`role: Option<"user"|"assistant">`, `has_attachments`, `from: Option<String>`,
`to: Option<String>`.

`SessionSearchResult`: `session_id`, `title`, `summary`, `summary_origin`,
`last_activity_at`, `match_kind`
(`session|title|summary|message|attachment|bookmark`), `message_id`, `role`,
`snippet`, `attachment_name`.

`SessionSearchResponse`: `results`, `truncated`, `scanned_sessions`,
`scan_limit_reached`, `skipped_unreadable`.

Date inputs are converted by the renderer from local day boundaries to RFC3339 UTC.
Invalid or reversed ranges fail with `VALIDATION_FAILED:date_range`.

### 6.4 Public errors

New failures map to existing `PublicErrorCode` values with specific message keys, so
the public enum and generated contracts do not grow:

- `SESSION_DELETED` -> `SessionNotFound` (`error.sessionDeleted`)
- `SESSION_BUSY` -> `ConcurrencyConflict` (`error.sessionBusy`)
- `DUPLICATE_TOO_LARGE`, `EXPORT_TOO_LARGE` -> `PayloadTooLarge`
  (`error.duplicateTooLarge`, `error.exportTooLarge`)
- `VALIDATION_FAILED:*` -> `InvalidRequest`, with a field-specific message key.

The renderer localizes the message key; it never shows a raw backend string. None of
these failures is automatically retried; `SESSION_BUSY` is presented as “wait for the
current turn to finish.”

## 7. Behavior details

### 7.1 List

- Fold all session events for the project in global order; drop `SessionDeleted`.
- Exclude archived unless `include_archived`; always include `active_session_id` when
  supplied, even if archived.
- Sort pinned first, then `last_activity_at DESC`.
- Cap at 100; set `truncated` if more.
- Effective summary: user summary if present and decryptable, else auto.
- If messages exist but no effective summary can be read, set `summary_unavailable`;
  the row shows “Summary unavailable” rather than “No messages yet”, and the list
  reports `unreadable_summaries`.
- Title fallback remains the renderer’s existing `Session {id-prefix}`; it is not
  searchable.

### 7.2 Rename, pin, archive

- Rename trims, rejects empty/control-only, caps at 120 scalar values; appends one
  event + receipt.
- Pin/archive take explicit desired state; last write wins. Archiving the active
  session keeps it open with an “Archived” badge and keeps it in the list through
  `active_session_id`; other archived sessions are hidden unless “Show archived” is
  on. Restoring is the same menu action.
- The row menu is keyboard-accessible; the active row keeps selection.
- A details dialog edits title and summary separately. A summary is trimmed, rejected
  above 500 scalar values, and sealed; saving refreshes. “Reset to auto” appends
  `content_id: None`; an empty save does the same.

### 7.3 Bookmarks

- A star action appears on persisted user and assistant messages, `aria-pressed`.
- Streaming/optimistic bubbles have no durable id and cannot be bookmarked.
- Toggling updates `ConversationPage.bookmarked_message_ids`; delete purges.
- The search filter “Bookmarked messages” works with an empty query.

### 7.4 Delete and duplicate UX

- Delete: confirmation dialog with title, “cannot be undone”, the database/backup
  caveat, the note that exported Markdown files remain, and a destructive button. On
  success, select the next remaining session, or clear to a new draft, and clear any
  renderer-local first-send record for the deleted session. On failure, keep the
  session and show the error.
- Duplicate: disabled while busy; on success, refresh and open the copy. Too-large or
  busy sources show a specific message.
- Export: warning dialog; on success, show the path, copy button, and byte count.

### 7.5 Search UX

- The sidebar search field replaces renderer-local title filtering.
- Empty query with no filters (or only “Show archived”) shows the normal list. At
  least 2 characters, or an active filter other than “Show archived”, triggers a
  debounced (250 ms) search; a sequence guard ignores stale responses. Empty query
  with only `bookmarked_only` shows bookmarks.
- Results group by session: title, summary, then match rows with kind labels and
  text-only snippets. A session-level result shows the summary and a “Session” label.
- Role is disabled with a hint while the query is empty; it is not a session filter.
- Selecting a message/attachment result opens the session and dispatches a focus
  event; the conversation panel scrolls the matching `data-message-id` into view if
  it is loaded.
- Filter panel: show archived, pinned only, bookmarked only, role, has attachments,
  from/to dates, plus a muted “Not available yet” note listing agents, human
  participants, task status, model/provider, tags/folders, cost, and artifacts.
- Search errors are retryable; zero results are explicit. The result count is
  announced politely for screen readers; a non-zero `skipped_unreadable` is disclosed
  as “some saved items could not be read”.
- Snippets and summaries use `dir="auto"` and plain text rendering.

## 8. UI composition

- Add a `historyPanel` slot to `PrimarySidebar`; the existing built-in search/list
  remains the fallback for tests/gallery.
- New `features/history/`:
  - `SessionHistoryPanel` — list, search, filters, result grouping.
  - `SessionDetailsDialog` — title + summary.
  - `DeleteSessionDialog`, `ExportSessionDialog`.
  - `useSessionSearch` — debounce, snapshot requests, filters.
  - `useSessionActions` — mutations + refresh.
- `useProjectSessions` remains the single owner of list/active selection/restore and
  maps the extended metadata. It passes `active_session_id` so an archived active
  session stays visible; the row carries an Archived badge until restored.
- The route passes the panel into the sidebar slot and wires selection/focus events.
- `MessageActions`/`MessageCard` gain a bookmark action and icon.
- `get_conversation` supplies bookmarked ids; the conversation view passes a
  `bookmarked` boolean per card.
- All new labels go to `en`, `ar`, `ru`, `zh-CN` under `history.*`, `session.*`,
  `message.*`; no hard-coded user-facing text.

## 9. Security and privacy

- Search decrypts only within the authorized project/session scope and returns
  bounded snippets. No plaintext is written to a search table, event, receipt, or
  log.
- List, search, export, and duplicate use a per-command cached content-key provider:
  one OS credential read, zeroized on drop. No process-wide cache; the key never
  enters SQLite or logs.
- User summaries are sealed content; auto summaries exist only in memory and the
  authorized response.
- Read views treat missing or unreadable content as a tombstone/skip and count it;
  they never return ciphertext. Export and duplicate fail rather than silently
  omitting content.
- Export is explicit plaintext with a warning and owner-only permissions where
  supported; it never opens the file or reveals its content in a notification.
  Exported Markdown is a separate copy and is not removed on delete; the UI says so.
- Delete purges content and inserts tombstones; it does not claim forensic erasure.
  Event metadata and the plaintext title remain, and the UI says so.
- Duplicate re-seals under the new session, so a copied content id can never be
  decrypted under the wrong scope.
- Path construction for export is allowlist-based; no user-controlled path segment
  is joined directly.
- Search snippets are text, not HTML; no `dangerouslySetInnerHTML`.

## 10. Testing and evidence

Rust:

- Fold/list: pinned sort, archived filter, active archived inclusion and tail
  replacement, deleted/foreign active ignored, 100-cap/truncated, last activity,
  old-session fallback, `summary_unavailable` plus count.
- Rename/pin/archive: validation, receipts, last-write-wins, restart replay.
- Summary: auto derivation (including attachment-only and one-sided), user
  seal/decrypt, 500-limit rejection, empty/reset to auto, old-content erase,
  missing/unreadable fallback, receipt contains no summary text.
- Bookmarks: session/message validation, get-conversation ids, delete purge,
  duplicate remap.
- Search: all four fields, empty-query session filters, superseded-branch coverage,
  role empty-query rejection, unlinked attachment exclusion, role/bookmark exclusions,
  case-insensitivity, snippets, scan/result caps, skipped unreadable, deleted
  exclusion, no plaintext at rest, no logs, one key-provider read per command.
- Duplicate: new ids/content scope, all persisted rows, active-branch reset to the
  newest-edit default, linked messages/attachments/references/bookmarks, no
  feedback/branch copy, unlinked attachment exclusion, missing-content failure,
  500-message/5 MB caps, live-operation refusal, replay, rebuild after duplicate.
- Delete: tombstone, content purge, projection purge, rebuild stays empty, stale
  write rejected, receipt replay, live-operation refusal, resolved pending rows and
  null-session first-send rows purged.
- Export: allowed/deleted/live-operation, path sanitization, full-id collision safety,
  Markdown contents including edited-branch labels, 5 MB cap, overwrite, Unix mode,
  exported files remain after delete.
- Migration/receipt compatibility: old `SessionSummary` JSON parses with defaults.

UI:

- Sidebar list/search/filters, debounce and stale-response guard.
- “Summary unavailable” row and `unreadable_summaries` disclosure.
- Row menu keyboard flow; dialogs; active deleted/archived behavior.
- Bookmark toggle state and empty-query bookmarks.
- Search result grouping, session-level results, disabled role hint, focus event.
- Error mapping for deleted/busy/too-large with localized message keys.
- Edited-branch labels in the transcript and export.
- RTL, 200% text, screen-reader labels/live counts.
- No hard-coded labels; i18n parity for all four locales.

Create `docs/reports/conversation-03-session-history.md` using synthetic canary data
only, with revision-tagged command logs. Update
`docs/reports/conversation-01-requirement-status-matrix.md` with the delivered subset
and the disclosed gaps. Do not claim PDF, modalities, cursors, or unsupported filters.

## 11. Phases

1. **Foundation** — migration, event payloads, list fold, index, receipt-compatible
   DTOs, contracts/client/Tauri command registration.
2. **Session actions** — rename, pin/unpin, archive/unarchive, list/order, row menu,
   details dialog, i18n.
3. **Bookmarks** — table, service, `get_conversation` ids, message action, tests.
4. **Duplicate, export, delete** — transactional services, caps, dialogs, rebuild
   exclusion, stale-write guard, tests.
5. **Summaries** — auto derivation, user edit/reset, list display, encrypted-content
   tests.
6. **Search and filters** — backend search, result DTOs, panel, filters, focus jump,
   unavailable-dimension disclosure, tests.
7. **Hardening** — rebuild/replay/concurrency, i18n/a11y/RTL, evidence report,
   matrix update.

Each phase is shippable behind no fake capability; a phase that cannot land honestly
stops and reports the blocker rather than showing an empty control.

## 12. Left to the builder

- Exact module split, helper names, and SQL shape; keep new services under the
  file-size policy.
- Unicode case-insensitive snippet extraction details.
- Markdown writer details and platform file-permission handling.
- Contract generation command and fixture updates.
- Component decomposition inside `features/history/`.
- Test harness details for a consistent read snapshot.

## 13. Builder-check resolutions

Two fresh builder reviews left questions; the resolved design points:

| Question | Resolution |
|---|---|
| What counts as busy? | `pending_operations.status = 'pending'`; resolved rows are not busy and are purged on delete. Null-session first-send rows count too, matched by `create_request_id`. |
| Export size cap? | 5 MB UTF-8; fail `EXPORT_TOO_LARGE`, never truncate. |
| Do filters apply to the list? | Empty query + a filter other than Show archived returns `session` results; `bookmarked_only` returns bookmarks; role needs a query and is disabled with a hint. |
| Archived active session after restart? | `list_sessions.active_session_id` inserts it before the cap, replacing the tail if needed; deleted/foreign ids are ignored; search follows the archived filter. The durable-preference restore already calls `get_conversation` directly. |
| Summary limits/retention? | Trim, reject over 500 scalar values, empty -> auto; old summary content is erased and tombstoned. |
| Does delete remove exported Markdown? | No; it is a separate plaintext copy and both dialogs disclose that. |
| Auto summary fallback? | One side may be absent; attachment-only uses file names; no messages -> no summary. |
| Missing/corrupt content? | List shows `summary_unavailable`/`unreadable_summaries`; search skips and counts `skipped_unreadable`; export/duplicate fail with `STORAGE_REPAIR_REQUIRED`. |
| Keychain cost? | Per-command cached key provider, zeroized on drop; no process-wide cache. |
| Duplicate caps? | 500 messages / 5 MB plaintext including attachments and user summary. |
| Unlinked attachments? | Excluded from search and duplicate; delete purges all session content. |
| New public error codes? | No; map to existing `PublicErrorCode` values with specific message keys. |
| Which transcript rows? | All persisted rows, including superseded edited branches; active-branch selection is UI state; duplicate resets it to the newest-edit default. |
| Export filename collisions? | Full session id in the filename; same-session re-export overwrites, different sessions cannot collide. |
| First-send pending? | Null-session rows matched by `create_request_id` count as live and are purged with the session. |

## 14. Calls to check while reading

These are my calls, not things you explicitly approved:

1. **No session metadata projection table.** Fold events on read; add a projection
   only if history outgrows the 100-session bound.
2. **Auto summary is derived on read**, not stored and not model-generated.
3. **Export writes to a fixed app-data folder**, not a Save As dialog, to avoid a new
   dependency. Exported files remain after delete.
4. **Duplicate replays message events** and re-seals content under the new session;
   it is not a projection-only copy.
5. **Delete is logical deletion plus content purge, not forensic erasure.** The UI
   states the WAL/backup caveat; exported files remain.
6. **Search is bounded substring search** over at most 100 matching sessions, not a
   full-text index or cross-project search.

If you require true forensic erasure, deletion of exported files, a Save As dialog, or
a semantic summary model, say so before implementation; each changes the
storage/dependency/policy plan.
