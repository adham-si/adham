use crate::domain::identity::CanonicalSkillId;
use crate::domain::skill::{InertResourceRef, MAX_CUMULATIVE_RESOURCE_BYTES, MAX_RESOURCE_LOADS};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

pub const MAX_HELPER_SKILLS: usize = 2;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ActivationError {
    #[error("Exceeded helper skill limit: max {max}, attempted {attempted}")]
    HelperLimitExceeded { attempted: usize, max: usize },

    #[error("Exceeded cumulative resource load count: max {max}")]
    ResourceCountLimitExceeded { max: usize },

    #[error(
        "Exceeded cumulative resource byte budget: max {max} bytes, attempted {attempted} bytes"
    )]
    ResourceByteLimitExceeded { attempted: usize, max: usize },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ActivationManifest {
    pub activation_id: String,
    pub task_id: String,
    pub step_id: String,
    pub primary_skill: CanonicalSkillId,
    pub helper_skills: Vec<CanonicalSkillId>,
    pub activated_body: String,
    pub loaded_resources: Vec<InertResourceRef>,
    pub cumulative_resource_bytes: usize,
}

impl ActivationManifest {
    pub fn new(
        task_id: impl Into<String>,
        step_id: impl Into<String>,
        primary_skill: CanonicalSkillId,
        helper_skills: Vec<CanonicalSkillId>,
        activated_body: impl Into<String>,
    ) -> Result<Self, ActivationError> {
        if helper_skills.len() > MAX_HELPER_SKILLS {
            return Err(ActivationError::HelperLimitExceeded {
                attempted: helper_skills.len(),
                max: MAX_HELPER_SKILLS,
            });
        }

        Ok(Self {
            activation_id: Uuid::now_v7().to_string(),
            task_id: task_id.into(),
            step_id: step_id.into(),
            primary_skill,
            helper_skills,
            activated_body: activated_body.into(),
            loaded_resources: Vec::new(),
            cumulative_resource_bytes: 0,
        })
    }

    pub fn attach_resource(&mut self, resource: InertResourceRef) -> Result<(), ActivationError> {
        if self.loaded_resources.len() >= MAX_RESOURCE_LOADS {
            return Err(ActivationError::ResourceCountLimitExceeded {
                max: MAX_RESOURCE_LOADS,
            });
        }

        let new_total = self.cumulative_resource_bytes + resource.byte_size;
        if new_total > MAX_CUMULATIVE_RESOURCE_BYTES {
            return Err(ActivationError::ResourceByteLimitExceeded {
                attempted: new_total,
                max: MAX_CUMULATIVE_RESOURCE_BYTES,
            });
        }

        self.cumulative_resource_bytes = new_total;
        self.loaded_resources.push(resource);
        Ok(())
    }
}
