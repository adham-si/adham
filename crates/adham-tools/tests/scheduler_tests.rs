use adham_tools::domain::approval::ApprovalScope;
use adham_tools::domain::grant::{ExecutionGrant, GrantError};
use adham_tools::scheduler::scheduler::{SchedulerError, ToolScheduler};

#[test]
fn test_scheduler_concurrency_limits_and_guard_release() {
    let scheduler = ToolScheduler::new();

    // 1. Read slots limit (max 4)
    let g1 = scheduler.acquire_read_slot().unwrap();
    let g2 = scheduler.acquire_read_slot().unwrap();
    let g3 = scheduler.acquire_read_slot().unwrap();
    let g4 = scheduler.acquire_read_slot().unwrap();

    let err = scheduler.acquire_read_slot().unwrap_err();
    assert_eq!(err, SchedulerError::ReadCapacityExceeded);

    // Dropping a guard releases the slot
    drop(g1);
    let g5 = scheduler.acquire_read_slot().unwrap();
    drop(g2);
    drop(g3);
    drop(g4);
    drop(g5);

    // 2. Mutation slot limit (max 1)
    let m1 = scheduler.acquire_mutation_slot().unwrap();
    let m_err = scheduler.acquire_mutation_slot().unwrap_err();
    assert_eq!(m_err, SchedulerError::MutationCapacityExceeded);
    drop(m1);

    // 3. Process slot limit (max 1)
    let p1 = scheduler.acquire_process_slot().unwrap();
    let p_err = scheduler.acquire_process_slot().unwrap_err();
    assert_eq!(p_err, SchedulerError::ProcessCapacityExceeded);
    drop(p1);
}

#[test]
fn test_grant_consumption_lifecycle() {
    let mut grant = ExecutionGrant::issue(
        "action_hash_123".to_string(),
        ApprovalScope::Once,
        1000,
        5000,
    );

    // 1. Consuming with wrong fingerprint fails
    let mismatch = grant.consume("wrong_hash", 1500).unwrap_err();
    assert!(matches!(mismatch, GrantError::FingerprintMismatch { .. }));

    // 2. Consuming with correct fingerprint succeeds
    assert!(grant.consume("action_hash_123", 1500).is_ok());

    // 3. Consuming single-use grant again fails with AlreadyConsumed
    let consumed_err = grant.consume("action_hash_123", 2000).unwrap_err();
    assert_eq!(consumed_err, GrantError::AlreadyConsumed);

    // 4. Consuming after expiry fails
    let mut expired_grant = ExecutionGrant::issue(
        "action_hash_456".to_string(),
        ApprovalScope::Once,
        1000,
        100, // 100ms TTL
    );
    let exp_err = expired_grant.consume("action_hash_456", 2000).unwrap_err();
    assert_eq!(exp_err, GrantError::Expired);
}
