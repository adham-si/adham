use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum PlatformError {
    #[error("Failed to create application directory: {0}")]
    DirectoryCreationFailed(String),
    #[error("Invalid path: {0}")]
    InvalidPath(String),
}

pub struct PlatformStoragePolicy {
    pub data_dir: PathBuf,
    pub sqlite_database_path: PathBuf,
}

impl PlatformStoragePolicy {
    pub fn new(app_local_data_dir: impl AsRef<Path>) -> Result<Self, PlatformError> {
        let data_dir = app_local_data_dir.as_ref().join("data");
        if !data_dir.exists() {
            std::fs::create_dir_all(&data_dir).map_err(|e| {
                PlatformError::DirectoryCreationFailed(format!("{}: {}", data_dir.display(), e))
            })?;
        }
        let sqlite_database_path = data_dir.join("adham.db");
        Ok(Self {
            data_dir,
            sqlite_database_path,
        })
    }

    pub fn resolve() -> Self {
        let base = std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("Adham");
        Self::new(base).expect("Failed to initialize default storage policy")
    }

    pub fn ensure_directories(&self) -> Result<(), PlatformError> {
        if !self.data_dir.exists() {
            std::fs::create_dir_all(&self.data_dir).map_err(|e| {
                PlatformError::DirectoryCreationFailed(format!("{}: {}", self.data_dir.display(), e))
            })?;
        }
        Ok(())
    }

    pub fn database_path(&self) -> &Path {
        &self.sqlite_database_path
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }
}
