use adham_extensions::domain::instance::PathContainmentError;
use adham_extensions::domain::package::AGENT_PLUGINS_SCHEMA_V1;
use adham_extensions::domain::publisher::PublisherIdentity;
use adham_extensions::domain::receipt::PluginInstallationState;
use adham_extensions::service::installer::{InstallError, PluginInstaller};

#[test]
fn test_plugin_installation_starts_strictly_disabled() {
    let manifest_json = format!(
        r#"{{
            "$schema": "{}",
            "name": "docker-helper",
            "version": "0.4.0",
            "description": "Docker container assistance"
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );

    let file_manifest = vec!["plugin.json", "README.md", "skills/docker/SKILL.md"];

    let publisher = PublisherIdentity::unverified("pub-123", "Community Contributor");

    let (receipt, instance) = PluginInstaller::install_package(
        &manifest_json,
        &file_manifest,
        publisher,
        "/app/storage/plugins",
        1700000000,
    )
    .expect("Inert installation should succeed");

    // Invariant: Zero scripts executed, newly installed package starts InstalledDisabled
    assert_eq!(receipt.state, PluginInstallationState::InstalledDisabled);
    assert_eq!(receipt.package_id.0, "docker-helper");
    assert_eq!(instance.data_generation, 1);
    assert!(instance
        .plugin_root_readonly
        .contains("packages/docker-helper/"));
    assert!(instance.plugin_data_isolated.contains("instances/"));
}

#[test]
fn test_rejection_of_path_escapes_in_package_artifacts() {
    let manifest_json = format!(
        r#"{{
            "$schema": "{}",
            "name": "malicious-package"
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );

    // Artifact attempting directory traversal
    let bad_files = vec!["plugin.json", "../../system/malicious.bat"];

    let publisher = PublisherIdentity::unverified("bad-pub", "Untrusted");

    let result = PluginInstaller::install_package(
        &manifest_json,
        &bad_files,
        publisher,
        "/app/storage/plugins",
        1700000000,
    );

    assert!(matches!(
        result,
        Err(InstallError::ArtifactPathEscape { .. })
    ));
}

#[test]
fn test_instance_data_path_containment_and_isolation() {
    let manifest_json = format!(
        r#"{{
            "$schema": "{}",
            "name": "stateful-plugin"
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );

    let publisher = PublisherIdentity::unverified("pub-state", "Author");
    let (_, instance) = PluginInstaller::install_package(
        &manifest_json,
        &["plugin.json"],
        publisher,
        "/app/storage/plugins",
        1700000000,
    )
    .unwrap();

    // Valid nested relative data path
    let valid_path = instance.resolve_data_path("cache/index.json").unwrap();
    assert!(valid_path.contains("instances/"));
    assert!(valid_path.ends_with("/cache/index.json"));

    // Traversal escape attempt
    let traversal = instance.resolve_data_path("../sibling_instance/keys.json");
    assert!(matches!(
        traversal,
        Err(PathContainmentError::TraversalEscape { .. })
    ));

    // Absolute path attempt
    let absolute = instance.resolve_data_path("/etc/passwd");
    assert!(matches!(
        absolute,
        Err(PathContainmentError::AbsolutePathForbidden { .. })
    ));
}

#[test]
fn test_install_plan_has_no_filesystem_effects_and_no_execution() {
    // The installer is a domain plan only: it must not create directories,
    // write files, or wire execution. Real installation with verified bytes,
    // bounded extraction, and atomic activation is a separate workstream.
    let dir = std::env::temp_dir().join(format!("adham_plugin_plan_{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&dir).expect("temp base");
    let base = dir.to_string_lossy().replace('\\', "/");
    let before: Vec<_> = std::fs::read_dir(&dir).expect("read").collect();

    let manifest_json = format!(
        r#"{{
            "$schema": "{}",
            "name": "plan-only"
        }}"#,
        AGENT_PLUGINS_SCHEMA_V1
    );
    let publisher = PublisherIdentity::unverified("pub-plan", "Author");
    let (receipt, _instance) = PluginInstaller::install_package(
        &manifest_json,
        &["plugin.json"],
        publisher,
        &base,
        1700000000,
    )
    .expect("plan");
    assert_eq!(receipt.state, PluginInstallationState::InstalledDisabled);

    let after: Vec<_> = std::fs::read_dir(&dir).expect("read").collect();
    assert_eq!(
        before.len(),
        after.len(),
        "installer must not touch the filesystem"
    );
    std::fs::remove_dir_all(&dir).ok();
}
