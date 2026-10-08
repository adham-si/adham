use adham_extensions::domain::binding::{ToolEffectClass, ToolGrantState};
use adham_extensions::domain::connection::{McpConnection, McpTransportKind};
use adham_extensions::service::mcp_gateway::McpGateway;

#[test]
fn test_mcp_tools_strictly_disabled_by_default() {
    let mut gateway = McpGateway::new();

    let conn = McpConnection::new(
        "test-sqlite-mcp",
        McpTransportKind::Stdio {
            command: "mcp-sqlite".to_string(),
            args: vec!["--db".to_string(), "sample.db".to_string()],
        },
        1700000000,
    );
    let conn_id = conn.id.clone();
    gateway.register_connection(conn);

    let discovered = gateway
        .discover_tools(
            &conn_id,
            vec![
                (
                    "query_read".to_string(),
                    "Executes read queries".to_string(),
                    serde_json::json!({"type": "object", "properties": {"sql": {"type": "string"}}}),
                    ToolEffectClass::Read,
                ),
                (
                    "execute_write".to_string(),
                    "Executes write mutations".to_string(),
                    serde_json::json!({"type": "object", "properties": {"sql": {"type": "string"}}}),
                    ToolEffectClass::SideEffect,
                ),
            ],
        )
        .expect("Discovery should succeed");

    assert_eq!(discovered.len(), 2);

    // Invariant: All discovered tools start strictly DisabledByDefault!
    for tool_id in &discovered {
        let binding = gateway.get_tool(tool_id).expect("Tool must exist");
        assert!(!binding.is_enabled());
        assert_eq!(binding.grant_state, ToolGrantState::DisabledByDefault);
        assert_eq!(binding.schema.schema_generation, 1);
    }

    // Explicit individual enablement of only one tool
    let read_tool_id = &discovered[0];
    gateway
        .enable_tool(read_tool_id, false, Some("Permitted read queries".into()))
        .expect("Should enable tool");

    let read_binding = gateway.get_tool(read_tool_id).unwrap();
    assert!(read_binding.is_enabled());

    let write_tool_id = &discovered[1];
    let write_binding = gateway.get_tool(write_tool_id).unwrap();
    assert!(!write_binding.is_enabled()); // Remains disabled!
}

#[test]
fn test_schema_change_invalidates_prior_tool_grant() {
    let mut gateway = McpGateway::new();

    let conn = McpConnection::new(
        "analytics-mcp",
        McpTransportKind::StreamableHttp {
            endpoint: "https://api.analytics.internal/mcp".to_string(),
        },
        1700000000,
    );
    let conn_id = conn.id.clone();
    gateway.register_connection(conn);

    let discovered = gateway
        .discover_tools(
            &conn_id,
            vec![(
                "fetch_metric".to_string(),
                "Fetches metrics".to_string(),
                serde_json::json!({"type": "object", "properties": {"metric": {"type": "string"}}}),
                ToolEffectClass::Read,
            )],
        )
        .expect("Discovery should succeed");

    let tool_id = &discovered[0];

    // Explicitly enable the tool
    gateway
        .enable_tool(tool_id, false, None)
        .expect("Should enable tool");
    assert!(gateway.get_tool(tool_id).unwrap().is_enabled());

    // Schema changes on the server
    gateway
        .update_tool_schema(
            tool_id,
            serde_json::json!({
                "type": "object",
                "properties": {
                    "metric": {"type": "string"},
                    "timeframe": {"type": "string"}
                },
                "required": ["metric", "timeframe"]
            }),
        )
        .expect("Schema update should succeed");

    let updated_binding = gateway.get_tool(tool_id).unwrap();
    assert_eq!(updated_binding.schema.schema_generation, 2);

    // Invariant: modifying schema MUST invalidate existing grants and reset to DisabledByDefault!
    assert!(!updated_binding.is_enabled());
    assert_eq!(
        updated_binding.grant_state,
        ToolGrantState::DisabledByDefault
    );
}

#[test]
fn test_connection_suspension_disables_all_associated_tools() {
    let mut gateway = McpGateway::new();

    let conn = McpConnection::new(
        "temp-mcp",
        McpTransportKind::Stdio {
            command: "temp-cli".to_string(),
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
                "temp_tool".to_string(),
                "Temporary tool".to_string(),
                serde_json::json!({"type": "object"}),
                ToolEffectClass::Read,
            )],
        )
        .unwrap();

    let tool_id = &discovered[0];
    gateway.enable_tool(tool_id, false, None).unwrap();
    assert!(gateway.get_tool(tool_id).unwrap().is_enabled());

    // Suspend connection due to anomaly
    gateway
        .suspend_connection(&conn_id, "Suspicious activity detected")
        .unwrap();

    assert!(!gateway.get_tool(tool_id).unwrap().is_enabled());
}
