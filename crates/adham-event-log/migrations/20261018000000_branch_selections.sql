-- Active-alternative selection for edited branches (CONVERSATION-01 line 65).
-- Local UI state, not an event: choosing which member of an edited branch
-- the session continues from never rewrites persisted history, only what a
-- later dispatch is answered against. Keyed by session (the root and active
-- message ids are validated against that session's rows before any write);
-- last write wins per (session, root).
CREATE TABLE IF NOT EXISTS branch_selections (
    session_id          TEXT NOT NULL,
    root_message_id     TEXT NOT NULL,
    active_message_id   TEXT NOT NULL,
    updated_at_us       INTEGER NOT NULL,
    PRIMARY KEY (session_id, root_message_id)
);
