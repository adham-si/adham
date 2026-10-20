use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Executor, Pool, Sqlite};
use std::path::Path;
use std::str::FromStr;
use std::time::Duration;
use tracing::info;

const SCHEMA_SQL: &str = include_str!("../../migrations/20261006000000_initial_schema.sql");
const INSTALLATION_SQL: &str = include_str!("../../migrations/20261008000000_installation.sql");
const RECEIPT_ACTOR_SQL: &str = include_str!("../../migrations/20261008000001_receipt_actor.sql");
const PENDING_OPERATIONS_SQL: &str =
    include_str!("../../migrations/20261014000000_pending_operations.sql");
const PREFERENCES_SQL: &str = include_str!("../../migrations/20261016000000_preferences.sql");
const PROVIDER_REGISTRY_SQL: &str =
    include_str!("../../migrations/20261016000001_provider_registry.sql");
const PROVIDER_CREDENTIALS_SQL: &str =
    include_str!("../../migrations/20261017000000_provider_credentials.sql");
const BRANCH_SELECTIONS_SQL: &str =
    include_str!("../../migrations/20261018000000_branch_selections.sql");
const ANSWER_FEEDBACK_SQL: &str =
    include_str!("../../migrations/20261018000001_answer_feedback.sql");
const ATTACHMENTS_SQL: &str = include_str!("../../migrations/20261019000000_attachments.sql");
const SESSION_HISTORY_SQL: &str =
    include_str!("../../migrations/20261020000000_session_history.sql");

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
    pool.execute(PENDING_OPERATIONS_SQL).await?;
    pool.execute(PREFERENCES_SQL).await?;
    pool.execute(PROVIDER_REGISTRY_SQL).await?;
    pool.execute(PROVIDER_CREDENTIALS_SQL).await?;
    pool.execute(BRANCH_SELECTIONS_SQL).await?;
    pool.execute(ANSWER_FEEDBACK_SQL).await?;
    pool.execute(ATTACHMENTS_SQL).await?;
    pool.execute(SESSION_HISTORY_SQL).await?;
    ensure_assistant_columns(&pool).await?;
    ensure_message_reference_columns(&pool).await?;
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

/// Assistant-terminal columns on `conversation_messages` (user rows leave
/// them NULL). `op_id` is unique: a second terminal write for the same
/// completion operation — including a Stop racing completion — is a no-op, so
/// exactly one terminal outcome wins.
async fn ensure_assistant_columns(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    let cols: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('conversation_messages')")
            .fetch_all(pool)
            .await?;
    for column in ["op_id", "completion_json", "usage_json"] {
        if !cols.iter().any(|c| c == column) {
            pool.execute(format!("ALTER TABLE conversation_messages ADD COLUMN {column}").as_str())
                .await?;
        }
    }
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS conversation_messages_op_id \
         ON conversation_messages(op_id)",
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// Message-reference columns on `conversation_messages` (NULL for messages
/// that reference nothing). A reference is the quote anchor of a reply or the
/// "edited-from" lineage of a branch alternative. Both columns are written
/// together or left NULL together.
async fn ensure_message_reference_columns(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    let cols: Vec<String> =
        sqlx::query_scalar("SELECT name FROM pragma_table_info('conversation_messages')")
            .fetch_all(pool)
            .await?;
    for column in ["refers_to_message_id", "refers_to_relation"] {
        if !cols.iter().any(|c| c == column) {
            pool.execute(
                format!("ALTER TABLE conversation_messages ADD COLUMN {column} TEXT").as_str(),
            )
            .await?;
        }
    }
    Ok(())
}
