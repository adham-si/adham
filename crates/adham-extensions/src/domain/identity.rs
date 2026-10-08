use serde::{Deserialize, Serialize};
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SkillSourceKind {
    User,
    Workspace,
    Project,
    Plugin,
}

impl fmt::Display for SkillSourceKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::User => write!(f, "user"),
            Self::Workspace => write!(f, "workspace"),
            Self::Project => write!(f, "project"),
            Self::Plugin => write!(f, "plugin"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CanonicalSkillId {
    pub source_kind: SkillSourceKind,
    pub scope_owner: String,
    pub skill_name: String,
    pub revision_hash: String,
}

impl CanonicalSkillId {
    pub fn new(
        source_kind: SkillSourceKind,
        scope_owner: impl Into<String>,
        skill_name: impl Into<String>,
        revision_hash: impl Into<String>,
    ) -> Self {
        Self {
            source_kind,
            scope_owner: scope_owner.into(),
            skill_name: skill_name.into(),
            revision_hash: revision_hash.into(),
        }
    }

    pub fn to_canonical_uri(&self) -> String {
        format!(
            "{}:{}/{}@{}",
            self.source_kind, self.scope_owner, self.skill_name, self.revision_hash
        )
    }
}

impl fmt::Display for CanonicalSkillId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_canonical_uri())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct McpConnectionId(pub String);

impl McpConnectionId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }

    pub fn from_string(id: impl Into<String>) -> Self {
        Self(id.into())
    }
}

impl Default for McpConnectionId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for McpConnectionId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CanonicalToolId {
    pub connection_id: McpConnectionId,
    pub server_generation: u64,
    pub tool_name: String,
}

impl CanonicalToolId {
    pub fn new(
        connection_id: McpConnectionId,
        server_generation: u64,
        tool_name: impl Into<String>,
    ) -> Self {
        Self {
            connection_id,
            server_generation,
            tool_name: tool_name.into(),
        }
    }

    pub fn to_identifier(&self) -> String {
        format!(
            "{}:{}:{}",
            self.connection_id, self.server_generation, self.tool_name
        )
    }
}

impl fmt::Display for CanonicalToolId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.to_identifier())
    }
}
