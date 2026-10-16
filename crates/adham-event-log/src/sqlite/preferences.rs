use adham_core_types::DomainError;
use sqlx::{Pool, Row, Sqlite};
use time::OffsetDateTime;

/// Schema version of the preference document stored by this module.
pub const PREFERENCES_SCHEMA_VERSION: u32 = 1;

/// A stored preference row. Absence of the row means installation defaults
/// (revision 0): callers fall back to compiled defaults, never to a guess.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredPreferences {
    pub schema_version: u32,
    pub prefs_json: String,
    pub revision: i64,
}

/// Outcome of a guarded write: either the new row or the conflict it lost to.
#[derive(Debug)]
pub enum PreferenceWriteError {
    /// `base_revision` did not match the stored revision. Carries the
    /// current row (or defaults at revision 0 when no row exists) so the
    /// caller can rebase and retry. Nothing was written.
    Conflict(StoredPreferences),
    Storage(DomainError),
}

impl std::fmt::Display for PreferenceWriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PreferenceWriteError::Conflict(current) => write!(
                f,
                "preference revision conflict: base revision is stale (current revision {})",
                current.revision
            ),
            PreferenceWriteError::Storage(e) => write!(f, "preference storage error: {e}"),
        }
    }
}

impl From<DomainError> for PreferenceWriteError {
    fn from(e: DomainError) -> Self {
        PreferenceWriteError::Storage(e)
    }
}

fn now_us() -> i64 {
    (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64
}

fn defaults() -> StoredPreferences {
    StoredPreferences {
        schema_version: PREFERENCES_SCHEMA_VERSION,
        prefs_json: String::new(),
        revision: 0,
    }
}

/// Read the stored preference row, if any.
pub async fn read_preferences(
    pool: &Pool<Sqlite>,
) -> Result<Option<StoredPreferences>, DomainError> {
    let row = sqlx::query(
        "SELECT schema_version, prefs_json, revision FROM installation_preferences WHERE id = 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|e| DomainError::Storage(e.to_string()))?;
    match row {
        None => Ok(None),
        Some(r) => {
            let schema_version: i64 = r.get("schema_version");
            let prefs_json: String = r.get("prefs_json");
            let revision: i64 = r.get("revision");
            Ok(Some(StoredPreferences {
                schema_version: schema_version as u32,
                prefs_json,
                revision,
            }))
        }
    }
}

/// Guarded write: applies only when `base_revision` matches the stored
/// revision (0 when no row exists). Rapid changes serialize on the revision:
/// the loser gets `Conflict` with the current row and writes nothing.
/// Concurrent first-writes race on a single INSERT; the loser reads back the
/// winner as a conflict rather than overwriting it.
pub async fn write_preferences(
    pool: &Pool<Sqlite>,
    schema_version: u32,
    prefs_json: &str,
    base_revision: i64,
) -> Result<StoredPreferences, PreferenceWriteError> {
    let updated = sqlx::query(
        "UPDATE installation_preferences
         SET schema_version = ?, prefs_json = ?, revision = revision + 1, updated_at_us = ?
         WHERE id = 1 AND revision = ?",
    )
    .bind(schema_version as i64)
    .bind(prefs_json)
    .bind(now_us())
    .bind(base_revision)
    .execute(pool)
    .await
    .map_err(|e| DomainError::Storage(e.to_string()))?;
    if updated.rows_affected() == 1 {
        return read_preferences(pool)
            .await?
            .ok_or_else(|| DomainError::Storage("preference row missing after write".into()))
            .map_err(PreferenceWriteError::Storage);
    }

    if base_revision == 0 {
        let inserted = sqlx::query(
            "INSERT INTO installation_preferences
             (id, schema_version, prefs_json, revision, updated_at_us)
             VALUES (1, ?, ?, 1, ?)
             ON CONFLICT(id) DO NOTHING",
        )
        .bind(schema_version as i64)
        .bind(prefs_json)
        .bind(now_us())
        .execute(pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        if inserted.rows_affected() == 1 {
            return read_preferences(pool)
                .await?
                .ok_or_else(|| DomainError::Storage("preference row missing after insert".into()))
                .map_err(PreferenceWriteError::Storage);
        }
    }

    // Lost the race (or the base was stale): report the current row so the
    // caller can rebase. No write happened on this path.
    match read_preferences(pool).await? {
        Some(current) => Err(PreferenceWriteError::Conflict(current)),
        None => Err(PreferenceWriteError::Conflict(defaults())),
    }
}

/// Delete the preference row: the installation returns to compiled defaults.
pub async fn reset_preferences(pool: &Pool<Sqlite>) -> Result<(), DomainError> {
    sqlx::query("DELETE FROM installation_preferences WHERE id = 1")
        .execute(pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
    Ok(())
}
