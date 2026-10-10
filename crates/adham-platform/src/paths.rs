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
        let root = app_local_data_dir.as_ref();
        validate_storage_root(root)?;
        let data_dir = root.join("data");
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

    pub fn resolve() -> Result<Self, PlatformError> {
        let base = Self::resolve_base(
            std::env::var("LOCALAPPDATA").ok().as_deref(),
            std::env::var("HOME").ok().as_deref(),
        )?;
        Self::new(base)
    }

    /// Pure, testable base-directory selection. No env access, no I/O.
    /// Tests must call this with temporary roots, never `resolve()`.
    pub fn resolve_base(
        local_app_data: Option<&str>,
        home: Option<&str>,
    ) -> Result<PathBuf, PlatformError> {
        #[cfg(windows)]
        {
            let _ = home;
            validate_root_var("LOCALAPPDATA", local_app_data).map(|p| p.join("Adham"))
        }
        #[cfg(target_os = "macos")]
        {
            let _ = local_app_data;
            validate_root_var("HOME", home)
                .map(|p| p.join("Library").join("Application Support").join("Adham"))
        }
        #[cfg(not(any(windows, target_os = "macos")))]
        {
            let _ = (local_app_data, home);
            Err(PlatformError::InvalidPath(
                "unsupported platform for application data directory".to_string(),
            ))
        }
    }

    pub fn ensure_directories(&self) -> Result<(), PlatformError> {
        if !self.data_dir.exists() {
            std::fs::create_dir_all(&self.data_dir).map_err(|e| {
                PlatformError::DirectoryCreationFailed(format!(
                    "{}: {}",
                    self.data_dir.display(),
                    e
                ))
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

fn validate_storage_root(root: &Path) -> Result<(), PlatformError> {
    if root.as_os_str().is_empty() {
        return Err(PlatformError::InvalidPath(
            "storage root must not be empty; refusing to use the project folder".to_string(),
        ));
    }
    if !root.is_absolute() {
        return Err(PlatformError::InvalidPath(format!(
            "storage root must be absolute, got '{}'; refusing to use the project folder",
            root.display()
        )));
    }
    Ok(())
}

fn validate_root_var(name: &str, value: Option<&str>) -> Result<PathBuf, PlatformError> {
    let raw = match value {
        Some(v) if !v.trim().is_empty() => v,
        Some(_) => {
            return Err(PlatformError::InvalidPath(format!(
                "{name} must not be empty; refusing to use the project folder"
            )));
        }
        None => {
            return Err(PlatformError::InvalidPath(format!(
                "{name} is missing; refusing to use the project folder"
            )));
        }
    };
    let path = PathBuf::from(raw);
    if !path.is_absolute() {
        return Err(PlatformError::InvalidPath(format!(
            "{name} must be absolute, got '{raw}'; refusing to use the project folder"
        )));
    }
    Ok(path)
}
