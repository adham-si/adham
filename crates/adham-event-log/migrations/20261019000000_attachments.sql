-- User-selected file attachments: an index of metadata and extraction state.
-- The bytes themselves live in content_records (AEAD, scope-bound) and open
-- only under the exact scope they were sealed with.

CREATE TABLE IF NOT EXISTS attachment_records (
    attachment_id     TEXT PRIMARY KEY,
    content_id        TEXT NOT NULL,
    file_name         TEXT NOT NULL,
    media_type        TEXT NOT NULL,
    byte_size         INTEGER NOT NULL,
    content_hash      TEXT NOT NULL,
    hash_algorithm    TEXT NOT NULL,
    extracted_chars   INTEGER NOT NULL,
    truncated         INTEGER NOT NULL DEFAULT 0,
    retention         TEXT NOT NULL,
    workspace_id      TEXT NOT NULL,
    project_id        TEXT NOT NULL,
    session_id        TEXT NOT NULL,
    created_at_us     INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS attachment_records_session_idx
    ON attachment_records(session_id, created_at_us);

-- Which attachments a persisted message was sent with. A link row means the
-- attachment was selected for that dispatch; the content itself is what the
-- model received (extracted text, possibly truncated).
CREATE TABLE IF NOT EXISTS message_attachments (
    message_id    TEXT NOT NULL,
    attachment_id TEXT NOT NULL,
    position      INTEGER NOT NULL,
    PRIMARY KEY (message_id, attachment_id)
);
