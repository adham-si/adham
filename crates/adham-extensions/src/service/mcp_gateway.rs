use crate::domain::binding::{ToolBinding, ToolBindingError, ToolEffectClass};
use crate::domain::connection::{McpConnection, McpConnectionState};
use crate::domain::identity::{CanonicalToolId, McpConnectionId};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum McpGatewayError {
    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),

    #[error("Tool not found: {0}")]
    ToolNotFound(String),

    #[error("Connection is suspended or quarantined: {0}")]
    ConnectionUnavailable(String),

    #[error("Tool binding error: {0}")]
    Binding(#[from] ToolBindingError),
}

pub struct McpGateway {
    connections: HashMap<McpConnectionId, McpConnection>,
    tools: HashMap<CanonicalToolId, ToolBinding>,
}

impl McpGateway {
    pub fn new() -> Self {
        Self {
            connections: HashMap::new(),
            tools: HashMap::new(),
        }
    }

    pub fn register_connection(&mut self, connection: McpConnection) {
        self.connections.insert(connection.id.clone(), connection);
    }

    pub fn get_connection(&self, id: &McpConnectionId) -> Option<&McpConnection> {
        self.connections.get(id)
    }

    pub fn discover_tools(
        &mut self,
        connection_id: &McpConnectionId,
        discovered_specs: Vec<(String, String, serde_json::Value, ToolEffectClass)>,
    ) -> Result<Vec<CanonicalToolId>, McpGatewayError> {
        let conn = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| McpGatewayError::ConnectionNotFound(connection_id.to_string()))?;

        match &conn.state {
            McpConnectionState::Suspended { reason }
            | McpConnectionState::Quarantined { reason } => {
                return Err(McpGatewayError::ConnectionUnavailable(reason.clone()));
            }
            _ => {
                conn.mark_discovery_ready();
            }
        }

        let generation = conn.generation;
        let mut tool_ids = Vec::new();

        for (name, desc, schema_json, effect) in discovered_specs {
            let canonical_tool_id = CanonicalToolId::new(connection_id.clone(), generation, &name);
            let binding = ToolBinding::new_discovered(
                canonical_tool_id.clone(),
                name,
                desc,
                schema_json,
                effect,
            )?;

            // Invariant verified: newly created binding is strictly DisabledByDefault
            self.tools.insert(canonical_tool_id.clone(), binding);
            tool_ids.push(canonical_tool_id);
        }

        Ok(tool_ids)
    }

    pub fn get_tool(&self, id: &CanonicalToolId) -> Option<&ToolBinding> {
        self.tools.get(id)
    }

    pub fn enable_tool(
        &mut self,
        id: &CanonicalToolId,
        require_approval: bool,
        notes: Option<String>,
    ) -> Result<(), McpGatewayError> {
        let conn = self
            .connections
            .get_mut(&id.connection_id)
            .ok_or_else(|| McpGatewayError::ConnectionNotFound(id.connection_id.to_string()))?;

        if matches!(
            conn.state,
            McpConnectionState::Suspended { .. } | McpConnectionState::Quarantined { .. }
        ) {
            return Err(McpGatewayError::ConnectionUnavailable(conn.id.to_string()));
        }

        let tool = self
            .tools
            .get_mut(id)
            .ok_or_else(|| McpGatewayError::ToolNotFound(id.to_string()))?;

        tool.enable(require_approval, notes);
        conn.mark_active_for_selected_tools();
        Ok(())
    }

    pub fn disable_tool(&mut self, id: &CanonicalToolId) -> Result<(), McpGatewayError> {
        let tool = self
            .tools
            .get_mut(id)
            .ok_or_else(|| McpGatewayError::ToolNotFound(id.to_string()))?;

        tool.disable();
        Ok(())
    }

    pub fn update_tool_schema(
        &mut self,
        id: &CanonicalToolId,
        new_schema: serde_json::Value,
    ) -> Result<(), McpGatewayError> {
        let tool = self
            .tools
            .get_mut(id)
            .ok_or_else(|| McpGatewayError::ToolNotFound(id.to_string()))?;

        // Invariant: updating schema invalidates prior grant and resets to DisabledByDefault
        tool.update_schema(new_schema)?;
        Ok(())
    }

    pub fn suspend_connection(
        &mut self,
        connection_id: &McpConnectionId,
        reason: impl Into<String>,
    ) -> Result<(), McpGatewayError> {
        let conn = self
            .connections
            .get_mut(connection_id)
            .ok_or_else(|| McpGatewayError::ConnectionNotFound(connection_id.to_string()))?;

        conn.suspend(reason);

        // Invalidate and disable all tools on this connection
        for (id, tool) in self.tools.iter_mut() {
            if &id.connection_id == connection_id {
                tool.disable();
            }
        }

        Ok(())
    }
}

impl Default for McpGateway {
    fn default() -> Self {
        Self::new()
    }
}
