use adham_tools::broker::patch::{apply_project_patch, PatchError};
use adham_tools::sandbox::staging::TempDir;
use std::fs;

#[test]
fn test_patch_apply_precondition_verification_and_atomic_replace() {
    let dir = TempDir::new("test_patch").unwrap();
    let file_path = dir.path().join("config.toml");
    let original = "key = 1\n";
    fs::write(&file_path, original).unwrap();
    let original_hash = blake3::hash(original.as_bytes()).to_hex().to_string();

    // 1. Precondition mismatch -> fails and leaves original intact
    let err =
        apply_project_patch(dir.path(), "config.toml", "wrong_hash_123", "key = 2\n").unwrap_err();

    assert!(matches!(err, PatchError::PreconditionConflict { .. }));
    let after_failed = fs::read_to_string(&file_path).unwrap();
    assert_eq!(after_failed, original);

    // 2. Precondition match -> atomically replaces
    let result =
        apply_project_patch(dir.path(), "config.toml", &original_hash, "key = 2\n").unwrap();

    assert_eq!(result.old_hash, original_hash);
    let after_success = fs::read_to_string(&file_path).unwrap();
    assert_eq!(after_success, "key = 2\n");
    assert_eq!(
        result.new_hash,
        blake3::hash(b"key = 2\n").to_hex().to_string()
    );
}

#[test]
fn test_patch_creates_new_file() {
    let dir = TempDir::new("test_patch_new").unwrap();
    let res = apply_project_patch(
        dir.path(),
        "nested/new_file.rs",
        "NEW",
        "pub fn hello() {}\n",
    )
    .unwrap();

    assert_eq!(res.old_hash, "NEW");
    let content = fs::read_to_string(dir.path().join("nested/new_file.rs")).unwrap();
    assert_eq!(content, "pub fn hello() {}\n");
}
