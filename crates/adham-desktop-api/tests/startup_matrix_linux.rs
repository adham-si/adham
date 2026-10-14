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
    fn spawn() -> Self {
        let temp_dir =
            std::env::temp_dir().join(format!("adham_iso_matrix_{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&temp_dir).expect("create isolated secret service temp dir");

        let ctrl_dir = temp_dir.join("ctrl");
        std::fs::create_dir_all(&ctrl_dir).expect("create isolated ctrl dir");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ctrl_dir, std::fs::Permissions::from_mode(0o700));
        }

        let keyring_dir = temp_dir.join("keyrings");
        std::fs::create_dir_all(&keyring_dir).expect("create keyring dir");
        let login_path = keyring_dir.join("login.keyring");
        if !login_path.exists() {
            std::fs::write(
                &login_path,
                "[keyring]\ndisplay-name=login\nctime=0\nmtime=0\nlock-on-idle=false\nlock-after=false\n",
            )
            .expect("create dummy login keyring");
        }

        let output = std::process::Command::new("dbus-launch")
            .arg("--sh-syntax")
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .env("XDG_DATA_DIRS", &temp_dir)
            .output()
            .expect("dbus-launch execution failed");
        assert!(output.status.success(), "dbus-launch must succeed");

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

        let dbus_addr = dbus_addr.expect("parse DBUS_SESSION_BUS_ADDRESS");
        let dbus_pid = dbus_pid.expect("parse DBUS_SESSION_BUS_PID");

        let this = Self {
            dbus_pid,
            dbus_addr,
            temp_dir,
        };

        this.unlock();
        assert!(!this.is_locked(), "collection must be initially unlocked");
        this
    }

    fn lock(&self) {
        let out = std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.secrets",
                "--type=method_call",
                "--print-reply",
                "/org/freedesktop/secrets",
                "org.freedesktop.Secret.Service.Lock",
                "array:objpath:/org/freedesktop/secrets/collection/login",
            ])
            .env("DBUS_SESSION_BUS_ADDRESS", &self.dbus_addr)
            .env("XDG_DATA_HOME", &self.temp_dir)
            .env("XDG_DATA_DIRS", &self.temp_dir)
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .output()
            .expect("dbus-send Lock execution failed");
        assert!(out.status.success(), "dbus-send Lock must succeed");
    }

    fn is_locked(&self) -> bool {
        let out = std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.secrets",
                "--type=method_call",
                "--print-reply",
                "/org/freedesktop/secrets/collection/login",
                "org.freedesktop.DBus.Properties.Get",
                "string:org.freedesktop.Secret.Collection",
                "string:Locked",
            ])
            .env("DBUS_SESSION_BUS_ADDRESS", &self.dbus_addr)
            .env("XDG_DATA_HOME", &self.temp_dir)
            .env("XDG_DATA_DIRS", &self.temp_dir)
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .output()
            .expect("dbus-send Get Locked execution failed");
        let s = String::from_utf8_lossy(&out.stdout);
        s.contains("boolean true")
    }

    fn unlock(&self) {
        let ctrl_arg = format!(
            "--control-directory={}",
            self.temp_dir.join("ctrl").display()
        );
        let mut child = std::process::Command::new("gnome-keyring-daemon")
            .args([&ctrl_arg, "--unlock", "--components=secrets"])
            .env("DBUS_SESSION_BUS_ADDRESS", &self.dbus_addr)
            .env("XDG_DATA_HOME", &self.temp_dir)
            .env("XDG_DATA_DIRS", &self.temp_dir)
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn gnome-keyring-daemon --unlock");
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            stdin.write_all(b"test\n").expect("write unlock password");
        }
        let status = child.wait().expect("wait on unlock daemon");
        assert!(
            status.success(),
            "gnome-keyring-daemon --unlock must succeed"
        );

        let status2 = std::process::Command::new("gnome-keyring-daemon")
            .args([&ctrl_arg, "--start", "--components=secrets"])
            .env("DBUS_SESSION_BUS_ADDRESS", &self.dbus_addr)
            .env("XDG_DATA_HOME", &self.temp_dir)
            .env("XDG_DATA_DIRS", &self.temp_dir)
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .expect("gnome-keyring-daemon --start failed");
        assert!(
            status2.success(),
            "gnome-keyring-daemon --start must succeed"
        );
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
    if let Ok(act) = std::env::var("TEST_LOCKED_STARTUP_ACTION") {
        let db = PathBuf::from(std::env::var("TEST_DB_PATH").expect("db path env"));
        let pool = create_sqlite_pool(&db).await.expect("pool");

        match act.as_str() {
            "seed" => {
                let ctx = ApiContext::load_or_create(pool.clone())
                    .await
                    .expect("initial startup while unlocked");
                let key = ctx.content_key.content_key().expect("key read");
                println!("INST_ID:{}", ctx.installation_id);
                println!("ACTOR_ID:{}", ctx.actor_id);
                println!("KEY_FP:{}", fp(&key));
                return;
            }
            "verify_locked_failure" => {
                let expected_inst_id =
                    std::env::var("TEST_EXPECTED_INST_ID").expect("expected inst id env");

                let err = match ApiContext::load_or_create(pool.clone()).await {
                    Ok(_) => panic!("startup against locked collection must fail closed"),
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
                    "installation record must not be duplicated or lost"
                );
                let stored_id: String =
                    sqlx::query_scalar("SELECT installation_id FROM installation LIMIT 1")
                        .fetch_one(&pool)
                        .await
                        .expect("stored_id");
                assert_eq!(stored_id, expected_inst_id);
                return;
            }
            "verify_unlocked_startup" => {
                let expected_inst_id =
                    std::env::var("TEST_EXPECTED_INST_ID").expect("expected inst id env");
                let expected_actor_id =
                    std::env::var("TEST_EXPECTED_ACTOR_ID").expect("expected actor id env");
                let expected_fp =
                    std::env::var("TEST_EXPECTED_KEY_FP").expect("expected key fp env");

                let ctx = ApiContext::load_or_create(pool.clone())
                    .await
                    .expect("startup after unlock");
                assert_eq!(
                    ctx.installation_id.to_string(),
                    expected_inst_id,
                    "installation ID must match original after unlock"
                );
                assert_eq!(
                    ctx.actor_id.to_string(),
                    expected_actor_id,
                    "actor ID must match original after unlock"
                );
                let key = ctx
                    .content_key
                    .content_key()
                    .expect("key read after unlock");
                assert_eq!(
                    fp(&key),
                    expected_fp,
                    "key must match original after unlock"
                );
                return;
            }
            "cleanup" => {
                if let Ok(account) = std::env::var("TEST_ACCOUNT") {
                    delete_credential(&account);
                }
                let _ = std::fs::remove_file(&db);
                return;
            }
            other => panic!("unknown test action: {other}"),
        }
    }

    let _guard = TEST_LOCK.lock().await;

    let iso = IsolatedSecretService::spawn();
    assert!(!iso.is_locked(), "collection must be initially unlocked");

    let db = test_db_path();
    let exe = std::env::current_exe().expect("current exe");

    // 1. Seed database and credential while unlocked
    let mut seed_cmd = std::process::Command::new(&exe);
    seed_cmd
        .arg("locked_collection_fails_closed_and_preserves_identity")
        .arg("--exact")
        .arg("--nocapture")
        .env("TEST_LOCKED_STARTUP_ACTION", "seed")
        .env("TEST_DB_PATH", db.to_str().unwrap())
        .env("DBUS_SESSION_BUS_ADDRESS", &iso.dbus_addr)
        .env("XDG_DATA_HOME", &iso.temp_dir)
        .env("XDG_DATA_DIRS", &iso.temp_dir)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY")
        .stdout(std::process::Stdio::piped());
    let mut child = seed_cmd.spawn().expect("spawn seed");
    let stdout = child.stdout.take().expect("stdout");
    let status = child.wait().expect("wait seed");
    assert!(status.success(), "seeding startup must succeed");
    use std::io::Read;
    let mut out_str = String::new();
    let mut reader = std::io::BufReader::new(stdout);
    reader.read_to_string(&mut out_str).expect("read stdout");
    let inst_id = out_str
        .lines()
        .find_map(|l| l.strip_prefix("INST_ID:"))
        .expect("must output INST_ID")
        .trim()
        .to_string();
    let actor_id = out_str
        .lines()
        .find_map(|l| l.strip_prefix("ACTOR_ID:"))
        .expect("must output ACTOR_ID")
        .trim()
        .to_string();
    let key_fp = out_str
        .lines()
        .find_map(|l| l.strip_prefix("KEY_FP:"))
        .expect("must output KEY_FP")
        .trim()
        .to_string();

    struct CleanupGuard<'a> {
        account: &'a str,
        db: &'a std::path::Path,
        iso: &'a IsolatedSecretService,
    }
    impl<'a> Drop for CleanupGuard<'a> {
        fn drop(&mut self) {
            let exe = std::env::current_exe().expect("current exe");
            let mut cmd = std::process::Command::new(exe);
            cmd.arg("locked_collection_fails_closed_and_preserves_identity")
                .arg("--exact")
                .env("TEST_LOCKED_STARTUP_ACTION", "cleanup")
                .env("TEST_ACCOUNT", self.account)
                .env("TEST_DB_PATH", self.db.to_str().unwrap())
                .env("DBUS_SESSION_BUS_ADDRESS", &self.iso.dbus_addr)
                .env("XDG_DATA_HOME", &self.iso.temp_dir)
                .env("XDG_DATA_DIRS", &self.iso.temp_dir)
                .env_remove("DISPLAY")
                .env_remove("WAYLAND_DISPLAY");
            let _ = run_subprocess(cmd);
        }
    }
    let _cleanup = CleanupGuard {
        account: &inst_id,
        db: &db,
        iso: &iso,
    };

    // 2. Explicitly lock collection and assert its locked state
    iso.lock();
    assert!(iso.is_locked(), "collection must be explicitly locked");

    // 3. Exercise startup failure while locked
    let mut lock_cmd = std::process::Command::new(&exe);
    lock_cmd
        .arg("locked_collection_fails_closed_and_preserves_identity")
        .arg("--exact")
        .env("TEST_LOCKED_STARTUP_ACTION", "verify_locked_failure")
        .env("TEST_DB_PATH", db.to_str().unwrap())
        .env("TEST_EXPECTED_INST_ID", &inst_id)
        .env("DBUS_SESSION_BUS_ADDRESS", &iso.dbus_addr)
        .env("XDG_DATA_HOME", &iso.temp_dir)
        .env("XDG_DATA_DIRS", &iso.temp_dir)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY");
    let status = run_subprocess(lock_cmd);
    assert!(status.success(), "locked failure verification must pass");

    // 4. Unlock collection and assert unlocked state
    iso.unlock();
    assert!(!iso.is_locked(), "collection must be unlocked");

    // 5. Verify original key and installation identity remain unchanged
    let mut unlock_cmd = std::process::Command::new(&exe);
    unlock_cmd
        .arg("locked_collection_fails_closed_and_preserves_identity")
        .arg("--exact")
        .env("TEST_LOCKED_STARTUP_ACTION", "verify_unlocked_startup")
        .env("TEST_DB_PATH", db.to_str().unwrap())
        .env("TEST_EXPECTED_INST_ID", &inst_id)
        .env("TEST_EXPECTED_ACTOR_ID", &actor_id)
        .env("TEST_EXPECTED_KEY_FP", &key_fp)
        .env("DBUS_SESSION_BUS_ADDRESS", &iso.dbus_addr)
        .env("XDG_DATA_HOME", &iso.temp_dir)
        .env("XDG_DATA_DIRS", &iso.temp_dir)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY");
    let status = run_subprocess(unlock_cmd);
    assert!(status.success(), "unlocked startup verification must pass");
}
