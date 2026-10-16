-- Installation-scoped application preferences (SETTINGS-01 Pillar 1).
-- Single-row table: id is always 1. Presentation-only settings
-- (theme, language, fonts, contrast, motion, composer input).
-- No secrets, no operational/security policy. `revision` guards
-- concurrent writes: a writer must present the revision it read.
CREATE TABLE IF NOT EXISTS installation_preferences (
    id              INTEGER PRIMARY KEY CHECK (id = 1),
    schema_version  INTEGER NOT NULL,
    prefs_json      TEXT NOT NULL,
    revision        INTEGER NOT NULL,
    updated_at_us   INTEGER NOT NULL
);
