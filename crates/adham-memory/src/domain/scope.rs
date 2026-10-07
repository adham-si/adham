use adham_core_types::{ProjectId, SessionId};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct MemoryId(pub String);

impl MemoryId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl Default for MemoryId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum MemoryScope {
    Project(ProjectId),
    Session(SessionId),
    Personal,
}

impl MemoryScope {
    pub fn is_project(&self) -> bool {
        matches!(self, Self::Project(_))
    }

    pub fn project_id(&self) -> Option<ProjectId> {
        match self {
            Self::Project(id) => Some(*id),
            _ => None,
        }
    }
}
