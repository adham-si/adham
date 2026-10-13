CREATE TABLE IF NOT EXISTS pending_operations (
    operation_id        TEXT PRIMARY KEY,
    kind                TEXT NOT NULL,
    workspace_id        TEXT NOT NULL,
    project_id          TEXT NOT NULL,
    session_id          TEXT,
    create_request_id   TEXT,
    message_request_id  TEXT NOT NULL,
    content_id          TEXT NOT NULL,
    title_content_id    TEXT,
    status              TEXT NOT NULL,
    created_at_us       INTEGER NOT NULL,
    updated_at_us       INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pending_ops_scope 
    ON pending_operations (workspace_id, project_id);
