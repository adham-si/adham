use adham_core_types::ProjectId;
use adham_memory::domain::proposal::{MemoryError, MemoryWriteProposal};
use adham_memory::domain::record::MemoryKind;
use adham_memory::domain::scope::MemoryScope;

#[test]
fn test_sensitive_credentials_and_keys_rejected() {
    let proj = ProjectId::new_v7();

    // 1. OpenAI key pattern
    let err1 = MemoryWriteProposal::new(
        MemoryScope::Project(proj),
        MemoryKind::Fact,
        "credentials",
        "OpenAI key is sk-proj-abcdef123456",
        None,
    )
    .unwrap_err();
    assert!(matches!(err1, MemoryError::SensitiveContentForbidden(_)));

    // 2. Private key
    let err2 = MemoryWriteProposal::new(
        MemoryScope::Project(proj),
        MemoryKind::Fact,
        "key",
        "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgk...",
        None,
    )
    .unwrap_err();
    assert!(matches!(err2, MemoryError::SensitiveContentForbidden(_)));

    // 3. Password
    let err3 = MemoryWriteProposal::new(
        MemoryScope::Project(proj),
        MemoryKind::Fact,
        "db_pass",
        "DB password is secret_password_123",
        None,
    )
    .unwrap_err();
    assert!(matches!(err3, MemoryError::SensitiveContentForbidden(_)));

    // 4. Safe fact succeeds
    let safe = MemoryWriteProposal::new(
        MemoryScope::Project(proj),
        MemoryKind::Constraint,
        "lint_rule",
        "Lines must be strictly under 300 lines of code.",
        None,
    );
    assert!(safe.is_ok());
}
