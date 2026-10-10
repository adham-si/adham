//! Installation-identity fail-closed guards: orphaned content blocks
//! regeneration, and `created` is true only for the first-create INSERT winner.

use adham_core_types::DomainError;
use adham_event_log::{create_sqlite_pool, load_or_create_installation};
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_identity_guard_{}.db", uuid::Uuid::now_v7()));
    path
}

async fn insert_surviving_row(pool: &sqlx::Pool<sqlx::Sqlite>, table: &str) {
    let sql = match table {
        "events" => {
            "INSERT INTO events
             (event_id, event_type, event_version, stream_id, stream_kind,
              stream_sequence, installation_id, actor_id, actor_kind, request_id,
              correlation_id, occurred_at_us, recorded_at_us, payload_json,
              metadata_json, checksum)
             VALUES ('evt-orphan-1', 'WorkspaceCreated', 1, 'workspace:orphan',
                     'workspace', 1, 'inst-orphan', 'actor-orphan', 'local_human',
                     'req-orphan', 'corr-orphan', 0, 0, x'7b7d', x'7b7d', 'chk1')"
        }
        "streams" => {
            "INSERT INTO streams
             (stream_id, stream_kind, current_sequence, updated_at_us)
             VALUES ('workspace:orphan', 'workspace', 1, 0)"
        }
        "command_receipts" => {
            "INSERT INTO command_receipts
             (request_id, command_type, command_version, scope_fingerprint,
              request_fingerprint, correlation_id, outcome_code, response_json,
              committed_at_us)
             VALUES ('req-orphan', 'CreateWorkspace', 1, 'sf', 'rf',
                     'corr-orphan', 'ok', x'7b7d', 0)"
        }
        "content_records" => {
            "INSERT INTO content_records
             (content_id, content_kind, media_type, encoding, protection_scheme,
              protected_bytes, plaintext_size, created_at_us)
             VALUES ('orphan-1', 'message', 'text/plain', 'encrypted',
                     'aead-xchacha20poly1305-v1', x'00', 0, 0)"
        }
        "content_tombstones" => {
            "INSERT INTO content_tombstones
             (content_id, erased_at_us, reason_code)
             VALUES ('orphan-1', 0, 'user_request')"
        }
        "projection_checkpoints" => {
            "INSERT INTO projection_checkpoints
             (projection_name, projection_version, last_global_position,
              status, updated_at_us)
             VALUES ('orphan-projection', 1, 1, 'ok', 0)"
        }
        "conversation_messages" => {
            "INSERT INTO conversation_messages
             (message_id, workspace_id, project_id, session_id, role,
              content_id, source_event_id, source_global_position,
              created_at_us)
             VALUES ('msg-orphan-1', 'ws-1', 'proj-1', 'sess-1', 'user',
                     'orphan-1', 'evt-orphan-1', 1, 0)"
        }
        other => panic!("unknown surviving-state table: {other}"),
    };
    sqlx::query(sql)
        .execute(pool)
        .await
        .unwrap_or_else(|e| panic!("insert into {table}: {e}"));
}

const SURVIVING_STATE_TABLES: &[&str] = &[
    "events",
    "streams",
    "command_receipts",
    "content_records",
    "content_tombstones",
    "projection_checkpoints",
    "conversation_messages",
];

#[tokio::test]
async fn fresh_db_single_creation_then_reopen() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let first = load_or_create_installation(&pool)
        .await
        .expect("first init");
    assert!(first.created);

    let second = load_or_create_installation(&pool).await.expect("reopen");
    assert!(!second.created);
    assert_eq!(first.record.installation_id, second.record.installation_id);
    assert_eq!(first.record.actor_id, second.record.actor_id);
}

#[tokio::test]
async fn any_surviving_state_blocks_regeneration() {
    for table in SURVIVING_STATE_TABLES {
        let db = test_db_path();
        let pool = create_sqlite_pool(&db).await.expect("pool");
        insert_surviving_row(&pool, table).await;

        let err = load_or_create_installation(&pool)
            .await
            .expect_err("surviving state must block regeneration");
        match &err {
            DomainError::Integrity(msg) => {
                assert!(
                    msg.contains("refusing to regenerate identity"),
                    "{table}: {msg}"
                );
            }
            other => panic!("{table}: expected Integrity, got {other:?}"),
        }

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(
            count, 0,
            "{table}: guard must fire before any identity INSERT"
        );
    }
}

#[tokio::test]
async fn existing_installation_survives_orphan_check() {
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");
    let first = load_or_create_installation(&pool)
        .await
        .expect("first init");
    for table in SURVIVING_STATE_TABLES {
        insert_surviving_row(&pool, table).await;
    }

    let second = load_or_create_installation(&pool)
        .await
        .expect("existing row must load even with surviving state present");
    assert!(!second.created);
    assert_eq!(first.record.installation_id, second.record.installation_id);
}
