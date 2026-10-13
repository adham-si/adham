//! Real Linux Secret Service native restart and disposable save/reopen proof.
//!
//! Exercises end-to-end native startup, persistent credential retrieval across
//! distinct process lifetimes, and protected-content persistence using synthetic
//! canary data. Cleans up synthetic credentials and files on completion.

#![cfg(target_os = "linux")]

mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;
use adham_event_log::{create_sqlite_pool, ContentKeyProvider, OsKeyringProvider};
use adham_platform::PlatformStoragePolicy;
use std::sync::Arc;

const SERVICE: &str = "adham-linux-native-proof";

fn fp(key: &[u8; 32]) -> String {
    blake3::hash(key).to_hex().to_string()
}

fn delete_credential(account: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account) {
        let _ = entry.delete_credential();
    }
}

#[tokio::test]
async fn test_native_linux_restart_and_save_reopen_journey() {
    let temp_dir = std::env::temp_dir().join(format!("adham_linux_proof_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&temp_dir).expect("create temp dir");
    let home_str = temp_dir.to_str().unwrap().to_string();

    let base = PlatformStoragePolicy::resolve_base(None, Some(&home_str)).expect("resolve base");
    let policy = PlatformStoragePolicy::new(&base).expect("policy");
    policy.ensure_directories().expect("ensure directories");
    assert!(policy.data_dir().is_dir());

    let pool = create_sqlite_pool(policy.database_path())
        .await
        .expect("pool");

    OsKeyringProvider::ensure_persistent_backend()
        .expect("native persistent Secret Service must be available");

    let account = format!("proof-inst-{}", uuid::Uuid::now_v7());
    let provider = OsKeyringProvider::new(SERVICE, &account);
    let key1 = provider.initialize_content_key().expect("initialize key");
    let key1_fp = fp(&key1);

    // Boot API context with initialized key
    let ctx = ApiContext::load_or_create_with_key(pool.clone(), Arc::new(provider))
        .await
        .expect("initial boot");
    let inst_id = ctx.installation_id;

    // Create workspace, project, session using test helpers
    let ws_id = create_test_workspace(&ctx, "Linux Native Workspace").await;
    let proj_id = create_test_project(&ctx, &ws_id, "Linux Native Project").await;
    let sess_id = create_test_session(&ctx, &ws_id, &proj_id, Some("Linux Native Session")).await;

    // Submit synthetic canary message
    let canary_text = format!("linux-native-canary-{}", uuid::Uuid::now_v7());
    let msg_res = handle_submit_message(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload {
                text: canary_text.clone(),
            },
        },
    )
    .await
    .expect("submit message");
    let saved_msg_id = msg_res.data.message_id;

    // Drop context and simulate process restart
    drop(ctx);
    drop(pool);

    // RESTART: Reopen database in fresh context with fresh provider instance
    let pool2 = create_sqlite_pool(policy.database_path())
        .await
        .expect("reopen pool");
    let provider2 = OsKeyringProvider::new(SERVICE, &account);
    let key2 = provider2.content_key().expect("retrieve key after restart");
    let key2_fp = fp(&key2);

    assert_eq!(
        key1_fp, key2_fp,
        "key blake3 fingerprint must be stable across restart"
    );

    let ctx2 = ApiContext::load_or_create_with_key(pool2.clone(), Arc::new(provider2))
        .await
        .expect("reopen boot");
    assert_eq!(ctx2.installation_id, inst_id);

    // Read conversation back
    let conv = handle_get_conversation(
        &ctx2,
        CommandContext {
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        },
    )
    .await
    .expect("get conversation");

    assert_eq!(conv.items.len(), 1);
    assert_eq!(conv.items[0].message_id, saved_msg_id);
    assert_eq!(conv.items[0].text, canary_text);

    // Cleanup: delete credential and verify fail-closed
    delete_credential(&account);
    let post_delete_provider = OsKeyringProvider::new(SERVICE, &account);
    assert!(
        post_delete_provider.content_key().is_err(),
        "key must fail closed after deletion"
    );

    drop(ctx2);
    drop(pool2);
    let _ = std::fs::remove_dir_all(&temp_dir);
}
