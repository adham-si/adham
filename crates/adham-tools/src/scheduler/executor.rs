use crate::broker::patch::{apply_project_patch, PatchArtifact};
use crate::broker::read::read_project_text;
use crate::domain::grant::{ExecutionGrant, GrantError, RootGrant};
use crate::domain::proposal::NormalizedAction;
use crate::domain::result::{EffectCertainty, ToolResult};
use crate::sandbox::profile::SandboxProfile;
use crate::sandbox::runner::execute_sandboxed_process;
use crate::sandbox::staging::prepare_staging_area;
use crate::scheduler::scheduler::{SchedulerError, ToolScheduler};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum ToolExecutionError {
    #[error("Grant error: {0}")]
    Grant(#[from] GrantError),
    #[error("Scheduler error: {0}")]
    Scheduler(#[from] SchedulerError),
    #[error("Execution error: {0}")]
    Execution(String),
}

pub struct ToolExecutor {
    scheduler: ToolScheduler,
}

impl ToolExecutor {
    pub fn new(scheduler: ToolScheduler) -> Self {
        Self { scheduler }
    }

    pub async fn execute(
        &self,
        action: &NormalizedAction,
        grant: &mut ExecutionGrant,
        root: &RootGrant,
        now_ms: u64,
    ) -> Result<ToolResult, ToolExecutionError> {
        let op_id = Uuid::now_v7().to_string();
        let call_id = Uuid::now_v7().to_string();

        // 1. Consume grant
        grant.consume(&action.fingerprint(), now_ms)?;

        // 2. Dispatch with appropriate slot guard
        match action {
            NormalizedAction::ReadText {
                path,
                offset,
                length,
            } => {
                let _guard = self.scheduler.acquire_read_slot()?;
                match read_project_text(&root.base_path, path, *offset, *length) {
                    Ok(text) => {
                        let bytes = text.len() as u64;
                        Ok(ToolResult::success(call_id, op_id, text, bytes, 5))
                    }
                    Err(e) => Ok(ToolResult::failure(
                        call_id,
                        op_id,
                        "READ_FAILED",
                        e.to_string(),
                        EffectCertainty::NotStarted,
                    )),
                }
            }
            NormalizedAction::ProposePatch {
                target_path,
                proposed_content,
                baseline_hash,
            } => {
                let patch =
                    PatchArtifact::new(target_path, proposed_content, baseline_hash.clone());
                let summary = serde_json::to_string(&patch).unwrap_or_default();
                Ok(ToolResult::success(
                    call_id,
                    op_id,
                    summary,
                    proposed_content.len() as u64,
                    2,
                ))
            }
            NormalizedAction::ApplyPatch {
                target_path,
                expected_hash,
                new_content,
                ..
            } => {
                let _guard = self.scheduler.acquire_mutation_slot()?;
                match apply_project_patch(&root.base_path, target_path, expected_hash, new_content)
                {
                    Ok(patch_res) => {
                        let summary = serde_json::to_string(&patch_res).unwrap_or_default();
                        Ok(ToolResult::success(
                            call_id,
                            op_id,
                            summary,
                            patch_res.bytes_written,
                            10,
                        ))
                    }
                    Err(e) => Ok(ToolResult::failure(
                        call_id,
                        op_id,
                        "PATCH_FAILED",
                        e.to_string(),
                        EffectCertainty::NotStarted,
                    )),
                }
            }
            NormalizedAction::RunProcess {
                binary,
                argv,
                timeout_secs,
                ..
            } => {
                let _guard = self.scheduler.acquire_process_slot()?;
                let staging = prepare_staging_area(&root.base_path)
                    .map_err(|e| ToolExecutionError::Execution(e.to_string()))?;

                let mut profile = SandboxProfile::default();
                if let Some(t) = timeout_secs {
                    profile.timeout_secs = *t;
                }

                match execute_sandboxed_process(staging.path(), binary, argv, &profile).await {
                    Ok(output) => {
                        let excerpt =
                            format!("STDOUT:\n{}\nSTDERR:\n{}", output.stdout, output.stderr);
                        if output.exit_code == 0 {
                            Ok(ToolResult::success(
                                call_id,
                                op_id,
                                excerpt,
                                (output.stdout.len() + output.stderr.len()) as u64,
                                output.duration_ms,
                            ))
                        } else {
                            let mut res = ToolResult::failure(
                                call_id,
                                op_id,
                                format!("EXIT_CODE_{}", output.exit_code),
                                "Process exited with non-zero status",
                                EffectCertainty::Settled,
                            );
                            res.output_excerpt = excerpt;
                            res.duration_ms = output.duration_ms;
                            Ok(res)
                        }
                    }
                    Err(e) => Ok(ToolResult::failure(
                        call_id,
                        op_id,
                        "SANDBOX_FAILED",
                        e.to_string(),
                        EffectCertainty::Unknown,
                    )),
                }
            }
        }
    }
}
