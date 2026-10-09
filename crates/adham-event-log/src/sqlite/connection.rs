use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Executor, Pool, Sqlite};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;
use tracing::info;

const SCHEMA_SQL: &str = include_str!("../../migrations/20261006000000_initial_schema.sql");
const INSTALLATION_SQL: &str = include_str!("../../migrations/20261008000000_installation.sql");
const RECEIPT_ACTOR_SQL: &str = include_str!("../../migrations/20261008000001_receipt_actor.sql");

pub async fn create_sqlite_pool(db_path: &Path) -> Result<Pool<Sqlite>, sqlx::Error> {
    let options = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))?
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .synchronous(SqliteSynchronous::Full)
        .foreign_keys(true)
        .busy_timeout(Duration::from_millis(5000));

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect_with(options)
        .await?;

    info!("Running embedded SQLite database schema initialization...");
    pool.execute(SCHEMA_SQL).await?;
    pool.execute(INSTALLATION_SQL).await?;
    ensure_installation_scope_columns(&pool).await?;
    ensure_receipt_actor_column(&pool).await?;
    ensure_content_scope_columns(&pool).await?;
    info!("Database schema initialized successfully.");

    Ok(pool)
}

async fn ensure_installation_scope_columns(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    let cols: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('installation')")
            .fetch_all(pool)
            .await?;
    if !cols.iter().any(|c| c == "active_workspace_id") {
        pool.execute("ALTER TABLE installation ADD COLUMN active_workspace_id TEXT")
            .await?;
    }
    if !cols.iter().any(|c| c == "active_project_id") {
        pool.execute("ALTER TABLE installation ADD COLUMN active_project_id TEXT")
            .await?;
    }
    Ok(())
}

async fn ensure_receipt_actor_column(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    let cols: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('command_receipts')")
            .fetch_all(pool)
            .await?;
    if !cols.iter().any(|c| c == "actor_id") {
        pool.execute(RECEIPT_ACTOR_SQL).await?;
    }
    Ok(())
}

async fn ensure_content_scope_columns(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    let cols: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('content_records')")
            .fetch_all(pool)
            .await?;
    if !cols.iter().any(|c| c == "installation_id") {
        // CONTENT_SCOPE_SQL has 4 ALTERs; execute one by one for SQLite.
        for stmt in [
            "ALTER TABLE content_records ADD COLUMN installation_id TEXT",
            "ALTER TABLE content_records ADD COLUMN workspace_id TEXT",
            "ALTER TABLE content_records ADD COLUMN project_id TEXT",
            "ALTER TABLE content_records ADD COLUMN session_id TEXT",
        ] {
            pool.execute(stmt).await?;
        }
    }
    Ok(())
}
