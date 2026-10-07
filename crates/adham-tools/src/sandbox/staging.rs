use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum StagingError {
    #[error("Failed to create temporary staging directory: {0}")]
    CreateDirFailed(String),
    #[error("IO error during staging copy: {0}")]
    IoError(String),
}

pub struct TempDir {
    path: PathBuf,
}

impl TempDir {
    pub fn new(prefix: &str) -> std::io::Result<Self> {
        let dir_name = format!("{}_{}", prefix, Uuid::now_v7());
        let path = std::env::temp_dir().join(dir_name);
        fs::create_dir_all(&path)?;
        Ok(Self { path })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub fn prepare_staging_area(project_root: &Path) -> Result<TempDir, StagingError> {
    let temp_dir =
        TempDir::new("adham_staging").map_err(|e| StagingError::CreateDirFailed(e.to_string()))?;

    copy_project_files_safely(project_root, temp_dir.path())
        .map_err(|e| StagingError::IoError(e.to_string()))?;

    Ok(temp_dir)
}

fn copy_project_files_safely(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !src.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let file_name = entry.file_name();
        let name_str = file_name.to_string_lossy();

        // Skip sensitive directories and files
        if name_str == ".git"
            || name_str == ".env"
            || name_str.starts_with(".env.")
            || name_str == "node_modules"
            || name_str == "target"
        {
            continue;
        }

        let src_path = entry.path();
        let dst_path = dst.join(&file_name);

        if file_type.is_dir() {
            fs::create_dir_all(&dst_path)?;
            copy_project_files_safely(&src_path, &dst_path)?;
        } else if file_type.is_file() {
            fs::copy(&src_path, &dst_path)?;
        }
    }

    Ok(())
}
