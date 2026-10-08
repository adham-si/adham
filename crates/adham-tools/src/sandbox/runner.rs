use crate::sandbox::profile::{sanitize_environment, SandboxProfile};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use std::time::Instant;
use thiserror::Error;
use tokio::process::Command;
use tokio::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessOutput {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
}

#[derive(Debug, Error)]
pub enum SandboxError {
    #[error("Process timed out after {0} seconds")]
    Timeout(u64),
    #[error("Failed to spawn process: {0}")]
    SpawnFailed(String),
    #[error("Execution failed: {0}")]
    ExecutionFailed(String),
}

pub async fn execute_sandboxed_process(
    staging_dir: &Path,
    binary: &str,
    argv: &[String],
    profile: &SandboxProfile,
) -> Result<ProcessOutput, SandboxError> {
    let start = Instant::now();

    let mut cmd = Command::new(binary);
    cmd.args(argv);
    cmd.current_dir(staging_dir);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    if profile.clean_env {
        cmd.env_clear();
        for (k, v) in sanitize_environment(std::env::vars()) {
            cmd.env(k, v);
        }
    }

    let child = cmd
        .spawn()
        .map_err(|e| SandboxError::SpawnFailed(e.to_string()))?;

    let timeout_duration = Duration::from_secs(profile.timeout_secs);
    let output = tokio::time::timeout(timeout_duration, child.wait_with_output())
        .await
        .map_err(|_| SandboxError::Timeout(profile.timeout_secs))?
        .map_err(|e| SandboxError::ExecutionFailed(e.to_string()))?;

    let duration_ms = start.elapsed().as_millis() as u64;

    let stdout_bytes = if output.stdout.len() > profile.max_stdout_bytes {
        &output.stdout[..profile.max_stdout_bytes]
    } else {
        &output.stdout
    };
    let stdout = String::from_utf8_lossy(stdout_bytes).to_string();

    let stderr_bytes = if output.stderr.len() > profile.max_stdout_bytes {
        &output.stderr[..profile.max_stdout_bytes]
    } else {
        &output.stderr
    };
    let stderr = String::from_utf8_lossy(stderr_bytes).to_string();

    Ok(ProcessOutput {
        exit_code: output.status.code().unwrap_or(-1),
        stdout,
        stderr,
        duration_ms,
    })
}
