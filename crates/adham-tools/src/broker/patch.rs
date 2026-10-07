use adham_platform::isolation::validate_project_relative_path;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatchArtifact {
    pub patch_id: String,
    pub target_path: String,
    pub baseline_hash: Option<String>,
    pub proposed_content: String,
}

impl PatchArtifact {
    pub fn new(
        target_path: impl Into<String>,
        proposed_content: impl Into<String>,
        baseline_hash: Option<String>,
    ) -> Self {
        Self {
            patch_id: Uuid::now_v7().to_string(),
            target_path: target_path.into(),
            baseline_hash,
            proposed_content: proposed_content.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PatchResult {
    pub target_path: String,
    pub old_hash: String,
    pub new_hash: String,
    pub bytes_written: u64,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PatchError {
    #[error("Path validation error: {0}")]
    PathError(String),
    #[error("Precondition conflict for '{target}': expected hash {expected}, got {actual}")]
    PreconditionConflict {
        target: String,
        expected: String,
        actual: String,
    },
    #[error("Target file '{0}' does not exist, but expected hash was specified")]
    TargetNotFound(String),
    #[error("IO error: {0}")]
    IoError(String),
}

pub fn apply_project_patch(
    root: &Path,
    target_path: &str,
    expected_hash: &str,
    new_content: &str,
) -> Result<PatchResult, PatchError> {
    let clean_rel = validate_project_relative_path(target_path)
        .map_err(|e| PatchError::PathError(e.to_string()))?;

    let full_path = root.join(&clean_rel);

    // Verify parent directory
    if let Some(parent) = full_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| PatchError::IoError(e.to_string()))?;
        }
    }

    let old_hash = if full_path.exists() {
        let existing_bytes =
            fs::read(&full_path).map_err(|e| PatchError::IoError(e.to_string()))?;
        let actual_hash = blake3::hash(&existing_bytes).to_hex().to_string();
        if !expected_hash.is_empty() && actual_hash != expected_hash {
            return Err(PatchError::PreconditionConflict {
                target: target_path.to_string(),
                expected: expected_hash.to_string(),
                actual: actual_hash,
            });
        }
        actual_hash
    } else {
        if !expected_hash.is_empty() && expected_hash != "NEW" {
            return Err(PatchError::TargetNotFound(target_path.to_string()));
        }
        "NEW".to_string()
    };

    // Atomic replacement: write to temp file on same directory, then rename
    let parent_dir = full_path.parent().unwrap_or(root);
    let temp_name = format!(".adham_patch_{}.tmp", Uuid::now_v7());
    let temp_path = parent_dir.join(temp_name);

    fs::write(&temp_path, new_content.as_bytes())
        .map_err(|e| PatchError::IoError(e.to_string()))?;

    if let Err(e) = fs::rename(&temp_path, &full_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(PatchError::IoError(e.to_string()));
    }

    let new_hash = blake3::hash(new_content.as_bytes()).to_hex().to_string();
    Ok(PatchResult {
        target_path: target_path.to_string(),
        old_hash,
        new_hash,
        bytes_written: new_content.len() as u64,
    })
}
