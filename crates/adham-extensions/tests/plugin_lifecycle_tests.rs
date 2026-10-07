use adham_extensions::domain::package::{PackageDigest, AGENT_PLUGINS_SCHEMA_V1};
use adham_extensions::domain::publisher::PublisherIdentity;
use adham_extensions::domain::receipt::PluginInstallationState;
use adham_extensions::service::installer::PluginInstaller;
use adham_extensions::service::lifecycle_controller::{LifecycleError, PluginLifecycleController};

fn setup_test_plugin() -> (
    adham_extensions::domain::receipt::InstallReceipt,
    adham_extensions::domain::instance::PluginRuntimeInstance,
) {
    let manifest_json = format!(
        r#"{{
            "$schema": "{}",
            "name": "lifecycle-plugin",
            "version": "1.0.0"
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );

    let publisher = PublisherIdentity::unverified("pub-life", "Tester");
    PluginInstaller::install_package(
        &manifest_json,
        &["plugin.json"],
        publisher,
        "/app/storage/plugins",
        1700000000,
    )
    .unwrap()
}

#[test]
fn test_plugin_explicit_activation_lifecycle() {
    let (mut receipt, _) = setup_test_plugin();

    assert_eq!(receipt.state, PluginInstallationState::InstalledDisabled);

    // Explicit user activation
    PluginLifecycleController::activate(&mut receipt).expect("Activation should succeed");
    assert_eq!(receipt.state, PluginInstallationState::Active);

    // Suspend plugin
    PluginLifecycleController::suspend(&mut receipt, "User paused plugin");
    assert!(matches!(
        receipt.state,
        PluginInstallationState::Suspended { .. }
    ));

    // Re-activate from suspended state
    PluginLifecycleController::activate(&mut receipt).expect("Reactivation should succeed");
    assert_eq!(receipt.state, PluginInstallationState::Active);
}

#[test]
fn test_quarantine_blocks_activation() {
    let (mut receipt, _) = setup_test_plugin();

    // Quarantine due to anomaly
    PluginLifecycleController::quarantine(&mut receipt, "Integrity hash mismatch detected");
    assert!(matches!(
        receipt.state,
        PluginInstallationState::Quarantined { .. }
    ));

    // Activation must be strictly blocked
    let res = PluginLifecycleController::activate(&mut receipt);
    assert!(matches!(
        res,
        Err(LifecycleError::IllegalActivationState(
            PluginInstallationState::Quarantined { .. }
        ))
    ));
}

#[test]
fn test_safe_rollback_and_generation_compatibility() {
    let (mut receipt, mut instance) = setup_test_plugin();

    // Advance generation to 2 after schema migration
    instance.data_generation = 2;

    let v1_digest = PackageDigest("blake3_digest_version_1".to_string());

    // Legal rollback: downgrade to generation 1
    let legal =
        PluginLifecycleController::rollback(&mut instance, &mut receipt, v1_digest.clone(), 1);
    assert!(legal.is_ok());
    assert_eq!(instance.data_generation, 1);
    assert_eq!(instance.package_digest, v1_digest);

    // Illegal rollback: targeting an incompatible future generation (e.g. 3 when current is 1)
    let illegal =
        PluginLifecycleController::rollback(&mut instance, &mut receipt, v1_digest.clone(), 3);
    assert!(matches!(
        illegal,
        Err(LifecycleError::IncompatibleDataGeneration {
            current: 1,
            target: 3
        })
    ));

    // Illegal rollback: quarantined target
    PluginLifecycleController::quarantine(&mut receipt, "Security incident");
    let quarantined_target =
        PluginLifecycleController::rollback(&mut instance, &mut receipt, v1_digest, 1);
    assert!(matches!(
        quarantined_target,
        Err(LifecycleError::RevokedOrQuarantinedRollbackTarget)
    ));
}

#[test]
fn test_uninstallation_transitions_to_removed() {
    let (mut receipt, _) = setup_test_plugin();
    PluginLifecycleController::activate(&mut receipt).unwrap();

    PluginLifecycleController::uninstall(&mut receipt);
    assert_eq!(receipt.state, PluginInstallationState::Removed);
}
