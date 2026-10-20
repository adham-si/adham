use crate::identifiers::ContentId;
use serde::{Deserialize, Serialize};

pub const EVENT_TYPE_SESSION_RENAMED: &str = "SessionRenamed";
pub const EVENT_TYPE_SESSION_PIN_CHANGED: &str = "SessionPinChanged";
pub const EVENT_TYPE_SESSION_ARCHIVE_CHANGED: &str = "SessionArchiveChanged";
pub const EVENT_TYPE_SESSION_SUMMARY_UPDATED: &str = "SessionSummaryUpdated";
pub const EVENT_TYPE_SESSION_DELETED: &str = "SessionDeleted";

/// Titles are trimmed non-empty strings of at most 120 Unicode scalar values
/// with no control characters. Callers store the trimmed value.
pub fn validate_title(title: &str) -> Result<(), &'static str> {
    if title.trim().is_empty() {
        return Err("title cannot be empty");
    }
    if title.chars().count() > 120 {
        return Err("title exceeds 120 scalar values limit");
    }
    if title.chars().any(char::is_control) {
        return Err("title cannot contain control characters");
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionRenamedV1 {
    pub title: String,
}

impl SessionRenamedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        validate_title(&self.title)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionPinChangedV1 {
    pub pinned: bool,
}

impl SessionPinChangedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionArchiveChangedV1 {
    pub archived: bool,
}

impl SessionArchiveChangedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionSummaryUpdatedV1 {
    pub content_id: Option<ContentId>,
}

impl SessionSummaryUpdatedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionDeletedV1 {}

impl SessionDeletedV1 {
    pub fn validate(&self) -> Result<(), &'static str> {
        Ok(())
    }
}
