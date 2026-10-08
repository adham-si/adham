use crate::domain::binding::ToolGrantState;
use crate::domain::identity::CanonicalToolId;
use crate::service::mcp_gateway::McpGateway;
use adham_tools::domain::proposal::ToolProposal;
use adham_tools::domain::result::{EffectCertainty, ToolResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum McpRawResponse {
    ProtocolError {
        code: i64,
        message: String,
    },
    ExecutionResult {
        is_error: bool,
        content: String,
        bytes_processed: u64,
        duration_ms: u64,
    },
}

pub struct McpInvocationGate;

impl McpInvocationGate {
    /// Validates an incoming model ToolProposal against the registered MCP tool binding.
    /// Returns Ok(()) if the tool is enabled and matches the schema generation,
    /// or Err(ToolResult) if the invocation is denied or blocked.
    pub fn validate_invocation(
        gateway: &McpGateway,
        proposal: &ToolProposal,
        tool_id: &CanonicalToolId,
        expected_schema_generation: u64,
    ) -> Result<(), ToolResult> {
        let tool = match gateway.get_tool(tool_id) {
            Some(t) => t,
            None => {
                return Err(ToolResult::denied(
                    proposal.proposal_id.0.clone(),
                    format!("op-{}", proposal.step_id),
                    format!("Tool '{}' is not registered in the MCP gateway", tool_id),
                ));
            }
        };

        // Invariant: tool MUST be explicitly enabled
        match &tool.grant_state {
            ToolGrantState::DisabledByDefault => {
                return Err(ToolResult::denied(
                    proposal.proposal_id.0.clone(),
                    format!("op-{}", proposal.step_id),
                    format!(
                        "Tool '{}' is disabled by default and requires explicit enablement",
                        tool.tool_name
                    ),
                ));
            }
            ToolGrantState::EnabledWithPolicy { .. } => {}
        }

        // Invariant: schema generation must match pinned generation
        if tool.schema.schema_generation != expected_schema_generation {
            return Err(ToolResult::failure(
                proposal.proposal_id.0.clone(),
                format!("op-{}", proposal.step_id),
                "stale_schema_generation",
                format!(
                    "Tool schema generation mismatch (expected {}, active {})",
                    expected_schema_generation, tool.schema.schema_generation
                ),
                EffectCertainty::NotStarted,
            ));
        }

        Ok(())
    }

    /// Normalizes raw MCP protocol/execution output into an adham-tools ToolResult.
    /// Strictly distinguishes protocol errors from application execution isError=true flags.
    pub fn normalize_mcp_response(
        tool_call_id: impl Into<String>,
        operation_id: impl Into<String>,
        raw_response: McpRawResponse,
    ) -> ToolResult {
        let call_id = tool_call_id.into();
        let op_id = operation_id.into();

        match raw_response {
            McpRawResponse::ProtocolError { code, message } => {
                // Protocol/transport error: effect certainty is Unknown
                ToolResult::failure(
                    call_id,
                    op_id,
                    format!("mcp_protocol_error_{}", code),
                    message,
                    EffectCertainty::Unknown,
                )
            }
            McpRawResponse::ExecutionResult {
                is_error,
                content,
                bytes_processed,
                duration_ms,
            } => {
                if is_error {
                    // Tool completed execution on the server, but reported application error
                    ToolResult::failure(
                        call_id,
                        op_id,
                        "tool_execution_error",
                        content,
                        EffectCertainty::Settled,
                    )
                } else {
                    ToolResult::success(call_id, op_id, content, bytes_processed, duration_ms)
                }
            }
        }
    }
}
