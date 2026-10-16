//! Authoritative system facts: resolved storage location, app version, platform.
//! No fabricated fallbacks: resolution failure is an error, not a guess.

mod common;

#[tokio::test]
async fn storage_status_carries_the_resolved_data_directory() {
    let ctx = common::setup_ctx(&common::test_db_path()).await;
    let status = adham_desktop_api::handle_get_storage_status(&ctx)
        .await
        .expect("storage status");
    assert!(
        !status.data_dir.is_empty(),
        "data_dir must be resolved, never blank"
    );
    assert!(
        std::path::Path::new(&status.data_dir).is_absolute(),
        "data_dir must be absolute: {}",
        status.data_dir
    );
    assert!(!status.journal_mode.is_empty());
}

#[test]
fn platform_info_carries_real_build_identity() {
    let info = adham_desktop_api::handle_get_platform_info();
    assert_eq!(info.app_version, env!("CARGO_PKG_VERSION"));
    assert!(
        info.build_profile == "debug" || info.build_profile == "release",
        "unexpected build profile: {}",
        info.build_profile
    );
    assert!(!info.os.is_empty() && !info.arch.is_empty());
}
