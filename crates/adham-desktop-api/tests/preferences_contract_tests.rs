//! Typed preference contracts: defaults, validation, revision conflicts, reset.
//! Uses the shared test harness (temp DB + in-memory key provider).

mod common;

use adham_desktop_api::{AppPreferences, UpdatePreferencesPayload};

fn prefs_with(appearance: &str, language: &str) -> AppPreferences {
    AppPreferences {
        appearance: appearance.to_string(),
        language: language.to_string(),
        font_family: "default".to_string(),
        font_size: "md".to_string(),
        high_contrast: "system".to_string(),
        reduced_motion: "system".to_string(),
        enter_to_send: true,
    }
}

#[tokio::test]
async fn get_returns_defaults_at_revision_zero_on_fresh_install() {
    let ctx = common::setup_ctx(&common::test_db_path()).await;
    let res = adham_desktop_api::handle_get_app_preferences(&ctx)
        .await
        .expect("get prefs");
    assert_eq!(res.revision, 0);
    assert_eq!(res.preferences, AppPreferences::defaults());
}

#[tokio::test]
async fn update_valid_preferences_persists_and_bumps_revision() {
    let ctx = common::setup_ctx(&common::test_db_path()).await;
    let next = prefs_with("dark", "ar");
    let res = adham_desktop_api::handle_update_app_preferences(
        &ctx,
        UpdatePreferencesPayload {
            preferences: next.clone(),
            base_revision: 0,
        },
    )
    .await
    .expect("update prefs");
    assert_eq!(res.revision, 1);
    assert_eq!(res.preferences, next);

    let reread = adham_desktop_api::handle_get_app_preferences(&ctx)
        .await
        .expect("get prefs");
    assert_eq!(reread.revision, 1);
    assert_eq!(reread.preferences.language, "ar");
}

#[tokio::test]
async fn update_rejects_values_outside_the_allowlist() {
    let ctx = common::setup_ctx(&common::test_db_path()).await;
    for bad in [
        prefs_with("neon", "en"),
        prefs_with("dark", "xx"),
        AppPreferences {
            font_size: "huge".to_string(),
            ..AppPreferences::defaults()
        },
    ] {
        let err = adham_desktop_api::handle_update_app_preferences(
            &ctx,
            UpdatePreferencesPayload {
                preferences: bad,
                base_revision: 0,
            },
        )
        .await
        .expect_err("invalid preferences must be rejected");
        assert!(
            err.starts_with("VALIDATION_FAILED"),
            "unexpected error: {err}"
        );
    }
    // Nothing was written: still defaults at revision 0.
    let reread = adham_desktop_api::handle_get_app_preferences(&ctx)
        .await
        .expect("get prefs");
    assert_eq!(reread.revision, 0);
}

#[tokio::test]
async fn update_with_stale_base_conflicts_and_keeps_current() {
    let ctx = common::setup_ctx(&common::test_db_path()).await;
    adham_desktop_api::handle_update_app_preferences(
        &ctx,
        UpdatePreferencesPayload {
            preferences: prefs_with("dark", "en"),
            base_revision: 0,
        },
    )
    .await
    .expect("first write");

    let err = adham_desktop_api::handle_update_app_preferences(
        &ctx,
        UpdatePreferencesPayload {
            preferences: prefs_with("light", "ru"),
            base_revision: 0,
        },
    )
    .await
    .expect_err("stale base must conflict");
    assert!(
        err.starts_with("PREFERENCE_REVISION_CONFLICT"),
        "unexpected error: {err}"
    );

    let reread = adham_desktop_api::handle_get_app_preferences(&ctx)
        .await
        .expect("get prefs");
    assert_eq!(reread.revision, 1);
    assert_eq!(reread.preferences.appearance, "dark");
}

#[tokio::test]
async fn reset_returns_installation_to_defaults_at_next_revision() {
    let ctx = common::setup_ctx(&common::test_db_path()).await;
    adham_desktop_api::handle_update_app_preferences(
        &ctx,
        UpdatePreferencesPayload {
            preferences: prefs_with("dark", "ar"),
            base_revision: 0,
        },
    )
    .await
    .expect("first write");
    let res = adham_desktop_api::handle_reset_app_preferences(&ctx)
        .await
        .expect("reset");
    // Monotonic: revision moves forward to 2 with the defaults document.
    assert_eq!(res.revision, 2);
    assert_eq!(res.preferences, AppPreferences::defaults());
    let reread = adham_desktop_api::handle_get_app_preferences(&ctx)
        .await
        .expect("get prefs");
    assert_eq!(reread.revision, 2);
    assert_eq!(reread.preferences, AppPreferences::defaults());
}
