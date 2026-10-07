use adham_platform::{validate_project_relative_path, PlatformError};
use std::path::PathBuf;

#[test]
fn test_path_traversal_rejection() {
    let dangerous = [
        "../secret.txt",
        "..",
        "foo/../../bar",
        "nested/dir/../..",
        "a/b/../c/../../d",
        r"foo\..\..\bar",
    ];

    for path in dangerous {
        let res = validate_project_relative_path(path);
        assert!(
            res.is_err(),
            "Path traversal '{path}' should have been rejected"
        );
        match res.unwrap_err() {
            PlatformError::InvalidPath(msg) => {
                assert!(msg.contains("forbidden") || msg.contains("traversal"));
            }
            err => panic!("Unexpected error type for '{path}': {err:?}"),
        }
    }
}

#[test]
fn test_absolute_and_drive_path_rejection() {
    let absolute = [
        "/etc/passwd",
        r"\Windows\System32",
        r"C:\secret\doc.txt",
        "C:relative-path",
        "D:/data/repo",
        "/root/file.txt",
    ];

    for path in absolute {
        let res = validate_project_relative_path(path);
        assert!(
            res.is_err(),
            "Absolute or drive path '{path}' should have been rejected"
        );
        match res.unwrap_err() {
            PlatformError::InvalidPath(msg) => {
                assert!(
                    msg.contains("absolute") || msg.contains("colon") || msg.contains("forbidden")
                );
            }
            err => panic!("Unexpected error type for '{path}': {err:?}"),
        }
    }
}

#[test]
fn test_unc_and_device_namespace_rejection() {
    let device_paths = [
        r"\\?\C:\Windows",
        r"\\.\COM1",
        r"\\server\share\file.txt",
        "//127.0.0.1/c$/boot.ini",
        r"\\localhost\c$\data",
    ];

    for path in device_paths {
        let res = validate_project_relative_path(path);
        assert!(
            res.is_err(),
            "UNC or device namespace '{path}' should have been rejected"
        );
    }
}

#[test]
fn test_alternate_data_streams_rejection() {
    let ads_paths = [
        "normal.txt:hidden",
        "script.ps1:$DATA",
        "sub/folder/file.json:metadata",
        r"nested\file.txt:stream",
    ];

    for path in ads_paths {
        let res = validate_project_relative_path(path);
        assert!(
            res.is_err(),
            "Alternate Data Stream syntax '{path}' should have been rejected"
        );
        match res.unwrap_err() {
            PlatformError::InvalidPath(msg) => {
                assert!(msg.contains("colon") || msg.contains("ADS"));
            }
            err => panic!("Unexpected error type for '{path}': {err:?}"),
        }
    }
}

#[test]
fn test_windows_dos_devices_rejection() {
    let dos_devices = [
        "CON",
        "con.txt",
        "PRN",
        "prn.log",
        "AUX",
        "aux.dat",
        "NUL",
        "nul.json",
        "COM1",
        "COM3.json",
        "LPT1",
        "src/con.js",
        r"deep\nested\NUL",
        "folder/aux.png",
    ];

    for path in dos_devices {
        let res = validate_project_relative_path(path);
        assert!(
            res.is_err(),
            "Reserved DOS device '{path}' should have been rejected"
        );
        match res.unwrap_err() {
            PlatformError::InvalidPath(msg) => {
                assert!(msg.contains("Reserved DOS device"));
            }
            err => panic!("Unexpected error type for '{path}': {err:?}"),
        }
    }
}

#[test]
fn test_trailing_dots_and_spaces_rejection() {
    let trailing = [
        "foo. ",
        "bar.",
        "folder /file.txt",
        "sub/trailing./test",
        "file.txt ",
        "dir. /test.txt",
    ];

    for path in trailing {
        let res = validate_project_relative_path(path);
        assert!(
            res.is_err(),
            "Path with trailing dot/space '{path}' should have been rejected"
        );
        match res.unwrap_err() {
            PlatformError::InvalidPath(msg) => {
                assert!(msg.contains("trailing dot or space"));
            }
            err => panic!("Unexpected error type for '{path}': {err:?}"),
        }
    }
}

#[test]
fn test_nul_byte_and_empty_path_rejection() {
    let invalid = ["", "   ", "foo\0bar.txt", "\0", "folder/\0/file"];

    for path in invalid {
        let res = validate_project_relative_path(path);
        assert!(
            res.is_err(),
            "Empty or NUL path '{path:?}' should have been rejected"
        );
    }
}

#[test]
fn test_valid_relative_paths_acceptance() {
    let valid = [
        ("src/index.ts", PathBuf::from("src").join("index.ts")),
        (
            "docs/spec/P0-05.md",
            PathBuf::from("docs").join("spec").join("P0-05.md"),
        ),
        (
            "assets/images/logo.png",
            PathBuf::from("assets").join("images").join("logo.png"),
        ),
        ("./src/main.rs", PathBuf::from("src").join("main.rs")),
        (
            r"deep\nested\file.json",
            PathBuf::from("deep").join("nested").join("file.json"),
        ),
    ];

    for (raw, expected) in valid {
        let res = validate_project_relative_path(raw);
        assert!(
            res.is_ok(),
            "Valid path '{raw}' should have been accepted, got: {res:?}"
        );
        assert_eq!(res.unwrap(), expected);
    }
}
