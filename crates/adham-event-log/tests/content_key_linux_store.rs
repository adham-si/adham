//! Real Linux Secret Service lifecycle for the native content key.
//!
//! Synthetic service name only (`adham-audit04-linux-*`), never the
//! production `adham-content-key` service. Every test deletes its
//! credential on exit. Key bytes are never printed; comparisons use
//! blake3 fingerprints only. Mirrors the Windows/macOS lifecycle contract
//! without touching it.

#![cfg(target_os = "linux")]

use adham_core_types::{ContentId, DomainError, EventScope, InstallationId};
use adham_event_log::sqlite::content_crypto::{open, seal};
use adham_event_log::{ContentKeyProvider, OsKeyringProvider};

const SERVICE: &str = "adham-audit04-linux-lifecycle-test";

/// Comparison fingerprint for assertions; raw key bytes are never printed.
fn fp(key: &[u8; 32]) -> String {
    blake3::hash(key).to_hex().to_string()
}

fn provider_for(test: &str) -> (OsKeyringProvider, String) {
    let account = format!("{test}-{}", uuid::Uuid::now_v7());
    (OsKeyringProvider::new(SERVICE, &account), account)
}

fn delete_credential(account: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account) {
        let _ = entry.delete_credential();
    }
}

fn scope() -> EventScope {
    EventScope {
        installation_id: InstallationId::new_v7(),
        workspace_id: None,
        project_id: None,
        session_id: None,
    }
}

static TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[test]
fn persistent_backend_is_available() {
    let _guard = TEST_LOCK.lock().unwrap();
    OsKeyringProvider::ensure_persistent_backend()
        .expect("Linux Secret Service backend must be available");
}

#[test]
fn initialize_creates_once_reads_stable_and_never_overwrites() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (provider, account) = provider_for("create-once");
    let key1 = provider.initialize_content_key().expect("first init");

    let key_again = provider.initialize_content_key().expect("second init");
    assert_eq!(
        fp(&key1),
        fp(&key_again),
        "initialize must never rotate the key"
    );

    let fresh = OsKeyringProvider::new(SERVICE, &account);
    let read1 = fresh.content_key().expect("read 1");
    let read2 = fresh.content_key().expect("read 2");
    assert_eq!(
        fp(&read1),
        fp(&read2),
        "reads must be stable across calls/instances"
    );
    assert_eq!(fp(&read1), fp(&key1));

    delete_credential(&account);
}

#[test]
fn missing_key_fails_closed_without_mint() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (provider, account) = provider_for("no-mint");
    let err = match provider.content_key() {
        Ok(_) => panic!("must fail closed"),
        Err(e) => e,
    };
    match &err {
        DomainError::Storage(msg) => {
            assert!(
                msg.contains("content key missing from credential store"),
                "{msg}"
            );
            assert!(msg.contains("automatic (re)creation is disabled"), "{msg}");
        }
        other => panic!("expected Storage key-loss error, got {other:?}"),
    }

    let entry = keyring::Entry::new(SERVICE, &account).expect("entry");
    assert!(
        matches!(entry.get_password(), Err(keyring::Error::NoEntry)),
        "read path must not have written a credential"
    );
    delete_credential(&account);
}

#[test]
fn corrupt_key_is_integrity_error_and_not_overwritten() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (_provider, account) = provider_for("corrupt");
    let entry = keyring::Entry::new(SERVICE, &account).expect("entry");
    entry
        .set_password("zzzz-not-a-valid-key")
        .expect("seed corrupt");

    let read_err = match _provider.content_key() {
        Ok(_) => panic!("corrupt must fail"),
        Err(e) => e,
    };
    assert!(
        matches!(read_err, DomainError::Integrity(_)),
        "{read_err:?}"
    );

    let init_err = match _provider.initialize_content_key() {
        Ok(_) => panic!("init must refuse to overwrite"),
        Err(e) => e,
    };
    assert!(
        matches!(init_err, DomainError::Integrity(_)),
        "{init_err:?}"
    );
    let stored = entry.get_password().expect("still present");
    assert!(
        stored == "zzzz-not-a-valid-key",
        "corrupt value must not be silently reset"
    );
    delete_credential(&account);
}

#[test]
fn seal_open_roundtrip_and_scope_binding() {
    let _guard = TEST_LOCK.lock().unwrap();
    let (provider, account) = provider_for("seal-open");
    provider.initialize_content_key().expect("init");

    let canary = b"p0-audit04-synthetic-canary-linux";
    let sc = scope();
    let content_id = ContentId::new_v7();
    let sealed = seal(&provider, &content_id, "note", &sc, canary).expect("seal");
    let opened = open(
        &provider,
        &content_id,
        "note",
        &sc,
        &sealed.nonce,
        &sealed.ciphertext,
    )
    .expect("open");
    assert_eq!(opened, canary);

    let other = scope();
    let mismatch = open(
        &provider,
        &content_id,
        "note",
        &other,
        &sealed.nonce,
        &sealed.ciphertext,
    )
    .expect_err("scope mismatch must fail authentication");
    assert!(
        matches!(mismatch, DomainError::Integrity(_)),
        "{mismatch:?}"
    );

    delete_credential(&account);
}

#[test]
fn unavailable_secret_service_fails_closed() {
    if std::env::var("TEST_UNAVAILABLE_SUBPROCESS").is_ok() {
        let (provider, _account) = provider_for("sub-unavail");
        let read_err = match provider.content_key() {
            Ok(_) => panic!("must fail closed when service is unavailable"),
            Err(e) => e,
        };
        assert!(
            matches!(read_err, DomainError::Storage(_)),
            "expected Storage error on read, got {read_err:?}"
        );

        let init_err = match provider.initialize_content_key() {
            Ok(_) => panic!("init must fail closed when service is unavailable"),
            Err(e) => e,
        };
        assert!(
            matches!(init_err, DomainError::Storage(_)),
            "expected Storage error on init, got {init_err:?}"
        );
        return;
    }

    let _guard = TEST_LOCK.lock().unwrap();

    let exe = std::env::current_exe().expect("current exe");
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("unavailable_secret_service_fails_closed")
        .arg("--exact")
        .env("TEST_UNAVAILABLE_SUBPROCESS", "1")
        .env("DBUS_SESSION_BUS_ADDRESS", "disabled:")
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY");
    let status = run_subprocess(cmd);
    assert!(
        status.success(),
        "unavailable secret service subprocess test must pass"
    );
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
    temp_dir: std::path::PathBuf,
}

impl IsolatedSecretService {
    fn spawn() -> Self {
        let temp_dir = std::env::temp_dir().join(format!("adham_iso_ss_{}", uuid::Uuid::now_v7()));
        std::fs::create_dir_all(&temp_dir).expect("create isolated secret service temp dir");

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
        let mut child = std::process::Command::new("gnome-keyring-daemon")
            .args(["--replace", "--unlock"])
            .env("DBUS_SESSION_BUS_ADDRESS", &self.dbus_addr)
            .env("XDG_DATA_HOME", &self.temp_dir)
            .env("XDG_DATA_DIRS", &self.temp_dir)
            .env_remove("DISPLAY")
            .env_remove("WAYLAND_DISPLAY")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .expect("spawn gnome-keyring-daemon --replace --unlock");
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
            .args(["--start", "--components=secrets"])
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

#[test]
fn locked_collection_fails_closed_and_refuses_overwrite() {
    if let Ok(act) = std::env::var("TEST_LOCKED_ACTION") {
        let account = std::env::var("TEST_ACCOUNT").expect("account env");
        match act.as_str() {
            "seed" => {
                let provider = OsKeyringProvider::default_for_installation(&account);
                let key = provider
                    .initialize_content_key()
                    .expect("initialize content key while unlocked");
                println!("KEY_FP:{}", fp(&key));
                return;
            }
            "verify_locked_failure" => {
                let provider = OsKeyringProvider::default_for_installation(&account);

                let read_err = match provider.content_key() {
                    Ok(_) => panic!("read from locked collection must fail closed"),
                    Err(e) => e,
                };
                assert!(
                    matches!(read_err, DomainError::Storage(_)),
                    "expected Storage error on read from locked collection, got {read_err:?}"
                );

                let init_err = match provider.initialize_content_key() {
                    Ok(_) => panic!("initialize against locked collection must fail closed"),
                    Err(e) => e,
                };
                assert!(
                    matches!(init_err, DomainError::Storage(_)),
                    "expected Storage error on init against locked collection, got {init_err:?}"
                );
                return;
            }
            "verify_unlocked_read" => {
                let expected_fp = std::env::var("TEST_EXPECTED_FP").expect("expected fp env");
                let provider = OsKeyringProvider::default_for_installation(&account);

                let key = provider
                    .content_key()
                    .expect("read content key after unlock");
                assert_eq!(
                    fp(&key),
                    expected_fp,
                    "key must match original after unlock"
                );
                return;
            }
            "cleanup" => {
                delete_credential(&account);
                return;
            }
            other => panic!("unknown test action: {other}"),
        }
    }

    let _guard = TEST_LOCK.lock().unwrap();

    let iso = IsolatedSecretService::spawn();
    assert!(!iso.is_locked(), "collection must be initially unlocked");

    let account = format!("locked-sub-{}", uuid::Uuid::now_v7());

    struct CleanupGuard<'a> {
        account: &'a str,
        iso: &'a IsolatedSecretService,
    }
    impl<'a> Drop for CleanupGuard<'a> {
        fn drop(&mut self) {
            let exe = std::env::current_exe().expect("current exe");
            let mut cmd = std::process::Command::new(exe);
            cmd.arg("locked_collection_fails_closed_and_refuses_overwrite")
                .arg("--exact")
                .env("TEST_LOCKED_ACTION", "cleanup")
                .env("TEST_ACCOUNT", self.account)
                .env("DBUS_SESSION_BUS_ADDRESS", &self.iso.dbus_addr)
                .env("XDG_DATA_HOME", &self.iso.temp_dir)
                .env("XDG_DATA_DIRS", &self.iso.temp_dir)
                .env_remove("DISPLAY")
                .env_remove("WAYLAND_DISPLAY");
            let _ = run_subprocess(cmd);
        }
    }
    let _cleanup = CleanupGuard {
        account: &account,
        iso: &iso,
    };

    let exe = std::env::current_exe().expect("current exe");

    // 1. Seed credential while unlocked
    let mut seed_cmd = std::process::Command::new(&exe);
    seed_cmd
        .arg("locked_collection_fails_closed_and_refuses_overwrite")
        .arg("--exact")
        .arg("--nocapture")
        .env("TEST_LOCKED_ACTION", "seed")
        .env("TEST_ACCOUNT", &account)
        .env("DBUS_SESSION_BUS_ADDRESS", &iso.dbus_addr)
        .env("XDG_DATA_HOME", &iso.temp_dir)
        .env("XDG_DATA_DIRS", &iso.temp_dir)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY")
        .stdout(std::process::Stdio::piped());
    let mut child = seed_cmd.spawn().expect("spawn seed");
    let stdout = child.stdout.take().expect("stdout");
    let status = child.wait().expect("wait seed");
    assert!(status.success(), "seeding credential must succeed");
    use std::io::Read;
    let mut out_str = String::new();
    let mut reader = std::io::BufReader::new(stdout);
    reader.read_to_string(&mut out_str).expect("read stdout");
    let key_fp = out_str
        .lines()
        .find_map(|l| l.strip_prefix("KEY_FP:"))
        .expect("must output KEY_FP")
        .trim()
        .to_string();

    // 2. Explicitly lock collection and assert its locked state
    iso.lock();
    assert!(iso.is_locked(), "collection must be explicitly locked");

    // 3. Exercise provider failure while locked
    let mut lock_cmd = std::process::Command::new(&exe);
    lock_cmd
        .arg("locked_collection_fails_closed_and_refuses_overwrite")
        .arg("--exact")
        .env("TEST_LOCKED_ACTION", "verify_locked_failure")
        .env("TEST_ACCOUNT", &account)
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

    // 5. Verify original key remains unchanged after unlock
    let mut unlock_cmd = std::process::Command::new(&exe);
    unlock_cmd
        .arg("locked_collection_fails_closed_and_refuses_overwrite")
        .arg("--exact")
        .env("TEST_LOCKED_ACTION", "verify_unlocked_read")
        .env("TEST_ACCOUNT", &account)
        .env("TEST_EXPECTED_FP", &key_fp)
        .env("DBUS_SESSION_BUS_ADDRESS", &iso.dbus_addr)
        .env("XDG_DATA_HOME", &iso.temp_dir)
        .env("XDG_DATA_DIRS", &iso.temp_dir)
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY");
    let status = run_subprocess(unlock_cmd);
    assert!(status.success(), "unlocked read verification must pass");
}
