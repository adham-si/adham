CREATE TABLE IF NOT EXISTS provider_accounts (
    account_id           TEXT PRIMARY KEY,
    kind                 TEXT NOT NULL,
    alias                TEXT NOT NULL,
    privacy_class        TEXT NOT NULL,
    endpoint_id          TEXT NOT NULL,
    base_url             TEXT NOT NULL,
    approved_destination INTEGER NOT NULL DEFAULT 0 CHECK (approved_destination IN (0, 1)),
    status               TEXT NOT NULL DEFAULT 'active',
    created_at_us        INTEGER NOT NULL,
    updated_at_us        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS provider_models (
    account_id        TEXT NOT NULL,
    model_id          TEXT NOT NULL,
    digest            TEXT NOT NULL,
    descriptor_json   TEXT NOT NULL,
    verified_revision INTEGER NOT NULL,
    updated_at_us     INTEGER NOT NULL,
    PRIMARY KEY (account_id, model_id),
    FOREIGN KEY (account_id) REFERENCES provider_accounts(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS provider_registry_state (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    revision      INTEGER NOT NULL,
    updated_at_us INTEGER NOT NULL
);
