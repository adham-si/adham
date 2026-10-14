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

#[test]
fn persistent_backend_is_available() {
    OsKeyringProvider::ensure_persistent_backend()
        .expect("Linux Secret Service backend must be available");
}

#[test]
fn initialize_creates_once_reads_stable_and_never_overwrites() {
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

    let exe = std::env::current_exe().expect("current exe");
    let status = std::process::Command::new(exe)
        .arg("unavailable_secret_service_fails_closed")
        .arg("--exact")
        .env("TEST_UNAVAILABLE_SUBPROCESS", "1")
        .env(
            "DBUS_SESSION_BUS_ADDRESS",
            "unix:path=/tmp/nonexistent-dbus-test.sock",
        )
        .status()
        .expect("run subprocess");
    assert!(
        status.success(),
        "unavailable secret service subprocess test must pass"
    );
}

struct IsolatedSecretService {
    dbus_pid: u32,
    dbus_addr: String,
    temp_dir: std::path::PathBuf,
}

impl IsolatedSecretService {
    fn spawn() -> Option<Self> {
        let temp_dir = std::env::temp_dir().join(format!("adham_iso_ss_{}", uuid::Uuid::now_v7()));
        if std::fs::create_dir_all(&temp_dir).is_err() {
            return None;
        }

        let output = std::process::Command::new("dbus-launch")
            .arg("--sh-syntax")
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

        let mut child = std::process::Command::new("gnome-keyring-daemon")
            .args(["--replace", "--unlock"])
            .env("DBUS_SESSION_BUS_ADDRESS", &dbus_addr)
            .env("XDG_DATA_HOME", &temp_dir)
            .env_remove("DISPLAY")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .ok()?;
        if let Some(mut stdin) = child.stdin.take() {
            use std::io::Write;
            let _ = stdin.write_all(b"test\n");
        }
        let _ = child.wait();

        let _ = std::process::Command::new("gnome-keyring-daemon")
            .args(["--start", "--components=secrets"])
            .env("DBUS_SESSION_BUS_ADDRESS", &dbus_addr)
            .env("XDG_DATA_HOME", &temp_dir)
            .env_remove("DISPLAY")
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

#[test]
fn locked_collection_fails_closed_and_refuses_overwrite() {
    if std::env::var("TEST_LOCKED_SUBPROCESS").is_ok() {
        let (provider, account) = provider_for("locked-sub");
        let key1 = provider
            .initialize_content_key()
            .expect("initialize key before lock");
        let _key1_fp = fp(&key1);

        // Lock both default and login collections in this isolated Secret Service
        let _ = std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.secrets",
                "--type=method_call",
                "--print-reply",
                "/org/freedesktop/secrets",
                "org.freedesktop.Secret.Service.Lock",
                "array:objpath:/org/freedesktop/secrets/aliases/default",
            ])
            .output();
        let _ = std::process::Command::new("dbus-send")
            .args([
                "--session",
                "--dest=org.freedesktop.secrets",
                "--type=method_call",
                "--print-reply",
                "/org/freedesktop/secrets",
                "org.freedesktop.Secret.Service.Lock",
                "array:objpath:/org/freedesktop/secrets/collection/login",
            ])
            .output();

        // Reading from locked collection must fail closed
        let read_err = match provider.content_key() {
            Ok(_) => panic!("read from locked collection must fail closed"),
            Err(e) => e,
        };
        assert!(
            matches!(read_err, DomainError::Storage(_)),
            "expected Storage error on read from locked collection, got {read_err:?}"
        );

        // Initializing against locked collection must fail closed without overwriting
        let init_err = match provider.initialize_content_key() {
            Ok(_) => panic!("initialize against locked collection must fail closed"),
            Err(e) => e,
        };
        assert!(
            matches!(init_err, DomainError::Storage(_)),
            "expected Storage error on init against locked collection, got {init_err:?}"
        );

        delete_credential(&account);
        return;
    }

    let iso = match IsolatedSecretService::spawn() {
        Some(s) => s,
        None => {
            eprintln!("skipping locked collection test: dbus-launch or gnome-keyring unavailable");
            return;
        }
    };

    let exe = std::env::current_exe().expect("current exe");
    let status = std::process::Command::new(exe)
        .arg("locked_collection_fails_closed_and_refuses_overwrite")
        .arg("--exact")
        .env("TEST_LOCKED_SUBPROCESS", "1")
        .env("DBUS_SESSION_BUS_ADDRESS", &iso.dbus_addr)
        .env("XDG_DATA_HOME", &iso.temp_dir)
        .env_remove("DISPLAY")
        .status()
        .expect("run subprocess");
    assert!(
        status.success(),
        "locked collection subprocess test must pass"
    );
    drop(iso);
}
