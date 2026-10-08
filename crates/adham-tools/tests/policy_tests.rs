use adham_tools::domain::approval::ApprovalScope;
use adham_tools::domain::policy::{PolicyDecision, PolicyEngine, PolicyPreset};
use adham_tools::domain::proposal::{
    normalize_proposal, ProposalError, ToolProposal, ToolProposalId,
};
use serde_json::json;

#[test]
fn test_proposal_normalization_and_shell_prohibition() {
    // 1. Prohibits shell interpreters in run_process
    let shell_proposal = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "project.run_process".to_string(),
        raw_arguments: json!({
            "binary": "cmd.exe",
            "argv": ["/c", "dir"]
        }),
    };
    let err = normalize_proposal(&shell_proposal).unwrap_err();
    assert!(matches!(err, ProposalError::ShellForbidden(_)));

    let bash_proposal = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "project.run_process".to_string(),
        raw_arguments: json!({
            "binary": "bash",
            "argv": ["-c", "echo hello"]
        }),
    };
    let err = normalize_proposal(&bash_proposal).unwrap_err();
    assert!(matches!(err, ProposalError::ShellForbidden(_)));

    // 2. Structured binary normalization succeeds
    let valid_proposal = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "project.run_process".to_string(),
        raw_arguments: json!({
            "binary": "cargo",
            "argv": ["test", "--workspace"]
        }),
    };
    let action = normalize_proposal(&valid_proposal).unwrap();
    assert_eq!(action.tool_name(), "project.run_process");
}

#[test]
fn test_hard_denials_override_approval() {
    let engine = PolicyEngine::new(PolicyPreset::Autonomous);

    // 1. Path traversal is denied unconditionally
    let traversal_proposal = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "project.read_text".to_string(),
        raw_arguments: json!({
            "path": "../../../etc/passwd"
        }),
    };
    let action = normalize_proposal(&traversal_proposal).unwrap();
    let decision = engine.evaluate(&action);
    assert!(
        matches!(decision, PolicyDecision::Deny { code, .. } if code == "PATH_TRAVERSAL_PROHIBITED")
    );

    // 2. Access to sensitive .env file is denied unconditionally
    let env_proposal = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "project.read_text".to_string(),
        raw_arguments: json!({
            "path": ".env"
        }),
    };
    let action = normalize_proposal(&env_proposal).unwrap();
    let decision = engine.evaluate(&action);
    assert!(
        matches!(decision, PolicyDecision::Deny { code, .. } if code == "SENSITIVE_FILE_RESTRICTED")
    );
}

#[test]
fn test_policy_preset_approval_requirements() {
    let safe_engine = PolicyEngine::new(PolicyPreset::Safe);

    // ReadText is allowed in safe preset
    let read_prop = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "project.read_text".to_string(),
        raw_arguments: json!({ "path": "src/main.rs" }),
    };
    let read_action = normalize_proposal(&read_prop).unwrap();
    assert_eq!(safe_engine.evaluate(&read_action), PolicyDecision::Allow);

    // ApplyPatch requires approval in safe preset
    let patch_prop = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "project.apply_patch".to_string(),
        raw_arguments: json!({
            "patch_id": "patch-1",
            "target_path": "src/main.rs",
            "expected_hash": "abc",
            "new_content": "fn main() {}"
        }),
    };
    let patch_action = normalize_proposal(&patch_prop).unwrap();
    assert!(matches!(
        safe_engine.evaluate(&patch_action),
        PolicyDecision::Ask {
            required_scope: ApprovalScope::Once,
            ..
        }
    ));
}
