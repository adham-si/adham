use adham_tools::domain::approval::ApprovalScope;
use adham_tools::domain::grant::{ExecutionGrant, RootGrant};
use adham_tools::domain::proposal::NormalizedAction;
use adham_tools::domain::result::{EffectCertainty, ToolOutcome};
use adham_tools::sandbox::staging::TempDir;
use adham_tools::scheduler::executor::ToolExecutor;
use adham_tools::scheduler::scheduler::ToolScheduler;
use std::fs;

#[tokio::test]
async fn test_executor_end_to_end_read_and_patch() {
    let dir = TempDir::new("test_exec_proj").unwrap();
    let root = RootGrant::new("root-1", "proj-1", dir.path().to_path_buf());
    let executor = ToolExecutor::new(ToolScheduler::new());

    // 1. Setup initial file
    let file_path = dir.path().join("main.rs");
    fs::write(&file_path, "fn old() {}\n").unwrap();
    let old_hash = blake3::hash(b"fn old() {}\n").to_hex().to_string();

    // 2. Execute ReadText
    let read_action = NormalizedAction::ReadText {
        path: "main.rs".to_string(),
        offset: None,
        length: None,
    };
    let mut read_grant =
        ExecutionGrant::issue(read_action.fingerprint(), ApprovalScope::Once, 1000, 10000);

    let read_result = executor
        .execute(&read_action, &mut read_grant, &root, 1500)
        .await
        .unwrap();

    assert_eq!(read_result.outcome, ToolOutcome::Success);
    assert_eq!(read_result.output_excerpt, "fn old() {}\n");
    assert_eq!(read_result.effect_certainty, EffectCertainty::Settled);

    // 3. Execute ApplyPatch
    let patch_action = NormalizedAction::ApplyPatch {
        patch_id: "patch-1".to_string(),
        target_path: "main.rs".to_string(),
        expected_hash: old_hash,
        new_content: "fn new_code() {}\n".to_string(),
    };
    let mut patch_grant =
        ExecutionGrant::issue(patch_action.fingerprint(), ApprovalScope::Once, 1000, 10000);

    let patch_result = executor
        .execute(&patch_action, &mut patch_grant, &root, 1600)
        .await
        .unwrap();

    assert_eq!(patch_result.outcome, ToolOutcome::Success);
    let updated = fs::read_to_string(&file_path).unwrap();
    assert_eq!(updated, "fn new_code() {}\n");
}

#[tokio::test]
async fn test_executor_process_execution() {
    let dir = TempDir::new("test_exec_proc").unwrap();
    let root = RootGrant::new("root-1", "proj-1", dir.path().to_path_buf());
    let executor = ToolExecutor::new(ToolScheduler::new());

    // Run safe toolchain binary `cargo` with `--version`
    let proc_action = NormalizedAction::RunProcess {
        binary: "cargo".to_string(),
        argv: vec!["--version".to_string()],
        workdir_rel: None,
        timeout_secs: Some(10),
    };
    let mut proc_grant =
        ExecutionGrant::issue(proc_action.fingerprint(), ApprovalScope::Once, 1000, 10000);

    let result = executor
        .execute(&proc_action, &mut proc_grant, &root, 1500)
        .await
        .unwrap();

    assert_eq!(result.outcome, ToolOutcome::Success);
    assert!(result.output_excerpt.contains("cargo"));
    assert_eq!(result.effect_certainty, EffectCertainty::Settled);
}
