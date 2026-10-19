# Conversation 01 — requirement status matrix

- **Date:** 2026-10-19
- **Revision inspected:** `980d899` (this report is a docs-only change on top of it). Sections A and C were first written against `d830626` plus uncommitted work; their findings were re-verified against `980d899` where the implementation changed (section B).
- **Scope:** sections A–C are read-only verification. Sections D–F record the implementation shipped at `980d899` and the verification commands run at that revision.
- **Data:** this report contains no user content, no secrets, no real app-data paths, and no key material.

Status values: `implemented` means backend and UI behavior were both found; `implemented-locally` means real renderer-only behavior over already-loaded data; `honest-unavailability` means the capability has no implementation, and any control that exists is local-only and disclosed as not transmitted.

## A. History operations: rename / pin / archive / search / export / delete

**Requirement source.** The requirement text covering the six operations is in `docs/Frontend UX — Compose & agent workspace.md` section 17, lines 543-552; the same list also names Duplicate and Bookmark:

> Sessions support:
>
> - Pin.
> - Rename.
> - Archive.
> - Duplicate.
> - Export.
> - Delete.
> - Bookmark important messages or outputs.

The same section requires generated titles and summaries, both editable by the user (line 566), and a search field that "finds session titles, summaries, messages, agents, files, and artifacts" (line 570). `docs/adham.md` has no per-operation session-history requirement: its export/delete wording is about local memory controls (lines 128 and 215). No matching session-history requirement was found under `docs/spec/**`.

**Existing baseline.** A session list endpoint exists and is wired end to end: `crates/adham-desktop-api/src/service/session.rs:212` (`list_sessions`), `crates/adham-desktop-api/src/handlers/session.rs:13` (`handle_list_sessions`), registered at `apps/desktop/src-tauri/src/lib.rs:469`, called from `apps/desktop/src/shared/api/adham-client.ts:305` and `apps/desktop/src/features/conversation/use-project-sessions.ts:67`. It reads `SessionCreated` events newest first, capped at 100 (`session.rs:198`, `:240-250`). It does not provide any of the six operations below.

| Operation | Status | Evidence (verified by reading) | Notes |
|---|---|---|---|
| Rename | `honest-unavailability` | `crates/adham-desktop-api/src/service/session.rs:28` (create) and `:212` (list) are the only session services; `crates/adham-desktop-api/src/handlers/session.rs:3-22` has only create/list; `apps/desktop/src-tauri/src/lib.rs:456-493` has no rename command; `apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.tsx:145-156` and `:205-216` render new-session, select, and retry only; the title is written once at creation (`session.rs:113-117`). | No backend behavior; not implemented. The title is derived from the first message and frozen (`apps/desktop/src/features/conversation/lazy-session-creation.ts:20-32`, `:220`); no update event or projection mutation exists. Required: a title-update command with event/receipt/projection and an edit control. |
| Pin | `honest-unavailability` | `lib.rs:456-493` has no pin command; `session.rs:240-249` reads `SessionCreated` payloads that carry no pin field; `primary-sidebar.tsx:176-223` has no pin affordance. | No backend behavior; not implemented. The only "pinned" code refers to provider registry models (`apps/desktop/src/features/conversation/provider-stream.ts:32`), not sessions. Required: a pin event/projection, ordering rule, and control. |
| Archive | `honest-unavailability` | `lib.rs:456-493` has no archive command; `session.rs:240-249` has no archived filter; `primary-sidebar.tsx:176-223` has no archive control. | No backend behavior; not implemented. Required: archived state/event, default-list filtering, a restore path, and a retention policy. |
| Search | `implemented-locally` | `apps/desktop/src/widgets/shell/primary-sidebar/primary-sidebar.tsx:93-97` filters the loaded `sessions` by case-insensitive title substring; `:159-173` renders the field; `:198-203` renders the no-match state. Loaded rows come from `use-project-sessions.ts:54-84`. | Real but narrow: title substring over the sessions already loaded (newest 100). It does not search summaries, messages, agents, files, or artifacts as line 570 requires, and there is no backend search endpoint or index. |
| Export | `honest-unavailability` | `lib.rs:456-493` has no export/save/download command; `apps/desktop/src/widgets/shell/panel/panel.tsx:309-317` shows only a static "No artifacts produced yet" state; no transcript export exists in `apps/desktop/src/features/conversation/conversation-panel.tsx`. | No backend behavior; not implemented. Clipboard copy of a code block (`packages/ui/src/markdown-view.tsx:311-352`) is not session export. Required: an export format/scope decision, redaction policy, and a native save path. |
| Delete | `honest-unavailability` | `lib.rs:456-493` has no delete command; `session.rs` has no delete service; `primary-sidebar.tsx:176-223` has no delete control. | No backend behavior; not implemented. Required: tombstone/retention semantics and cascade decisions for messages, attachments, branch selections, feedback, and receipts, plus destructive confirmation (`docs/Frontend UX — Compose & agent workspace.md:488`). |

Search is the only one of the six with implemented behavior, and it is renderer-local and title-only.

**Places searched for the missing operations:** `crates/adham-desktop-api/src/service/*.rs`, `crates/adham-desktop-api/src/handlers/*.rs`, the Tauri command registry in `apps/desktop/src-tauri/src/lib.rs`, `apps/desktop/src/**`, `docs/adham.md`, `docs/spec/**`, and the Compose UX spec. No rename, pin, archive, session-export, or session-delete command, service, handler, or UI control was found.

## B. Non-text content classes (issue #32 C4 remainder)

Requirement context: the Compose UX spec lists input types at lines 182-196 (text and code, images and screenshots, documents, audio, video, files, folders, clipboard, voice dictation), leading controls at lines 166-170 (attachment, voice/audio, optional screen capture), and artifact output at lines 492-494. No PDF or OCR requirement text was found in `docs/adham.md` or `docs/spec/**`; the classes below are the issue #32 C4 remainder.

**What the UI actually offers (at `980d899`).** `apps/desktop/src/features/conversation/attachments/ui/attachment-picker.tsx` is a real picker (`<input type="file">` with `ATTACHMENT_ACCEPT`); `attachments/model/use-attachment-drop.ts` ingests files dropped on the app window; `apps/desktop/src/widgets/compose/compose-input.tsx` ingests clipboard files. `attachments/model/use-attachments.ts` reads picked/dropped files in the renderer (`arrayBuffer()` + `new TextDecoder('utf-8', { fatal: true })` in `attachments/api/attachment-client.ts`) and calls `ingestAttachment`/`ingestAttachmentPath`; a chip appears only after the stored record exists. `compose-context-chips.tsx` renders status (`reading`/`ready`/`pending`/`error`), character count and truncation; `attachments/ui/message-attachments.tsx` renders the history chips and previews the stored text. Images, folders, voice, screen capture and generated artifacts have no control — the fake `compose-attachment-menu.tsx` was deleted.

| Content class | Status | Evidence (verified by reading) | Notes |
|---|---|---|---|
| Text/code file input | `implemented` (text/code only) | Backend: `crates/adham-desktop-api/src/service/attachment.rs` (extension allowlist, `MAX_ATTACHMENT_BYTES = 5 MiB`, `MAX_EXTRACTED_CHARS = 200_000`, fatal UTF-8 validation), `attachment_dispatch.rs` (`MAX_DISPATCH_ATTACHMENT_CHARS = 240_000` per send, refusal never silent drop), migration `crates/adham-event-log/migrations/20261019000000_attachments.sql`, commands in `apps/desktop/src-tauri/src/lib.rs`. Frontend: `attachments/**` (picker, drop, paste-files, client, hook), `conversation-panel.tsx` (dispatch guards, clear-on-success, history chips), `use-conversation-stream.ts` (sessionless pending ingestion, localized refusal, tracked-first-send dismissal on failure). Contracts: `attachmentIds` on `SubmitMessagePayload`/`CompleteOncePayload`, `attachments` on message DTOs. | End-to-end for UTF-8 text and code files selected, dropped or pasted. An unusable selection refuses the send with `VALIDATION_FAILED: attachment.{tooLarge|unsupportedType|binaryContent|notUtf8|notFound|selectionTooLarge|unsupportedSource|unreadable}`, localized through `attachments.errors.*` in all four locales. Attachment-only sends are supported; files are blocked (not queued) while a turn runs. Extraction is bounded and stored through the existing AEAD content path; dispatch appends the file text only to the message it was sent with, so retry re-sends exactly what the turn carried. |
| PDF text extraction | `honest-unavailability` | The backend allowlist accepts text/code extensions only and returns `unsupportedType` for anything else (`attachment.rs`); no PDF crate was added to `Cargo.toml`/`Cargo.lock` or `package.json`/`pnpm-lock.yaml`. | PDF text extraction is NOT implemented in this build; the owner-approved reduction for this round. Required: a separately reviewed PDF parser dependency and extraction path, plus a retention policy for extracted text. |
| Scanned or encrypted PDF | `honest-unavailability` | Same allowlist and refusal path; no PDF parser, decryption, or OCR code exists. | Not implemented. Encrypted PDFs would additionally need password/decryption handling; scanned PDFs would need OCR. |
| OCR | `honest-unavailability` | No OCR implementation or dependency was found in `crates/`, `apps/desktop/src`, or the manifests; the only "ocr" hit is an acronym list in `apps/desktop/src/pages/settings/models/components/provider-models.tsx:41`. | Not implemented. OCR requires a separately reviewed implementation/dependency; no control is rendered for it. |
| Image/vision input | `honest-unavailability` | No image pipeline: the picker accepts text/code files only (`attachments/api/attachment-client.ts`, `ATTACHMENT_ACCEPT`), and the backend allowlist rejects image extensions (`attachment.rs`). `ComposeActionBar` does not pass `supportsVision`. Markdown images are labelled not shown (`packages/ui/src/markdown-view.tsx`). | Image/vision input is NOT implemented in this build. No control fabricates an image attachment; no image bytes reach a provider. Switching to a text-only model therefore cannot silently drop an image, because none can be selected. |
| Audio input | `honest-unavailability` | The composer toolbar contains the attachment picker, mode selector, model picker and send/stop controls only (`apps/desktop/src/widgets/compose/compose-action-bar.tsx`); the requirement asks for voice/audio input (Compose spec lines 169 and 189). | Not implemented; no voice/audio control and no audio pipeline. |
| Video input | `honest-unavailability` | No video control in the menus above; the backend allowlist has no video extensions (`attachment.rs:31-64`); the requirement lists video (Compose spec line 190). | Not implemented; no video pipeline. |
| Native image generation | `honest-unavailability` | No generation command in the Tauri registry (`lib.rs:456-493`); the artifacts tab is a static empty state (`panel.tsx:309-317`); no artifact persistence or save code was found. | Not implemented; no generated image can be produced, previewed, or downloaded. |
| Audio generation | `honest-unavailability` | Same command registry and static artifacts tab (`lib.rs:456-493`, `panel.tsx:309-317`); no text-to-speech or audio-generation code was found. | Not implemented; no audio generation pipeline. |
| Video generation | `honest-unavailability` | Same command registry and static artifacts tab (`lib.rs:456-493`, `panel.tsx:309-317`); no video-generation code was found. | Not implemented; no video generation pipeline. |
| Export artifacts (generated file downloads) | `honest-unavailability` | No export/save/download command in `lib.rs:456-493`; the artifacts tab only renders the empty message (`panel.tsx:309-317`). | Not implemented. Required: artifact records, a native save dialog, and a redaction/retention policy before any generated file can be downloaded. |

## C. Turn/attempt identity and cursors (issue #32 C5.1)

Inspected `crates/adham-desktop-api/src/handlers/conversation.rs` and the projection it reads:

| Field | Observed behavior | Evidence |
|---|---|---|
| `source_event_id` | Always the empty string. The projection view does not expose a source event id. | `conversation.rs:48`; view fields in `crates/adham-projections/src/conversation.rs:13-29`. |
| `projection_position` | Starts at `0`, increments by exactly `1` per returned message, and is returned as a decimal string. It is a message count, not an event-log position. | `conversation.rs:38`, `:62`, `:75`. The projection orders rows by `source_global_position` (`crates/adham-projections/src/conversation.rs:264`), but that value is not carried in the returned view. |
| `next_cursor` | Always `None`. | `conversation.rs:74`. |

Pagination is not wired: `handle_get_conversation` accepts only `context` (`conversation.rs:6-9`) and the Tauri wrapper accepts only `context` (`apps/desktop/src-tauri/src/lib.rs:165-172`), while the client still passes `cursor` and `limit` (`apps/desktop/src/shared/api/adham-client.ts:338-354`).

Status: `not-implemented`. Durable event/attempt identity repair is tracked in the P0 foundation work and is out of scope for this conversation; no claim is made here.

## D. Composer input behavior (issue #32 C2) — at `980d899`

| Requirement clause | Status | Evidence | Notes |
|---|---|---|---|
| Draft scoped to project+session/branch, including new-session draft | `implemented` | `conversation-panel.tsx` derives `scopeKey` from the resolved workspace/project and passes `sessionId`/`pendingBucket` to `useDrafts`; keys are `adham:compose:draft:<ws>:<proj>:<session\|pending>`. `use-drafts.ts` migrates the scope-less `pending` bucket into the scoped pending bucket when the scope appears, then adopts the scoped pending bucket into the resolved session. | Two projects can no longer share a draft or a new-session draft. A composer-level branch selector does not exist: alternatives are per message (C3), so the session key is the effective branch scope. |
| Selected model scoped the same way, no cross-project mixing | `implemented` | `compose-model-preference.ts` (`migratePendingModelChoice(next, pending)`), same scope key in `conversation-panel.tsx`; tests `compose-model-preference.test.ts`, `conversation-panel.model-selection.test.tsx`, `conversation-panel.streaming.test.tsx`. | A legacy scope-less pick is adopted once, then follows the session. A vanished stored id is still explained, never substituted. |
| Enter preference / Shift+Enter / IME | `implemented` | `enterToSend` prop on the panel and composer; `compose-input.tsx` guards `keyCode 229`; tests in `compose.test.tsx` (`submits on Enter but not on Shift+Enter`, `ignores Enter while an IME composition is in progress`, `enterToSend={false}` cases). | — |
| Pasted multiline content | `implemented` | Long and multiline text pastes stay inline in the textarea as text; no synthetic chip. `compose-input.tsx` only intercepts clipboard *files*. Tests: `keeps a long text paste inline instead of fabricating a file chip`, `keeps a multiline paste inline in the textarea`. | — |
| Clear-on-ack without losing edits | `implemented` | `conversation-panel.tsx`: `if (draftRef.current === text) commitPrompt(text)` on submit; the failure path restores the sent text only when the visible draft is empty or still that text. | Text typed while a send is in flight is not cleared. |
| Attachment-only submissions | `implemented` | `lazy-session-creation.ts` `allowEmptyText` (used when attachments are selected), backend accepts empty text with attachment ids; test `sends a selected file alone, without text`. | The session title falls back to the default for an attachment-only first send. |
| Explicit queue-or-block while running | `implemented` | Text sent while a turn runs queues as a follow-up instruction (existing queue behavior); a file selected while running makes the send refuse with the localized "files cannot be queued" guard (test in `conversation-panel.attachments.test.tsx`). The picker button is disabled while running, but paste/drop selections still refuse explicitly instead of being dropped. | — |

## E. Message rendering (issue #32 C3) — at `980d899`

- **Streaming-safe CommonMark/GFM subset** — `packages/ui/src/markdown.ts` parses to data, never HTML, never throws on partial input; headings, lists, tables, links, quotes and fenced code are covered by `markdown-view.test.tsx`, including the loop that renders every prefix of a partial streaming document.
- **Fenced code: language label, copy-code, unlabeled fallback** — `CodeBlock` in `packages/ui/src/markdown-view.tsx` shows the language, falls back to the localized `compose.markdown.code` ("Code") when the fence names none, and copies only the source through the clipboard with `Copied`/`Copy failed` states.
- **Bounded long code** — the `<pre>` is a `max-h-[60vh] overflow-auto` scroller: the full text stays in the DOM (copy copies everything) and 1200-line blocks no longer stretch the timeline.
- **Syntax highlighting: `honest-unavailability`** — intentionally not implemented this round; no highlighting dependency was added. Code renders as plain monospace with the language label and copy action. Do not describe highlighted code as delivered.
- The remaining C3 checkboxes (sanitization, copy/stop/retry, reply/edit branching, feedback) were verified in earlier slices; state messages that cannot be rendered are labelled with `unsupportedContent` instead of being dropped.

## F. History UX and acceptance surface (issue #32 C5) — at `980d899`

| Requirement clause | Status | Evidence | Notes |
|---|---|---|---|
| Scroll follows only when near bottom, preserves manual reading, Jump to latest | `implemented` | `conversation-panel.tsx`: `timelineRef` + `handleTimelineScroll` (64 px near-bottom threshold), `scrollToLatest`, `showJumpToLatest`; follow effect depends on message count, last message text and streaming text. Test: `offers jump-to-latest only after the reader scrolls away from the bottom`. | Scroll position resets only while the reader is at the bottom; scrolling up stops the follow. |
| Reliable draft and selected model across session switches, no cross-project cache mixing | `implemented` | Section D rows; `use-drafts.ts` hydrates on session change; model effect re-reads the scoped bucket. | — |
| Long/code-heavy messages usable and bounded | `implemented` | `packages/ui/src/message-card.tsx` body is a `max-h-[70vh] overflow-y-auto` scroller (full text preserved, test in `message-card.test.tsx`); code blocks bounded as in section E. | No truncation and no "show more" hiding content. |
| Rename/pin/archive/search/export/delete | `see section A` | Section A above. | Search is renderer-local and title-only; the other five have no backend behavior and no control, which is the honest status. |
| Four locales including Arabic RTL, code LTR isolation | `implemented` | `apps/desktop/src/shared/i18n/locales/{en,ar,ru,zh-CN}` with coverage tests (`localization-coverage.test.ts`, `language-foundation.test.ts`); code/pre and scroll containers carry `dir="ltr"`; `isRtlText` heuristics tested in `compose.test.tsx`. | New strings for this slice (`attachments.*`, `compose.markdown.code`, `conversation.jumpToLatest`) were added to all four catalogs. |
| Reduced motion | `implemented` | `applyPresentation` writes `data-reduced-motion` on the document element (`apps/desktop/src/shared/settings/preferences-store.ts`); `apps/desktop/src/styles/index.css` now disables animation/transition duration and smooth scrolling for `[data-reduced-motion='reduce']`. | Applies to the whole app, including the timeline transitions. |
| Keyboard navigation and accessible action menus | `implemented` | Message actions, composer controls, menus and the picker are native buttons/inputs; menu keyboard behavior is tested (`packages/ui/src/menu.test.tsx`); attachment removal buttons carry localized `aria-label`s. | — |
| Focused/announced status without reading every streamed token | `implemented` | Status region is `aria-live="polite"` and contains status strings, not the streamed text; `TurnStatus` uses `role="status"` for phase changes; the timeline itself is not a live region. Attachment errors announce through `role="alert"` (chip error) and the send-refusal alert. | Screen readers get phase changes, not every delta. |
| Stable turn/attempt ids, cursor semantics, bounded pagination | `see section C` | Section C above. | Blocked on the P0 identity repair; no claim is made. |

## Verification run at `980d899`

| Command | Result |
|---|---|
| `cargo test --workspace --locked` | exit 0; 96 test binaries reported `test result: ok`, no failures (includes `crates/adham-desktop-api/tests/attachments.rs`). |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | clean. |
| `cargo fmt --all --check` | clean. |
| `npx vitest run` | 77 files, 813 tests passed. |
| `npx tsc --noEmit` | clean. |
| `npx oxlint --deny-warnings apps/desktop/src packages/ui/src` | clean. |
| `npx biome format --write` (changed paths) | no fixes applied. |

**Outstanding operator proof.** One live GUI turn against the local Ollama model with a text file attached has not been captured at this revision (the dev app was not running during verification). The deterministic evidence above covers ingestion, dispatch assembly, refusal paths and renderer behavior; a live screenshot/log remains the operator's acceptance step. The backend's bounded reader is not replaced by the renderer path: dropped paths use the Rust reader (`ingestAttachmentPath`) with the same limits.
