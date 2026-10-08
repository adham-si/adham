use adham_core_types::{ProjectId, SessionId};
use adham_memory::domain::proposal::MemoryWriteProposal;
use adham_memory::domain::record::MemoryKind;
use adham_memory::domain::scope::MemoryScope;
use adham_memory::store::service::MemoryService;

#[test]
fn test_project_memory_strict_isolation() {
    let mut service = MemoryService::new();

    let project_a = ProjectId::new_v7();
    let project_b = ProjectId::new_v7();

    let proposal_a = MemoryWriteProposal::new(
        MemoryScope::Project(project_a),
        MemoryKind::Decision,
        "database",
        "We decided to use SQLite with WAL mode.",
        None,
    )
    .unwrap();

    let id_a = service
        .commit_proposal(proposal_a, "agent-1", 1000)
        .unwrap();

    // Project A retrieves its memory
    let records_a = service.retrieve(&MemoryScope::Project(project_a), None);
    assert_eq!(records_a.len(), 1);
    assert_eq!(records_a[0].memory_id, id_a);

    // Project B retrieves its memory -> must be EMPTY!
    let records_b = service.retrieve(&MemoryScope::Project(project_b), None);
    assert!(records_b.is_empty());
}

#[test]
fn test_session_memory_isolation() {
    let mut service = MemoryService::new();

    let session_1 = SessionId::new_v7();
    let session_2 = SessionId::new_v7();

    let prop_1 = MemoryWriteProposal::new(
        MemoryScope::Session(session_1),
        MemoryKind::Fact,
        "user_intent",
        "User prefers dark theme",
        None,
    )
    .unwrap();

    service.commit_proposal(prop_1, "agent-1", 1000).unwrap();

    assert_eq!(
        service
            .retrieve(&MemoryScope::Session(session_1), None)
            .len(),
        1
    );
    assert!(service
        .retrieve(&MemoryScope::Session(session_2), None)
        .is_empty());
}
