-- Session history read model support: bookmarks and bounded fold indexes.

CREATE TABLE IF NOT EXISTS message_bookmarks (
    session_id    TEXT NOT NULL,
    message_id    TEXT NOT NULL,
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
