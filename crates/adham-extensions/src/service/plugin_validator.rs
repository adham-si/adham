use crate::domain::package::{
    PackageDigest, PackageManifest, PluginVersion, AGENT_PLUGINS_SCHEMA_V1,
};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PluginValidationError {
    #[error("Missing or invalid $schema declaration: expected '{expected}', found '{actual:?}'")]
    InvalidSchema {
        expected: &'static str,
        actual: Option<String>,
    },

    #[error("Plugin name is missing, empty, or contains illegal characters")]
    InvalidName,

    #[error("Path containment violation in field '{field}': '{path}'")]
    PathContainmentViolation { field: String, path: String },

    #[error("JSON parsing error: {0}")]
    JsonParseError(String),
}

pub struct PluginValidator;

impl PluginValidator {
    /// Parses and validates a portable plugin.json according to Agent Plugins 1.0.0 specification.
    /// Nonfatal unrecognized top-level fields are safely captured and ignored.
    pub fn validate_manifest(raw_json: &str) -> Result<PackageManifest, PluginValidationError> {
        let root: serde_json::Value = serde_json::from_str(raw_json)
            .map_err(|e| PluginValidationError::JsonParseError(e.to_string()))?;

        let obj = root.as_object().ok_or(PluginValidationError::InvalidName)?;

        // Validate $schema
        let schema_val = obj.get("$schema").and_then(|v| v.as_str());
        if schema_val != Some(AGENT_PLUGINS_SCHEMA_V1) {
            return Err(PluginValidationError::InvalidSchema {
                expected: AGENT_PLUGINS_SCHEMA_V1,
                actual: schema_val.map(|s| s.to_string()),
            });
        }

        // Validate name
        let name_val = obj
            .get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if name_val.is_empty()
            || name_val.contains('/')
            || name_val.contains('\\')
            || name_val.contains(':')
        {
            return Err(PluginValidationError::InvalidName);
        }

        let version = obj
            .get("version")
            .and_then(|v| v.as_str())
            .map(PluginVersion::new);

        let description = obj
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());

        let mut manifest =
            PackageManifest::new(AGENT_PLUGINS_SCHEMA_V1, name_val, version, description);

        // Validate skills_dir if present
        if let Some(skills_val) = obj.get("skills").and_then(|v| v.as_str()) {
            Self::check_contained_path("skills", skills_val)?;
            manifest.skills_dir = Some(skills_val.to_string());
        }

        // Validate mcp_config if present
        if let Some(mcp_val) = obj.get("mcp").and_then(|v| v.as_str()) {
            Self::check_contained_path("mcp", mcp_val)?;
            manifest.mcp_config = Some(mcp_val.to_string());
        }

        // Capture nonfatal unknown fields
        let known_keys = ["$schema", "name", "version", "description", "skills", "mcp"];
        let mut unknown_fields = HashMap::new();
        for (k, v) in obj {
            if !known_keys.contains(&k.as_str()) {
                unknown_fields.insert(k.clone(), v.clone());
            }
        }
        manifest.unknown_fields = unknown_fields;

        Ok(manifest)
    }

    /// Computes canonical package digest over the raw package content bytes.
    pub fn compute_package_digest(package_bytes: &[u8]) -> PackageDigest {
        PackageDigest::compute_from_bytes(package_bytes)
    }

    pub fn check_contained_path(field: &str, path: &str) -> Result<(), PluginValidationError> {
        let trimmed = path.trim();
        if trimmed.contains("..")
            || trimmed.contains('\\')
            || trimmed.contains(':')
            || trimmed.starts_with('/')
        {
            return Err(PluginValidationError::PathContainmentViolation {
                field: field.to_string(),
                path: trimmed.to_string(),
            });
        }
        Ok(())
    }
}
