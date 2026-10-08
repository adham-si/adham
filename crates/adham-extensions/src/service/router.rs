use crate::domain::activation::{ActivationError, ActivationManifest, MAX_HELPER_SKILLS};
use crate::domain::identity::{CanonicalSkillId, SkillSourceKind};
use crate::domain::skill::{SkillMetadata, SkillSnapshot, MAX_METADATA_SHORTLIST};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RouterError {
    #[error("Activation error: {0}")]
    Activation(#[from] ActivationError),

    #[error("Primary skill not found: {0}")]
    PrimarySkillNotFound(String),

    #[error("Helper skill not found: {0}")]
    HelperSkillNotFound(String),
}

pub struct CapabilityRouter;

impl CapabilityRouter {
    /// Returns a bounded metadata candidate shortlist of at most MAX_METADATA_SHORTLIST (20 items).
    pub fn shortlist_candidates<'a>(
        query: &str,
        candidates: &'a [SkillSnapshot],
    ) -> Vec<&'a SkillMetadata> {
        let query_lower = query.to_lowercase();
        let terms: Vec<&str> = query_lower.split_whitespace().collect();

        let mut scored: Vec<(&'a SkillSnapshot, usize, u8)> = candidates
            .iter()
            .map(|skill| {
                let text = format!("{} {}", skill.metadata.name, skill.metadata.description)
                    .to_lowercase();
                let score = if terms.is_empty() {
                    1
                } else {
                    terms.iter().filter(|&&t| text.contains(t)).count()
                };

                let scope_priority = match skill.canonical_id.source_kind {
                    SkillSourceKind::Project => 4,
                    SkillSourceKind::Workspace => 3,
                    SkillSourceKind::User => 2,
                    SkillSourceKind::Plugin => 1,
                };

                (skill, score, scope_priority)
            })
            .filter(|(_, score, _)| *score > 0)
            .collect();

        // Sort by score descending, then by scope priority descending
        scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.2.cmp(&a.2)));

        scored
            .into_iter()
            .take(MAX_METADATA_SHORTLIST)
            .map(|(s, _, _)| &s.metadata)
            .collect()
    }

    /// Resolves an exact skill snapshot by its canonical identity.
    pub fn resolve_exact<'a>(
        canonical_id: &CanonicalSkillId,
        candidates: &'a [SkillSnapshot],
    ) -> Option<&'a SkillSnapshot> {
        candidates.iter().find(|s| &s.canonical_id == canonical_id)
    }

    /// Builds an activation manifest for the chosen primary and helper skills.
    pub fn create_activation(
        task_id: impl Into<String>,
        step_id: impl Into<String>,
        primary_id: CanonicalSkillId,
        helper_ids: Vec<CanonicalSkillId>,
        available_snapshots: &[SkillSnapshot],
    ) -> Result<ActivationManifest, RouterError> {
        let primary = Self::resolve_exact(&primary_id, available_snapshots)
            .ok_or_else(|| RouterError::PrimarySkillNotFound(primary_id.to_string()))?;

        if helper_ids.len() > MAX_HELPER_SKILLS {
            return Err(RouterError::Activation(
                ActivationError::HelperLimitExceeded {
                    attempted: helper_ids.len(),
                    max: MAX_HELPER_SKILLS,
                },
            ));
        }

        let mut combined_body = format!(
            "### Primary Skill: {}\n{}\n",
            primary.metadata.name, primary.body
        );

        for helper_id in &helper_ids {
            let helper = Self::resolve_exact(helper_id, available_snapshots)
                .ok_or_else(|| RouterError::HelperSkillNotFound(helper_id.to_string()))?;
            combined_body.push_str(&format!(
                "\n### Helper Skill: {}\n{}\n",
                helper.metadata.name, helper.body
            ));
        }

        let manifest =
            ActivationManifest::new(task_id, step_id, primary_id, helper_ids, combined_body)?;

        Ok(manifest)
    }
}
