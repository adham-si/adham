use adham_extensions::domain::identity::SkillSourceKind;
use adham_extensions::domain::skill::{
    InertResourceRef, SkillValidationError, MAX_RESOURCE_BYTES, MAX_SKILL_BODY_BYTES,
};
use adham_extensions::service::skill_loader::{SkillLoader, SkillLoaderError};

#[test]
fn test_safe_frontmatter_parsing_and_snapshot_creation() {
    let raw = r#"---
name: code-review
description: Performs rigorous code review against safety guidelines
allowed-tools:
  - read_file
  - run_tests
compatibility: ">=0.1.0"
---
# Instructions
Always review code carefully and check boundaries.
"#;

    let snapshot = SkillLoader::parse_skill_content(
        SkillSourceKind::Project,
        "proj-alpha",
        raw,
        Vec::new(),
        1700000000,
    )
    .expect("Should parse valid skill content");

    assert_eq!(snapshot.metadata.name, "code-review");
    assert_eq!(
        snapshot.metadata.description,
        "Performs rigorous code review against safety guidelines"
    );
    // Invariant: requested tools are captured, but are not grants
    assert_eq!(
        snapshot.metadata.requested_tools,
        vec!["read_file", "run_tests"]
    );
    assert_eq!(snapshot.metadata.compatibility, Some(">=0.1.0".to_string()));
    assert!(snapshot.body.contains("Always review code carefully"));
    assert_eq!(snapshot.canonical_id.source_kind, SkillSourceKind::Project);
    assert_eq!(snapshot.canonical_id.scope_owner, "proj-alpha");
}

#[test]
fn test_rejection_of_path_traversal_in_resources() {
    // Attempt directory traversal
    let res = InertResourceRef::new("../secret.key", 128, "abc123hash");
    assert!(matches!(
        res,
        Err(SkillValidationError::IllegalResourcePath { .. })
    ));

    // Attempt absolute path
    let res_abs = InertResourceRef::new("/etc/passwd", 128, "abc123hash");
    assert!(matches!(
        res_abs,
        Err(SkillValidationError::IllegalResourcePath { .. })
    ));

    // Attempt Windows drive letter
    let res_win = InertResourceRef::new("C:\\Windows\\system.ini", 128, "abc123hash");
    assert!(matches!(
        res_win,
        Err(SkillValidationError::IllegalResourcePath { .. })
    ));
}

#[test]
fn test_rejection_of_oversized_resources_and_bodies() {
    // Exceeding single resource 256 KiB
    let oversized_bytes = MAX_RESOURCE_BYTES + 1;
    let res = InertResourceRef::new("docs/manual.md", oversized_bytes, "hash");
    assert!(matches!(
        res,
        Err(SkillValidationError::ResourceTooLarge { .. })
    ));

    // Exceeding skill body 64 KiB
    let huge_body = "x".repeat(MAX_SKILL_BODY_BYTES + 100);
    let raw = format!(
        "---\nname: big-skill\ndescription: huge\n---\n{}",
        huge_body
    );

    let parsed = SkillLoader::parse_skill_content(
        SkillSourceKind::User,
        "user-1",
        &raw,
        Vec::new(),
        1700000000,
    );

    assert!(matches!(
        parsed,
        Err(SkillLoaderError::Validation(
            SkillValidationError::BodyTooLarge { .. }
        ))
    ));
}
