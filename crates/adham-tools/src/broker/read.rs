use adham_platform::isolation::validate_project_relative_path;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use thiserror::Error;

pub const MAX_READ_BYTES: u64 = 256 * 1024; // 256 KiB
pub const MAX_FILE_SIZE_BYTES: u64 = 8 * 1024 * 1024; // 8 MiB

#[derive(Debug, Error, PartialEq, Eq)]
pub enum BrokerError {
    #[error("Path validation error: {0}")]
    PathError(String),
    #[error("File not found: {0}")]
    NotFound(String),
    #[error("File exceeds maximum allowed size ({0} bytes > {MAX_FILE_SIZE_BYTES})")]
    FileTooLarge(u64),
    #[error("IO error: {0}")]
    IoError(String),
    #[error("Invalid UTF-8 content")]
    InvalidUtf8,
}

pub fn read_project_text(
    root: &Path,
    rel_path: &str,
    offset: Option<u64>,
    length: Option<u64>,
) -> Result<String, BrokerError> {
    let clean_rel = validate_project_relative_path(rel_path)
        .map_err(|e| BrokerError::PathError(e.to_string()))?;

    let full_path = root.join(&clean_rel);
    if !full_path.exists() {
        return Err(BrokerError::NotFound(rel_path.to_string()));
    }

    let meta = std::fs::metadata(&full_path).map_err(|e| BrokerError::IoError(e.to_string()))?;

    let file_len = meta.len();
    if file_len > MAX_FILE_SIZE_BYTES {
        return Err(BrokerError::FileTooLarge(file_len));
    }

    let mut file = File::open(&full_path).map_err(|e| BrokerError::IoError(e.to_string()))?;

    let start_offset = offset.unwrap_or(0);
    if start_offset > 0 {
        file.seek(SeekFrom::Start(start_offset))
            .map_err(|e| BrokerError::IoError(e.to_string()))?;
    }

    let read_limit = length.unwrap_or(MAX_READ_BYTES).min(MAX_READ_BYTES);
    let mut buffer = Vec::new();
    let mut take = file.take(read_limit);
    take.read_to_end(&mut buffer)
        .map_err(|e| BrokerError::IoError(e.to_string()))?;

    String::from_utf8(buffer).map_err(|_| BrokerError::InvalidUtf8)
}
