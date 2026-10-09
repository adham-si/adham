use crate::domain::graph::TaskGraph;
use crate::domain::node::{NodeId, NodeLifecycle};
use crate::engine::join::{assemble_context_shard, collect_incoming_artifacts};
use crate::engine::scheduler::{
    advance_graph_state, mark_node_completed, mark_node_failed, mark_node_running,
};
use adham_core_types::{ProjectId, SessionId, WorkspaceId};
use adham_runtime::application::AgentDriver;
use adham_runtime::domain::*;
use adham_runtime::ports::clock::Clock;
use adham_runtime::ports::model::ModelPort;
use adham_runtime::ports::verification::{CompletionContract, VerificationPort};
use uuid::Uuid;

pub struct SubagentCoordinator {
    pub graph: TaskGraph,
    pub workspace_id: WorkspaceId,
    pub project_id: ProjectId,
}

impl SubagentCoordinator {
    pub fn new(graph: TaskGraph, workspace_id: WorkspaceId, project_id: ProjectId) -> Self {
        Self {
            graph,
            workspace_id,
            project_id,
        }
    }

    #[allow(clippy::field_reassign_with_default)]
    pub async fn execute_next_node<M: ModelPort, V: VerificationPort, C: Clock>(
        &mut self,
        model: M,
        verifier: V,
        clock: C,
    ) -> Result<Option<NodeId>, String> {
        advance_graph_state(&mut self.graph).map_err(|e| e.to_string())?;
        let ready_node = self
            .graph
            .nodes()
            .iter()
            .find(|n| n.lifecycle == NodeLifecycle::Ready)
            .map(|n| n.definition.node_id.clone());

        let Some(node_id) = ready_node else {
            return Ok(None);
        };

        let (objective, allocated_tokens, allocated_steps) = {
            let node = self.graph.get_node(&node_id).ok_or("Node not found")?;
            (
                node.definition.objective.clone(),
                node.definition.allocated_tokens,
                node.definition.allocated_steps,
            )
        };
        let artifacts = collect_incoming_artifacts(&self.graph, &node_id);
        let context_shard = assemble_context_shard(&objective, &artifacts);

        let delegation_id = format!("del-{}", Uuid::now_v7());
        mark_node_running(&mut self.graph, &node_id, delegation_id).map_err(|e| e.to_string())?;

        let driver = AgentDriver::new(model, verifier, clock);

        // Child session with dedicated identity
        let child_identity = ExecutionIdentity {
            workspace_id: self.workspace_id,
            project_id: self.project_id,
            session_id: SessionId::new_v7(),
            agent_id: AgentId::new(format!("subagent-{}", node_id.as_str())),
            run_id: RunId::new_v7(),
        };

        let mut state = RunState::new_queued(child_identity);
        let mut budget = RunBudget::default();
        budget.max_turns = allocated_tokens.min(16);
        budget.max_steps = allocated_steps;
        let mut usage = BudgetUsage::default();

        let contract = CompletionContract {
            task_id: node_id.0.clone(),
            required_evidence_count: 1,
        };

        match driver
            .run_step(&mut state, &budget, &mut usage, &contract, &context_shard)
            .await
        {
            Ok(run_result) => {
                if run_result.lifecycle == RunLifecycle::Terminal
                    && run_result.terminal_outcome == Some(TerminalOutcome::Completed)
                {
                    let artifact_text =
                        format!("Artifact produced by {}: Completed", node_id.as_str());
                    mark_node_completed(&mut self.graph, &node_id, Some(artifact_text))
                        .map_err(|e| e.to_string())?;
                } else {
                    mark_node_failed(
                        &mut self.graph,
                        &node_id,
                        format!("Child run ended in state: {:?}", run_result.lifecycle),
                    )
                    .map_err(|e| e.to_string())?;
                }
            }
            Err(e) => {
                mark_node_failed(&mut self.graph, &node_id, e.to_string())
                    .map_err(|err| err.to_string())?;
            }
        }

        advance_graph_state(&mut self.graph).map_err(|e| e.to_string())?;
        Ok(Some(node_id))
    }
}
