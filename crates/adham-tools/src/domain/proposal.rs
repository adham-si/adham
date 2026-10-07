use crate::domain::definition::ToolName;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ToolProposalId(pub String);

impl ToolProposalId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for ToolProposalId {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolProposal {
    pub proposal_id: ToolProposalId,
    pub run_id: String,
    pub step_id: String,
    pub tool_name: String,
    pub raw_arguments: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NormalizedAction {
    ReadText {
        path: String,
        offset: Option<u64>,
        length: Option<u64>,
    },
    ProposePatch {
        target_path: String,
        proposed_content: String,
        baseline_hash: Option<String>,
    },
    ApplyPatch {
        patch_id: String,
        target_path: String,
        expected_hash: String,
        new_content: String,
    },
    RunProcess {
        binary: String,
        argv: Vec<String>,
        workdir_rel: Option<String>,
        timeout_secs: Option<u64>,
    },
}

impl NormalizedAction {
    pub fn fingerprint(&self) -> String {
        let serialized = serde_json::to_vec(self).unwrap_or_default();
        let hash = blake3::hash(&serialized);
        hash.to_hex().to_string()
    }

    pub fn tool_name(&self) -> &'static str {
        match self {
            Self::ReadText { .. } => ToolName::READ_TEXT,
            Self::ProposePatch { .. } => ToolName::PROPOSE_PATCH,
            Self::ApplyPatch { .. } => ToolName::APPLY_PATCH,
            Self::RunProcess { .. } => ToolName::RUN_PROCESS,
        }
    }
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ProposalError {
    #[error("Unknown tool name: {0}")]
    UnknownTool(String),
    #[error("Malformed arguments: {0}")]
    MalformedArguments(String),
    #[error("Missing required argument: {0}")]
    MissingArgument(String),
    #[error("Shell interpreter not permitted: {0}. Structured binary calls only.")]
    ShellForbidden(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
}

pub fn normalize_proposal(proposal: &ToolProposal) -> Result<NormalizedAction, ProposalError> {
    match proposal.tool_name.as_str() {
        ToolName::READ_TEXT => {
            let path = proposal
                .raw_arguments
                .get("path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("path".to_string()))?
                .to_string();
            let offset = proposal
                .raw_arguments
                .get("offset")
                .and_then(|v| v.as_u64());
            let length = proposal
                .raw_arguments
                .get("length")
                .and_then(|v| v.as_u64());
            Ok(NormalizedAction::ReadText {
                path,
                offset,
                length,
            })
        }
        ToolName::PROPOSE_PATCH => {
            let target_path = proposal
                .raw_arguments
                .get("target_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("target_path".to_string()))?
                .to_string();
            let proposed_content = proposal
                .raw_arguments
                .get("proposed_content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("proposed_content".to_string()))?
                .to_string();
            let baseline_hash = proposal
                .raw_arguments
                .get("baseline_hash")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            Ok(NormalizedAction::ProposePatch {
                target_path,
                proposed_content,
                baseline_hash,
            })
        }
        ToolName::APPLY_PATCH => {
            let patch_id = proposal
                .raw_arguments
                .get("patch_id")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("patch_id".to_string()))?
                .to_string();
            let target_path = proposal
                .raw_arguments
                .get("target_path")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("target_path".to_string()))?
                .to_string();
            let expected_hash = proposal
                .raw_arguments
                .get("expected_hash")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("expected_hash".to_string()))?
                .to_string();
            let new_content = proposal
                .raw_arguments
                .get("new_content")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("new_content".to_string()))?
                .to_string();
            Ok(NormalizedAction::ApplyPatch {
                patch_id,
                target_path,
                expected_hash,
                new_content,
            })
        }
        ToolName::RUN_PROCESS => {
            let binary = proposal
                .raw_arguments
                .get("binary")
                .and_then(|v| v.as_str())
                .ok_or_else(|| ProposalError::MissingArgument("binary".to_string()))?
                .to_string();

            let lower_bin = binary.to_lowercase();
            if lower_bin == "cmd.exe"
                || lower_bin == "cmd"
                || lower_bin == "powershell.exe"
                || lower_bin == "powershell"
                || lower_bin == "pwsh"
                || lower_bin == "pwsh.exe"
                || lower_bin == "sh"
                || lower_bin == "bash"
                || lower_bin == "zsh"
            {
                return Err(ProposalError::ShellForbidden(binary));
            }

            let argv = if let Some(arr) = proposal
                .raw_arguments
                .get("argv")
                .and_then(|v| v.as_array())
            {
                arr.iter()
                    .filter_map(|v| v.as_str().map(|s| s.to_string()))
                    .collect()
            } else {
                Vec::new()
            };

            let workdir_rel = proposal
                .raw_arguments
                .get("workdir_rel")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            let timeout_secs = proposal
                .raw_arguments
                .get("timeout_secs")
                .and_then(|v| v.as_u64());

            Ok(NormalizedAction::RunProcess {
                binary,
                argv,
                workdir_rel,
                timeout_secs,
            })
        }
        other => Err(ProposalError::UnknownTool(other.to_string())),
    }
}
