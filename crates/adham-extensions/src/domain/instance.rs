use crate::domain::package::{PackageDigest, PackageId};
use serde::{Deserialize, Serialize};
use std::fmt;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PathContainmentError {
    #[error("Path traversal attempt or illegal separator detected: '{path}'")]
    TraversalEscape { path: String },

    #[error("Absolute path or drive letter forbidden: '{path}'")]
    AbsolutePathForbidden { path: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PluginInstanceId(pub String);

impl PluginInstanceId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for PluginInstanceId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for PluginInstanceId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

pub type DataGeneration = u64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PluginRuntimeInstance {
    pub instance_id: PluginInstanceId,
    pub package_id: PackageId,
    pub package_digest: PackageDigest,
    pub data_generation: DataGeneration,
    pub plugin_root_readonly: String,
    pub plugin_data_isolated: String,
}

impl PluginRuntimeInstance {
    pub fn new(
        package_id: PackageId,
        package_digest: PackageDigest,
        data_generation: DataGeneration,
        plugin_root_readonly: impl Into<String>,
        plugin_data_isolated: impl Into<String>,
    ) -> Self {
        Self {
            instance_id: PluginInstanceId::new(),
            package_id,
            package_digest,
            data_generation,
            plugin_root_readonly: plugin_root_readonly.into(),
            plugin_data_isolated: plugin_data_isolated.into(),
        }
    }

    /// Resolves and validates a relative path inside the isolated PLUGIN_DATA directory.
    /// Strictly rejects path escapes, absolute paths, and parent directory references.
    pub fn resolve_data_path(&self, relative_path: &str) -> Result<String, PathContainmentError> {
        let trimmed = relative_path.trim();
        if trimmed.contains("..")
            || trimmed.contains('\\')
            || trimmed.contains(':')
            || trimmed.contains('\0')
        {
            return Err(PathContainmentError::TraversalEscape {
                path: trimmed.to_string(),
            });
        }

        if trimmed.starts_with('/') {
            return Err(PathContainmentError::AbsolutePathForbidden {
                path: trimmed.to_string(),
            });
        }

        let base = self.plugin_data_isolated.trim_end_matches('/');
        Ok(format!("{}/{}", base, trimmed))
    }
}
