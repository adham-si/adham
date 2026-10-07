# P0-06 Test Matrix & Verification Report

**Date of Execution:** 2026-10-06  
**Suite Status:** 35 passed; 0 failed; 0 ignored (100% Pass Rate)  
**Execution Runtime:** 16.74s  

---

## 1. Domain Types & Identifier Tests (`adham-core-types`)

| Test Name | File | Description | Status |
|---|---|---|---|
| `identifiers::export_bindings_requestid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `RequestId` | **PASSED** |
| `identifiers::export_bindings_correlationid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `CorrelationId` | **PASSED** |
| `identifiers::export_bindings_workspaceid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `WorkspaceId` | **PASSED** |
| `identifiers::export_bindings_actorid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `ActorId` | **PASSED** |
| `identifiers::export_bindings_contentid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `ContentId` | **PASSED** |
| `identifiers::export_bindings_eventid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `EventId` | **PASSED** |
| `identifiers::export_bindings_projectid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `ProjectId` | **PASSED** |
| `identifiers::export_bindings_sessionid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `SessionId` | **PASSED** |
| `identifiers::export_bindings_streamid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `StreamId` | **PASSED** |
| `identifiers::export_bindings_installationid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `InstallationId` | **PASSED** |
| `identifiers::export_bindings_messageid` | `src/identifiers.rs` | Verifies UUIDv7 generation and TS bindings for `MessageId` | **PASSED** |
| `errors::export_bindings_publicerrorcode` | `src/errors.rs` | Verifies error code serialization to TypeScript | **PASSED** |
| `events::export_bindings_actorkind` | `src/events.rs` | Verifies `ActorKind` enum export to TypeScript | **PASSED** |
| `events::export_bindings_eventactor` | `src/events.rs` | Verifies `EventActor` struct export to TypeScript | **PASSED** |
| `events::export_bindings_eventscope` | `src/events.rs` | Verifies `EventScope` struct export to TypeScript | **PASSED** |

---

## 2. Event Log & Cryptographic Chaining Tests (`adham-event-log`)

| Test Name | File | Description | Status |
|---|---|---|---|
| `test_blake3_checksum_chaining` | `tests/store_tests.rs` | Verifies BLAKE3 hash chaining between events; confirms that any payload tampering invalidates checksum | **PASSED** |
| `test_sensitive_content_segregation` | `tests/store_tests.rs` | Verifies that message bodies are stored in `content_records` rather than raw event payloads | **PASSED** |
| `test_event_store_append_and_concurrency` | `tests/store_tests.rs` | Verifies optimistic concurrency control: appending with incorrect `expected_sequence` returns `ConcurrencyConflict` | **PASSED** |

---

## 3. Projection & Deterministic Rebuild Tests (`adham-projections`)

| Test Name | File | Description | Status |
|---|---|---|---|
| `test_conversation_projection_and_deterministic_rebuild` | `tests/projection_tests.rs` | Inserts message events, populates projection, wipes `conversation_messages`, and deterministically replays all canonical events from `events` table with identical state | **PASSED** |

---

## 4. Desktop API DTO & Binding Tests (`adham-desktop-api`)

| Test Name | File | Description | Status |
|---|---|---|---|
| `dtos::export_bindings_commandenvelope` | `src/dtos.rs` | Validates `CommandEnvelope` transport format | **PASSED** |
| `dtos::export_bindings_commandresult` | `src/dtos.rs` | Validates `CommandResult` transport format | **PASSED** |
| `dtos::export_bindings_commandcontext` | `src/dtos.rs` | Validates `CommandContext` transport format | **PASSED** |
| `dtos::export_bindings_bootstrapstate` | `src/dtos.rs` | Validates `BootstrapState` transport format | **PASSED** |
| `dtos::export_bindings_storagestatus` | `src/dtos.rs` | Validates `StorageStatus` transport format | **PASSED** |
| `dtos::export_bindings_createworkspacepayload` | `src/dtos.rs` | Validates `CreateWorkspacePayload` transport format | **PASSED** |
| `dtos::export_bindings_workspacesummary` | `src/dtos.rs` | Validates `WorkspaceSummary` transport format | **PASSED** |
| `dtos::export_bindings_createprojectpayload` | `src/dtos.rs` | Validates `CreateProjectPayload` transport format | **PASSED** |
| `dtos::export_bindings_projectsummary` | `src/dtos.rs` | Validates `ProjectSummary` transport format | **PASSED** |
| `dtos::export_bindings_createsessionpayload` | `src/dtos.rs` | Validates `CreateSessionPayload` transport format | **PASSED** |
| `dtos::export_bindings_sessionsummary` | `src/dtos.rs` | Validates `SessionSummary` transport format | **PASSED** |
| `dtos::export_bindings_submitmessagepayload` | `src/dtos.rs` | Validates `SubmitMessagePayload` transport format | **PASSED** |
| `dtos::export_bindings_submittedmessage` | `src/dtos.rs` | Validates `SubmittedMessage` transport format | **PASSED** |
| `dtos::export_bindings_conversationmessagedto` | `src/dtos.rs` | Validates `ConversationMessageDto` transport format | **PASSED** |
| `dtos::export_bindings_conversationpage` | `src/dtos.rs` | Validates `ConversationPage` transport format | **PASSED** |
| `dtos::export_bindings_rebuildprojectionsresponse` | `src/dtos.rs` | Validates `RebuildProjectionsResponse` transport format | **PASSED** |

---

## 5. Summary Conclusion

All 35 domain, cryptographic, concurrency, and projection tests executed successfully with 0 failures. The backend storage engine strictly complies with P0-01, P0-02, P0-03, and P0-04 contracts.
