# Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved session-history suite: actions, bookmarks, summaries, cross-content search, filters, export, duplicate, and honest delete.

**Architecture:** Session metadata stays event-sourced; `list_sessions` folds small PascalCase events, folds in message activity, and caps at 100 with the active session forced in. Content-bearing features use the existing SQLite/AEAD store; no plaintext index. New services are split under `crates/adham-desktop-api/src/service/history/`, and the renderer gets a `features/history/` module. Delete appends `SessionDeleted`, tombstones and erases content, purges local rows, and is excluded from projection rebuilds.

**Tech Stack:** Rust workspace, SQLx/SQLite, Tauri 2, React 19, TanStack Router, Vitest, generated TS contracts.

**Spec:** `docs/superpowers/specs/2026-10-20-session-history-design.md`

**Status:** Proposed — awaiting execution-method approval.

## Global Constraints

- No new dependencies. #33 PDF, #34 modalities, and #35 cursors stay blocked; no PDF/modality/cursor code.
- New session-history event types are PascalCase strings; existing message event strings (`MessageSubmitted`, `assistant/message-completed`) do not change.
- Message and summary content stays AEAD-protected and scope-bound. No plaintext search table, event, receipt, or log.
- Receipts store structural ids only; no summary or message text.
- Every session write takes the session stream write lock first, then checks `SessionDeleted`; a check outside that lock is not sufficient.
- Delete is logical deletion plus database content purge, not forensic erasure. Exported Markdown remains.
- Read views skip unreadable content and disclose counts; export/duplicate fail with `STORAGE_REPAIR_REQUIRED`.
- Null-session first-send pending rows count as live and are purged by `create_request_id`.
- Generated files are never hand-edited: `routeTree.gen.ts`, `packages/contracts-generated/`.
- Every new label exists in `en`, `ar`, `ru`, `zh-CN`; no hard-coded user-facing text.
- New Rust service files target <300 lines (hard check >600). Tests use synthetic canary data only.
- Stage explicit paths; never `git add -A`. Do not push without approval.

## Review Focus

These are the failure modes most likely to hurt a user; each has a test in the owning task.

1. **Late writes resurrect deleted conversations.** A write racing delete must fail `SESSION_DELETED`, and a projection rebuild must not restore the messages. Task 8.
2. **First-send recovery leaks or blocks the wrong session.** Null-session pending rows must count as busy and be purged by `create_request_id`. Tasks 6 and 8.
3. **An archived active session disappears.** Restart restore must keep it visible while the cap stays at 100. Task 2.
4. **One unreadable row breaks or silently truncates history.** List/search skip and count; export/duplicate fail. Tasks 2, 7, 9.
5. **Search/filters overstate coverage.** Search is bounded, reports truncation/scan limits, and never fakes unavailable dimensions. Tasks 9 and 10.

---

### Task 1: Foundation — migration, history events, receipt range

**Files:**
- Create: `crates/adham-event-log/migrations/20261020000000_session_history.sql`
- Modify: `crates/adham-event-log/src/sqlite/connection.rs`
- Modify: `crates/adham-event-log/src/sqlite/store/receipts.rs`
- Modify: `crates/adham-event-log/src/sqlite/store/content.rs` (`erase_content_tx`)
- Create: `crates/adham-core-types/src/history.rs`
- Modify: `crates/adham-core-types/src/lib.rs`
- Test: `crates/adham-core-types/tests/history_events.rs`
- Test: `crates/adham-event-log/tests/session_history_schema_tests.rs`

**Interfaces:**
- Produces:
  ```rust
  pub struct SessionRenamedV1 { pub title: String }
  pub struct SessionPinChangedV1 { pub pinned: bool }
  pub struct SessionArchiveChangedV1 { pub archived: bool }
  pub struct SessionSummaryUpdatedV1 { pub content_id: Option<ContentId> }
  pub struct SessionDeletedV1 {}
  pub const EVENT_TYPE_SESSION_RENAMED: &str = "SessionRenamed";
  pub const EVENT_TYPE_SESSION_PIN_CHANGED: &str = "SessionPinChanged";
  pub const EVENT_TYPE_SESSION_ARCHIVE_CHANGED: &str = "SessionArchiveChanged";
  pub const EVENT_TYPE_SESSION_SUMMARY_UPDATED: &str = "SessionSummaryUpdated";
  pub const EVENT_TYPE_SESSION_DELETED: &str = "SessionDeleted";
  pub fn validate_title(title: &str) -> Result<(), &'static str>;
  ```
  Each payload has `validate(&self) -> Result<(), &'static str>`.
- Produces:
  ```rust
  pub async fn record_receipt_range_tx(
      tx: &mut sqlx::Transaction<'_, Sqlite>,
      request_id: &RequestId,
      command_type: &str,
      command_version: i32,
      scope_fingerprint: &str,
      request_fingerprint: &str,
      actor_id: &ActorId,
      correlation_id: &CorrelationId,
      outcome_code: &str,
      response_json: &[u8],
      first_global_position: i64,
      last_global_position: i64,
  ) -> Result<(), DomainError>;
  ```
  `record_receipt_tx` delegates with the same position for both.
- Produces `pub async fn erase_content_tx(tx, content_id, reason_code) -> Result<(), DomainError>`: insert a `content_tombstones` row and delete the content record. Task 5 and Task 8 use it.

- [ ] **Step 1: Write the failing tests**

  In `history_events.rs`:
  ```rust
  #[test]
  fn title_validation_uses_scalar_count_and_rejects_controls() {
      assert!(SessionRenamedV1 { title: "ok".into() }.validate().is_ok());
      assert!(SessionRenamedV1 { title: " ".into() }.validate().is_err());
      assert!(SessionRenamedV1 { title: "a".repeat(120) }.validate().is_ok());
      assert!(SessionRenamedV1 { title: "a".repeat(121) }.validate().is_err());
      assert!(SessionRenamedV1 { title: "a\u{0007}b".into() }.validate().is_err());
  }

  #[test]
  fn summary_payload_allows_none_and_content_id() {
      assert!(SessionSummaryUpdatedV1 { content_id: None }.validate().is_ok());
      assert!(SessionSummaryUpdatedV1 { content_id: Some(ContentId::new_v7()) }.validate().is_ok());
  }
  ```

  In `session_history_schema_tests.rs`, reuse the temp-file pattern in
  `crates/adham-event-log/tests/storage_contract_tests.rs` (`test_db_path()`):
  ```rust
  #[tokio::test]
  async fn migration_is_idempotent_and_creates_history_indexes() {
      let db_path = test_db_path();
      let pool = create_sqlite_pool(&db_path).await.unwrap();
      let tables: Vec<String> = sqlx::query_scalar(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='message_bookmarks'")
          .fetch_all(&pool).await.unwrap();
      assert_eq!(tables, vec!["message_bookmarks"]);
      let indexes: Vec<String> = sqlx::query_scalar(
          "SELECT name FROM sqlite_master WHERE type='index' AND name IN \
           ('events_project_type','content_records_session_idx','pending_operations_create_request_idx')")
          .fetch_all(&pool).await.unwrap();
      assert_eq!(indexes.len(), 3);
      drop(pool);
      let pool = create_sqlite_pool(&db_path).await.unwrap();
      assert!(pool.acquire().await.is_ok());
      drop(pool);
      let _ = std::fs::remove_file(db_path);
  }
  ```
  Add a receipt-range test that writes a receipt with first `1`, last `9`, and asserts both columns.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-core-types --test history_events --locked` and
  `cargo test -p adham-event-log --test session_history_schema_tests --locked`
  Expected: FAIL — missing payload types, migration, and range helper.

- [ ] **Step 3: Implement the payloads, validation, migration, and helper**

  Validation rules: trim non-empty, at most 120 Unicode scalar values, no control characters; `SessionSummaryUpdatedV1` accepts `None` or a typed content id; booleans/deleted always valid. Use `chars().count()` and `char::is_control()`.

  Migration:
  ```sql
  CREATE TABLE IF NOT EXISTS message_bookmarks (
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      created_at_us INTEGER NOT NULL,
      PRIMARY KEY (session_id, message_id)
  );
  CREATE INDEX IF NOT EXISTS message_bookmarks_session_idx
      ON message_bookmarks(session_id, created_at_us);
  CREATE INDEX IF NOT EXISTS events_project_type
      ON events(project_id, event_type, global_position);
  CREATE INDEX IF NOT EXISTS content_records_session_idx
      ON content_records(session_id);
  CREATE INDEX IF NOT EXISTS pending_operations_create_request_idx
      ON pending_operations(create_request_id, status);
  ```
  Add `include_str!` and `pool.execute(...)` in `create_sqlite_pool` after the attachments migration. Do not add registry/schema files; the taxonomy count stays unchanged.

- [ ] **Step 4: Run tests to verify they pass**

  Run: `cargo test -p adham-core-types --test history_events --locked && cargo test -p adham-event-log --test session_history_schema_tests --locked && cargo fmt --all -- --check`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add crates/adham-core-types/src/history.rs crates/adham-core-types/src/lib.rs \
    crates/adham-core-types/tests/history_events.rs \
    crates/adham-event-log/migrations/20261020000000_session_history.sql \
    crates/adham-event-log/src/sqlite/connection.rs \
    crates/adham-event-log/src/sqlite/store/receipts.rs \
    crates/adham-event-log/tests/session_history_schema_tests.rs
  git commit -m "feat(history): add history events and schema"
  ```

---

### Task 2: History list — fold, active cap, auto summary, DTOs, contracts

**Files:**
- Create: `crates/adham-desktop-api/src/dtos/history.rs`
- Modify: `crates/adham-desktop-api/src/dtos/mod.rs`
- Create: `crates/adham-desktop-api/src/service/history/mod.rs`
- Create: `crates/adham-desktop-api/src/service/history/list.rs`
- Create: `crates/adham-desktop-api/src/service/history/key_cache.rs`
- Modify: `crates/adham-desktop-api/src/service/session.rs`
- Modify: `crates/adham-desktop-api/src/service/mod.rs`
- Modify: `crates/adham-desktop-api/src/handlers/session.rs`
- Modify: `crates/adham-desktop-api/src/handlers/mod.rs`
- Modify: `xtask/src/main.rs`
- Modify: `apps/desktop/src/shared/api/adham-client-base.ts`
- Modify: `apps/desktop/src/shared/api/schemas.ts`
- Modify: `apps/desktop/src/shared/api/error-envelope.ts`
- Modify: `apps/desktop/src/features/conversation/use-project-sessions.ts`
- Modify: `apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.tsx`
- Modify: `apps/desktop/src/shared/i18n/locales/{en,ar,ru,zh-CN}/common.json` (error keys)
- Test: `crates/adham-desktop-api/tests/session_history_list.rs`
- Test: `apps/desktop/src/features/conversation/use-project-sessions.test.tsx`

**Interfaces:**
- Produces:
  ```rust
  pub struct SessionSummary {
      pub session_id: String, pub project_id: String, pub title: Option<String>,
      pub created_at: String, pub summary: Option<String>,
      pub summary_origin: Option<String>, pub summary_unavailable: bool,
      pub pinned: bool, pub archived: bool, pub last_activity_at: String,
  }
  pub struct SessionList {
      pub project_id: String, pub sessions: Vec<SessionSummary>,
      pub truncated: bool, pub unreadable_summaries: u32,
  }
  pub struct SessionMetadata {
      pub session_id: String, pub project_id: String, pub title: Option<String>,
      pub summary_origin: Option<String>, pub pinned: bool, pub archived: bool,
      pub created_at: String, pub last_activity_at: String,
  }
  pub struct ListSessionsOptions {
      pub include_archived: bool,
      pub active_session_id: Option<String>,
  }
  ```
- Produces `CachedContentKeyProvider::new(Arc<dyn ContentKeyProvider>) -> Self`; `content_key()` reads once and zero-fills on drop.
- Produces `pub async fn list_sessions(ctx, project_id: &str, workspace_id: Option<&str>, options: &ListSessionsOptions) -> Result<SessionList, String>`.
- Internal `load_history_rows(ctx, project_id, options) -> Result<(Vec<HistoryRow>, bool, u32), String>` and an uncapped `load_all_history_rows(ctx, project_id) -> Result<(Vec<HistoryRow>, u32), String>` reused by search.
- Internal `read_session_metadata_tx(tx, provider, session_id) -> Result<SessionMetadata, String>` uses the same fold, last-activity, and effective-summary rules as list; actions/summary/duplicate use it so their receipts match the next list read.

- [ ] **Step 1: Write the failing tests**

  In `session_history_list.rs`, use `setup_ctx`, `create_test_workspace/project/session`, and append events directly through the store:
  ```rust
  #[tokio::test]
  async fn list_folds_actions_and_orders_pinned_first() {
      // create three sessions; rename/pin one; archive one; delete one
      // assert: deleted absent, archived hidden, pinned first, title is renamed,
      // last_activity_at comes from the persisted message, not created_at
  }

  #[tokio::test]
  async fn active_archived_session_is_forced_into_the_cap() {
      // create 101 sessions, archive the active one, include_archived=false
      // assert: exactly 100 rows, active present, truncated=true,
      // and a tail row was displaced
  }

  #[tokio::test]
  async fn auto_summary_uses_first_user_and_latest_assistant() {
      // persisted user text "First question" and assistant "Latest answer"
      // assert summary_origin == Some("auto"), summary contains both
  }

  #[tokio::test]
  async fn auto_summary_handles_attachment_only_and_one_sided_sessions() {
      // user row has only an attachment name; assistant absent
      // assert summary includes the file name and no placeholder text
  }

  #[tokio::test]
  async fn unreadable_summary_sets_flag_and_count() {
      // message rows exist, content rows are removed
      // assert summary_unavailable, summary.is_none(), unreadable_summaries == 1
  }

  #[tokio::test]
  async fn deleted_and_foreign_active_session_ids_are_ignored() {
      // activeSessionId points at a deleted/other-project session; list is unchanged
  }

  #[tokio::test]
  async fn old_session_summary_receipts_default_and_fall_back() {
      // deserialize the pre-change JSON; last_activity_at == "" -> created_at
  }

  #[tokio::test]
  async fn validation_errors_keep_their_specific_key() {
      // ErrorEnvelope::from_error_str("VALIDATION_FAILED:summary_too_long")
      // assert message_key == "error.validation.summary_too_long"
  }
  ```
  In `use-project-sessions.test.tsx`, assert `updatedAt` maps from `lastActivityAt`, summary/pinned/archived survive, and `activeSessionId` is passed to `listSessions`.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_list --locked` and `pnpm exec vitest run apps/desktop/src/features/conversation/use-project-sessions.test.tsx`
  Expected: FAIL — missing DTO fields/list behavior.

- [ ] **Step 3: Implement the fold and readers**

  Use one deferred read transaction for the event fold, activity query, and summary reads so list is a consistent snapshot. Query all history events for the workspace/project scope in `global_position ASC`:
  `SessionCreated`, `SessionRenamed`, `SessionPinChanged`, `SessionArchiveChanged`, `SessionSummaryUpdated`, `SessionDeleted`.
  Fold per `stream_id`; drop deleted. Use `SessionCreatedV1` for id/created time. Title is the latest rename or created title. Pinned/archived are last-write-wins. Summary content id is the latest `Some`/`None`.

  `last_activity_at`: one grouped query over `conversation_messages` for the project (`MAX(created_at_us)` per session); fall back to `created_at`.

  Auto summary: derive only for the final capped rows (after active/sort/cap), so the list does at most two content reads per returned session. For each row, select the first `role='user'` and latest `role='assistant'` by `source_global_position`. Read content through one `CachedContentKeyProvider`; missing/unreadable content is skipped. Attachment-only user text uses linked `attachment_records.file_name` joined by `message_attachments`. Clip user to 120 chars, assistant to 140, total 240. If messages exist but neither side is readable, set `summary_unavailable=true` and increment `unreadable_summaries`. If no messages, `summary=None, summary_origin=None, summary_unavailable=false`.

  User summary: if the folded content id exists and decrypts, use it and set `summary_origin=Some("user")`; otherwise fall back to auto.

  Active cap: filter archived unless `include_archived`; validate `active_session_id` against the project and ignore deleted/foreign ids; include it when archived. Sort `(pinned DESC, last_activity_at DESC, session_id ASC)`. Take 100. If the active id is outside the first 100, replace the tail with it and keep `truncated=true`. `truncated` is true when any otherwise eligible session was omitted.

  Update `create_session` to call `validate_title` for a `Some` title and populate the new fields (`summary=None`, `summary_origin=None`, `summary_unavailable=false`, `pinned=false`, `archived=false`, `last_activity_at=created_at`), and add `#[serde(default)]` to all new `SessionSummary` fields so old receipts parse. On receipt replay, replace an empty `last_activity_at` with `created_at`. Add `ListSessionsOptions` to the handler/Tauri/client/schemas. `useProjectSessions` passes `activeSessionId` and maps the new fields.

  Add backend error mappings in `dtos/mod.rs` and frontend fallbacks in `error-envelope.ts`: `SESSION_DELETED` → `SessionNotFound`, `SESSION_BUSY` → `ConcurrencyConflict`, `DUPLICATE_TOO_LARGE`/`EXPORT_TOO_LARGE` → `PayloadTooLarge`, `STORAGE_REPAIR_REQUIRED` → `StorageRepairRequired`, `STORAGE_UNAVAILABLE` → `StorageUnavailable`. Preserve `VALIDATION_FAILED:<suffix>` as a field-specific `error.validation.<suffix>` key rather than collapsing it; add keys for `title_invalid`, `summary_too_long`, `role_requires_query`, `date_range`, `empty_query`, `query_too_short`, and `confirm_required`. Add the matching i18n fallback keys and include the new codes in the pre-effect whitelist where appropriate.

  Keep the built-in sidebar fallback; render summary when present, small Pinned/Archived badges, and a muted note when `unreadable_summaries > 0`. The full panel arrives in Task 10.

- [ ] **Step 4: Run tests, regenerate contracts, verify**

  Run:
  ```bash
  cargo test -p adham-desktop-api --test session_history_list --locked
  cargo xtask contracts
  pnpm exec vitest run apps/desktop/src/features/conversation/use-project-sessions.test.tsx
  cargo fmt --all -- --check
  ```
  Expected: PASS; `packages/contracts-generated/src/index.ts` changes only through `cargo xtask contracts`.

- [ ] **Step 5: Commit**

  Stage the new history DTO/service files, modified session/client/schema/UI files, generated contracts, and tests. Commit `feat(history): fold session metadata into the list`.

---

### Task 3: Session actions — rename, pin, archive

**Files:**
- Create: `crates/adham-desktop-api/src/service/history/actions.rs`
- Modify: `crates/adham-desktop-api/src/service/common.rs`
- Create: `crates/adham-desktop-api/src/handlers/history.rs`
- Modify: `crates/adham-desktop-api/src/handlers/mod.rs`, `crates/adham-desktop-api/src/service/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `xtask/src/main.rs`
- Modify: `apps/desktop/src/shared/api/adham-client-base.ts`, `schemas.ts`, `error-envelope.ts`
- Modify: `apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.tsx`
- Modify: `apps/desktop/src/features/conversation/use-project-sessions.ts`
- Create: `apps/desktop/src/features/history/session-details-dialog.tsx`
- Create: `apps/desktop/src/features/history/use-session-actions.ts`
- Modify: `apps/desktop/src/shared/i18n/locales/{en,ar,ru,zh-CN}/conversation.json`
- Test: `crates/adham-desktop-api/tests/session_history_actions.rs`
- Test: `apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.history.test.tsx`

**Interfaces:**
- Produces in `service/common.rs`:
  ```rust
  pub async fn lock_session_stream_tx(
      tx: &mut sqlx::Transaction<'_, Sqlite>, session_id: &str,
  ) -> Result<(), String>;
  pub async fn ensure_session_active_tx(
      tx: &mut sqlx::Transaction<'_, Sqlite>, session_id: &str,
  ) -> Result<(), String>;
  ```
  `lock_session_stream_tx` runs `UPDATE streams SET current_sequence = current_sequence WHERE stream_id = ?` and returns `SESSION_NOT_FOUND` when no row; `ensure_session_active_tx` rejects when a `SessionDeleted` event exists.
- Produces commands returning `CommandResult<SessionMetadata>`:
  `rename_session`, `set_session_pinned`, `set_session_archived`.
- Payloads: `RenameSessionPayload { title: String }`, `SetSessionPinnedPayload { pinned: bool }`, `SetSessionArchivedPayload { archived: bool }`.

- [ ] **Step 1: Write the failing tests**

  ```rust
  #[tokio::test]
  async fn rename_pin_archive_append_events_and_replay() {
      // rename -> list reflects it; pin -> pinned true; archive -> archived true;
      // same request id returns the stored metadata without a second event
  }

  #[tokio::test]
  async fn rename_rejects_empty_control_and_over_120_scalars() { /* ... */ }

  #[tokio::test]
  async fn actions_refuse_a_deleted_session() {
      // append SessionDeleted, then rename; assert SESSION_DELETED and no event
  }

  ```
  UI test: opening the row menu, renaming, pinning, and archiving call the client and refresh; the active archived row keeps its badge.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_actions --locked` and the Vitest file.
  Expected: FAIL.

- [ ] **Step 3: Implement the action service and UI**

  Each action: parse scope/request/fingerprints; begin tx; `lock_session_stream_tx`; `ensure_session_active_tx` before receipt lookup; check receipt; on match compare fingerprints, rollback, return stored metadata; validate payload; read current sequence; append the event with `expected_sequence`; use `read_session_metadata_tx` with one `CachedContentKeyProvider`; record receipt; commit. On commit failure, re-read the receipt and replay/conflict as `submit_message` does.

  Use `ctx.actor_id`, `ActorKind::LocalHuman`, and the session scope for every append. Title rename uses the same scalar/control validation as Task 1. Pin/archive accept explicit booleans.

  Tauri: add three commands and `generate_handler!` entries. Client: envelope methods that return `SessionMetadata`. UI: add a relative-wrapped `Menu` per row with Rename, Pin/Unpin, Archive/Unarchive; add a title-only `SessionDetailsDialog` (summary field is added in Task 5); refresh after success; show inline errors. Add all labels to four locales.

- [ ] **Step 4: Run tests and contracts**

  Run:
  ```bash
  cargo test -p adham-desktop-api --test session_history_actions --locked
  cargo xtask contracts
  pnpm exec vitest run apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.history.test.tsx
  ```
  Expected: PASS.

- [ ] **Step 5: Commit**

  Commit `feat(history): add rename pin and archive actions`.

---

### Task 4: Message bookmarks

**Files:**
- Create: `crates/adham-desktop-api/src/service/history/bookmarks.rs`
- Modify: `crates/adham-desktop-api/src/dtos/mod.rs`, `handlers/conversation.rs`, `handlers/history.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `xtask/src/main.rs`
- Modify: `apps/desktop/src/shared/api/adham-client-base.ts`, `schemas.ts`
- Modify: `packages/ui/src/message-card.tsx`, `packages/ui/src/message-actions.tsx`
- Modify: `apps/desktop/src/features/conversation/conversation-panel*.tsx`, `use-conversation.ts`
- Modify: i18n `conversation.json` in four locales
- Test: `crates/adham-desktop-api/tests/session_history_bookmarks.rs`
- Test: `apps/desktop/src/features/conversation/conversation-panel.bookmarks.test.tsx`

**Interfaces:**
- `ConversationPage` gains `bookmarked_message_ids: Vec<String>`.
- Plain command:
  ```rust
  pub async fn set_message_bookmark(
      ctx: &ApiContext, context: &CommandContext, message_id: &str, bookmarked: bool,
  ) -> Result<Vec<String>, String>;
  pub async fn read_bookmarked_message_ids(
      pool: &SqlitePool, session_id: &str,
  ) -> Result<Vec<String>, String>;
  ```
- `MessageCard`/`MessageActions` gain optional `bookmarked: boolean` and `onToggleBookmark?: () => void`.

- [ ] **Step 1: Write the failing tests**

  Backend: toggle a persisted message on/off; reject a message from another session; reject a deleted session; `get_conversation` returns the ids; session delete purges (covered again in Task 8).
  UI: a persisted user/assistant card renders an `aria-pressed` star; clicking calls the client; optimistic/streaming cards have no star.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_bookmarks --locked` and the Vitest file.

- [ ] **Step 3: Implement**

  `set_message_bookmark` parses `CommandContext`, proves workspace/project/session scope, begins a tx, locks the session stream, checks active, verifies `conversation_messages.message_id/session_id`, inserts or deletes, commits, and returns the sorted ids. `get_conversation` calls `read_bookmarked_message_ids` and includes them.

  Bookmark toggles are the explicit design exception to the mutation-receipt rule: a plain command with the desired state, no event, no receipt. Retrying the same desired state is idempotent.

  UI: add a star action to `MessageActions` only when `messageId` is durable; pass `bookmarked` from `ConversationPage.bookmarked_message_ids`; refresh ids on toggle. Add `data-message-id={messageId}` to the message card for the later search focus jump. Use plain text/icon labels from i18n.

- [ ] **Step 4: Run tests and contracts**

  Run the backend test, `cargo xtask contracts`, and the Vitest file. Expected: PASS.

- [ ] **Step 5: Commit**

  Commit `feat(history): add message bookmarks`.

---

### Task 5: User summaries and details dialog

**Files:**
- Create: `crates/adham-desktop-api/src/service/history/summary.rs`
- Modify: `crates/adham-desktop-api/src/service/history/mod.rs`, `actions.rs`, `handlers/history.rs`, `handlers/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `xtask/src/main.rs`
- Modify: `apps/desktop/src/shared/api/adham-client-base.ts`, `schemas.ts`
- Modify: `apps/desktop/src/features/history/session-details-dialog.tsx` (created in Task 3)
- Modify: i18n `conversation.json` in four locales
- Test: `crates/adham-desktop-api/tests/session_history_summaries.rs`
- Test: `apps/desktop/src/features/history/session-details-dialog.test.tsx`

**Interfaces:**
- `SetSessionSummaryPayload { summary: Option<String> }`; command returns `CommandResult<SessionMetadata>`.
- Internal `read_effective_summary_tx(...)` returns `(Option<String>, Option<String>, bool)` (text, origin, unavailable).
- Summary content kind is `"session_summary"`; receipt stores no text.

- [ ] **Step 1: Write the failing tests**

  ```rust
  #[tokio::test]
  async fn user_summary_overrides_auto_and_reset_reverts() { /* ... */ }

  #[tokio::test]
  async fn summary_over_500_scalars_is_rejected() {
      // assert VALIDATION_FAILED:summary_too_long and no event
  }

  #[tokio::test]
  async fn replacing_summary_tombstones_the_old_content() {
      // old content id is absent from content_records and present in content_tombstones
  }

  #[tokio::test]
  async fn unreadable_user_summary_falls_back_to_auto() { /* ... */ }

  #[tokio::test]
  async fn summary_receipt_contains_no_summary_text() {
      // read receipts.response_json; assert it does not contain the canary text
  }
  ```
  UI: saving a summary refreshes the row; Reset sends `None`; empty input sends `None`; >500 shows the localized error.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_summaries --locked` and the Vitest file.

- [ ] **Step 3: Implement**

  `set_session_summary`: lock the session stream, ensure active, then check receipt; trim; if `Some`, reject >500 scalars; empty becomes `None`. Read the current effective summary content id from folded events. If `Some`, seal a new content record with a new content id under the session scope and append `SessionSummaryUpdated { content_id: Some(new_id) }`; if `None`, append `None`. Erase the old summary content record and insert a tombstone in the same transaction. Use `read_session_metadata_tx` with the cached provider; record receipt; commit.

  Extend the details dialog with a textarea/preview, character count, Save, and Reset to auto. Refresh the list after save so text comes from a hydrated list read, not the receipt.

- [ ] **Step 4: Run tests and contracts**

  Run the backend test, `cargo xtask contracts`, and the Vitest file. Expected: PASS.

- [ ] **Step 5: Commit**

  Commit `feat(history): add editable session summaries`.

---

### Task 6: Duplicate complete transcript

**Files:**
- Create: `crates/adham-desktop-api/src/service/history/duplicate.rs`
- Modify: `crates/adham-desktop-api/src/service/history/mod.rs`, `handlers/history.rs`, `handlers/mod.rs`
- Modify: `crates/adham-event-log/src/sqlite/store/attachments.rs` (list linked attachments helper)
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `xtask/src/main.rs`
- Modify: client/schemas/useProjectSessions/primary-sidebar/useProjectSessions tests
- Modify: `apps/desktop/src/features/history/use-session-actions.ts` (created in Task 3)
- Test: `crates/adham-desktop-api/tests/session_history_duplicate.rs`

**Interfaces:**
- `DuplicateSessionPayload { title: Option<String> }`; returns `CommandResult<SessionMetadata>`.
- Copies every persisted row, including superseded branches. New message ids, content ids, event ids, assistant operation ids; active branch selections, feedback, pin, and archive are not copied; bookmarks and references are remapped.
- Title defaults to a localized UI value; backend fallback is `{source_title} copy`, capped at 120.

- [ ] **Step 1: Write the failing tests**

  ```rust
  #[tokio::test]
  async fn duplicate_copies_all_branches_and_remaps_refs_and_bookmarks() { /* ... */ }

  #[tokio::test]
  async fn duplicate_refuses_pending_and_null_session_first_send() {
      // pending row with session_id=null and create_request_id matching SessionCreated
      // assert SESSION_BUSY
  }

  #[tokio::test]
  async fn duplicate_refuses_over_500_messages_or_5_mb() { /* ... */ }

  #[tokio::test]
  async fn duplicate_receipt_replay_returns_the_same_new_session() { /* ... */ }

  #[tokio::test]
  async fn duplicate_resets_active_branch_and_excludes_unlinked_attachments() {
      // copy has the newest-edit default branch selection
      // unlinked attachment row is not copied
  }

  #[tokio::test]
  async fn duplicate_fails_on_missing_or_unreadable_content() {
      // assert STORAGE_REPAIR_REQUIRED and no partial session
  }

  #[tokio::test]
  async fn duplicate_reseals_content_under_the_new_session_scope() {
      // new content ids and ciphertext; source decrypts with its scope only
  }
  ```
  Also assert the copy has no feedback/branch selections/pin/archive, the source is unchanged, and a rebuild still shows the copy.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_duplicate --locked`.

- [ ] **Step 3: Implement**

  Begin tx; lock the source session stream; `ensure_session_active_tx`; check receipt; check live pending by `session_id` or `create_request_id`; read source metadata and strict `get_session_messages` with one `CachedContentKeyProvider`; map content errors to `STORAGE_REPAIR_REQUIRED`. Use that provider for every source read and new seal; do not open the keychain per message. Precheck >500 messages and >5MB of plaintext (message text, linked attachment extracted text, user summary) using `content_records.plaintext_size`, then verify while copying. Collect linked attachments, bookmarks, and the effective user summary.

  Create the new session id/title; append `SessionCreated`. Walk source rows in `source_global_position` order:
  - user row: new content id + `put_content_tx` under the new session scope; append `MessageSubmitted` v2 with remapped reference and remapped `attachment_ids`; `insert_message_tx`.
  - assistant row: new content id + `put_content_tx`; append `assistant/message-completed` with new `op_id`, `message_id`, same completion/usage; `insert_assistant_completion_tx`.
  Stamp new timestamps with a small monotonic offset. Re-seal/copy linked attachment extracted text, mint new attachment ids, insert records, link to the new message. Copy the user summary as a new sealed content record + `SessionSummaryUpdated`. Copy bookmarks with remapped message ids. Build the new session's `SessionMetadata` with `read_session_metadata_tx`. Record a range receipt (`record_receipt_range_tx`) using the first/last appended positions; commit.

  UI: Duplicate menu item; default localized title; on success refresh and open the copy. Specific errors for busy/too-large.

- [ ] **Step 4: Run tests and contracts**

  Run the backend test, `cargo xtask contracts`, and the affected Vitest files. Expected: PASS.

- [ ] **Step 5: Commit**

  Commit `feat(history): duplicate sessions with full transcript`.

---

### Task 7: Markdown export

**Files:**
- Create: `crates/adham-desktop-api/src/service/history/export.rs`
- Modify: `crates/adham-desktop-api/src/service/history/mod.rs`, `handlers/history.rs`, `handlers/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `xtask/src/main.rs`
- Modify: client/schemas/primary-sidebar/useProjectSessions
- Modify: `apps/desktop/src/features/history/use-session-actions.ts` (add export)
- Create: `apps/desktop/src/features/history/export-session-dialog.tsx`
- Test: `crates/adham-desktop-api/tests/session_history_export.rs`
- Test: `apps/desktop/src/features/history/export-session-dialog.test.tsx`

**Interfaces:**
- `ExportSessionResponse { path: String, bytes: u64 }`.
- Path: `adham_platform::PlatformStoragePolicy::resolve()?.data_dir/exports/{slug}-{session_id}.md`; slug 40 scalars / 120 UTF-8 bytes max, fallback `session`; unique sibling `.tmp` then replace; Unix `0o600`.
- 5 MB UTF-8 cap; `EXPORT_TOO_LARGE`; no truncation; no new dependency.

- [ ] **Step 1: Write the failing tests**

  ```rust
  #[tokio::test]
  async fn export_writes_markdown_with_summary_and_all_branch_rows() { /* ... */ }

  #[tokio::test]
  async fn export_rejects_over_5_mb_without_a_partial_file() { /* ... */ }

  #[tokio::test]
  async fn export_filename_uses_full_id_and_sanitized_slug() {
      // titles "Same" and "Same" with different ids produce distinct files
  }

  #[tokio::test]
  async fn export_overwrites_same_session_and_sets_owner_only_mode() {
      // second export replaces the first; Unix mode is 0o600
  }

  #[tokio::test]
  async fn export_refuses_deleted_and_busy_sessions() { /* ... */ }
  ```
  UI test: warning dialog, path/copy button/bytes, error message.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_export --locked` and the Vitest file.

- [ ] **Step 3: Implement**

  Lock/read source metadata; refuse deleted; refuse live pending (including null first-send); read effective summary with one `CachedContentKeyProvider`; strict `get_session_messages` with that provider, mapped to `STORAGE_REPAIR_REQUIRED`; list linked attachments by message. Build Markdown: title, effective summary labelled Auto/User, each message with role and text, completion labels, edited-branch labels from `refers_to_relation`, and attachment names/sizes. Do not embed attachment bytes, bookmarks, feedback, usage, or provenance. Build the string and fail before writing if >5MB. Write a unique temp sibling, fsync/close, replace target; return path/bytes.

  UI: warning that the file is unencrypted and survives delete; show path with copy button and byte count; fixed-folder note.

- [ ] **Step 4: Run tests and contracts**

  Run the backend test, `cargo xtask contracts`, and the Vitest file. Expected: PASS.

- [ ] **Step 5: Commit**

  Commit `feat(history): export sessions to markdown`.

---

### Task 8: Delete — tombstone, purge, rebuild exclusion, late-write guards

**Files:**
- Create: `crates/adham-desktop-api/src/service/history/delete.rs`
- Modify: `crates/adham-event-log/src/sqlite/store/content.rs` (erase/tombstone helper)
- Modify: `crates/adham-event-log/src/sqlite/store/pending_operations.rs` (scope/busy/purge helpers)
- Modify: `crates/adham-event-log/src/sqlite/store/attachments.rs` (delete-by-session helper)
- Modify: `crates/adham-desktop-api/src/service/common.rs`, `message.rs`, `pending.rs`, `branch.rs`, `feedback.rs`, `session.rs`, `attachment.rs`
- Modify: `crates/adham-desktop-api/src/handlers/providers/streaming.rs`, `stream_io.rs`, `providers/mod.rs`
- Modify: `crates/adham-projections/src/conversation.rs` (rebuild skip deleted)
- Modify: `crates/adham-desktop-api/src/handlers/history.rs`, `handlers/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `xtask/src/main.rs`
- Modify: client/schemas/primary-sidebar/useProjectSessions/lazy-session-creation
- Modify: `apps/desktop/src/features/history/use-session-actions.ts` (add delete)
- Create: `apps/desktop/src/features/history/delete-session-dialog.tsx`
- Test: `crates/adham-desktop-api/tests/session_history_delete.rs`
- Test: `crates/adham-projections/tests/projection_tests.rs`
- Test: `apps/desktop/src/features/history/delete-session-dialog.test.tsx`

**Interfaces:**
- `DeleteSessionPayload { confirm: bool }`; returns `CommandResult<DeleteSessionResponse { session_id, deleted }>`.
- Reuse `lock_session_stream_tx` / `ensure_session_active_tx`.
- `erase_content_tx(tx, content_id, reason_code)` inserts a tombstone and deletes the content row.
- `purge_pending_operations_tx(tx, session_id, create_request_id)` returns collected content ids and deletes matching rows.
- `ConversationProjection::rebuild` skips message events whose `session_id` has a `SessionDeleted` event.

- [ ] **Step 1: Write the failing tests**

  ```rust
  #[tokio::test]
  async fn delete_tombstones_purges_and_removes_from_list() { /* ... */ }

  #[tokio::test]
  async fn delete_requires_confirmation() {
      // assert VALIDATION_FAILED:confirm_required and no event/content change
  }

  #[tokio::test]
  async fn delete_purges_null_session_first_send_content() {
      // pending row session_id=null, create_request_id == SessionCreated.request_id
      // assert content_ids and pending row are gone, and busy check refused while pending
  }

  #[tokio::test]
  async fn delete_purges_resolved_pending_rows_and_replays_receipt() {
      // resolved rows do not block, are purged, and the same request id returns the same response
  }

  #[tokio::test]
  async fn rebuild_does_not_resurrect_deleted_messages() { /* ... */ }

  #[tokio::test]
  async fn late_write_after_delete_fails_session_deleted() {
      // delete first, then submit_message; assert SESSION_DELETED and no content/event
  }

  #[tokio::test]
  async fn first_send_pending_after_delete_is_rejected() {
      // null-session pending row whose create_request_id resolves to a deleted session
      // assert SESSION_DELETED and no row
  }

  #[tokio::test]
  async fn attachment_ingestion_after_delete_is_rejected() {
      // assert SESSION_DELETED and no attachment/content row
  }

  #[tokio::test]
  async fn create_receipt_replay_after_delete_is_rejected() { /* ... */ }

  #[tokio::test]
  async fn delete_leaves_exported_markdown_in_place() { /* export, delete, assert the file still reads */ }
  ```
  Projection test asserts `rebuild` count excludes deleted. UI test: confirmation wording (database/backup caveat, event metadata remains, exports remain), destructive action, next selection/new draft, local first-send cleared.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_delete --locked`, `cargo test -p adham-projections --test projection_tests --locked`, and the Vitest file.

- [ ] **Step 3: Implement**

  Delete: parse/confirm; begin tx; lock session stream; check receipt; `ensure_session_active_tx`; read the `SessionCreated.request_id`; check live pending by `session_id` or `create_request_id` (resolved rows do not block); read current sequence; append `SessionDeleted`; collect all `content_records` for the session plus pending `content_id`/`title_content_id`; `erase_content_tx` each; delete `message_attachments` for the session's messages, `attachment_records`, `conversation_messages`, `answer_feedback`, `branch_selections`, `message_bookmarks`, and matching pending rows; record receipt; commit; best-effort `PRAGMA wal_checkpoint(TRUNCATE)`.

  Rebuild: build a `HashSet<String>` of deleted session ids from `SessionDeleted` events, and skip message events whose `session_id` is in it. Preserve existing version handling and checkpoint behavior.

  Late writes: add `lock_session_stream_tx` + `ensure_session_active_tx` before receipt lookup in `submit_message`, pending operations, provider completion start/finish, metadata actions, summary, bookmarks, duplicate, and attachment ingestion. For a pending row with `session_id = NULL`, resolve its `create_request_id` to the `SessionCreated` event and check that session; if it is tombstoned, reject. Attachment ingestion must lock/check inside its content/row transaction. Branch/feedback local writes must check active inside their transaction. `create_session` receipt replay must check `SessionDeleted` before returning the historical `SessionSummary`. `resolve_scoped_session` additionally rejects a `SessionDeleted` stream for reads.

  UI: Delete menu item; dialog with title, "cannot be undone", database/backup caveat, "event metadata remains", and "exported Markdown files remain"; on success refresh/select next or clear; clear local first-send record for the deleted session. Add labels to four locales.

- [ ] **Step 4: Run tests and the full affected suites**

  Run:
  ```bash
  cargo test -p adham-desktop-api --test session_history_delete --locked
  cargo test -p adham-projections --test projection_tests --locked
  cargo test -p adham-desktop-api --test p0_repair_regression --locked
  pnpm exec vitest run apps/desktop/src/features/history/delete-session-dialog.test.tsx
  ```
  Expected: PASS; a rebuild is empty for a deleted session and a late submit is rejected.

- [ ] **Step 5: Commit**

  Commit `feat(history): delete sessions with tombstoned content`.

---

### Task 9: Backend search and filters

**Files:**
- Create: `crates/adham-desktop-api/src/service/history/search.rs`
- Modify: `crates/adham-desktop-api/src/service/history/mod.rs`, `handlers/history.rs`, `handlers/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `xtask/src/main.rs`
- Modify: client/schemas
- Test: `crates/adham-desktop-api/tests/session_history_search.rs`

**Interfaces:**
  ```rust
  pub struct SessionSearchFilters {
      pub include_archived: bool, pub pinned_only: bool, pub bookmarked_only: bool,
      pub role: Option<String>, pub has_attachments: bool,
      pub from: Option<String>, pub to: Option<String>,
  }
  pub struct SessionSearchRequest { pub query: String, pub filters: SessionSearchFilters }
  pub struct SessionSearchResult {
      pub session_id: String, pub title: Option<String>, pub summary: Option<String>,
      pub summary_origin: Option<String>, pub last_activity_at: String,
      pub match_kind: String, pub message_id: Option<String>, pub role: Option<String>,
      pub snippet: Option<String>, pub attachment_name: Option<String>,
  }
  pub struct SessionSearchResponse {
      pub results: Vec<SessionSearchResult>, pub truncated: bool,
      pub scanned_sessions: u32, pub scan_limit_reached: bool, pub skipped_unreadable: u32,
  }
  ```
- `match_kind` is one of `session`, `title`, `summary`, `message`, `attachment`, `bookmark`.
- `role` accepts only `user` or `assistant`; an empty query with a role is `VALIDATION_FAILED:role_requires_query`.
- `search_history(ctx, context, request)` scopes by `context.workspace_id`/`project_id`; no project field in the request.
- Result cap is a constant 50; no caller-supplied limit. `scanned_sessions` is the count of candidate sessions scanned after filters.

- [ ] **Step 1: Write the failing tests**

  ```rust
  #[tokio::test]
  async fn search_matches_title_summary_message_and_linked_attachment_only() { /* ... */ }

  #[tokio::test]
  async fn empty_query_with_filter_returns_session_results() {
      // pinned_only + empty query -> match_kind == "session"
      // bookmarked_only + empty query -> bookmark results
      // empty query with no filter -> VALIDATION_FAILED:empty_query
  }

  #[tokio::test]
  async fn role_with_empty_query_is_rejected() { /* ... */ }

  #[tokio::test]
  async fn one_character_query_is_rejected() {
      // assert VALIDATION_FAILED:query_too_short
  }

  #[tokio::test]
  async fn invalid_or_reversed_date_range_is_rejected() {
      // assert VALIDATION_FAILED:date_range
  }

  #[tokio::test]
  async fn unlinked_attachments_are_excluded_and_unreadable_rows_are_counted() { /* ... */ }

  #[tokio::test]
  async fn role_and_bookmark_filters_exclude_title_and_summary_matches() { /* ... */ }

  #[tokio::test]
  async fn search_is_case_insensitive_and_bounds_snippets() { /* ... */ }

  #[tokio::test]
  async fn search_uses_one_key_read_and_returns_no_ciphertext() {
      // counting provider asserts one content_key() call; results only plaintext snippets
  }

  #[tokio::test]
  async fn caps_results_at_50_and_scans_at_10_000_messages() { /* ... */ }
  ```
  Also assert all persisted branch rows are searched, deleted sessions are excluded, and `skipped_unreadable` is non-zero when a content row is missing.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `cargo test -p adham-desktop-api --test session_history_search --locked`.

- [ ] **Step 3: Implement**

  Parse `CommandContext` and use its workspace/project scope. Load the uncapped folded history rows (Task 2 helper) for that project. Apply session filters: archived, pinned, has linked attachments, date range on `last_activity_at`, bookmarked. Take at most 100 matching candidate sessions (set `truncated` if more); do not cap before filtering. If query is empty: require a filter other than `include_archived`; role is invalid; return one `session` result per matching session, or message-level `bookmark` results for `bookmarked_only`. A non-empty query with fewer than two non-whitespace characters is `VALIDATION_FAILED:query_too_short`. Reject an invalid role with `VALIDATION_FAILED:role`.

  For non-empty queries, case-insensitive substring match title and effective summary first (unless role/bookmarked filters exclude those kinds). Then scan `conversation_messages` for candidates in `source_global_position` order, decrypting text with the per-command cached key provider; skip unreadable and count. For attachments, join `attachment_records` to `message_attachments` and `conversation_messages`, so unlinked attachments are excluded; match the plaintext file name and decrypted extracted text; anchor to the earliest linked message and use its role/bookmark state. Stop at 10,000 message rows and set `scan_limit_reached`.

  Build text-only snippets (≤180 chars) around the first case-insensitive match; use Unicode-safe boundaries. Sort by session last activity then match position; cap 50 and set `truncated` when more. Use one deferred read transaction. Decode date inputs as RFC3339; reject invalid/reversed with `VALIDATION_FAILED:date_range`.

- [ ] **Step 4: Run tests and contracts**

  Run the backend test and `cargo xtask contracts`. Expected: PASS.

- [ ] **Step 5: Commit**

  Commit `feat(history): search sessions and attachments`.

---

### Task 10: Search and history panel UI

**Files:**
- Create: `apps/desktop/src/features/history/session-history-panel.tsx`
- Create: `apps/desktop/src/features/history/use-session-search.ts`
- Modify: `apps/desktop/src/features/history/use-session-actions.ts`
- Modify: `apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.tsx` (`historyPanel` slot)
- Modify: `apps/desktop/src/routes/index.tsx`
- Modify: `apps/desktop/src/features/conversation/use-project-sessions.ts`
- Modify: `apps/desktop/src/features/conversation/conversation-panel.tsx` (focus listener/scroll)
- Modify: i18n `conversation.json` in four locales
- Test: `apps/desktop/src/features/history/use-session-search.test.ts`
- Test: `apps/desktop/src/features/history/session-history-panel.test.tsx`
- Test: `apps/desktop/src/features/conversation/conversation-panel.history-focus.test.tsx`

**Interfaces:**
- `PrimarySidebarProps.historyPanel?: React.ReactNode`; when present it replaces the built-in search/list; the fallback remains for tests/gallery.
- `useSessionSearch({ backend, context, query, filters })` returns `{ results, loading, error, truncated, scanLimitReached, skippedUnreadable, retry }`; 250 ms debounce and a sequence guard.
- `SessionHistoryPanel` receives sessions, activeSessionId, onSelectSession, onNewSession, onRefresh, and the action handlers. It groups results by session and dispatches `adham:session-focus-message` with `{ sessionId, messageId }`.

- [ ] **Step 1: Write the failing tests**

  `use-session-search.test.ts`: debounce coalesces keystrokes; a stale response is ignored; empty query with no filter does not call the backend; bookmarked-only empty query calls; role is disabled/cleared when query empties.

  `session-history-panel.test.tsx`: renders list and groups results; shows Session/Title/Summary/Message/Attachment/Bookmark labels; shows "Not available yet" for agents/participants/task status/model/tags/cost/artifacts; shows truncated/scan/skipped notices; selecting a message dispatches the focus event; keyboard menu works; RTL/200% layout remains usable. `conversation-panel.history-focus.test.tsx`: the focus event scrolls the rendered `data-message-id` and highlights it; an unknown id is ignored.

- [ ] **Step 2: Run tests to verify they fail**

  Run: `pnpm exec vitest run apps/desktop/src/features/history/use-session-search.test.ts apps/desktop/src/features/history/session-history-panel.test.tsx`.

- [ ] **Step 3: Implement**

  Replace the renderer-local title filter in the production sidebar with `SessionHistoryPanel` passed through the new slot. The panel owns the search field, filter disclosure, result grouping, and notices. "Show archived" alone leaves the normal list; any other active filter or ≥2 query chars triggers search. Role is disabled with a hint until a query exists. Empty query + bookmarked-only shows bookmarks. Selecting a message/attachment result opens the session and dispatches the focus event; the conversation scrolls to `data-message-id` if loaded. Show the list's `unreadable_summaries` count and the search's `skipped_unreadable` count as muted notices. Add a `conversation-panel.tsx` listener for `adham:session-focus-message`: after the target session's messages render, scroll the matching `data-message-id` into view and apply a brief highlight; ignore an id that is not loaded.

  Reuse `useSessionActions` from Task 3 for rename/pin/archive/duplicate/export/delete, and refresh through `useProjectSessions`. Keep action errors inline. Add all `history.*` labels to four locales; use plain text for snippets and `dir="auto"`.

- [ ] **Step 4: Run UI tests and typecheck**

  Run:
  ```bash
  pnpm exec vitest run apps/desktop/src/features/history
  pnpm typecheck
  pnpm lint
  ```
  Expected: PASS.

- [ ] **Step 5: Commit**

  Commit `feat(history): add search and history panel`.

---

### Task 11: Hardening, evidence, matrix

**Files:**
- Create: `docs/reports/conversation-03-session-history.md`
- Modify: `docs/reports/conversation-01-requirement-status-matrix.md`
- Modify: any tests needed for a11y/RTL/i18n
- Verify: no changes to `Cargo.toml`/`package.json` dependencies for #33/#34/#35

- [ ] **Step 1: Run the full verification set**

  ```bash
  node scripts/check-file-size.mjs
  cargo fmt --all -- --check
  cargo clippy --workspace --all-targets --locked -- -D warnings
  cargo xtask contracts
  cargo test --workspace --locked
  cargo test -p adham-desktop-api --test p0_repair_regression --locked
  pnpm check
  ```
  Fix failures in the owning task, not with suppressions.

- [ ] **Step 2: Write synthetic evidence**

  `docs/reports/conversation-03-session-history.md` records revision-tagged command logs for: list/fold, actions, bookmarks, summaries, search, filters, duplicate, export, delete, rebuild exclusion, null-session pending purge, and late-write rejection. Use synthetic canary data only; no user content, secrets, raw app-data paths, or key material. State that exported Markdown is not deleted and that delete is not forensic erasure.

  Update the requirement matrix with delivered/partial/unavailable rows. Keep #33/#34/#35 blocked; do not claim PDF, modalities, cursors, or unsupported filters.

- [ ] **Step 3: Review the final diff**

  Check generated files, i18n parity, error mappings, and that no fake filter/control ships. Confirm the active archived session, unreadable content notices, and 100-row cap behave as specified. Run `git status --short` and stage only intended paths.

- [ ] **Step 4: Commit**

  Commit `test(history): verify session history suite and evidence`.
