use adham_runtime::domain::*;

#[test]
fn test_budget_exhaustion_detection() {
    let budget = RunBudget {
        max_turns: 2,
        max_steps: 4,
        max_attempts: 6,
        max_model_attempts_per_op: 2,
        max_active_duration_ms: 1000,
        max_output_bytes: 500,
    };

    let mut usage = BudgetUsage::default();
    assert_eq!(usage.check_exhaustion(&budget), None);

    // Exceed turns
    usage.turns_used = 2;
    assert_eq!(
        usage.check_exhaustion(&budget),
        Some(BlockReason::BudgetExhausted)
    );
    usage.turns_used = 1;

    // Exceed steps
    usage.steps_used = 4;
    assert_eq!(
        usage.check_exhaustion(&budget),
        Some(BlockReason::BudgetExhausted)
    );
    usage.steps_used = 2;

    // Exceed duration
    usage.active_duration_ms = 1000;
    assert_eq!(
        usage.check_exhaustion(&budget),
        Some(BlockReason::BudgetExhausted)
    );
    usage.active_duration_ms = 200;

    // Exceed output bytes
    usage.output_bytes_used = 500;
    assert_eq!(
        usage.check_exhaustion(&budget),
        Some(BlockReason::BudgetExhausted)
    );
}
