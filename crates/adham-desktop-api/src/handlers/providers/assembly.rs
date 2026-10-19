//! Context assembly for one dispatch (Delivery A): mode instruction, branch
//! history, size caps, and the evidenced input budget.

use super::{ApiContext, effective_context_budget};

use crate::dtos::*;
use adham_core_types::*;
use adham_provider::domain::model::ModelDescriptor;
use adham_provider::domain::request::{ChatMessage, MessageRole};

/// Bounded server-side history: cap N messages and N bytes, trimmed from the
/// oldest end. The newest user message (the dispatch input) is always kept.
const MAX_HISTORY_MESSAGES: usize = 20;

const MAX_HISTORY_BYTES: usize = 16_384;

/// Chars-per-token estimate for budgeting. No tokenizer is embedded, so every
/// figure derived from this is labeled estimated in the UI.
const ESTIMATE_CHARS_PER_TOKEN: usize = 4;

/// Output/generation reserve inside the effective context: Ollama's num_ctx
/// covers prompt + generated tokens (thinking included), so num_predict is
/// pinned to the reserve below. At most half the budget, never more than 4096.
const OUTPUT_RESERVE_TOKENS: u32 = 4096;

pub(crate) struct AssembledContext {
    pub(crate) messages: Vec<ChatMessage>,
    pub(crate) estimated_input_tokens: u32,
    pub(crate) input_budget_tokens: Option<u32>,
    pub(crate) dropped_messages: u32,
}

fn estimate_tokens(chars: usize) -> u32 {
    (chars as u64).div_ceil(ESTIMATE_CHARS_PER_TOKEN as u64) as u32
}

/// Evidenced input budget and output reserve: effective context (model max ∩
/// configured num_ctx) minus the reserve. Unknown evidence stays unknown —
/// nothing is guessed. Returns (input_budget, max_output_tokens).
pub(crate) fn budget_with_reserve(descriptor: &ModelDescriptor) -> (Option<u32>, Option<u32>) {
    let Some(effective) = effective_context_budget(descriptor) else {
        return (None, None);
    };
    let reserve = OUTPUT_RESERVE_TOKENS.min(effective / 2);
    (Some(effective - reserve), (reserve > 0).then_some(reserve))
}

/// The rows a dispatch is answered against. A fresh send (or a reply, which
/// only quotes) keeps the whole session history. An "edited-from" branch
/// answers against the context its original had: everything before the edited
/// message, plus the just-submitted edited turn. The original prompt, its
/// answers, and whatever followed stay persisted and visible, but are not fed
/// back to the model.
fn branch_context_rows(
    rows: Vec<adham_projections::ConversationMessageView>,
    reference: Option<&MessageReferenceDto>,
) -> impl Iterator<Item = adham_projections::ConversationMessageView> {
    let newest = rows.len().saturating_sub(1);
    // The reference was validated before the submit effect: the target is a
    // persisted user row of this session (position found defensively anyway).
    let cut = reference
        .filter(|r| r.relation == "edited-from")
        .and_then(|r| {
            rows.iter()
                .position(|row| row.message_id.as_str() == r.refers_to_message_id)
        });
    rows.into_iter()
        .enumerate()
        .filter_map(move |(index, row)| match cut {
            Some(cut) if index >= cut && index != newest => None,
            _ => Some(row),
        })
}

/// The rows a dispatch is answered against, in the order both rules need: an
/// "edited-from" send is answered against the context its original had (the
/// cut), and then every edited branch contributes only its active member. The
/// cut runs first because it is defined against the persisted rows: an edit of
/// an already-superseded prompt must still see what that prompt saw.
pub(crate) async fn branch_aware_rows(
    rows: Vec<adham_projections::ConversationMessageView>,
    reference: Option<&MessageReferenceDto>,
    session_id: &SessionId,
    ctx: &ApiContext,
) -> std::vec::IntoIter<adham_projections::ConversationMessageView> {
    // A failed selection read falls back to the default branch (the newest
    // edit) instead of mixing superseded prompts into the context.
    let selections = crate::service::branch::read_branch_selections(&ctx.pool, session_id)
        .await
        .unwrap_or_default();
    crate::service::branch::active_branch_rows(
        branch_context_rows(rows, reference).collect(),
        &selections,
    )
    .into_iter()
}

/// Context assembly: mode instruction + branch history under the caps and the
/// evidenced input budget. Oldest messages drop first and every drop is
/// counted; the newest message always survives (a single oversized message is
/// sent as-is with the estimate visible rather than refusing the send).
/// `stop_after` (retry/regenerate) ends history at that message inclusive: the
/// turn is answered again against the context it originally had, and previous
/// attempts of the same turn are not fed back to the model.
pub(crate) fn assemble_context(
    rows: impl Iterator<Item = adham_projections::ConversationMessageView>,
    instruction: Option<&str>,
    input_budget: Option<u32>,
    stop_after: Option<&str>,
) -> AssembledContext {
    let instruction_chars = instruction.map(str::len).unwrap_or(0);
    let mut kept: Vec<ChatMessage> = Vec::new();
    for row in rows {
        if matches!(
            row.completion,
            Some(MessageCompletionV1::Interrupted) | Some(MessageCompletionV1::Failed)
        ) {
            continue;
        }
        let is_last = stop_after == Some(row.message_id.as_str());
        kept.push(ChatMessage {
            role: if row.role == "assistant" {
                MessageRole::Assistant
            } else {
                MessageRole::User
            },
            content: row.content,
        });
        if is_last {
            break;
        }
    }
    // trim from the oldest end; the newest messages win
    let mut dropped_messages: u32 = 0;
    loop {
        if kept.len() <= 1 {
            break;
        }
        let bytes: usize = kept.iter().map(|m| m.content.len()).sum();
        let estimated = estimate_tokens(bytes + instruction_chars);
        let over_caps = kept.len() > MAX_HISTORY_MESSAGES || bytes > MAX_HISTORY_BYTES;
        let over_budget = input_budget.map(|b| estimated > b).unwrap_or(false);
        if !over_caps && !over_budget {
            break;
        }
        kept.remove(0);
        dropped_messages += 1;
    }
    // non-empty content guard: model gets a user prompt (the submitted row is in history)
    if kept.last().map(|m| m.role) != Some(MessageRole::User) {
        kept.push(ChatMessage {
            role: MessageRole::User,
            content: "(empty prompt)".to_string(),
        });
    }
    // Turn-mode instruction: part of this request only. The stored user text
    // stays exactly what the user wrote; the mode is frozen at dispatch.
    if let Some(instruction) = instruction {
        kept.insert(
            0,
            ChatMessage {
                role: MessageRole::System,
                content: instruction.to_string(),
            },
        );
    }
    let bytes: usize = kept.iter().map(|m| m.content.len()).sum();
    AssembledContext {
        estimated_input_tokens: estimate_tokens(bytes),
        input_budget_tokens: input_budget,
        dropped_messages,
        messages: kept,
    }
}

/// System instruction for a declared turn mode. Request-only: mode semantics
/// never persist and no mode grants permissions — tools do not exist yet, so
/// "execute" (refused in the handler) is the only mode with nothing to bind to.
pub(crate) fn mode_instruction(mode: &str) -> Option<&'static str> {
    match mode {
        "ask" => Some(
            "Mode: Ask. Hold a conversation: answer and discuss directly. Do not claim to change \
             files, run commands, or take any action.",
        ),
        "plan" => Some(
            "Mode: Plan. Respond with a read-only plan: steps, trade-offs and risks. Do not claim \
             to have changed or executed anything.",
        ),
        "code" => Some(
            "Mode: Code. Respond with code ready to review and apply by hand (complete snippets \
             or diffs). You cannot execute anything.",
        ),
        _ => None,
    }
}
