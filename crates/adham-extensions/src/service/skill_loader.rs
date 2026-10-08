use crate::domain::identity::{CanonicalSkillId, SkillSourceKind};
use crate::domain::skill::{
    InertResourceRef, SkillMetadata, SkillSnapshot, SkillValidationError, MAX_SKILL_BODY_BYTES,
};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SkillLoaderError {
    #[error("Validation error: {0}")]
    Validation(#[from] SkillValidationError),

    #[error("Missing or malformed YAML frontmatter")]
    MalformedFrontmatter,

    #[error("Skill content exceeds maximum allowed size ({actual} > {max} bytes)")]
    ContentTooLarge { actual: usize, max: usize },
}

pub struct SkillLoader;

impl SkillLoader {
    /// Safely parses a SKILL.md file content and returns an immutable SkillSnapshot.
    pub fn parse_skill_content(
        source_kind: SkillSourceKind,
        scope_owner: impl Into<String>,
        raw_content: &str,
        resources: Vec<InertResourceRef>,
        created_at_epoch_ms: u64,
    ) -> Result<SkillSnapshot, SkillLoaderError> {
        let content_bytes = raw_content.as_bytes();
        if content_bytes.len() > MAX_SKILL_BODY_BYTES + 8192 {
            return Err(SkillLoaderError::ContentTooLarge {
                actual: content_bytes.len(),
                max: MAX_SKILL_BODY_BYTES + 8192,
            });
        }

        let (metadata, body) = Self::extract_frontmatter_and_body(raw_content)?;

        let body_hash = blake3::hash(body.as_bytes()).to_hex().to_string();
        let canonical_id =
            CanonicalSkillId::new(source_kind, scope_owner, &metadata.name, &body_hash[..12]);

        let snapshot =
            SkillSnapshot::new(canonical_id, metadata, body, resources, created_at_epoch_ms)?;

        Ok(snapshot)
    }

    fn extract_frontmatter_and_body(
        raw_content: &str,
    ) -> Result<(SkillMetadata, String), SkillLoaderError> {
        let trimmed = raw_content.trim_start();
        if !trimmed.starts_with("---") {
            return Err(SkillLoaderError::MalformedFrontmatter);
        }

        let rest = &trimmed[3..];
        let end_idx = rest.find("\n---").or_else(|| rest.find("\r\n---"));
        let (frontmatter_text, body_text) = match end_idx {
            Some(idx) => {
                let fm = &rest[..idx];
                let after = &rest[idx..];
                let body_start = after.find('\n').map(|n| &after[n + 1..]).unwrap_or("");
                let body_trimmed = body_start
                    .trim_start_matches('-')
                    .trim_start_matches('\r')
                    .trim_start_matches('\n');
                (fm, body_trimmed)
            }
            None => return Err(SkillLoaderError::MalformedFrontmatter),
        };

        let mut name = String::new();
        let mut description = String::new();
        let mut requested_tools = Vec::new();
        let mut compatibility = None;

        let mut in_tools_list = false;

        for line in frontmatter_text.lines() {
            let line_trim = line.trim();
            if line_trim.is_empty() || line_trim.starts_with('#') {
                continue;
            }

            if line_trim.starts_with('-') && in_tools_list {
                let tool = line_trim.trim_start_matches('-').trim();
                if !tool.is_empty() {
                    requested_tools.push(tool.to_string());
                }
                continue;
            }

            in_tools_list = false;

            if let Some((key, val)) = line_trim.split_once(':') {
                let k = key.trim().to_lowercase();
                let v = val.trim().trim_matches('"').trim_matches('\'').to_string();
                match k.as_str() {
                    "name" => name = v,
                    "description" => description = v,
                    "allowed-tools" | "allowed_tools" | "tools" => {
                        if !v.is_empty() {
                            requested_tools.push(v);
                        } else {
                            in_tools_list = true;
                        }
                    }
                    "compatibility" => compatibility = Some(v),
                    _ => {}
                }
            }
        }

        let metadata = SkillMetadata::new(name, description, requested_tools, compatibility)?;
        Ok((metadata, body_text.to_string()))
    }
}
