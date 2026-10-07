use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffectCertainty {
    NotStarted,
    Active,
    Settled,
    Partial,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum ToolOutcome {
    Success,
    Failure { code: String, message: String },
    Timeout,
    Denied { reason: String },
    Blocked { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ToolResult {
    pub tool_call_id: String,
    pub operation_id: String,
    pub outcome: ToolOutcome,
    pub effect_certainty: EffectCertainty,
    pub output_excerpt: String,
    pub output_artifact_ref: Option<String>,
    pub bytes_processed: u64,
    pub duration_ms: u64,
}

impl ToolResult {
    pub const MAX_EXCERPT_CHARS: usize = 16 * 1024; // 16 KiB excerpt limit

    pub fn success(
        tool_call_id: impl Into<String>,
        operation_id: impl Into<String>,
        output: impl AsRef<str>,
        bytes_processed: u64,
        duration_ms: u64,
    ) -> Self {
        let text = output.as_ref();
        let output_excerpt = if text.len() > Self::MAX_EXCERPT_CHARS {
            format!("{}... [truncated]", &text[..Self::MAX_EXCERPT_CHARS])
        } else {
            text.to_string()
        };

        Self {
            tool_call_id: tool_call_id.into(),
            operation_id: operation_id.into(),
            outcome: ToolOutcome::Success,
            effect_certainty: EffectCertainty::Settled,
            output_excerpt,
            output_artifact_ref: None,
            bytes_processed,
            duration_ms,
        }
    }

    pub fn failure(
        tool_call_id: impl Into<String>,
        operation_id: impl Into<String>,
        code: impl Into<String>,
        message: impl Into<String>,
        effect: EffectCertainty,
    ) -> Self {
        Self {
            tool_call_id: tool_call_id.into(),
            operation_id: operation_id.into(),
            outcome: ToolOutcome::Failure {
                code: code.into(),
                message: message.into(),
            },
            effect_certainty: effect,
            output_excerpt: String::new(),
            output_artifact_ref: None,
            bytes_processed: 0,
            duration_ms: 0,
        }
    }

    pub fn denied(
        tool_call_id: impl Into<String>,
        operation_id: impl Into<String>,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            tool_call_id: tool_call_id.into(),
            operation_id: operation_id.into(),
            outcome: ToolOutcome::Denied {
                reason: reason.into(),
            },
            effect_certainty: EffectCertainty::NotStarted,
            output_excerpt: String::new(),
            output_artifact_ref: None,
            bytes_processed: 0,
            duration_ms: 0,
        }
    }
}
