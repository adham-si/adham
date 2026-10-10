//! Real Windows Credential Manager lifecycle for the native content key.
//!
//! Synthetic service name only (`adham-audit04-*`), never the production
//! `adham-content-key` service. Every test deletes its credential on exit.
//! Key bytes are never printed; cross-process checks compare blake3
//! fingerprints only.

#![cfg(windows)]

use adham_core_types::{ContentId, DomainError, EventScope, InstallationId};
use adham_event_log::sqlite::content_crypto::{open, seal};
use adham_event_log::{ContentKeyProvider, OsKeyringProvider};

const SERVICE: &str = "adham-audit04-lifecycle-test";

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

    let canary = b"p0-audit04-synthetic-canary";
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

const XPROC_ENV: &str = "ADHAM_AUDIT04_XPROC_CHILD";

#[test]
fn cross_process_key_persistence() {
    if std::env::var(XPROC_ENV).is_ok() {
        let service = std::env::var("ADHAM_XPROC_SERVICE").expect("service env");
        let account = std::env::var("ADHAM_XPROC_ACCOUNT").expect("account env");
        let provider = OsKeyringProvider::new(&service, &account);
        let key = provider.content_key().expect("child read-only key load");
        let fp = blake3::hash(&key).to_hex().to_string();
        println!("XPROC_FP={fp}");
        std::process::exit(0);
    }

    let (provider, account) = provider_for("xproc");
    let key_parent = provider.initialize_content_key().expect("parent init");
    let fp_parent = blake3::hash(&key_parent).to_hex().to_string();

    let exe = std::env::current_exe().expect("test binary path");
    let out = std::process::Command::new(exe)
        .args(["--exact", "cross_process_key_persistence", "--nocapture"])
        .env(XPROC_ENV, "1")
        .env("ADHAM_XPROC_SERVICE", SERVICE)
        .env("ADHAM_XPROC_ACCOUNT", &account)
        .output()
        .expect("spawn child process");
    assert!(out.status.success(), "child failed: {out:?}");

    let stdout = String::from_utf8_lossy(&out.stdout);
    let fp_child = stdout
        .lines()
        .find_map(|l| l.strip_prefix("XPROC_FP="))
        .expect("child printed fingerprint");
    assert_eq!(
        fp_parent, fp_child,
        "key must be byte-identical across processes"
    );
    eprintln!("cross-process key fingerprint (parent==child): {fp_parent}");

    delete_credential(&account);
}
