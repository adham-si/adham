<aside>
🔌

Adham treats the renderer as an untrusted presentation process. IPC exposes a small versioned application API—not Rust internals, raw events, database access, filesystem paths, shell execution, secrets, or generic service invocation.

</aside>

## Scope

This specification defines:

- Allowed P0 Tauri commands.
- Transport DTOs and versioning.
- Rust-to-TypeScript binding generation.
- Capability and window restrictions.
- Frontend API ownership.
- Validation, limits, timeouts, and idempotency.
- Public errors and redaction.
- Projection-change notifications and TanStack Query synchronization.
- Contract, authorization, and abuse-resistance tests.

It transports the use cases defined by P0-01 — First vertical-slice contract and never bypasses P0-03 — SQLite event store, content & projections.

# 1. Trust model

Assume renderer JavaScript can become compromised through:

- A vulnerable frontend dependency.
- Cross-site scripting.
- A malicious or corrupted plugin surface introduced later.
- Developer-tools misuse.
- A logic bug that calls valid commands with invalid context.

Therefore:

- TypeScript types are developer ergonomics, not authorization.
- Hidden buttons are not access control.
- Every command validates version, shape, scope, relationships, limits, and authority in Rust.
- The renderer never selects the local actor.
- The renderer never supplies database paths, event types, checksums, canonical timestamps, policy decisions, credentials, or SQL.
- A compromised renderer is limited to the same narrow commands available to the visible main window.

# 2. IPC layers

```
React feature
    ↓
feature API function
    ↓
shared/api/adham-client.ts
    ↓
generated transport DTO
    ↓
Tauri invoke
    ↓
thin command adapter
    ↓
application service
    ↓
domain + ports
    ↓
SQLite adapter
```

Business decisions may occur only below the Tauri command adapter.

# 3. Allowed P0 command surface

| Command | Mutation | Required context | Result |
| --- | --- | --- | --- |
| `get_bootstrap_state` | No | Installation | Bootstrap state |
| `create_workspace` | Yes | Installation | Workspace summary |
| `create_project` | Yes | Workspace | Project summary |
| `create_session` | Yes | Workspace + project | Session summary |
| `submit_message` | Yes | Workspace + project + session | Submitted message summary |
| `get_conversation` | No | Workspace + project + session | Paginated conversation |
| `get_storage_status` | No | Installation | Safe readiness/repair state |
| `list_workspaces` | No | Installation | Workspace summaries, creation order, clamped to 100 with `truncated` disclosure |
| `list_projects` | No | Workspace (`CommandContext.workspace_id` required) | Project summaries of one workspace, creation order, clamped to 100 with `truncated` disclosure |
| `select_project` | Yes (scope state only, no event) | Workspace (context) + `SelectProjectPayload.project_id` | Updated bootstrap state; receipt-backed idempotency under its own `select_project` fingerprint domain |

Not exposed:

- `append_event`
- `execute_sql`
- `read_file`
- `write_file`
- `run_command`
- `http_request`
- `get_secret`
- `set_actor`
- `set_database_path`
- `load_raw_events`
- Generic `dispatch`, `call_service`, or `invoke_method`

Any new command requires this document or a later IPC registry to be updated with context, permissions, limits, owner, and tests.

# 4. Transport types

Transport DTOs live in the desktop API crate, not in domain crates:

```
crates/adham-desktop-api/
└── src/
    ├── lib.rs
    ├── envelope.rs
    ├── errors.rs
    ├── bootstrap.rs
    ├── workspace.rs
    ├── project.rs
    ├── session.rs
    └── conversation.rs
```

The first scaffold may temporarily place these modules in `src-tauri` if `adham-desktop-api` would be an unused placeholder. Extract the crate as soon as two adapters or contract-generation ownership require it.

DTO rules:

- Separate from domain entities and SQL rows.
- Derive Serde and `ts-rs::TS`.
- Use camelCase on the wire.
- Use explicit enums rather than free-form status strings.
- Do not expose internal error chains.
- Do not expose raw paths.
- Do not serialize Rust `usize`.
- Encode integer values exceeding JavaScript’s safe range as strings.
- Every top-level request includes a protocol version.

# 5. Command envelope

```rust
pub struct CommandEnvelope<T> {
    pub protocol_version: u16,
    pub request_id: RequestId,
    pub context: TransportContext,
    pub payload: T,
}

pub struct TransportContext {
    pub workspace_id: Option<WorkspaceId>,
    pub project_id: Option<ProjectId>,
    pub session_id: Option<SessionId>,
}
```

Rules:

- P0 protocol version is `1`.
- Unsupported versions fail before application service execution.
- Request IDs are valid UUID strings generated once per user intent.
- An automatic retry reuses the request ID.
- Context IDs are references, not proof of relationship or permission.
- The backend resolves installation and actor identity.
- Empty optional context fields are rejected when the command requires them.

# 6. Command result

```rust
pub struct CommandResult<T> {
    pub protocol_version: u16,
    pub request_id: RequestId,
    pub correlation_id: CorrelationId,
    pub data: T,
}
```

Mutating results identify the committed resource and authoritative state needed by the UI. They do not return raw canonical-event payloads.

Example submitted-message result:

```rust
pub struct SubmitMessageResult {
    pub message_id: MessageId,
    pub session_id: SessionId,
    pub text: String,
    pub created_at: String,
    pub stream_sequence: String,
    pub projection_position: String,
}
```

Sequence and position serialize as decimal strings to avoid JavaScript number precision assumptions.

# 7. Public error envelope

```rust
pub struct ErrorEnvelope {
    pub protocol_version: u16,
    pub code: PublicErrorCode,
    pub message_key: String,
    pub retryable: bool,
    pub correlation_id: CorrelationId,
    pub field_errors: Vec<FieldError>,
    pub retry_after_ms: Option<u32>,
}
```

Use a localization key rather than a backend-authored English sentence as the primary UI message. Optional safe parameters may be added later through a bounded structure.

Initial error codes:

- `INVALID_PROTOCOL_VERSION`
- `INVALID_REQUEST`
- `PAYLOAD_TOO_LARGE`
- `RATE_LIMITED`
- `WORKSPACE_NOT_FOUND`
- `PROJECT_NOT_FOUND`
- `SESSION_NOT_FOUND`
- `CONTEXT_MISMATCH`
- `REQUEST_ID_CONFLICT`
- `CONCURRENCY_CONFLICT`
- `STORAGE_STARTING`
- `STORAGE_UNAVAILABLE`
- `STORAGE_REPAIR_REQUIRED`
- `PROJECTION_UNAVAILABLE`
- `COMMAND_TIMED_OUT`
- `INTERNAL_ERROR`

Never cross IPC:

- SQL errors or query text.
- Rust type names and backtraces.
- Raw OS error strings containing paths.
- Database location.
- Protected content bytes or key references.
- Panic messages.
- Internal retry counts unless intentionally public.

# 8. Thin Tauri command adapters

```rust
#[tauri::command]
pub async fn submit_message(
    state: State<'_, AppServices>,
    request: CommandEnvelope<SubmitMessageRequest>,
) -> Result<CommandResult<SubmitMessageResult>, ErrorEnvelope> {
    state.submit_message.execute(request).await.map_err(map_public_error)
}
```

The adapter may:

- Deserialize transport input.
- Attach trusted window/request context.
- Call one application use case.
- Map typed application errors into public errors.

The adapter may not:

- Open SQL transactions.
- Append events directly.
- Read files.
- Select actors.
- Construct storage paths.
- Apply projections.
- Decide workspace/project ownership.
- Log request payloads.

# 9. Binding generation

Use `ts-rs` for P0.

Generated output:

```
packages/contracts-generated/
├── commands.ts
├── results.ts
├── errors.ts
├── identifiers.ts
└── index.ts
```

Generation command:

```
cargo xtask contracts
```

Required behavior:

1. Collect every public IPC DTO.
2. Generate TypeScript into a temporary directory.
3. Format generated output deterministically.
4. Compare with committed output in check mode.
5. Replace atomically in write mode.
6. Emit a contract manifest containing protocol version and type names.

Generated files:

- Are committed.
- Are never edited manually.
- Are excluded from ordinary file-size limits and formatting rewrites that change generator output.
- Include a generated-file header.
- Fail CI when stale.

Contract CI:

```
cargo xtask contracts --check
```

# 10. Runtime boundary validation

Static generated TypeScript does not validate runtime values.

P0 uses:

- Rust Serde validation for all renderer-to-backend input.
- Bounded Zod schemas for public envelopes and response discriminants at `adham-client.ts`.
- Contract fixtures serialized by Rust and parsed by frontend tests.
- Negative fixtures for malformed IDs, unknown enums, missing fields, unsafe integer shapes, and oversized strings.

Do not duplicate every domain rule in Zod. Rust remains authoritative. Frontend validation detects integration drift and presents safe errors.

A future generator may produce runtime schemas from Schemars output, but it must not be introduced until its dependency and schema fidelity are reviewed.

# 11. Frontend API ownership

Only this module may import Tauri invoke APIs:

```
apps/desktop/src/shared/api/adham-client.ts
```

Recommended public API:

```tsx
export interface AdhamClient {
  getBootstrapState(): Promise<BootstrapState>
  createWorkspace(input: CreateWorkspaceInput): Promise<WorkspaceSummary>
  createProject(input: CreateProjectInput): Promise<ProjectSummary>
  createSession(input: CreateSessionInput): Promise<SessionSummary>
  submitMessage(input: SubmitMessageInput): Promise<SubmittedMessage>
  getConversation(input: GetConversationInput): Promise<ConversationPage>
  getStorageStatus(): Promise<StorageStatus>
}
```

React features receive the interface through an application provider. Tests use a fake implementation; they do not mock Tauri globally throughout the component tree.

No component, hook, route, entity, or feature imports `@tauri-apps/api/core` directly.

Enforce this with Oxlint/import restrictions or a repository-boundary test.

# 12. TanStack Query ownership

Canonical query keys:

```tsx
const queryKeys = {
  bootstrap: ['bootstrap'] as const,
  storageStatus: ['storage-status'] as const,
  workspace: (workspaceId: string) => ['workspace', workspaceId] as const,
  projects: (workspaceId: string) => ['projects', workspaceId] as const,
  conversation: (workspaceId: string, projectId: string, sessionId: string) =>
    ['conversation', workspaceId, projectId, sessionId] as const,
}
```

Rules:

- Query cache is not canonical state.
- IDs are always present in scoped keys.
- Switching projects creates a different key; it never retargets active data.
- Mutations update or invalidate only their exact scope.
- Application restart fetches from the backend again.
- Persisted browser/query cache is disabled for the P0 slice.
- Message text is not written to localStorage or sessionStorage.

# 13. Projection-change notifications

After a transaction commits, the backend may emit a non-authoritative invalidation notification:

```rust
pub struct ProjectionChanged {
    pub protocol_version: u16,
    pub projection: ProjectionName,
    pub workspace_id: WorkspaceId,
    pub project_id: Option<ProjectId>,
    pub session_id: Option<SessionId>,
    pub position: String,
}
```

Notification rules:

- Contains no private content.
- Emitted only after commit.
- Routed only to authorized application windows.
- May be coalesced or dropped.
- Never replaces querying authoritative state.
- Frontend validates the envelope and invalidates the matching TanStack Query key.
- On window focus, resume, or suspected gap, the frontend refetches.

For the single-window first slice, the mutation result provides immediate UI state and the notification proves the future synchronization path.

# 14. Conversation pagination

Do not return unlimited conversation history.

```rust
pub struct GetConversationRequest {
    pub cursor: Option<ConversationCursor>,
    pub limit: Option<u16>,
}

pub struct ConversationPage {
    pub items: Vec<ConversationMessageDto>,
    pub next_cursor: Option<ConversationCursor>,
    pub projection_position: String,
}
```

P0 defaults:

- Default page size: 50.
- Maximum page size: 100.
- Cursor is opaque and backend-issued.
- Cursor encodes no secret and is validated against session scope.
- Results have deterministic order.

# 15. Input and output limits

Initial P0 limits:

| Limit | Value |
| --- | --- |
| Entire command envelope | 128 KiB UTF-8 encoded |
| Message text | 64 KiB UTF-8 and 32,000 Unicode scalar values |
| Workspace/project/session name | 120 Unicode scalar values |
| Field-error count | 32 |
| Safe error-envelope size | 16 KiB |
| Conversation page | 100 messages |
| Single command result | 1 MiB |
| Pending writer queue | 64 commands |
| Local read timeout | 10 seconds |
| Local mutation timeout before commit begins | 10 seconds |

These values are constants owned by the desktop API/application layer and tested at boundaries. They may be tightened after measurements.

Oversized input is rejected before content protection or transaction work.

# 16. Rate limiting and abuse resistance

The main window receives bounded local command capacity.

P0 baseline:

- Mutating commands: token-bucket burst of 20, sustained 10 per second.
- Read commands: burst of 60, sustained 30 per second.
- Writer queue depth: 64.
- Excess commands return `RATE_LIMITED` with bounded retry guidance.

This is protection against renderer bugs or compromise, not user billing.

Rate-limit identity includes window label and installation identity. Changing workspace does not reset it.

# 17. Timeouts and cancellation

P0 commands are short local operations.

- Timeout before transaction begins may cancel queue admission safely.
- Once a mutating transaction begins, the backend completes commit or rollback even if the renderer navigates away.
- The renderer must query the original request ID/receipt before retrying an uncertain result.
- A new request ID is never generated to “fix” an uncertain commit.
- Read commands may be canceled by dropping the request; backend work remains bounded by timeout.
- P0 exposes no generic cancel-command API.

Long-running task cancellation belongs to the runtime state-machine specification, not this local command protocol.

# 18. Window and capability policy

P0 has one trusted application window label:

```
main
```

Rules:

- Only bundled application origins may invoke commands.
- Tauri isolation pattern is enabled if compatible with the final frontend setup; Tauri recommends it to protect core IPC from unwanted frontend calls.[[1]](https://v2.tauri.app/concept/inter-process-communication/isolation/)
- Capabilities begin with the minimum required core permissions.
- No filesystem, shell, HTTP, dialog, clipboard, global shortcut, updater, notification, or process plugin permission is granted for the first vertical slice unless the slice explicitly requires and documents it.
- Development-only capabilities do not ship in production configuration.
- Future secondary windows receive separate labels and command/capability sets.
- Custom plugin or remote content never shares the main window’s IPC authority.

The command registry and capability files are reviewed together. A command must not exist merely because no visible UI calls it.

# 19. CSP and origin rules

Production renderer policy:

- `default-src 'self'`.
- No remote scripts.
- No arbitrary remote frames.
- Images limited to required local/data/blob sources.
- Network origins absent during the first slice.
- Style policy is the narrowest configuration that the compiled Tailwind application proves it needs.
- Development-server exceptions exist only in development configuration.

Tauri modifies bundled CSP with required nonces/hashes, and its documentation recommends tailoring policies to the application’s trusted origins.[[2]](https://v2.tauri.app/security/csp)

CI inspects built HTML/configuration for unexpected origins and forbidden production relaxations.

# 20. Logging and tracing

One correlation ID follows:

```
frontend intent
→ IPC adapter
→ application service
→ transaction
→ projection notification
→ public result
```

Allowed fields:

- Command name.
- Protocol version.
- Request/correlation IDs.
- Scope IDs when diagnostic policy permits.
- Duration.
- Outcome code.
- Payload-size bucket.
- Queue time.

Forbidden:

- Message text.
- Workspace/project/session names.
- Full request/result JSON.
- Database path.
- Protected content.
- Tauri window URL when it may contain private state.

Frontend production logging follows the same policy and does not log mutation objects.

# 21. Error mapping

Each application error maps exactly once in the Tauri adapter layer.

Examples:

| Internal error | Public code | Retryable |
| --- | --- | --- |
| Invalid DTO | `INVALID_REQUEST` | No |
| Missing project | `PROJECT_NOT_FOUND` | No |
| Scope mismatch | `CONTEXT_MISMATCH` | No |
| Same request, different fingerprint | `REQUEST_ID_CONFLICT` | No |
| Expected sequence mismatch | `CONCURRENCY_CONFLICT` | Yes after refetch |
| Writer queue full | `RATE_LIMITED` | Yes |
| Storage not ready | `STORAGE_STARTING` | Yes |
| Integrity failure | `STORAGE_REPAIR_REQUIRED` | No automatic retry |
| Unexpected internal error | `INTERNAL_ERROR` | No blind retry |

`anyhow` and SQLx errors terminate at the composition/adapter boundary and are never serialized directly.

# 22. Required tests

## Contract generation

- Every command input/result/error type is exported.
- Generated TypeScript is deterministic.
- CI detects stale generated files.
- Rust fixtures parse through frontend runtime validators.
- Invalid fixtures fail with controlled errors.

## Authorization and context

- Missing required context rejected.
- Workspace/project/session mismatch rejected.
- Renderer-supplied actor field rejected as unknown input.
- Unknown command not registered.
- Secondary/untrusted window cannot invoke main commands.

## Limits

- Exact boundary accepted.
- One byte/scalar over rejected.
- Oversized envelope rejected before storage.
- Excess page size clamped or rejected according to contract.
- Rate limits and queue bounds enforced.

## Idempotency and uncertain results

- Retry with same request returns original result.
- Changed payload conflicts.
- Simulated lost response followed by retry does not duplicate event.
- Timeout before queue admission performs no mutation.
- Renderer closes during transaction; backend commits or rolls back atomically.

## Frontend synchronization

- Mutation updates exact conversation key.
- Notification invalidates only matching scope.
- Wrong-project notification cannot invalidate or merge another project’s data.
- Dropped notification is repaired by focus/refetch.
- Restart fetches authoritative projection.

## Redaction

- Public errors contain no paths or SQL.
- Logs contain no message text.
- Notifications contain no private content.
- Production bundle contains no development IPC endpoint or remote origin.

# 23. Acceptance gate

P0-04 is implementation-ready when:

- Command allowlist and contexts are accepted.
- DTO ownership and `ts-rs` generation are accepted.
- Runtime boundary-validation strategy is accepted.
- Error codes and localization behavior are accepted.
- Initial size, queue, rate, and timeout limits are accepted.
- Query-key and notification synchronization is accepted.
- Window/capability and CSP baselines are accepted.
- All required contract, scope, idempotency, redaction, and synchronization tests are implementable without unresolved semantics.

The next artifact is P0-05: project-isolation threat model covering renderer compromise, path boundaries, local data, credentials, IPC, symlinks/junctions, future providers, tools, plugins, diagnostics, and recovery.