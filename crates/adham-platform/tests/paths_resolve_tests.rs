//! Storage-root validation: missing/empty/relative roots must error
//! before any directory is created. Uses temporary roots only — never
//! the real HOME/LOCALAPPDATA and never `resolve()` (which reads the
//! process environment and creates real directories).

use adham_platform::{PlatformError, PlatformStoragePolicy};
use std::path::PathBuf;

fn temp_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("adham_paths_test_{}_{}", std::process::id(), name))
}

fn remove_dir(path: &std::path::Path) {
    let _ = std::fs::remove_dir_all(path);
}

#[test]
fn missing_roots_error() {
    let err = PlatformStoragePolicy::resolve_base(None, None).unwrap_err();
    match err {
        PlatformError::InvalidPath(msg) => {
            assert!(msg.contains("missing"), "{msg}");
            assert!(msg.contains("refusing"), "{msg}");
        }
        other => panic!("expected InvalidPath, got {other:?}"),
    }
}

#[test]
fn empty_and_whitespace_roots_error() {
    for raw in ["", "   ", "\t "] {
        let err = PlatformStoragePolicy::resolve_base(Some(raw), Some(raw)).unwrap_err();
        assert!(
            matches!(err, PlatformError::InvalidPath(_)),
            "empty root {raw:?} must error"
        );
    }
}

#[test]
fn relative_roots_error_without_creating_them() {
    for raw in ["relative/Adham", ".", "Adham"] {
        let before = PathBuf::from(raw);
        let existed_before = before.exists();
        let err = PlatformStoragePolicy::resolve_base(Some(raw), Some(raw)).unwrap_err();
        assert!(
            matches!(err, PlatformError::InvalidPath(_)),
            "relative root {raw:?} must error"
        );
        // Pure validation: must not have created anything new.
        assert_eq!(before.exists(), existed_before, "must not create {raw:?}");
    }
}

#[test]
fn new_rejects_relative_and_empty_roots() {
    for raw in ["", "relative/root", "."] {
        match PlatformStoragePolicy::new(raw) {
            Err(PlatformError::InvalidPath(_)) => {}
            Err(other) => panic!("new({raw:?}) wrong error: {other:?}"),
            Ok(_) => panic!("new({raw:?}) must error"),
        }
    }
    assert!(
        !PathBuf::from("relative/root/data").exists(),
        "new() must not create directories for invalid roots"
    );
}

#[cfg(target_os = "macos")]
#[test]
fn macos_base_preserves_app_support_location() {
    let home = temp_root("home");
    let base =
        PlatformStoragePolicy::resolve_base(None, Some(home.to_str().unwrap())).expect("base");
    assert_eq!(
        base,
        home.join("Library")
            .join("Application Support")
            .join("Adham")
    );

    let policy = PlatformStoragePolicy::new(&base).expect("policy");
    assert_eq!(policy.data_dir(), &base.join("data"));
    assert_eq!(policy.database_path().file_name().unwrap(), "adham.db");
    assert!(policy.data_dir().is_dir());
    remove_dir(&base);
}

#[cfg(windows)]
#[test]
fn windows_base_preserves_localappdata_location() {
    let root = temp_root("localappdata");
    let root_str = root.to_str().unwrap().to_string();
    let base = PlatformStoragePolicy::resolve_base(Some(&root_str), None).expect("base");
    assert_eq!(base, root.join("Adham"));

    let policy = PlatformStoragePolicy::new(&base).expect("policy");
    assert_eq!(policy.database_path().file_name().unwrap(), "adham.db");
    assert!(policy.data_dir().is_dir());
    remove_dir(&base);
}

#[cfg(not(any(windows, target_os = "macos")))]
#[test]
fn unsupported_platform_errors() {
    let err = PlatformStoragePolicy::resolve_base(Some("/tmp/x"), Some("/tmp/x")).unwrap_err();
    assert!(matches!(err, PlatformError::InvalidPath(_)));
}

#[test]
fn absolute_temp_root_creates_data_dir() {
    let root = temp_root("ok");
    let home_str = root.to_str().unwrap().to_string();
    // On macOS the first arg is ignored; on Windows the second is ignored.
    // Either way this exercises the absolute-path happy path with a temp root.
    let base = PlatformStoragePolicy::resolve_base(Some(&home_str), Some(&home_str));
    #[cfg(any(windows, target_os = "macos"))]
    {
        let base = base.expect("absolute temp root must resolve");
        let policy = PlatformStoragePolicy::new(&base).expect("policy");
        assert!(policy.data_dir().is_dir());
        remove_dir(&base);
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        assert!(base.is_err());
    }
    remove_dir(&root);
}
