use adham_core_types::{ActorId, DomainError, InstallationId};
use sqlx::{Pool, Row, Sqlite};
use time::OffsetDateTime;

/// Authoritative installation + local-actor record.
///
/// Single-row `installation(id=1)` table. No file fallback: two authorities can
/// disagree and silently fork identities after corruption. Missing or corrupt
/// rows are explicit errors, never silent regeneration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstallationRecord {
    pub installation_id: InstallationId,
    pub actor_id: ActorId,
}

/// Result of loading or creating the installation record.
///
/// `created` is true only for the process that won the atomic first-create
/// INSERT; that winner is the sole authority allowed to initialize the
/// content key. Everyone else must treat key material as read-only.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstallationInit {
    pub record: InstallationRecord,
    pub created: bool,
}

pub async fn load_or_create_installation(
    pool: &Pool<Sqlite>,
) -> Result<InstallationInit, DomainError> {
    // Fast path: existing row.
    if let Some(rec) = read_installation(pool).await? {
        return Ok(InstallationInit {
            record: rec,
            created: false,
        });
    }

    // Guardrail: a missing installation row under surviving data (events,
    // streams, receipts, content, tombstones, projections) means identity
    // was lost under live data. Never regenerate identity (and thereby
    // encryption keys) in that state — report integrity loss.
    if has_surviving_state(pool).await? {
        return Err(DomainError::Integrity(
            "installation record missing but surviving application state exists; refusing to regenerate identity or encryption keys".into(),
        ));
    }

    // Atomic create: INSERT ... ON CONFLICT DO NOTHING handles concurrent init.
    let installation_id = InstallationId::new_v7();
    let actor_id = ActorId::new_v7();
    let now_us = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
    let result = sqlx::query(
        "INSERT INTO installation (id, installation_id, actor_id, created_at_us, updated_at_us)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING",
    )
    .bind(installation_id.to_string())
    .bind(actor_id.to_string())
    .bind(now_us)
    .bind(now_us)
    .execute(pool)
    .await
    .map_err(|e| DomainError::Storage(e.to_string()))?;

    // Whoever won the race, read back the authoritative row.
    let record = read_installation(pool)
        .await?
        .ok_or_else(|| DomainError::Storage("installation record missing after create".into()))?;
    Ok(InstallationInit {
        record,
        created: result.rows_affected() == 1,
    })
}

/// True when any surviving application state exists without an installation
/// record (identity lost under live data). Covers every authoritative table:
/// events, stream tracking, idempotency receipts, sealed content, erasure
/// tombstones, projections, and projected messages.
async fn has_surviving_state(pool: &Pool<Sqlite>) -> Result<bool, DomainError> {
    const TABLES: &[&str] = &[
        "events",
        "streams",
        "command_receipts",
        "content_records",
        "content_tombstones",
        "projection_checkpoints",
        "conversation_messages",
    ];
    for table in TABLES {
        let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
            .fetch_one(pool)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;
        if count > 0 {
            return Ok(true);
        }
    }
    Ok(false)
}

async fn read_installation(pool: &Pool<Sqlite>) -> Result<Option<InstallationRecord>, DomainError> {
    let row = sqlx::query("SELECT installation_id, actor_id FROM installation WHERE id = 1")
        .fetch_optional(pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
    match row {
        None => Ok(None),
        Some(r) => {
            let inst_str: String = r.get("installation_id");
            let actor_str: String = r.get("actor_id");
            let installation_id = InstallationId::from_string(&inst_str).map_err(|e| {
                DomainError::Integrity(format!("corrupt installation_id in store: {e}"))
            })?;
            let actor_id = ActorId::from_string(&actor_str)
                .map_err(|e| DomainError::Integrity(format!("corrupt actor_id in store: {e}")))?;
            Ok(Some(InstallationRecord {
                installation_id,
                actor_id,
            }))
        }
    }
}
