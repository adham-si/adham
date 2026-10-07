use crate::domain::approval::ApprovalScope;
use crate::domain::proposal::NormalizedAction;
use adham_platform::isolation::validate_project_relative_path;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum PolicyDecision {
    Allow,
    Ask {
        reason: String,
        required_scope: ApprovalScope,
    },
    Deny {
        reason: String,
        code: String,
    },
    Block {
        reason: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyPreset {
    Safe,
    Balanced,
    Autonomous,
}

impl Default for PolicyPreset {
    fn default() -> Self {
        Self::Safe
    }
}

pub struct PolicyEngine {
    pub preset: PolicyPreset,
}

impl PolicyEngine {
    pub fn new(preset: PolicyPreset) -> Self {
        Self { preset }
    }

    pub fn evaluate(&self, action: &NormalizedAction) -> PolicyDecision {
        // 1. Hard deny checks across all tools
        if let Some(deny) = self.check_hard_denials(action) {
            return deny;
        }

        // 2. Preset-based policy
        match action {
            NormalizedAction::ReadText { .. } => PolicyDecision::Allow,
            NormalizedAction::ProposePatch { .. } => PolicyDecision::Allow,
            NormalizedAction::ApplyPatch { target_path, .. } => match self.preset {
                PolicyPreset::Safe | PolicyPreset::Balanced => PolicyDecision::Ask {
                    reason: format!("File modification requires confirmation: {target_path}"),
                    required_scope: ApprovalScope::Once,
                },
                PolicyPreset::Autonomous => PolicyDecision::Allow,
            },
            NormalizedAction::RunProcess { binary, argv, .. } => PolicyDecision::Ask {
                reason: format!("Process execution requires confirmation: {binary} {argv:?}"),
                required_scope: ApprovalScope::Task,
            },
        }
    }

    fn check_hard_denials(&self, action: &NormalizedAction) -> Option<PolicyDecision> {
        match action {
            NormalizedAction::ReadText { path, .. } => {
                if let Err(e) = validate_project_relative_path(path) {
                    return Some(PolicyDecision::Deny {
                        reason: format!("Path validation failed: {e}"),
                        code: "PATH_TRAVERSAL_PROHIBITED".to_string(),
                    });
                }
                if Self::is_sensitive_file(path) {
                    return Some(PolicyDecision::Deny {
                        reason: format!("Direct access to sensitive file denied: {path}"),
                        code: "SENSITIVE_FILE_RESTRICTED".to_string(),
                    });
                }
                None
            }
            NormalizedAction::ProposePatch { target_path, .. } => {
                if let Err(e) = validate_project_relative_path(target_path) {
                    return Some(PolicyDecision::Deny {
                        reason: format!("Target path validation failed: {e}"),
                        code: "PATH_TRAVERSAL_PROHIBITED".to_string(),
                    });
                }
                None
            }
            NormalizedAction::ApplyPatch { target_path, .. } => {
                if let Err(e) = validate_project_relative_path(target_path) {
                    return Some(PolicyDecision::Deny {
                        reason: format!("Target path validation failed: {e}"),
                        code: "PATH_TRAVERSAL_PROHIBITED".to_string(),
                    });
                }
                if Self::is_sensitive_file(target_path) {
                    return Some(PolicyDecision::Deny {
                        reason: format!(
                            "Direct modification of sensitive file denied: {target_path}"
                        ),
                        code: "SENSITIVE_FILE_RESTRICTED".to_string(),
                    });
                }
                None
            }
            NormalizedAction::RunProcess { binary, .. } => {
                let lower = binary.to_lowercase();
                if lower.contains("curl") || lower.contains("wget") || lower.contains("nc") {
                    return Some(PolicyDecision::Deny {
                        reason: format!(
                            "Network egress tool prohibited in offline sandbox: {binary}"
                        ),
                        code: "NETWORK_TOOL_FORBIDDEN".to_string(),
                    });
                }
                None
            }
        }
    }

    fn is_sensitive_file(path: &str) -> bool {
        let p = path.to_lowercase();
        p == ".env"
            || p.starts_with(".env.")
            || p.contains("/.env")
            || p.contains("\\.env")
            || p.contains("id_rsa")
            || p.contains("id_ed25519")
            || p.contains(".git/config")
            || p.contains(".git\\config")
            || p.contains(".npmrc")
    }
}
