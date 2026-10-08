use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ToolName(pub String);

impl ToolName {
    pub const READ_TEXT: &'static str = "project.read_text";
    pub const PROPOSE_PATCH: &'static str = "project.propose_patch";
    pub const APPLY_PATCH: &'static str = "project.apply_patch";
    pub const RUN_PROCESS: &'static str = "project.run_process";

    pub fn new(name: impl Into<String>) -> Self {
        Self(name.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolCategory {
    ReadOnly,
    ArtifactOnly,
    BrokeredMutation,
    ProcessExecution,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SchedulingClass {
    ConcurrentRead,
    ExclusiveMutation,
    ExclusiveProcess,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ResourceLimitSpec {
    pub max_read_bytes: u64,
    pub max_file_bytes: u64,
    pub max_patch_bytes: u64,
    pub max_patch_files: u32,
    pub max_wall_time_secs: u64,
    pub max_stdout_bytes: u64,
    pub max_excerpt_bytes: u64,
}

impl Default for ResourceLimitSpec {
    fn default() -> Self {
        Self {
            max_read_bytes: 256 * 1024,        // 256 KiB excerpt
            max_file_bytes: 8 * 1024 * 1024,   // 8 MiB max file
            max_patch_bytes: 1024 * 1024,      // 1 MiB patch
            max_patch_files: 20,               // 20 files max per patch
            max_wall_time_secs: 120,           // 120s wall time
            max_stdout_bytes: 8 * 1024 * 1024, // 8 MiB stdout/stderr
            max_excerpt_bytes: 16 * 1024,      // 16 KiB excerpt for LLM
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolDefinition {
    pub name: ToolName,
    pub version: String,
    pub category: ToolCategory,
    pub scheduling_class: SchedulingClass,
    pub limits: ResourceLimitSpec,
    pub requires_sandbox: bool,
}

impl ToolDefinition {
    pub fn read_text() -> Self {
        Self {
            name: ToolName::new(ToolName::READ_TEXT),
            version: "1.0.0".to_string(),
            category: ToolCategory::ReadOnly,
            scheduling_class: SchedulingClass::ConcurrentRead,
            limits: ResourceLimitSpec::default(),
            requires_sandbox: false,
        }
    }

    pub fn propose_patch() -> Self {
        Self {
            name: ToolName::new(ToolName::PROPOSE_PATCH),
            version: "1.0.0".to_string(),
            category: ToolCategory::ArtifactOnly,
            scheduling_class: SchedulingClass::ConcurrentRead,
            limits: ResourceLimitSpec::default(),
            requires_sandbox: false,
        }
    }

    pub fn apply_patch() -> Self {
        Self {
            name: ToolName::new(ToolName::APPLY_PATCH),
            version: "1.0.0".to_string(),
            category: ToolCategory::BrokeredMutation,
            scheduling_class: SchedulingClass::ExclusiveMutation,
            limits: ResourceLimitSpec::default(),
            requires_sandbox: false,
        }
    }

    pub fn run_process() -> Self {
        Self {
            name: ToolName::new(ToolName::RUN_PROCESS),
            version: "1.0.0".to_string(),
            category: ToolCategory::ProcessExecution,
            scheduling_class: SchedulingClass::ExclusiveProcess,
            limits: ResourceLimitSpec::default(),
            requires_sandbox: true,
        }
    }
}
