use crate::domain::instance::{DataGeneration, PluginRuntimeInstance};
use crate::domain::package::PackageDigest;
use crate::domain::receipt::{InstallReceipt, PluginInstallationState};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum LifecycleError {
    #[error("Cannot activate: package is in state '{0:?}'")]
    IllegalActivationState(PluginInstallationState),

    #[error("Cannot rollback: target package digest is revoked or quarantined")]
    RevokedOrQuarantinedRollbackTarget,

    #[error("Incompatible data generation for rollback: current {current}, attempted {target}")]
    IncompatibleDataGeneration {
        current: DataGeneration,
        target: DataGeneration,
    },
}

pub struct PluginLifecycleController;

impl PluginLifecycleController {
    /// Explicit user activation of an installed-disabled or suspended plugin.
    pub fn activate(receipt: &mut InstallReceipt) -> Result<(), LifecycleError> {
        match &receipt.state {
            PluginInstallationState::InstalledDisabled
            | PluginInstallationState::Suspended { .. } => {
                receipt.activate();
                Ok(())
            }
            state => Err(LifecycleError::IllegalActivationState(state.clone())),
        }
    }

    /// Suspends plugin execution without deleting its state or components.
    pub fn suspend(receipt: &mut InstallReceipt, reason: impl Into<String>) {
        receipt.suspend(reason);
    }

    /// Quarantines an untrusted or suspicious plugin, immediately stopping new admissions.
    pub fn quarantine(receipt: &mut InstallReceipt, reason: impl Into<String>) {
        receipt.quarantine(reason);
    }

    /// Revokes a compromised or revoked plugin version.
    pub fn revoke(receipt: &mut InstallReceipt, reason: impl Into<String>) {
        receipt.revoke(reason);
    }

    /// Performs safe rollback to an earlier reviewed package digest and compatible data generation.
    pub fn rollback(
        instance: &mut PluginRuntimeInstance,
        receipt: &mut InstallReceipt,
        target_digest: PackageDigest,
        target_generation: DataGeneration,
    ) -> Result<(), LifecycleError> {
        if matches!(
            receipt.state,
            PluginInstallationState::Quarantined { .. } | PluginInstallationState::Revoked { .. }
        ) {
            return Err(LifecycleError::RevokedOrQuarantinedRollbackTarget);
        }

        // Incompatible future data generation cannot be targeted by an earlier package version
        if target_generation > instance.data_generation {
            return Err(LifecycleError::IncompatibleDataGeneration {
                current: instance.data_generation,
                target: target_generation,
            });
        }

        instance.package_digest = target_digest.clone();
        instance.data_generation = target_generation;
        receipt.package_digest = target_digest;

        Ok(())
    }

    /// Marks plugin as removed while preserving user-owned files, forks, and memories.
    pub fn uninstall(receipt: &mut InstallReceipt) {
        receipt.mark_removed();
    }
}
