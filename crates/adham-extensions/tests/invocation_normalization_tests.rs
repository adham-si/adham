use adham_extensions::domain::binding::ToolEffectClass;
use adham_extensions::domain::connection::{McpConnection, McpTransportKind};
use adham_extensions::service::invocation_gate::{McpInvocationGate, McpRawResponse};
use adham_extensions::service::mcp_gateway::McpGateway;
use adham_tools::domain::proposal::{ToolProposal, ToolProposalId};
use adham_tools::domain::result::{EffectCertainty, ToolOutcome};

#[test]
fn test_invocation_gate_enforces_enablement_and_schema_generation() {
    let mut gateway = McpGateway::new();

    let conn = McpConnection::new(
        "server-1",
        McpTransportKind::Stdio {
            command: "echo".to_string(),
            args: vec![],
        },
        1700000000,
    );
    let conn_id = conn.id.clone();
    gateway.register_connection(conn);

    let discovered = gateway
        .discover_tools(
            &conn_id,
            vec![(
                "execute_cmd".to_string(),
                "Runs cmd".to_string(),
                serde_json::json!({"type": "object"}),
                ToolEffectClass::SideEffect,
            )],
        )
        .unwrap();

    let tool_id = &discovered[0];

    let proposal = ToolProposal {
        proposal_id: ToolProposalId::new(),
        run_id: "run-1".to_string(),
        step_id: "step-1".to_string(),
        tool_name: "execute_cmd".to_string(),
        raw_arguments: serde_json::json!({}),
    };

    // 1. Invocation rejected when tool is disabled by default
    let res_disabled = McpInvocationGate::validate_invocation(&gateway, &proposal, tool_id, 1);
    assert!(res_disabled.is_err());
    let denied = res_disabled.unwrap_err();
    assert!(matches!(denied.outcome, ToolOutcome::Denied { .. }));

    // Enable the tool
    gateway.enable_tool(tool_id, false, None).unwrap();

    // 2. Invocation rejected when schema generation mismatches (e.g. model holds generation 2, active is 1)
    let res_stale = McpInvocationGate::validate_invocation(&gateway, &proposal, tool_id, 2);
    assert!(res_stale.is_err());
    let stale_err = res_stale.unwrap_err();
    assert!(matches!(
        stale_err.outcome,
        ToolOutcome::Failure { ref code, .. } if code == "stale_schema_generation"
    ));
    assert_eq!(stale_err.effect_certainty, EffectCertainty::NotStarted);

    // 3. Invocation permitted when enabled and generation matches
    let res_valid = McpInvocationGate::validate_invocation(&gateway, &proposal, tool_id, 1);
    assert!(res_valid.is_ok());
}

#[test]
fn test_mcp_response_normalization_and_error_distinction() {
    // Protocol error: effect certainty MUST be Unknown
    let protocol_err = McpRawResponse::ProtocolError {
        code: -32603,
        message: "Internal transport timeout".to_string(),
    };
    let norm_proto = McpInvocationGate::normalize_mcp_response("call-1", "op-1", protocol_err);

    assert_eq!(norm_proto.effect_certainty, EffectCertainty::Unknown);
    match norm_proto.outcome {
        ToolOutcome::Failure { code, message } => {
            assert_eq!(code, "mcp_protocol_error_-32603");
            assert_eq!(message, "Internal transport timeout");
        }
        _ => panic!("Expected failure outcome"),
    }

    // Application execution error: is_error=true -> effect certainty is Settled
    let app_err = McpRawResponse::ExecutionResult {
        is_error: true,
        content: "SQL syntax error near SELECT".to_string(),
        bytes_processed: 256,
        duration_ms: 12,
    };
    let norm_app = McpInvocationGate::normalize_mcp_response("call-2", "op-2", app_err);

    assert_eq!(norm_app.effect_certainty, EffectCertainty::Settled);
    match norm_app.outcome {
        ToolOutcome::Failure { code, message } => {
            assert_eq!(code, "tool_execution_error");
            assert_eq!(message, "SQL syntax error near SELECT");
        }
        _ => panic!("Expected failure outcome"),
    }

    // Application execution success: is_error=false
    let app_success = McpRawResponse::ExecutionResult {
        is_error: false,
        content: "Rows affected: 3".to_string(),
        bytes_processed: 512,
        duration_ms: 18,
    };
    let norm_succ = McpInvocationGate::normalize_mcp_response("call-3", "op-3", app_success);

    assert_eq!(norm_succ.effect_certainty, EffectCertainty::Settled);
    assert_eq!(norm_succ.outcome, ToolOutcome::Success);
    assert_eq!(norm_succ.output_excerpt, "Rows affected: 3");
    assert_eq!(norm_succ.bytes_processed, 512);
    assert_eq!(norm_succ.duration_ms, 18);
}
