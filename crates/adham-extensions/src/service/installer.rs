use crate::domain::instance::{PluginInstanceId, PluginRuntimeInstance};
use crate::domain::package::{PackageDigest, PackageId};
use crate::domain::publisher::PublisherIdentity;
use crate::domain::receipt::{InstallReceipt, PluginInstallationState};
use crate::service::plugin_validator::{PluginValidationError, PluginValidator};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum InstallError {
    #[error("Validation failure: {0}")]
    Validation(#[from] PluginValidationError),

    #[error("Path escape detected in package artifact file: '{path}'")]
    ArtifactPathEscape { path: String },
}

pub struct PluginInstaller;

impl PluginInstaller {
    /// Simulates/executes inert package installation into the app-owned plugin store.
    /// Invariants:
    /// - Strictly zero install/postinstall scripts are executed.
    /// - Newly installed packages start in InstalledDisabled state.
    /// - Package root is read-only; instance data directory is partitioned and isolated.
    pub fn install_package(
        raw_manifest_json: &str,
        file_manifest: &[&str],
        publisher: PublisherIdentity,
        storage_base_dir: &str,
        installed_at_epoch_ms: u64,
    ) -> Result<(InstallReceipt, PluginRuntimeInstance), InstallError> {
        let manifest = PluginValidator::validate_manifest(raw_manifest_json)?;

        // Verify containment for every file listed in the package
        for &rel_path in file_manifest {
            PluginValidator::check_contained_path("file_entry", rel_path).map_err(|_| {
                InstallError::ArtifactPathEscape {
                    path: rel_path.to_string(),
                }
            })?;
        }

        let mut digest_input = raw_manifest_json.as_bytes().to_vec();
        for &f in file_manifest {
            digest_input.extend_from_slice(f.as_bytes());
        }
        let package_digest = PackageDigest::compute_from_bytes(&digest_input);

        let package_id = PackageId::new(&manifest.name);
        let clean_base = storage_base_dir.trim_end_matches('/');
        let immutable_pkg_root = format!(
            "{}/packages/{}/{}",
            clean_base,
            package_id,
            &package_digest.0[..12]
        );

        let receipt = InstallReceipt::new_installed_disabled(
            package_id.clone(),
            package_digest.clone(),
            manifest.version,
            publisher.trust_tier,
            immutable_pkg_root.clone(),
            installed_at_epoch_ms,
        );

        let instance_id = PluginInstanceId::new();
        let isolated_data_dir = format!("{}/instances/{}/data/gen_1", clean_base, instance_id);

        let runtime_instance = PluginRuntimeInstance {
            instance_id,
            package_id,
            package_digest,
            data_generation: 1,
            plugin_root_readonly: immutable_pkg_root,
            plugin_data_isolated: isolated_data_dir,
        };

        // Invariant check: Receipt must be InstalledDisabled
        debug_assert_eq!(receipt.state, PluginInstallationState::InstalledDisabled);

        Ok((receipt, runtime_instance))
    }
}
