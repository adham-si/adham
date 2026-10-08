use adham_core_types::ProjectId;
use adham_memory::domain::proposal::{MemoryError, MemoryWriteProposal};
use adham_memory::domain::record::MemoryKind;
use adham_memory::domain::scope::MemoryScope;
use adham_memory::store::service::MemoryService;

#[test]
fn test_versioned_memory_update_and_conflict_resolution() {
    let mut service = MemoryService::new();
    let proj = ProjectId::new_v7();
    let scope = MemoryScope::Project(proj);

    let proposal = MemoryWriteProposal::new(
        scope.clone(),
        MemoryKind::Constraint,
        "style",
        "Prefer single quotes in TS",
        None,
    )
    .unwrap();

    let id = service.commit_proposal(proposal, "agent", 1000).unwrap();

    // 1. Valid update with expected revision 1
    let new_rev = service
        .update_memory(&id, "Prefer double quotes in TS", 1, 2000)
        .unwrap();
    assert_eq!(new_rev, 2);

    let records = service.retrieve(&scope, None);
    assert_eq!(records[0].revision, 2);
    assert_eq!(records[0].content, "Prefer double quotes in TS");

    // 2. Conflict: attempting update with stale revision 1 fails
    let err = service
        .update_memory(&id, "Prefer backticks in TS", 1, 3000)
        .unwrap_err();

    assert_eq!(
        err,
        MemoryError::RevisionConflict {
            expected: 1,
            actual: 2
        }
    );
}
