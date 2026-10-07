use adham_tools::broker::read::{read_project_text, BrokerError, MAX_READ_BYTES};
use adham_tools::sandbox::staging::TempDir;
use std::fs;

#[test]
fn test_brokered_read_happy_path_and_bounds() {
    let dir = TempDir::new("test_broker").unwrap();
    let file_path = dir.path().join("hello.txt");
    fs::write(&file_path, "Hello, Adham Sandboxed Engine!").unwrap();

    // 1. Full read
    let content = read_project_text(dir.path(), "hello.txt", None, None).unwrap();
    assert_eq!(content, "Hello, Adham Sandboxed Engine!");

    // 2. Bounded read with offset and length
    let slice = read_project_text(dir.path(), "hello.txt", Some(7), Some(5)).unwrap();
    assert_eq!(slice, "Adham");

    // 3. Not found
    let err = read_project_text(dir.path(), "nonexistent.txt", None, None).unwrap_err();
    assert!(matches!(err, BrokerError::NotFound(_)));
}

#[test]
fn test_brokered_read_rejects_path_traversal() {
    let dir = TempDir::new("test_broker_traversal").unwrap();
    let err = read_project_text(dir.path(), "../../etc/hosts", None, None).unwrap_err();
    assert!(matches!(err, BrokerError::PathError(_)));

    let colon_err = read_project_text(dir.path(), "C:/Windows/win.ini", None, None).unwrap_err();
    assert!(matches!(colon_err, BrokerError::PathError(_)));
}

#[test]
fn test_brokered_read_caps_max_bytes() {
    let dir = TempDir::new("test_broker_max").unwrap();
    let large_file = dir.path().join("large.txt");
    let data = "x".repeat((MAX_READ_BYTES + 500) as usize);
    fs::write(&large_file, data).unwrap();

    let content = read_project_text(dir.path(), "large.txt", None, None).unwrap();
    assert_eq!(content.len() as u64, MAX_READ_BYTES);
}
