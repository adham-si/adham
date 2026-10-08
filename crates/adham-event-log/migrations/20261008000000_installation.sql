-- Authoritative installation / local-actor record (P0 repair).
-- Single-row table: id is always 1. OS credential store holds encryption
-- secrets; this table holds non-secret identity metadata.
CREATE TABLE IF NOT EXISTS installation (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    installation_id TEXT NOT NULL UNIQUE,
    actor_id        TEXT NOT NULL,
    created_at_us   INTEGER NOT NULL,
    updated_at_us   INTEGER NOT NULL
);
