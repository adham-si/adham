//! Production startup matrix against the real Linux Secret Service.
//!
//! Uses the real `adham-content-key` service with synthetic random
//! installation accounts, deleting each credential at test exit.

#![cfg(target_os = "linux")]

use adham_core_types::DomainError;
use adham_desktop_api::ApiContext;
use adham_event_log::create_sqlite_pool;
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!(
        "adham_startup_matrix_linux_{}.db",
        uuid::Uuid::now_v7()
    ));
    path
}

fn delete_credential(installation_id: &str) {
    if let Ok(entry) = keyring::Entry::new("adham-content-key", installation_id) {
        let _ = entry.delete_credential();
    }
}

/// Comparison fingerprint for assertions; raw key bytes are never printed.
fn fp(key: &[u8; 32]) -> String {
    blake3::hash(key).to_hex().to_string()
}

static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[tokio::test]
async fn fresh_startup_initializes_key_and_reopen_is_stable() {
    let _guard = TEST_LOCK.lock().await;
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let ctx = ApiContext::load_or_create(pool.clone())
        .await
        .expect("fresh startup");
    let account = ctx.installation_id.to_string();
    let key_first = ctx.content_key.content_key().expect("fresh key read");
    let key_second = ctx.content_key.content_key().expect("fresh key reread");
    assert_eq!(fp(&key_first), fp(&key_second));

    let ctx2 = ApiContext::load_or_create(pool)
        .await
        .expect("reopen startup");
    assert_eq!(ctx.installation_id, ctx2.installation_id);
    assert_eq!(ctx.actor_id, ctx2.actor_id);
    let key_reopen = ctx2.content_key.content_key().expect("reopen key read");
    assert_eq!(fp(&key_first), fp(&key_reopen), "key must survive restart");

    delete_credential(&account);
    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn existing_installation_with_deleted_key_fails_closed() {
    let _guard = TEST_LOCK.lock().await;
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let ctx = ApiContext::load_or_create(pool.clone())
        .await
        .expect("first startup");
    let account = ctx.installation_id.to_string();
    delete_credential(&account);

    let err = match ApiContext::load_or_create(pool.clone()).await {
        Ok(_) => panic!("missing key must block startup"),
        Err(e) => e,
    };
    match &err {
        DomainError::Storage(msg) => {
            assert!(msg.contains("content key missing"), "{msg}");
        }
        other => panic!("expected Storage key-loss error, got {other:?}"),
    }

    let entry = keyring::Entry::new("adham-content-key", &account).expect("entry");
    assert!(
        matches!(entry.get_password(), Err(keyring::Error::NoEntry)),
        "failed startup must not mint a replacement key"
    );
    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(row_count, 1, "identity must be preserved across key loss");

    delete_credential(&account);
    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn orphan_content_blocks_startup_regeneration() {
    let _guard = TEST_LOCK.lock().await;
    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");
    sqlx::query(
        "INSERT INTO events
         (event_id, event_type, event_version, stream_id, stream_kind,
          stream_sequence, installation_id, actor_id, actor_kind, request_id,
          correlation_id, occurred_at_us, recorded_at_us, payload_json,
          metadata_json, checksum)
         VALUES ('evt-orphan-startup-linux', 'WorkspaceCreated', 1, 'workspace:orphan',
                 'workspace', 1, 'inst-orphan', 'actor-orphan', 'local_human',
                 'req-orphan', 'corr-orphan', 0, 0, x'7b7d', x'7b7d', 'chk1')",
    )
    .execute(&pool)
    .await
    .expect("insert orphan event");

    let err = match ApiContext::load_or_create(pool.clone()).await {
        Ok(_) => panic!("orphan content must block startup"),
        Err(e) => e,
    };
    assert!(matches!(err, DomainError::Integrity(_)), "{err:?}");
    let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
        .fetch_one(&pool)
        .await
        .expect("count");
    assert_eq!(row_count, 0, "no identity may be generated under live data");
    let _ = std::fs::remove_file(&db);
}

#[tokio::test]
async fn unavailable_secret_service_fails_closed_and_preserves_identity() {
    if std::env::var("TEST_UNAVAIL_STARTUP_SUBPROCESS").is_ok() {
        let db = PathBuf::from(std::env::var("TEST_DB_PATH").expect("db path env"));
        let pool = create_sqlite_pool(&db).await.expect("pool");

        let err = match ApiContext::load_or_create(pool.clone()).await {
            Ok(_) => panic!("startup must fail closed when Secret Service is unavailable"),
            Err(e) => e,
        };
        assert!(
            matches!(err, DomainError::Storage(_)),
            "expected Storage error, got {err:?}"
        );

        let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(
            row_count, 1,
            "installation identity must be preserved in SQLite"
        );
        return;
    }

    let _guard = TEST_LOCK.lock().await;

    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let ctx = ApiContext::load_or_create(pool.clone())
        .await
        .expect("initial startup");
    let account = ctx.installation_id.to_string();
    let original_inst_id = ctx.installation_id;
    drop(ctx);
    drop(pool);

    let exe = std::env::current_exe().expect("current exe");
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("unavailable_secret_service_fails_closed_and_preserves_identity")
        .arg("--exact")
        .env("TEST_UNAVAIL_STARTUP_SUBPROCESS", "1")
        .env("TEST_DB_PATH", db.to_str().unwrap())
        .env("DBUS_SESSION_BUS_ADDRESS", "disabled:")
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY");
    let status = run_subprocess(cmd);
    assert!(
        status.success(),
        "unavailable secret service subprocess test must pass"
    );

    let pool = create_sqlite_pool(&db).await.expect("pool");
    let stored_id: String = sqlx::query_scalar("SELECT installation_id FROM installation LIMIT 1")
        .fetch_one(&pool)
        .await
        .expect("stored_id");
    assert_eq!(stored_id, original_inst_id.to_string());

    delete_credential(&account);
    let _ = std::fs::remove_file(&db);
}

fn run_subprocess(mut cmd: std::process::Command) -> std::process::ExitStatus {
    let mut child = cmd.spawn().expect("spawn subprocess");
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_secs(10);
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return status,
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    panic!("subprocess timed out after 10s");
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }
            Err(e) => panic!("try_wait failed: {e}"),
        }
    }
}

struct IsolatedSecretService {
    dbus_pid: u32,
    dbus_addr: String,
    temp_dir: PathBuf,
}

impl IsolatedSecretService {
    fn spawn() -> Option<Self> {
        let temp_dir =
            std::env::temp_dir().join(format!("adham_iso_matrix_{}", uuid::Uuid::now_v7()));
        if std::fs::create_dir_all(&temp_dir).is_err() {
            return None;
        }

        let output = std::process::Command::new("dbus-launch")
            .arg("--sh-syntax")
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env("XDG_DATA_DIRS", &temp_dir)
            .output()
            .ok()?;
        if !output.status.success() {
            let _ = std::fs::remove_dir_all(&temp_dir);
            return None;
        }

        let s = String::from_utf8_lossy(&output.stdout);
        let mut dbus_addr = None;
        let mut dbus_pid = None;
        for line in s.lines() {
            if let Some(rest) = line.strip_prefix("DBUS_SESSION_BUS_ADDRESS=") {
                let addr = rest.trim_end_matches(';').trim_matches('\'').to_string();
                dbus_addr = Some(addr);
            } else if let Some(rest) = line.strip_prefix("DBUS_SESSION_BUS_PID=") {
                let pid_str = rest.trim_end_matches(';').trim_matches('\'');
                if let Ok(p) = pid_str.parse::<u32>() {
                    dbus_pid = Some(p);
                }
            }
        }

        let (dbus_addr, dbus_pid) = match (dbus_addr, dbus_pid) {
            (Some(a), Some(p)) => (a, p),
            _ => {
                let _ = std::fs::remove_dir_all(&temp_dir);
                return None;
            }
        };

        let _ = std::process::Command::new("gnome-keyring-daemon")
            .args(["--start", "--components=secrets"])
            .env("DBUS_SESSION_BUS_ADDRESS", &dbus_addr)
            .env("XDG_DATA_HOME", &temp_dir)
            .env("XDG_DATA_DIRS", &temp_dir)
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();

        Some(Self {
            dbus_pid,
            dbus_addr,
            temp_dir,
        })
    }
}

impl Drop for IsolatedSecretService {
    fn drop(&mut self) {
        let _ = std::process::Command::new("kill")
            .arg(self.dbus_pid.to_string())
            .status();
        let _ = std::fs::remove_dir_all(&self.temp_dir);
    }
}

#[tokio::test]
async fn locked_collection_fails_closed_and_preserves_identity() {
    if std::env::var("TEST_LOCKED_STARTUP_SUBPROCESS").is_ok() {
        let db = PathBuf::from(std::env::var("TEST_DB_PATH").expect("db path env"));
        let pool = create_sqlite_pool(&db).await.expect("pool");

        let reopen_err = match ApiContext::load_or_create(pool.clone()).await {
            Ok(_) => panic!("startup against locked collection must fail closed"),
            Err(e) => e,
        };
        assert!(
            matches!(reopen_err, DomainError::Storage(_)),
            "expected Storage error, got {reopen_err:?}"
        );

        let row_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM installation")
            .fetch_one(&pool)
            .await
            .expect("count");
        assert_eq!(
            row_count, 1,
            "installation record must not be duplicated or lost"
        );
        let stored_id: String =
            sqlx::query_scalar("SELECT installation_id FROM installation LIMIT 1")
                .fetch_one(&pool)
                .await
                .expect("stored_id");
        let expected_id = std::env::var("TEST_EXPECTED_ID").expect("expected id env");
        assert_eq!(stored_id, expected_id);

        return;
    }

    let _guard = TEST_LOCK.lock().await;

    let db = test_db_path();
    let pool = create_sqlite_pool(&db).await.expect("pool");

    let ctx = ApiContext::load_or_create(pool.clone())
        .await
        .expect("initial startup");
    let account = ctx.installation_id.to_string();
    let original_inst_id = ctx.installation_id;
    drop(ctx);
    drop(pool);

    let iso = match IsolatedSecretService::spawn() {
        Some(s) => s,
        None => {
            eprintln!("skipping locked collection test: dbus-launch or gnome-keyring unavailable");
            return;
        }
    };

    let exe = std::env::current_exe().expect("current exe");
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("locked_collection_fails_closed_and_preserves_identity")
        .arg("--exact")
        .env("TEST_LOCKED_STARTUP_SUBPROCESS", "1")
        .env("TEST_DB_PATH", db.to_str().unwrap())
        .env("TEST_EXPECTED_ID", original_inst_id.to_string())
        .env("DBUS_SESSION_BUS_ADDRESS", &iso.dbus_addr)
        .env("XDG_DATA_HOME", &iso.temp_dir)
        .env("XDG_DATA_DIRS", &iso.temp_dir)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY");
    let status = run_subprocess(cmd);
    assert!(
        status.success(),
        "locked collection startup subprocess test must pass"
    );

    delete_credential(&account);
    let _ = std::fs::remove_file(&db);
    drop(iso);
}
