use crate::paths::PlatformError;
use std::path::PathBuf;

/// Validates that a path is strictly relative to a project root and safe
/// from path traversal, Alternate Data Streams, device paths, and Windows reserved names.
pub fn validate_project_relative_path(raw: &str) -> Result<PathBuf, PlatformError> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(PlatformError::InvalidPath(
            "Project path cannot be empty".to_string(),
        ));
    }

    if raw.contains('\0') {
        return Err(PlatformError::InvalidPath(
            "Project path contains forbidden NUL character".to_string(),
        ));
    }

    // Prohibit Alternate Data Streams and drive-letter specifications
    if raw.contains(':') {
        return Err(PlatformError::InvalidPath(
            "Project path contains forbidden colon syntax (drive or ADS)".to_string(),
        ));
    }

    // Prohibit absolute paths, UNC shares, and device namespaces
    if raw.starts_with('/')
        || raw.starts_with('\\')
        || raw.starts_with("//")
        || raw.starts_with("\\\\")
        || raw.starts_with(r"\\?\")
        || raw.starts_with(r"\\.\")
    {
        return Err(PlatformError::InvalidPath(
            "Project path cannot be absolute, UNC, or a device namespace".to_string(),
        ));
    }

    let mut normalized = PathBuf::new();
    let components: Vec<&str> = raw.split(['/', '\\']).collect();

    for comp in components {
        if comp.is_empty() || comp == "." {
            continue;
        }

        if comp == ".." {
            return Err(PlatformError::InvalidPath(
                "Path traversal sequence '..' is strictly forbidden".to_string(),
            ));
        }

        // On Windows, components ending in trailing spaces or dots are normalized/stripped by NTFS
        if comp.ends_with('.') || comp.ends_with(' ') {
            return Err(PlatformError::InvalidPath(format!(
                "Path component cannot end with a trailing dot or space: '{comp}'"
            )));
        }

        if is_reserved_dos_device(comp) {
            return Err(PlatformError::InvalidPath(format!(
                "Reserved DOS device name is forbidden: '{comp}'"
            )));
        }

        normalized.push(comp);
    }

    if normalized.as_os_str().is_empty() {
        return Err(PlatformError::InvalidPath(
            "Resolved project path is empty".to_string(),
        ));
    }

    Ok(normalized)
}

fn is_reserved_dos_device(component: &str) -> bool {
    let stem = match component.find('.') {
        Some(pos) => &component[..pos],
        None => component,
    };
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}
