<aside>
🗄️

P0 storage uses SQLite as a local durable journal: immutable structural events, separately protected private content, atomic idempotency receipts, and rebuildable projections. A committed command is either completely visible or not visible at all.

</aside>

## Scope

This specification defines:

- Database ownership and location.
- Connection and WAL policy.
- Event, content, receipt, and projection tables.
- Transaction boundaries.
- Idempotency and concurrency behavior.
- Projection application and rebuilding.
- Migrations and compatibility.
- Startup health checks.
- Backup, restore, corruption, and recovery.
- Storage privacy and redaction.

It implements the persistence requirements of P0-02 — Canonical event taxonomy & schema.

# 1. Ownership and dependency boundaries

## Domain and application layers

The event-log domain owns:

- Event envelopes.
- Stream identity and expected-sequence rules.
- Append intent.
- Replay semantics.
- Corruption and concurrency errors.

The application layer owns:

- Command idempotency workflow.
- Scope and aggregate validation.
- Atomic content/event/receipt/projection orchestration.

Neither layer imports SQLx, Tauri, Windows APIs, or path libraries.

## Ports

```rust
pub trait EventStore {
    async fn append(&self, request: AppendRequest) -> Result<AppendResult, StoreError>;
    async fn load_stream(&self, stream: &StreamId) -> Result<Vec<StoredEvent>, StoreError>;
    async fn read_global(&self, after: GlobalPosition, limit: u32) -> Result<Vec<StoredEvent>, StoreError>;
}

pub trait ContentStore {
    async fn put(&self, content: ProtectedContent) -> Result<ContentRecord, StoreError>;
    async fn get(&self, id: ContentId) -> Result<Option<ProtectedContent>, StoreError>;
    async fn erase(&self, id: ContentId) -> Result<EraseOutcome, StoreError>;
}

pub trait ProjectionStore {
    async fn apply(&self, event: &StoredEvent) -> Result<(), ProjectionError>;
    async fn checkpoint(&self, projection: ProjectionId) -> Result<ProjectionCheckpoint, StoreError>;
}
```

The SQLx/SQLite implementation lives under an adapter module. Tauri receives only application services, never a raw database pool.

# 2. Database path

The trusted composition root resolves the application-local data directory through Tauri’s path resolver. The database adapter receives an already authorized path.

Conceptual layout:

```
<ADHAM_LOCAL_DATA>/
├── data/
│   ├── adham.db
│   ├── adham.db-wal
│   └── adham.db-shm
├── backups/
├── staging/
└── diagnostics/
```

Rules:

- The renderer cannot provide or read the database path.
- The event-log crate does not construct OS paths.
- Parent directories are created with user-only permissions where the platform supports it.
- Symlinks, junctions, unexpected ownership, and path replacement are checked by the platform adapter.
- The database never lives inside a user project folder.
- Temporary and backup files remain under approved Adham-owned storage.

# 3. Connection architecture

Use two logical access paths:

## Writer

A single writer service serializes mutating commands. It owns one SQLx writer connection or a pool constrained to one active writer.

Benefits:

- Predictable SQLite write behavior.
- Clear command ordering.
- Fewer `SQLITE_BUSY` races.
- One location for transactions, retries, and metrics.

## Readers

A small read pool serves projections and diagnostics. Read queries never mutate state or execute PRAGMAs that change persistence configuration.

Business code never receives a reader or writer connection directly.

# 4. SQLite connection policy

Configure and verify:

```
journal_mode = WAL
synchronous = FULL
foreign_keys = ON
busy_timeout = 5000 ms
trusted_schema = OFF
```

Optional values such as cache size, mmap size, auto-checkpoint interval, and journal size limit require measurement before tuning.

Why:

- WAL allows readers to continue while the writer appends and persists across reopened connections.[[1]](https://sqlite.org/wal.html)
- `synchronous=FULL` prioritizes committed-task durability for P0. It may be changed only through an ADR supported by benchmarks and crash tests.
- Foreign keys are enabled on every connection.
- Busy timeout handles brief lock contention but does not replace serialized writes.
- Trusted schema is disabled where the selected SQLite build supports it.

At startup, execute and verify the effective values. A requested WAL mode that returns another mode is a failed health check, not a silent downgrade. SQLx exposes SQLite journal configuration through `SqliteConnectOptions`.[[2]](https://docs.rs/sqlx/latest/sqlx/sqlite/struct.SqliteConnectOptions.html)

# 5. Physical schema

The following SQL is conceptual. P0-03 implementation migrations own exact syntax, constraints, and SQLite-version compatibility.

## `events`

```sql
CREATE TABLE events (
    global_position    INTEGER PRIMARY KEY,
    event_id           TEXT NOT NULL UNIQUE,
    event_type         TEXT NOT NULL,
    event_version      INTEGER NOT NULL CHECK (event_version > 0),

    stream_id          TEXT NOT NULL,
    stream_kind        TEXT NOT NULL,
    stream_sequence    INTEGER NOT NULL CHECK (stream_sequence > 0),

    installation_id    TEXT NOT NULL,
    workspace_id       TEXT,
    project_id         TEXT,
    session_id         TEXT,

    actor_id            TEXT NOT NULL,
    actor_kind          TEXT NOT NULL,
    request_id          TEXT NOT NULL,
    correlation_id      TEXT NOT NULL,
    causation_id        TEXT,

    occurred_at_us      INTEGER NOT NULL,
    recorded_at_us      INTEGER NOT NULL,

    payload_json        BLOB NOT NULL,
    metadata_json       BLOB NOT NULL,
    previous_checksum   BLOB,
    checksum            BLOB NOT NULL,

    UNIQUE (stream_id, stream_sequence),
    UNIQUE (stream_id, checksum)
);
```

`global_position` is database-assigned. Do not accept it from application code.

Required indexes:

```sql
CREATE INDEX events_stream_order
    ON events (stream_id, stream_sequence);
CREATE INDEX events_global_order
    ON events (global_position);
CREATE INDEX events_scope_workspace
    ON events (workspace_id, global_position);
CREATE INDEX events_scope_project
    ON events (project_id, global_position);
CREATE INDEX events_scope_session
    ON events (session_id, stream_sequence);
CREATE INDEX events_correlation
    ON events (correlation_id, global_position);
```

Do not add speculative indexes. Verify each index with real query plans.

## `streams`

```sql
CREATE TABLE streams (
    stream_id          TEXT PRIMARY KEY,
    stream_kind        TEXT NOT NULL,
    current_sequence   INTEGER NOT NULL,
    last_checksum      BLOB,
    last_event_id      TEXT,
    updated_at_us      INTEGER NOT NULL
);
```

This row provides optimistic concurrency and the prior checksum without scanning the event table. It is updated in the same append transaction.

## `command_receipts`

```sql
CREATE TABLE command_receipts (
    request_id          TEXT PRIMARY KEY,
    command_type        TEXT NOT NULL,
    command_version     INTEGER NOT NULL,
    scope_fingerprint   BLOB NOT NULL,
    request_fingerprint BLOB NOT NULL,
    correlation_id      TEXT NOT NULL,
    outcome_code        TEXT NOT NULL,
    response_json       BLOB NOT NULL,
    first_global_position INTEGER,
    last_global_position  INTEGER,
    committed_at_us     INTEGER NOT NULL
);
```

Only successfully committed command outcomes are required in P0. Validation failures before mutation are not persisted as receipts.

The stored response is a safe transport result, not an internal object, SQL error, path, or secret.

## `content_records`

```sql
CREATE TABLE content_records (
    content_id          TEXT PRIMARY KEY,
    content_kind        TEXT NOT NULL,
    media_type          TEXT NOT NULL,
    encoding            TEXT NOT NULL,
    protection_scheme   TEXT NOT NULL,
    key_reference       TEXT,
    nonce               BLOB,
    protected_bytes     BLOB NOT NULL,
    plaintext_size      INTEGER NOT NULL,
    created_at_us       INTEGER NOT NULL
);
```

The event references `content_id`; it does not store message text.

No table contains plaintext content when the selected protection scheme supports application-level encryption. The exact key-provider and encryption algorithm are approved in P0-05 before public data is stored.

## `content_tombstones`

```sql
CREATE TABLE content_tombstones (
    content_id          TEXT PRIMARY KEY,
    erased_at_us        INTEGER NOT NULL,
    reason_code         TEXT NOT NULL
);
```

Erasure removes protected content and creates a non-sensitive tombstone in one transaction. Projections render a deleted-content state.

## `projection_checkpoints`

```sql
CREATE TABLE projection_checkpoints (
    projection_name       TEXT PRIMARY KEY,
    projection_version    INTEGER NOT NULL,
    last_global_position  INTEGER NOT NULL,
    status                TEXT NOT NULL,
    error_code            TEXT,
    updated_at_us         INTEGER NOT NULL
);
```

## `conversation_messages`

```sql
CREATE TABLE conversation_messages (
    message_id            TEXT PRIMARY KEY,
    workspace_id          TEXT NOT NULL,
    project_id            TEXT NOT NULL,
    session_id            TEXT NOT NULL,
    role                  TEXT NOT NULL,
    content_id            TEXT NOT NULL,
    source_event_id       TEXT NOT NULL UNIQUE,
    source_global_position INTEGER NOT NULL,
    created_at_us         INTEGER NOT NULL
);
```

The projection stores content references, not duplicated plaintext.

# 6. Time representation

Persist timestamps as signed 64-bit UTC microseconds since Unix epoch.

Reasons:

- Stable ordering and comparison.
- No timezone ambiguity.
- No locale-sensitive parsing.
- Safe range for the product’s expected lifetime.

IPC renders RFC 3339 UTC strings. All date conversion is tested. Nanosecond precision is unnecessary for P0.

# 7. Append transaction

For `SubmitMessage`, the application service follows this exact sequence.

## Before transaction

1. Decode and validate the typed command.
2. Resolve trusted local actor.
3. Normalize text.
4. Compute request and scope fingerprints.
5. Produce protected content bytes through the content-protection port.

No canonical state decision is finalized outside the transaction.

## Inside `BEGIN IMMEDIATE`

1. Look up `command_receipts.request_id`.
2. If found:
    - Matching command, scope, and fingerprint → return stored response.
    - Anything differs → return `REQUEST_ID_CONFLICT`.
3. Verify workspace/project/session relationships from canonical/projection state.
4. Load or create the target stream row.
5. Compare its sequence with the expected sequence.
6. Insert the content record.
7. Build canonical payload and metadata.
8. Compute event checksum from the previous checksum and canonical framed bytes.
9. Insert the event.
10. Update the stream sequence/checksum.
11. Apply the synchronous conversation projection.
12. Advance the projection checkpoint.
13. Insert the safe command receipt and result.
14. Commit.

## After commit

- Return the committed result.
- Publish a non-authoritative in-process notification for UI cache invalidation.
- Emit redacted metrics/logs.

If any step fails, rollback removes all writes. There is no event without content, receipt without event, or projection ahead of canonical history.

# 8. Idempotency

## Fingerprints

Create separate BLAKE3 fingerprints for:

- Normalized command type/version/payload.
- Immutable scope context.

Use versioned length-prefixed framing. Do not hash ad hoc concatenated strings.

## Retry behavior

| Receipt state | Behavior |
| --- | --- |
| No receipt | Execute command |
| Matching receipt | Return stored result; append nothing |
| Same request, different payload | `REQUEST_ID_CONFLICT` |
| Same request, different scope | `REQUEST_ID_CONFLICT` and security diagnostic |
| Previous transaction rolled back | No receipt exists; retry may execute |

P0 does not keep an externally visible “in progress” receipt because the single local writer holds the transaction. Later long-running tasks require a separate durable task-command protocol.

# 9. Concurrency and retries

- Mutating commands enter a bounded writer queue.
- Queue admission has a timeout and cancellation behavior.
- Database busy retries are bounded, jittered, and limited to errors proven transient.
- Domain concurrency conflicts are not retried automatically by the adapter.
- The application service may reload and retry only when the command semantics explicitly permit it.
- A retry never changes request ID.
- Projection reads use a consistent committed snapshot.

Never retry an unknown commit outcome by generating a new request ID. First query the original receipt.

# 10. Projection application

The initial conversation projection is synchronous and updated in the same transaction as the event.

Projection handler contract:

```rust
pub trait Projector<E> {
    const NAME: &'static str;
    const VERSION: u32;

    async fn apply(&self, tx: &mut Transaction<'_>, event: &E)
        -> Result<(), ProjectionError>;
}
```

Rules:

- Applying the same source event twice is a no-op through a unique source-event constraint.
- Projection handlers cannot append canonical events.
- Projection handlers cannot make network calls.
- Projection handlers cannot read secrets.
- Projection failures rollback the command in the initial slice.
- Projection tables contain references to private content, not copies.

Later heavy projections may become asynchronous, but only after read-after-write semantics and failure states are specified.

# 11. Projection rebuild

## Trigger conditions

- Projection table missing or intentionally cleared.
- Projection version changed.
- Checkpoint invalid.
- User invokes repair.
- Startup detects projection inconsistency.

## P0 rebuild algorithm

1. Acquire the projection maintenance lock.
2. Mark projection status `rebuilding`.
3. Start a transaction.
4. Clear only the target projection tables.
5. Replay canonical events from global position 1 in bounded batches.
6. Verify checksums and decode exact versions.
7. Apply supported events in global order.
8. Set checkpoint to the final applied position and current projection version.
9. Mark status `ready`.
10. Commit.

For larger future databases, replace in-place rebuild with shadow tables and atomic swap. Do not optimize before measurements justify it.

A missing content record creates a tombstone view; it does not corrupt the structural event stream.

# 12. Startup sequence

The storage service starts before IPC commands are registered as ready.

1. Resolve and validate app-local data path.
2. Open writer connection with required options.
3. Apply safe PRAGMAs.
4. Verify effective journal, foreign-key, and synchronous settings.
5. Run embedded migrations.
6. Run `PRAGMA quick_check` according to startup policy.
7. Verify schema version.
8. Verify the latest event and checksum chain boundary for each active stream, with deeper verification scheduled or user-invoked.
9. Validate projection checkpoints.
10. Rebuild stale projections if safe.
11. Expose readiness state.

States visible to the UI:

- `starting`
- `ready`
- `repair-required`
- `read-only-recovery`
- `unavailable`

The UI never receives a raw database error.

# 13. Migrations

Use embedded SQLx migrations stored with the SQLite adapter. SQLx supports embedding migrations in the binary.[[3]](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html)

Rules:

- Migration numbers are monotonic and never reused.
- Released migrations are immutable.
- Every migration has an upgrade test from the previous supported schema.
- Destructive migrations require backup, explicit compatibility strategy, and an ADR.
- Migrations modify physical storage, not historical event meaning.
- Event upcasting remains separate from database migration.
- Downgrade is not assumed safe; older application versions detect a newer schema and refuse mutation.
- Migration failure opens recovery mode and preserves the original database.

# 14. Content protection

The schema supports envelope protection from the first migration.

```rust
pub trait ContentProtector {
    async fn protect(&self, plaintext: &[u8], context: ProtectionContext)
        -> Result<ProtectedContent, ProtectionError>;
    async fn reveal(&self, protected: &ProtectedContent, context: ProtectionContext)
        -> Result<SecretBytes, ProtectionError>;
}
```

Requirements before public alpha:

- Authenticated encryption using a reviewed library.
- Master or wrapping key stored through the operating-system credential facility.
- Unique nonce/key material according to the chosen algorithm.
- Workspace/project/content identity bound as associated data.
- Plaintext zeroized where practical.
- Keys and plaintext excluded from logs, panics, diagnostics, and frontend state.
- Locked or unavailable vault produces an explicit recoverable state.

Development mode may use a clearly marked temporary protector only with disposable fixtures. It may not silently store real message content as plaintext.

# 15. Erasure behavior

Content erasure transaction:

1. Validate scope and deletion policy.
2. Delete the protected content record or its unique wrapped key.
3. Insert content tombstone.
4. Update affected projections to a tombstone state.
5. Append the future structural erasure event when that event contract is introduced.
6. Commit.

P0-03 does not promise forensic erasure from storage media or old backups. Before exposing “permanent delete,” the product must define WAL checkpointing, encrypted backups, retention, and key-destruction guarantees honestly.

# 16. Backup

Never copy an active `adham.db` file alone while WAL mode is enabled. An active database may depend on its WAL file.[[1]](https://sqlite.org/wal.html)

Use SQLite’s online backup mechanism or an equivalent consistent snapshot procedure.

Backup flow:

1. Create backup in Adham-owned staging.
2. Snapshot a consistent committed database.
3. Run integrity verification on the snapshot.
4. Write manifest containing application version, schema version, final global position, timestamp, and snapshot checksum.
5. Fsync where supported.
6. Atomically move into the backup directory.
7. Apply retention policy.

Backups containing protected content remain sensitive. Export outside Adham-owned storage requires explicit user action and future encrypted-export design.

# 17. Restore

Restore never overwrites the active database in place.

1. Stop new writers.
2. Validate manifest and snapshot checksum.
3. Open candidate read-only.
4. Run integrity check and schema compatibility check.
5. Verify event checksums and registry compatibility.
6. Migrate a copy if required.
7. Move current database to recoverable quarantine.
8. Atomically activate restored database.
9. Reopen and rebuild projections.
10. Preserve an audit record outside the restored event history.

Any failure leaves the current database untouched.

# 18. Corruption and recovery

Signals:

- SQLite integrity failure.
- Checksum mismatch.
- Missing sequence.
- Stream row inconsistent with latest event.
- Projection checkpoint ahead of event log.
- Unsupported schema or event version.

Behavior:

- Stop mutations.
- Enter `read-only-recovery` when safe reads are possible.
- Identify affected database, stream, and sequence without exposing content.
- Never “repair” by deleting events automatically.
- Offer restore, export diagnostics, projection rebuild, or explicit expert repair depending on failure class.
- Copy the original database to quarantine before approved repair.

Projection corruption can be repaired from events. Canonical-event corruption requires restore or a separately specified forensic repair flow.

# 19. Limits

Initial limits are configuration constants with tests, not magic values scattered through code.

Define before implementation:

- Maximum command payload bytes.
- Maximum message text bytes and characters.
- Maximum events returned per replay batch.
- Maximum writer queue depth.
- Busy timeout and retry count.
- Maximum safe response-receipt bytes.
- Projection rebuild batch size.
- Backup count and size policy.

Limit errors are public validation errors and produce no mutation.

# 20. Observability

Allowed storage telemetry/log fields:

- Operation name.
- Duration.
- Row/event count.
- Global position and stream sequence.
- Public error code.
- SQLite result category.
- Database-size bucket.
- WAL-size bucket.
- Projection lag.

Forbidden by default:

- SQL query parameters containing content.
- Payload JSON.
- Protected bytes, nonce, or key reference.
- Message text.
- Workspace/project/session names.
- Raw database path.

# 21. Required tests

## Transactions

- Fault before content insert.
- Fault after content insert.
- Fault after event insert.
- Fault after stream update.
- Fault after projection update.
- Fault before receipt insert.
- Fault immediately before commit.

Every case leaves either the complete prior state or complete new state—never a partial command.

## Idempotency

- Identical retry returns original response.
- Same ID with changed payload conflicts.
- Same ID with changed scope conflicts.
- Rolled-back attempt can safely retry.
- Restart preserves receipt behavior.

## Concurrency

- Two writers with the same expected sequence permit one commit.
- Reader sees only committed projection state.
- Busy retry remains bounded.
- Queue cancellation does not execute a command later.

## Replay and projections

- Delete and rebuild conversation projection.
- Apply event twice.
- Missing content renders tombstone.
- Unknown event version blocks at previous checkpoint.
- Corrupted checksum prevents advancement.

## Migrations

- Empty database to current.
- Previous supported schema to current.
- Interrupted migration preserves recoverable original.
- Newer schema opened by older app refuses mutation.

## Storage health

- WAL mode verified.
- Foreign keys enforced.
- Busy timeout active.
- Invalid path rejected.
- Read-only filesystem returns safe error.
- Disk-full simulation rolls back command.

## Backup and restore

- Backup while reads/writes occur produces a consistent snapshot.
- Corrupted backup rejected.
- Incompatible schema rejected.
- Restore failure leaves active DB unchanged.
- Restore rebuilds projections.

# 22. Acceptance gate

P0-03 is implementation-ready when:

- Ports and adapter boundaries are accepted.
- Writer/read architecture is accepted.
- Physical schema and indexes are reviewed.
- Timestamp representation is fixed.
- Transaction algorithm is accepted.
- Idempotency fingerprints and receipt behavior are accepted.
- Projection atomicity and rebuild behavior are accepted.
- Content-protection requirement and development limitation are accepted.
- Backup/restore and corruption behavior are accepted.
- Limits have owners and initial values before coding.
- The required fault-injection tests can be implemented deterministically.

The next artifact is P0-04: typed IPC, command capabilities, generated bindings, transport limits, redaction, and frontend cache/event behavior.