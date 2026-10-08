use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fmt;

pub const AGENT_PLUGINS_SCHEMA_V1: &str =
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PackageId(pub String);

impl PackageId {
    pub fn new(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

impl fmt::Display for PackageId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PluginVersion(pub String);

impl PluginVersion {
    pub fn new(version: impl Into<String>) -> Self {
        Self(version.into())
    }
}

impl fmt::Display for PluginVersion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PackageDigest(pub String);

impl PackageDigest {
    pub fn compute_from_bytes(bytes: &[u8]) -> Self {
        let hash = blake3::hash(bytes);
        Self(hash.to_hex().to_string())
    }
}

impl fmt::Display for PackageDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackageComponentInventory {
    pub skills: Vec<String>,
    pub mcp_servers: Vec<String>,
    pub declarative_contributions: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PackageManifest {
    pub schema: String,
    pub name: String,
    pub version: Option<PluginVersion>,
    pub description: Option<String>,
    pub skills_dir: Option<String>,
    pub mcp_config: Option<String>,
    /// Nonfatal unrecognized top-level fields (ignored without failing)
    pub unknown_fields: HashMap<String, serde_json::Value>,
}

impl PackageManifest {
    pub fn new(
        schema: impl Into<String>,
        name: impl Into<String>,
        version: Option<PluginVersion>,
        description: Option<String>,
    ) -> Self {
        Self {
            schema: schema.into(),
            name: name.into(),
            version,
            description,
            skills_dir: None,
            mcp_config: None,
            unknown_fields: HashMap::new(),
        }
    }
}
