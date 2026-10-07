-- Canonical SQLite schema for Adham P0
-- Events table: append-only structural facts
CREATE TABLE IF NOT EXISTS events (
    global_position    INTEGER PRIMARY KEY AUTOINCREMENT,
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

    actor_id           TEXT NOT NULL,
    actor_kind         TEXT NOT NULL,
    request_id         TEXT NOT NULL,
    correlation_id     TEXT NOT NULL,
    causation_id       TEXT,

    occurred_at_us     INTEGER NOT NULL,
    recorded_at_us     INTEGER NOT NULL,

    payload_json       BLOB NOT NULL,
    metadata_json      BLOB NOT NULL,
    previous_checksum  TEXT,
    checksum           TEXT NOT NULL,

    UNIQUE (stream_id, stream_sequence),
    UNIQUE (stream_id, checksum)
);

CREATE INDEX IF NOT EXISTS events_stream_order
    ON events (stream_id, stream_sequence);
CREATE INDEX IF NOT EXISTS events_global_order
    ON events (global_position);
CREATE INDEX IF NOT EXISTS events_scope_session
    ON events (session_id, stream_sequence);

-- Streams tracking table for optimistic concurrency
CREATE TABLE IF NOT EXISTS streams (
    stream_id          TEXT PRIMARY KEY,
    stream_kind        TEXT NOT NULL,
    current_sequence   INTEGER NOT NULL,
    last_checksum      TEXT,
    last_event_id      TEXT,
    updated_at_us      INTEGER NOT NULL
);

-- Idempotency receipts table
CREATE TABLE IF NOT EXISTS command_receipts (
    request_id          TEXT PRIMARY KEY,
    command_type        TEXT NOT NULL,
    command_version     INTEGER NOT NULL,
    scope_fingerprint   TEXT NOT NULL,
    request_fingerprint TEXT NOT NULL,
    correlation_id      TEXT NOT NULL,
    outcome_code        TEXT NOT NULL,
    response_json       BLOB NOT NULL,
    first_global_position INTEGER,
    last_global_position  INTEGER,
    committed_at_us     INTEGER NOT NULL
);

-- Sensitive content store
CREATE TABLE IF NOT EXISTS content_records (
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

-- Content tombstones
CREATE TABLE IF NOT EXISTS content_tombstones (
    content_id          TEXT PRIMARY KEY,
    erased_at_us        INTEGER NOT NULL,
    reason_code         TEXT NOT NULL
);

-- Projection checkpoints
CREATE TABLE IF NOT EXISTS projection_checkpoints (
    projection_name       TEXT PRIMARY KEY,
    projection_version    INTEGER NOT NULL,
    last_global_position  INTEGER NOT NULL,
    status                TEXT NOT NULL,
    error_code            TEXT,
    updated_at_us         INTEGER NOT NULL
);

-- Synchronous conversation messages projection
CREATE TABLE IF NOT EXISTS conversation_messages (
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

CREATE INDEX IF NOT EXISTS conversation_session_order
    ON conversation_messages (session_id, source_global_position);
