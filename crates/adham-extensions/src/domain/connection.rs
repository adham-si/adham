use crate::domain::identity::McpConnectionId;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpTransportKind {
    Stdio { command: String, args: Vec<String> },
    StreamableHttp { endpoint: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum McpConnectionState {
    Proposed,
    Reviewed,
    ConfiguredDisabled,
    Connecting,
    DiscoveryReady,
    ActiveForSelectedTools,
    Suspended { reason: String },
    Quarantined { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpConnection {
    pub id: McpConnectionId,
    pub server_name: String,
    pub transport: McpTransportKind,
    pub state: McpConnectionState,
    pub generation: u64,
    pub created_at_epoch_ms: u64,
}

impl McpConnection {
    pub fn new(
        server_name: impl Into<String>,
        transport: McpTransportKind,
        created_at_epoch_ms: u64,
    ) -> Self {
        Self {
            id: McpConnectionId::new(),
            server_name: server_name.into(),
            transport,
            state: McpConnectionState::ConfiguredDisabled,
            generation: 1,
            created_at_epoch_ms,
        }
    }

    pub fn mark_discovery_ready(&mut self) {
        self.state = McpConnectionState::DiscoveryReady;
    }

    pub fn mark_active_for_selected_tools(&mut self) {
        self.state = McpConnectionState::ActiveForSelectedTools;
    }

    pub fn suspend(&mut self, reason: impl Into<String>) {
        self.state = McpConnectionState::Suspended {
            reason: reason.into(),
        };
        self.generation += 1;
    }

    pub fn quarantine(&mut self, reason: impl Into<String>) {
        self.state = McpConnectionState::Quarantined {
            reason: reason.into(),
        };
        self.generation += 1;
    }

    pub fn update_config(&mut self, new_transport: McpTransportKind) {
        self.transport = new_transport;
        self.state = McpConnectionState::ConfiguredDisabled;
        self.generation += 1; // Invalidate all prior tool bindings
    }
}
