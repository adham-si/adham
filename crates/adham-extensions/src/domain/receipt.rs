use crate::domain::package::{PackageDigest, PackageId, PluginVersion};
use crate::domain::publisher::TrustTier;
use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct InstallReceiptId(pub String);

impl InstallReceiptId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for InstallReceiptId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for InstallReceiptId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum PluginInstallationState {
    Staged,
    Validated,
    /// Invariant: Newly installed packages start strictly disabled!
    InstalledDisabled,
    Active,
    Suspended {
        reason: String,
    },
    Quarantined {
        reason: String,
    },
    Revoked {
        reason: String,
    },
    Removed,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InstallReceipt {
    pub receipt_id: InstallReceiptId,
    pub package_id: PackageId,
    pub package_digest: PackageDigest,
    pub installed_version: Option<PluginVersion>,
    pub trust_tier: TrustTier,
    pub state: PluginInstallationState,
    pub installed_at_epoch_ms: u64,
    pub immutable_package_root: String,
}

impl InstallReceipt {
    pub fn new_installed_disabled(
        package_id: PackageId,
        package_digest: PackageDigest,
        installed_version: Option<PluginVersion>,
        trust_tier: TrustTier,
        immutable_package_root: impl Into<String>,
        installed_at_epoch_ms: u64,
    ) -> Self {
        Self {
            receipt_id: InstallReceiptId::new(),
            package_id,
            package_digest,
            installed_version,
            trust_tier,
            state: PluginInstallationState::InstalledDisabled,
            installed_at_epoch_ms,
            immutable_package_root: immutable_package_root.into(),
        }
    }

    pub fn activate(&mut self) {
        self.state = PluginInstallationState::Active;
    }

    pub fn suspend(&mut self, reason: impl Into<String>) {
        self.state = PluginInstallationState::Suspended {
            reason: reason.into(),
        };
    }

    pub fn quarantine(&mut self, reason: impl Into<String>) {
        self.state = PluginInstallationState::Quarantined {
            reason: reason.into(),
        };
    }

    pub fn revoke(&mut self, reason: impl Into<String>) {
        self.state = PluginInstallationState::Revoked {
            reason: reason.into(),
        };
    }

    pub fn mark_removed(&mut self) {
        self.state = PluginInstallationState::Removed;
    }
}
