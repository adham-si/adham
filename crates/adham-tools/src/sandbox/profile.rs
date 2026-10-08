use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SandboxProfile {
    pub network_egress: bool,
    pub clean_env: bool,
    pub timeout_secs: u64,
    pub max_stdout_bytes: usize,
}

impl Default for SandboxProfile {
    fn default() -> Self {
        Self {
            network_egress: false,             // Strict offline sandbox
            clean_env: true,                   // Strip host credentials
            timeout_secs: 120,                 // 120s max wall time
            max_stdout_bytes: 8 * 1024 * 1024, // 8 MiB output cap
        }
    }
}

pub fn sanitize_environment(
    vars: impl IntoIterator<Item = (String, String)>,
) -> Vec<(String, String)> {
    vars.into_iter()
        .filter(|(key, _)| is_safe_env_var(key))
        .collect()
}

fn is_safe_env_var(key: &str) -> bool {
    let upper = key.to_uppercase();

    // Strip secrets, credentials, tokens, keys
    if upper.contains("KEY")
        || upper.contains("TOKEN")
        || upper.contains("SECRET")
        || upper.contains("PASS")
        || upper.contains("AUTH")
        || upper.contains("CREDENTIAL")
        || upper.starts_with("AWS_")
        || upper.starts_with("AZURE_")
        || upper.starts_with("GOOGLE_")
        || upper.starts_with("GCP_")
        || upper.starts_with("SSH_")
        || upper.starts_with("GITHUB_")
    {
        return false;
    }

    // Allow essential system execution variables
    matches!(
        upper.as_str(),
        "PATH"
            | "PATHEXT"
            | "SYSTEMROOT"
            | "WINDIR"
            | "COMSPEC"
            | "TEMP"
            | "TMP"
            | "LANG"
            | "LC_ALL"
            | "HOME"
            | "USERPROFILE"
            | "TERM"
            | "RUST_LOG"
    )
}
