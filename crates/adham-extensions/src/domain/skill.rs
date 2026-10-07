use crate::domain::identity::CanonicalSkillId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_METADATA_SHORTLIST: usize = 20;
pub const MAX_SKILL_BODY_BYTES: usize = 64 * 1024; // 64 KiB maximum
pub const MAX_RESOURCE_BYTES: usize = 256 * 1024; // 256 KiB per load
pub const MAX_CUMULATIVE_RESOURCE_BYTES: usize = 1024 * 1024; // 1 MiB cumulative
pub const MAX_RESOURCE_LOADS: usize = 10;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SkillValidationError {
    #[error("Skill body exceeds maximum size limit ({actual} > {max} bytes)")]
    BodyTooLarge { actual: usize, max: usize },

    #[error("Skill resource exceeds maximum size limit ({actual} > {max} bytes)")]
    ResourceTooLarge { actual: usize, max: usize },

    #[error("Skill resource traversal attempt or illegal path: '{path}'")]
    IllegalResourcePath { path: String },

    #[error("Empty or invalid skill name")]
    InvalidName,

    #[error("Empty or invalid skill description")]
    InvalidDescription,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillMetadata {
    pub name: String,
    pub description: String,
    /// Untrusted request/constraint declared in frontmatter.
    /// In Adham, this is an evaluation filter, NEVER an authority grant!
    pub requested_tools: Vec<String>,
    pub compatibility: Option<String>,
}

impl SkillMetadata {
    pub fn new(
        name: impl Into<String>,
        description: impl Into<String>,
        requested_tools: Vec<String>,
        compatibility: Option<String>,
    ) -> Result<Self, SkillValidationError> {
        let name = name.into().trim().to_string();
        let description = description.into().trim().to_string();

        if name.is_empty() {
            return Err(SkillValidationError::InvalidName);
        }
        if description.is_empty() {
            return Err(SkillValidationError::InvalidDescription);
        }

        Ok(Self {
            name,
            description,
            requested_tools,
            compatibility,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InertResourceRef {
    pub relative_path: String,
    pub byte_size: usize,
    pub content_hash: String,
}

impl InertResourceRef {
    pub fn new(
        relative_path: impl Into<String>,
        byte_size: usize,
        content_hash: impl Into<String>,
    ) -> Result<Self, SkillValidationError> {
        let path = relative_path.into();
        if path.contains("..")
            || path.starts_with('/')
            || path.starts_with('\\')
            || path.contains(':')
        {
            return Err(SkillValidationError::IllegalResourcePath { path });
        }
        if byte_size > MAX_RESOURCE_BYTES {
            return Err(SkillValidationError::ResourceTooLarge {
                actual: byte_size,
                max: MAX_RESOURCE_BYTES,
            });
        }
        Ok(Self {
            relative_path: path,
            byte_size,
            content_hash: content_hash.into(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SkillSnapshot {
    pub canonical_id: CanonicalSkillId,
    pub metadata: SkillMetadata,
    pub body: String,
    pub resources: Vec<InertResourceRef>,
    pub created_at_epoch_ms: u64,
}

impl SkillSnapshot {
    pub fn new(
        canonical_id: CanonicalSkillId,
        metadata: SkillMetadata,
        body: impl Into<String>,
        resources: Vec<InertResourceRef>,
        created_at_epoch_ms: u64,
    ) -> Result<Self, SkillValidationError> {
        let body = body.into();
        if body.len() > MAX_SKILL_BODY_BYTES {
            return Err(SkillValidationError::BodyTooLarge {
                actual: body.len(),
                max: MAX_SKILL_BODY_BYTES,
            });
        }

        Ok(Self {
            canonical_id,
            metadata,
            body,
            resources,
            created_at_epoch_ms,
        })
    }
}
