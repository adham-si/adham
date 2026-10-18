//! Active-alternative selection for edited branches (line 65).
//!
//! Editing a prompt and resending appends an alternative branch; the original,
//! its answers, and whatever followed stay persisted and visible. The selection
//! here is *local state, not an event*: it never rewrites history. It decides
//! which member of a branch the session continues from — a later dispatch is
//! answered against that member and its answers only.
//!
//! Default when nothing is selected: the newest edit is the live branch, so a
//! session with an unselected branch is still coherent instead of mixing both
//! prompts into one context.
use crate::dtos::{BranchSelectionDto, CommandContext, SetActiveAlternativePayload};
use crate::handlers::ApiContext;
use adham_core_types::*;
use adham_projections::{ConversationMessageView, ConversationProjection};
use sqlx::{Pool, Row, Sqlite};
use std::collections::{HashMap, HashSet};
use time::OffsetDateTime;

fn is_alternative(row: &ConversationMessageView) -> bool {
    row.role == "user" && row.refers_to_relation.as_deref() == Some("edited-from")
}

/// Rows a dispatch is answered against once edited branches exist: every
/// branch contributes only its active member (the explicit selection, else the
/// newest edit) and that member's answers. Superseded prompts and their answers
/// stay persisted and visible, but are not fed back to the model. The newest
/// row always survives: it is the just-submitted turn of this dispatch.
pub fn active_branch_rows(
    rows: Vec<ConversationMessageView>,
    selections: &[BranchSelectionDto],
) -> Vec<ConversationMessageView> {
    if !rows.iter().any(is_alternative) {
        return rows;
    }
    let newest = rows.len() - 1;
    // Branch root -> indices of its alternatives, in row order.
    let mut groups: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, row) in rows.iter().enumerate() {
        if !is_alternative(row) {
            continue;
        }
        if let Some(root) = row.refers_to_message_id.as_deref() {
            groups.entry(root).or_default().push(index);
        }
    }
    let mut dropped: HashSet<usize> = HashSet::new();
    for (root_id, alternatives) in groups {
        // A root outside the loaded rows cannot be branched apart: leave the
        // group untouched rather than guess which prompt the edits follow.
        let Some(root_index) = rows.iter().position(|r| r.message_id == root_id) else {
            continue;
        };
        let mut members = alternatives;
        members.push(root_index);
        members.sort_unstable();
        let explicit = selections
            .iter()
            .find(|s| s.root_message_id == root_id)
            .map(|s| s.active_message_id.as_str());
        let active = explicit
            .and_then(|id| {
                members
                    .iter()
                    .copied()
                    .find(|&i| rows[i].message_id.as_str() == id)
            })
            // No explicit choice: the newest edit is the live branch.
            .unwrap_or_else(|| members.last().copied().unwrap_or(root_index));
        for &index in &members {
            if index != active {
                dropped.insert(index);
            }
        }
    }
    // A dropped prompt's answers travel with it: contiguous non-user rows up
    // to the next user turn.
    let mut dropped_answers: HashSet<usize> = HashSet::new();
    for &index in &dropped {
        let mut next = index + 1;
        while next < rows.len() && rows[next].role != "user" {
            dropped_answers.insert(next);
            next += 1;
        }
    }
    // The just-submitted turn of this dispatch is always the newest row; it
    // reaches the model regardless of any selection.
    dropped.remove(&newest);
    dropped_answers.remove(&newest);
    rows.into_iter()
        .enumerate()
        .filter_map(|(index, row)| {
            (!dropped.contains(&index) && !dropped_answers.contains(&index)).then_some(row)
        })
        .collect()
}

/// Selections for one session, ordered by root id. One shape everywhere: the
/// history page, dispatch assembly, and the write response all read this.
pub async fn read_branch_selections(
    pool: &Pool<Sqlite>,
    session_id: &SessionId,
) -> Result<Vec<BranchSelectionDto>, DomainError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT root_message_id, active_message_id FROM branch_selections \
         WHERE session_id = ? ORDER BY root_message_id",
    )
    .bind(session_id.to_string())
    .fetch_all(pool)
    .await
    .map_err(|e| DomainError::Storage(e.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|(root_message_id, active_message_id)| BranchSelectionDto {
            root_message_id,
            active_message_id,
        })
        .collect())
}

/// Record which member of an edited branch the session continues from.
/// Everything is validated before the write: the session exists inside the
/// caller's scope, the root is a user turn that actually has edited
/// alternatives, and the active member is that root or one of its edits. A
/// refused selection writes nothing (the previous selection stands).
pub async fn set_active_alternative(
    ctx: &ApiContext,
    context: CommandContext,
    payload: SetActiveAlternativePayload,
) -> Result<Vec<BranchSelectionDto>, String> {
    let session_id = SessionId::from_string(
        context
            .session_id
            .as_deref()
            .ok_or("sessionId context required")?,
    )
    .map_err(|e| e.to_string())?;

    let sess_stream = format!("session:{session_id}");
    let sess_row: Option<sqlx::sqlite::SqliteRow> = sqlx::query(
        "SELECT workspace_id, project_id FROM events WHERE stream_id = ? AND stream_sequence = 1",
    )
    .bind(&sess_stream)
    .fetch_optional(&ctx.pool)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    let sess_row =
        sess_row.ok_or("SESSION_NOT_FOUND: session stream does not exist".to_string())?;
    if let Some(expected) = context.workspace_id.as_deref() {
        let actual: Option<String> = sess_row.get("workspace_id");
        if actual.as_deref() != Some(expected) {
            return Err(
                "CONTEXT_MISMATCH: session does not belong to specified workspace".to_string(),
            );
        }
    }
    if let Some(expected) = context.project_id.as_deref() {
        let actual: Option<String> = sess_row.get("project_id");
        if actual.as_deref() != Some(expected) {
            return Err(
                "CONTEXT_MISMATCH: session does not belong to specified project".to_string(),
            );
        }
    }

    let rows = ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &session_id,
    )
    .await
    .map_err(|e| e.to_string())?;

    let is_edit_of_root = |row: &ConversationMessageView| {
        is_alternative(row)
            && row.refers_to_message_id.as_deref() == Some(payload.root_message_id.as_str())
    };
    let root_is_user = rows
        .iter()
        .any(|r| r.message_id == payload.root_message_id && r.role == "user");
    if !root_is_user {
        return Err(
            "VALIDATION_FAILED: alternative root must be a user message of this session"
                .to_string(),
        );
    }
    if !rows.iter().any(is_edit_of_root) {
        return Err("VALIDATION_FAILED: message has no edited alternatives".to_string());
    }
    let active_ok = payload.active_message_id == payload.root_message_id
        || rows
            .iter()
            .any(|r| is_edit_of_root(r) && r.message_id == payload.active_message_id);
    if !active_ok {
        return Err(
            "VALIDATION_FAILED: active alternative must be the original prompt or one of its edits"
                .to_string(),
        );
    }

    let now_us = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
    sqlx::query(
        "INSERT INTO branch_selections (session_id, root_message_id, active_message_id, updated_at_us)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, root_message_id) DO UPDATE SET
             active_message_id = excluded.active_message_id,
             updated_at_us = excluded.updated_at_us",
    )
    .bind(session_id.to_string())
    .bind(&payload.root_message_id)
    .bind(&payload.active_message_id)
    .bind(now_us)
    .execute(&ctx.pool)
    .await
    .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    read_branch_selections(&ctx.pool, &session_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(
        id: &str,
        role: &str,
        content: &str,
        refers_to: Option<(&str, &str)>,
    ) -> ConversationMessageView {
        ConversationMessageView {
            message_id: id.to_string(),
            session_id: "s1".to_string(),
            role: role.to_string(),
            content: content.to_string(),
            created_at_us: 0,
            op_id: None,
            completion: None,
            usage: None,
            refers_to_message_id: refers_to.map(|(id, _)| id.to_string()),
            refers_to_relation: refers_to.map(|(_, relation)| relation.to_string()),
        }
    }

    fn contents(rows: &[ConversationMessageView]) -> Vec<&str> {
        rows.iter().map(|r| r.content.as_str()).collect()
    }

    fn selection(root: &str, active: &str) -> BranchSelectionDto {
        BranchSelectionDto {
            root_message_id: root.to_string(),
            active_message_id: active.to_string(),
        }
    }

    /// q1 / a1 / edited q1' / its answer / later turn — the canonical shape.
    fn branched() -> Vec<ConversationMessageView> {
        vec![
            row("q1", "user", "original", None),
            row("a1", "assistant", "original answer", None),
            row("q2", "user", "edited", Some(("q1", "edited-from"))),
            row("a2", "assistant", "edited answer", None),
            row("q3", "user", "later", None),
        ]
    }

    #[test]
    fn without_alternatives_rows_pass_through() {
        let rows = vec![
            row("q1", "user", "one", None),
            row("a1", "assistant", "two", None),
        ];
        let filtered = active_branch_rows(rows, &[]);
        assert_eq!(contents(&filtered), vec!["one", "two"]);
    }

    #[test]
    fn default_keeps_the_newest_edit_and_its_answers() {
        let filtered = active_branch_rows(branched(), &[]);
        assert_eq!(
            contents(&filtered),
            vec!["edited", "edited answer", "later"]
        );
    }

    #[test]
    fn explicit_selection_keeps_the_original_branch() {
        let filtered = active_branch_rows(branched(), &[selection("q1", "q1")]);
        assert_eq!(
            contents(&filtered),
            vec!["original", "original answer", "later"]
        );
    }

    #[test]
    fn explicit_selection_of_the_edit_matches_the_default() {
        let filtered = active_branch_rows(branched(), &[selection("q1", "q2")]);
        assert_eq!(
            contents(&filtered),
            vec!["edited", "edited answer", "later"]
        );
    }

    #[test]
    fn stale_selection_falls_back_to_the_newest_edit() {
        let filtered = active_branch_rows(branched(), &[selection("q1", "not-a-member")]);
        assert_eq!(
            contents(&filtered),
            vec!["edited", "edited answer", "later"]
        );
    }

    #[test]
    fn root_outside_the_loaded_rows_leaves_the_group_untouched() {
        let rows = vec![
            row("q2", "user", "edited", Some(("q1", "edited-from"))),
            row("a2", "assistant", "edited answer", None),
        ];
        let filtered = active_branch_rows(rows, &[]);
        assert_eq!(contents(&filtered), vec!["edited", "edited answer"]);
    }

    #[test]
    fn chained_edits_keep_only_the_final_branch() {
        let rows = vec![
            row("q1", "user", "original", None),
            row("a1", "assistant", "original answer", None),
            row("q2", "user", "first edit", Some(("q1", "edited-from"))),
            row("a2", "assistant", "first edit answer", None),
            row("q3", "user", "second edit", Some(("q2", "edited-from"))),
            row("a3", "assistant", "second edit answer", None),
        ];
        let filtered = active_branch_rows(rows, &[]);
        assert_eq!(
            contents(&filtered),
            vec!["second edit", "second edit answer"]
        );
    }

    #[test]
    fn the_just_submitted_row_always_survives() {
        // A selection naming the original arrives together with a new edit as
        // the newest row: the edit still reaches the model.
        let rows = vec![
            row("q1", "user", "original", None),
            row("q2", "user", "edit one", Some(("q1", "edited-from"))),
            row("q3", "user", "edit two", Some(("q1", "edited-from"))),
        ];
        let filtered = active_branch_rows(rows, &[selection("q1", "q1")]);
        assert_eq!(contents(&filtered), vec!["original", "edit two"]);
    }

    #[test]
    fn replies_do_not_form_branches() {
        let rows = vec![
            row("q1", "user", "one", None),
            row("q2", "user", "quoted reply", Some(("q1", "replied"))),
        ];
        let filtered = active_branch_rows(rows, &[]);
        assert_eq!(contents(&filtered), vec!["one", "quoted reply"]);
    }
}
