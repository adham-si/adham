use crate::identifiers::*;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use ts_rs::TS;

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
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkspaceCreatedV1 {
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub kind: String,
    pub preferred_language: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectCreatedV1 {
    pub project_id: ProjectId,
    pub workspace_id: WorkspaceId,
    pub name: String,
    pub storage_kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionCreatedV1 {
    pub session_id: SessionId,
    pub project_id: ProjectId,
    pub title: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageSubmittedV1 {
    pub message_id: MessageId,
    pub content_id: ContentId,
    pub content_kind: String,
    pub size_bytes: u64,
}
