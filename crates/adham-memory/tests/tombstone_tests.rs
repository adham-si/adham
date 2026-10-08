use adham_core_types::ProjectId;
use adham_memory::domain::proposal::{MemoryError, MemoryWriteProposal};
use adham_memory::domain::record::MemoryKind;
use adham_memory::domain::scope::MemoryScope;
use adham_memory::store::service::MemoryService;

#[test]
fn test_tombstone_immediate_retrieval_suppression() {
    let mut service = MemoryService::new();
    let proj = ProjectId::new_v7();
    let scope = MemoryScope::Project(proj);

    let proposal = MemoryWriteProposal::new(
        scope.clone(),
        MemoryKind::Fact,
        "old_api",
        "Legacy API was v1",
        None,
    )
    .unwrap();

    let id = service.commit_proposal(proposal, "agent", 1000).unwrap();

    // 1. Retrieved initially
    let initial = service.retrieve(&scope, None);
    assert_eq!(initial.len(), 1);
    assert_eq!(initial[0].memory_id, id);

    // 2. Forget (tombstone)
    service
        .forget(&id, &scope, "API v1 was deprecated", 2000)
        .unwrap();

    // 3. Immediately suppressed from retrieval
    let post_forget = service.retrieve(&scope, None);
    assert!(post_forget.is_empty());

    // 4. Update fails on tombstoned record
    let update_err = service
        .update_memory(&id, "Updated v2 API", 1, 3000)
        .unwrap_err();
    assert!(matches!(update_err, MemoryError::Tombstoned(_)));
}
