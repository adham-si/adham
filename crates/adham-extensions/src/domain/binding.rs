use crate::domain::identity::CanonicalToolId;
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const MAX_TOOL_SCHEMA_BYTES: usize = 64 * 1024; // 64 KiB schema limit

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ToolBindingError {
    #[error("Tool schema exceeds 64 KiB size limit ({actual} > {max} bytes)")]
    SchemaTooLarge { actual: usize, max: usize },

    #[error("Tool '{tool}' is disabled by default and has not been explicitly enabled")]
    ToolDisabled { tool: String },

    #[error("Tool schema generation mismatch (expected {expected}, found {actual})")]
    StaleSchemaGeneration { expected: u64, actual: u64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolEffectClass {
    Read,
    SideEffect,
    Destructive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum ToolGrantState {
    /// Non-negotiable invariant: All discovered tools start disabled!
    DisabledByDefault,
    EnabledWithPolicy {
        require_approval: bool,
        policy_notes: Option<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolSchemaSnapshot {
    pub schema_hash: String,
    pub input_schema_json: serde_json::Value,
    pub schema_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolBinding {
    pub canonical_id: CanonicalToolId,
    pub tool_name: String,
    pub description: String,
    pub schema: ToolSchemaSnapshot,
    pub effect_class: ToolEffectClass,
    pub grant_state: ToolGrantState,
}

impl ToolBinding {
    pub fn new_discovered(
        canonical_id: CanonicalToolId,
        tool_name: impl Into<String>,
        description: impl Into<String>,
        input_schema_json: serde_json::Value,
        effect_class: ToolEffectClass,
    ) -> Result<Self, ToolBindingError> {
        let serialized = serde_json::to_vec(&input_schema_json).unwrap_or_default();
        if serialized.len() > MAX_TOOL_SCHEMA_BYTES {
            return Err(ToolBindingError::SchemaTooLarge {
                actual: serialized.len(),
                max: MAX_TOOL_SCHEMA_BYTES,
            });
        }

        let schema_hash = blake3::hash(&serialized).to_hex().to_string();

        Ok(Self {
            canonical_id,
            tool_name: tool_name.into(),
            description: description.into(),
            schema: ToolSchemaSnapshot {
                schema_hash,
                input_schema_json,
                schema_generation: 1,
            },
            effect_class,
            // Strictly disabled by default
            grant_state: ToolGrantState::DisabledByDefault,
        })
    }

    pub fn is_enabled(&self) -> bool {
        matches!(self.grant_state, ToolGrantState::EnabledWithPolicy { .. })
    }

    pub fn enable(&mut self, require_approval: bool, notes: Option<String>) {
        self.grant_state = ToolGrantState::EnabledWithPolicy {
            require_approval,
            policy_notes: notes,
        };
    }

    pub fn disable(&mut self) {
        self.grant_state = ToolGrantState::DisabledByDefault;
    }

    /// Updating the schema invalidates existing grants and resets state to DisabledByDefault.
    pub fn update_schema(
        &mut self,
        new_input_schema_json: serde_json::Value,
    ) -> Result<(), ToolBindingError> {
        let serialized = serde_json::to_vec(&new_input_schema_json).unwrap_or_default();
        if serialized.len() > MAX_TOOL_SCHEMA_BYTES {
            return Err(ToolBindingError::SchemaTooLarge {
                actual: serialized.len(),
                max: MAX_TOOL_SCHEMA_BYTES,
            });
        }

        let schema_hash = blake3::hash(&serialized).to_hex().to_string();
        self.schema = ToolSchemaSnapshot {
            schema_hash,
            input_schema_json: new_input_schema_json,
            schema_generation: self.schema.schema_generation + 1,
        };

        // Invalidate grant: newly modified schema MUST be re-reviewed and explicitly re-enabled
        self.grant_state = ToolGrantState::DisabledByDefault;
        Ok(())
    }
}
