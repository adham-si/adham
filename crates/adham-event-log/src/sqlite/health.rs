use serde::{Deserialize, Serialize};
use sqlx::{Pool, Row, Sqlite};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageHealthReport {
    pub is_healthy: bool,
    pub journal_mode: String,
    pub foreign_keys: bool,
    pub busy_timeout_ms: u32,
    pub quick_check_ok: bool,
}

pub async fn verify_storage_health(
    pool: &Pool<Sqlite>,
) -> Result<StorageHealthReport, sqlx::Error> {
    // 1. Check journal mode
    let journal_row = sqlx::query("PRAGMA journal_mode").fetch_one(pool).await?;
    let journal_mode: String = journal_row.get(0);

    // 2. Check foreign keys
    let fk_row = sqlx::query("PRAGMA foreign_keys").fetch_one(pool).await?;
    let fk_val: i32 = fk_row.get(0);
    let foreign_keys = fk_val == 1;

    // 3. Check busy timeout
    let timeout_row = sqlx::query("PRAGMA busy_timeout").fetch_one(pool).await?;
    let timeout_val: i32 = timeout_row.get(0);
    let busy_timeout_ms = timeout_val.max(0) as u32;

    // 4. Quick check integrity
    let check_row = sqlx::query("PRAGMA quick_check(1)").fetch_one(pool).await?;
    let check_res: String = check_row.get(0);
    let quick_check_ok = check_res.eq_ignore_ascii_case("ok");

    let is_healthy = journal_mode.eq_ignore_ascii_case("wal")
        && foreign_keys
        && busy_timeout_ms >= 5000
        && quick_check_ok;

    Ok(StorageHealthReport {
        is_healthy,
        journal_mode,
        foreign_keys,
        busy_timeout_ms,
        quick_check_ok,
    })
}
