use crate::identifiers::*;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use ts_rs::TS;

pub const EVENT_TYPE_WORKSPACE_CREATED: &str = "workspace/created";
pub const EVENT_TYPE_PROJECT_CREATED: &str = "project/created";
pub const EVENT_TYPE_SESSION_CREATED: &str = "session/created";
pub const EVENT_TYPE_USER_MESSAGE_SUBMITTED: &str = "user/message-submitted";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum StreamKind {
    Workspace,
    Project,
    Session,
}

impl StreamKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Workspace => "workspace",
            Self::Project => "project",
            Self::Session => "session",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub enum ActorKind {
    LocalHuman,
    System,
    Migration,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EventActor {
    pub actor_id: ActorId,
    pub kind: ActorKind,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EventScope {
    pub installation_id: InstallationId,
    pub workspace_id: Option<WorkspaceId>,
    pub project_id: Option<ProjectId>,
    pub session_id: Option<SessionId>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventEnvelope<P> {
    pub event_id: EventId,
    pub event_type: String,
    pub event_version: u16,
    pub stream_id: String,
    pub stream_sequence: u64,
    pub request_id: RequestId,
    pub correlation_id: CorrelationId,
    pub causation_id: Option<EventId>,
    pub actor: EventActor,
    pub scope: EventScope,
    #[serde(with = "time::serde::rfc3339")]
    pub occurred_at: OffsetDateTime,
    pub payload: P,
    pub previous_checksum: Option<String>,
    pub checksum: String,
}

// Initial canonical event payloads
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct WorkspaceCreatedV1 {
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub kind: String,
    pub preferred_language: String,
}

impl WorkspaceCreatedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        let trimmed = self.name.trim();
        if trimmed.is_empty() {
            return Err("name cannot be empty");
        }
        if self.name.len() > 120 {
            return Err("name exceeds 120 scalar values limit");
        }
        if self.kind != "personal" {
            return Err("kind must be personal");
        }
        if !["en", "ar", "zh-CN", "ru"].contains(&self.preferred_language.as_str()) {
            return Err("unsupported preferred_language code");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectCreatedV1 {
    pub project_id: ProjectId,
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub storage_kind: String,
}

impl ProjectCreatedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        let trimmed = self.name.trim();
        if trimmed.is_empty() {
            return Err("name cannot be empty");
        }
        if self.name.len() > 120 {
            return Err("name exceeds 120 scalar values limit");
        }
        if self.storage_kind != "isolated" {
            return Err("storage_kind must be isolated");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionCreatedV1 {
    pub session_id: SessionId,
    pub project_id: ProjectId,
    pub title: Option<String>,
}

impl SessionCreatedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if let Some(ref title) = self.title {
            if title.len() > 120 {
                return Err("title exceeds 120 scalar values limit");
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageSubmittedV1 {
    pub message_id: MessageId,
    pub content_id: ContentId,
    pub content_kind: String,
    pub size_bytes: u64,
}

impl MessageSubmittedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.content_kind != "user_text" {
            return Err("content_kind must be user_text");
        }
        if self.size_bytes == 0 || self.size_bytes > 65536 {
            return Err("size_bytes must be between 1 and 65536");
        }
        Ok(())
    }
}
