use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum VerificationVerdict {
    Pass,
    PassWithPermittedWarnings {
        warnings_count: usize,
        summary: String,
    },
    Fail {
        reason: String,
        failed_checks: Vec<String>,
    },
    Blocked {
        reason: String,
        blocked_checks: Vec<String>,
    },
}

impl VerificationVerdict {
    pub fn is_success(&self) -> bool {
        matches!(self, Self::Pass | Self::PassWithPermittedWarnings { .. })
    }

    pub fn is_failure(&self) -> bool {
        matches!(self, Self::Fail { .. })
    }

    pub fn is_blocked(&self) -> bool {
        matches!(self, Self::Blocked { .. })
    }
}
