<aside>
🧱

This contract defines the smallest trustworthy Adham vertical slice: create local identities, submit one message through a domain command, persist canonical events, rebuild a projection, restart, and display the same state.

</aside>

## Scope

Included:

- One local installation actor with no sign-in.
- One personal workspace.
- One project using Adham-owned isolated storage; no user-folder access yet.
- One session.
- One submitted text message.
- SQLite event persistence.
- Conversation projection.
- Typed Tauri IPC.
- Restart and deterministic replay.

Explicitly excluded:

- Model providers and responses.
- Agent loop.
- File access.
- Terminal or sandbox.
- Network access.
- Memory and vector storage.
- Skills, MCP, and plugins.
- Collaboration.
- Cloud synchronization.

# 1. Identity ownership

| Identity | Created by | Trusted source |
| --- | --- | --- |
| `InstallationId` | Backend on first successful initialization | Local installation record |
| `ActorId` | Backend | Local user associated with installation |
| `WorkspaceId` | Backend after `CreateWorkspace` | Workspace event stream |
| `ProjectId` | Backend after `CreateProject` | Project event stream |
| `SessionId` | Backend after `CreateSession` | Session event stream |
| `MessageId` | Backend after accepted `SubmitMessage` | Session event stream |
| `RequestId` | Frontend once per user intent | IPC command envelope |
| `CorrelationId` | Backend or accepted request context | Logs and error envelope |

The frontend may reference workspace, project, and session IDs returned by the backend. It may not invent an actor, event ID, event type, sequence, timestamp, or checksum.

A retried user action must reuse the original `RequestId`. A genuinely new action receives a new one.

# 2. Transport envelope

```rust
pub struct CommandEnvelope<T> {
    pub version: u16,
    pub request_id: RequestId,
    pub context: CommandContext,
    pub payload: T,
}

pub struct CommandContext {
    pub workspace_id: Option<WorkspaceId>,
    pub project_id: Option<ProjectId>,
    pub session_id: Option<SessionId>,
}
```

The actor is resolved from the trusted local installation. It is not accepted from the renderer in P0.

Every command result includes:

```rust
pub struct CommandResult<T> {
    pub request_id: RequestId,
    pub correlation_id: CorrelationId,
    pub data: T,
}
```

Errors use:

```rust
pub struct ErrorEnvelope {
    pub code: ErrorCode,
    pub message: String,
    pub retryable: bool,
    pub correlation_id: CorrelationId,
    pub field_errors: Vec<FieldError>,
}
```

Messages are safe for the renderer. SQL text, local paths, stack traces, secrets, and internal event payloads are excluded.

# 3. Commands

## `get_bootstrap_state`

Returns whether the installation is initialized and lists the local workspaces/projects needed to resume onboarding.

It performs no mutation.

## `create_workspace`

Payload:

```rust
pub struct CreateWorkspace {
    pub name: WorkspaceName,
    pub kind: WorkspaceKind,
    pub preferred_language: LanguageCode,
}
```

P0 accepts only `WorkspaceKind::Personal`.

Produces:

- `workspace/created`

Returns:

- Workspace ID.
- Name.
- Kind.
- Preferred language.
- Creation timestamp.

## `create_project`

Requires a valid workspace context.

Payload:

```rust
pub struct CreateProject {
    pub name: ProjectName,
    pub storage_kind: ProjectStorageKind,
}
```

P0 accepts only `ProjectStorageKind::AdhamOwnedIsolated`. It does not accept an arbitrary filesystem path.

Produces:

- `project/created`

Returns the project identity and workspace relationship.

## `create_session`

Requires valid workspace and project context.

Payload:

```rust
pub struct CreateSession {
    pub title: Option<SessionTitle>,
}
```

Produces:

- `session/created`

The backend verifies that the project belongs to the workspace.

## `submit_message`

Requires valid workspace, project, and session context.

Payload:

```rust
pub struct SubmitMessage {
    pub text: MessageText,
}
```

Validation:

- Text is not empty after normalization.
- Text stays below the P0 byte and character limits.
- Session belongs to the project.
- Project belongs to the workspace.
- Request ID has not produced a conflicting command.

Produces:

- `user/message-submitted`

Returns:

- Message ID.
- Session ID.
- Canonical timestamp.
- Accepted text.
- Resulting stream sequence.

## `get_conversation`

Requires valid workspace, project, and session context.

Returns the rebuildable conversation projection. It does not expose raw event-store rows.

# 4. Initial canonical events

## Event envelope

The authoritative envelope, scope, actor, checksum, and compatibility rules are defined in P0-02 — Canonical event taxonomy & schema. Event type and event version are stored separately.

```rust
pub struct EventEnvelope<P> {
    pub event_id: EventId,
    pub event_type: EventType,
    pub event_version: u16,
    pub stream_id: StreamId,
    pub stream_sequence: u64,
    pub request_id: RequestId,
    pub correlation_id: CorrelationId,
    pub causation_id: Option<EventId>,
    pub actor_id: ActorId,
    pub occurred_at: OffsetDateTime,
    pub payload: P,
    pub checksum: EventChecksum,
}
```

Initial event types:

- `workspace/created`
- `project/created`
- `session/created`
- `user/message-submitted`

Event names and versions are backend-owned constants. Renderer input never supplies them.

# 5. Stream model

Use separate streams:

```
workspace:{WorkspaceId}
project:{ProjectId}
session:{SessionId}
```

Sequence numbers are monotonic and contiguous per stream, beginning at 1.

Appending requires an expected stream version. A mismatch returns a concurrency conflict and does not partially write an event.

The request ID is unique for the command’s idempotency scope. Replaying the same request with the same normalized payload returns the original successful result. Reusing it with a different command or payload returns `REQUEST_ID_CONFLICT`.

# 6. Conversation projection

The P0 conversation projection contains:

```rust
pub struct ConversationProjection {
    pub workspace_id: WorkspaceId,
    pub project_id: ProjectId,
    pub session_id: SessionId,
    pub title: Option<SessionTitle>,
    pub messages: Vec<ConversationMessage>,
    pub last_applied_sequence: u64,
}

pub struct ConversationMessage {
    pub message_id: MessageId,
    pub role: ConversationRole,
    pub text: String,
    pub created_at: OffsetDateTime,
    pub source_event_id: EventId,
}
```

P0 supports only `ConversationRole::User`.

Projection invariants:

- It can be deleted and rebuilt from canonical structural events plus the authorized content store.
- Missing or deleted message content renders a tombstone without changing canonical event order.
- Applying an event twice does not duplicate a message.
- Events are applied in stream-sequence order.
- Unknown future event versions stop the affected projection and return a diagnostic state; they are not guessed or discarded silently.

# 7. Error codes

Minimum stable codes:

- `INVALID_COMMAND_VERSION`
- `VALIDATION_FAILED`
- `WORKSPACE_NOT_FOUND`
- `PROJECT_NOT_FOUND`
- `SESSION_NOT_FOUND`
- `CONTEXT_MISMATCH`
- `REQUEST_ID_CONFLICT`
- `CONCURRENCY_CONFLICT`
- `STORAGE_UNAVAILABLE`
- `STORAGE_CORRUPTED`
- `PROJECTION_UNAVAILABLE`
- `INTERNAL_ERROR`

Only the documented public code and safe message cross IPC.

# 8. Required scenarios

## Create and display

**Given** a new Adham installation with no workspace

**When** the user creates a personal workspace, isolated project, session, and submits “Hello Adham”

**Then** four domain events exist in their proper streams and the conversation projection displays one user message.

## Restart and replay

**Given** the successful create-and-display scenario

**When** Adham terminates and restarts

**Then** the database reopens, migrations and health checks pass, the projection is loaded or rebuilt, and the same message appears with the same identity and timestamp.

## Projection rebuild

**Given** valid canonical events and an absent conversation projection

**When** projection rebuild runs

**Then** it deterministically creates the same conversation view without changing canonical events.

## Duplicate request

**Given** a successful `SubmitMessage` request

**When** the identical request ID and payload are retried

**Then** the original result is returned and no second event or message is created.

## Conflicting request reuse

**Given** a successful request ID

**When** that ID is reused with different text

**Then** the backend returns `REQUEST_ID_CONFLICT` and appends nothing.

## Malformed request

**Given** an empty message or unsupported command version

**When** it reaches IPC

**Then** validation returns the appropriate public error with no event written.

## Wrong-project request

**Given** a session belonging to Project A

**When** the renderer submits it under Project B’s context

**Then** the backend returns `CONTEXT_MISMATCH`, appends nothing, and records a redacted security diagnostic.

## Interrupted transaction

**Given** a fault injected before transaction commit

**When** the process stops and restarts

**Then** neither a partial event nor a partial idempotency result is visible.

# 9. Security invariants

- The renderer cannot append raw events.
- The renderer cannot select the local actor.
- The slice exposes no filesystem, shell, HTTP, credential, plugin, MCP, or provider command.
- Project storage is Adham-owned and resolved by the trusted platform adapter.
- Logs contain IDs and error codes, not message text by default.
- The database path is never accepted from IPC.
- Message content is stored separately from the canonical structural event.
- All writes use a transaction covering content, event, idempotency record, and required projection checkpoint changes.
- Canonical events are immutable after commit.

# 10. Acceptance gate

The slice is complete only when:

- All commands use generated TypeScript transport DTOs.
- Strict TypeScript and runtime boundary validation pass.
- Workspace/project/session relationships are enforced in Rust.
- Event append and idempotency are atomic.
- Restart preserves identity and message state.
- Projection delete/rebuild produces identical output.
- Wrong-project and malformed requests produce no mutation.
- Formatting, linting, type checking, Rust tests, frontend tests, audit, and dependency-policy checks pass.
- The application launches in the real Tauri window on Windows.
- The agent reports commands, evidence, skipped checks, and unresolved warnings without claiming success for a failed gate.