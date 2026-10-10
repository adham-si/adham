//! Backend-guard behavior against a non-persistent (mock) credential store.
//!
//! The keyring default builder is process-global, so this file is a dedicated
//! test binary: every test here expects the mock builder and never touches the
//! real OS credential store.

use adham_event_log::{ContentKeyProvider, OsKeyringProvider};

fn install_mock_backend() {
    keyring::set_default_credential_builder(keyring::mock::default_credential_builder());
}

#[test]
fn ensure_persistent_backend_rejects_mock_store() {
    install_mock_backend();
    let err = OsKeyringProvider::ensure_persistent_backend().expect_err("mock must be rejected");
    let msg = err.to_string();
    assert!(
        msg.contains("no supported OS credential backend"),
        "unexpected error: {msg}"
    );
}

#[test]
fn content_key_on_mock_store_never_mints() {
    install_mock_backend();
    let provider = OsKeyringProvider::new("adham-audit04-guard-test", "missing-account");
    let err = match provider.content_key() {
        Ok(_) => panic!("must fail closed"),
        Err(e) => e,
    };
    let msg = err.to_string();
    assert!(
        msg.contains("content key missing from credential store")
            && msg.contains("automatic (re)creation is disabled"),
        "unexpected error: {msg}"
    );
}

#[test]
fn initialize_on_mock_store_fails_read_back_verification() {
    install_mock_backend();
    let provider = OsKeyringProvider::new("adham-audit04-guard-test", "readback-account");
    let err = match provider.initialize_content_key() {
        Ok(_) => panic!("entry-scoped store cannot pass read-back verify"),
        Err(e) => e,
    };
    let msg = err.to_string();
    assert!(msg.contains("did not persist"), "unexpected error: {msg}");
}
