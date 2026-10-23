//! Local like/dislike feedback keyed to the exact answer row (lines 66-67).
//!
//! Durable local state, not an event: a verdict is never uploaded anywhere and
//! never affects inference authorization. It is keyed to one persisted
//! assistant row — one attempt — so a retry's new attempt starts unrated.
use crate::dtos::{AnswerFeedbackDto, AnswerVerdict, CommandContext, SetAnswerFeedbackPayload};
use crate::handlers::ApiContext;
use crate::service::common::{
    ensure_session_active_tx, lock_session_stream_tx, resolve_scoped_session,
};
use adham_core_types::{DomainError, SessionId};
use adham_projections::ConversationProjection;
use sqlx::{Pool, Sqlite};
use time::OffsetDateTime;

/// A reason is a note, not a document.
const REASON_MAX_CHARS: usize = 500;

/// Trimmed reason: blank means "no reason", overlong is refused.
pub fn normalize_reason(reason: Option<String>) -> Result<Option<String>, String> {
    let Some(raw) = reason else { return Ok(None) };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    if trimmed.chars().count() > REASON_MAX_CHARS {
        return Err(format!(
            "VALIDATION_FAILED: reason must be at most {REASON_MAX_CHARS} characters"
        ));
    }
    Ok(Some(trimmed.to_string()))
}

/// Verdicts for one session, ordered by message id. One shape everywhere: the
/// history page and the write response both read this.
pub async fn read_answer_feedback(
    pool: &Pool<Sqlite>,
    session_id: &SessionId,
) -> Result<Vec<AnswerFeedbackDto>, DomainError> {
    let rows: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT message_id, verdict, reason FROM answer_feedback \
         WHERE session_id = ? ORDER BY message_id",
    )
    .bind(session_id.to_string())
    .fetch_all(pool)
    .await
    .map_err(|e| DomainError::Storage(e.to_string()))?;
    let mut feedback = Vec::with_capacity(rows.len());
    for (message_id, verdict, reason) in rows {
        let verdict = match verdict.as_str() {
            "like" => AnswerVerdict::Like,
            "dislike" => AnswerVerdict::Dislike,
            // The table's CHECK constraint admits only the two verdicts.
            other => {
                return Err(DomainError::Integrity(format!(
                    "answer_feedback verdict corrupt: {other}"
                )));
            }
        };
        feedback.push(AnswerFeedbackDto {
            message_id,
            verdict,
            reason,
        });
    }
    Ok(feedback)
}

/// Set, switch, or remove (verdict null) the verdict for one answer. The
/// answer must be an assistant row of this session: anything else is refused
/// before any write, so the previous feedback stands.
pub async fn set_answer_feedback(
    ctx: &ApiContext,
    context: CommandContext,
    payload: SetAnswerFeedbackPayload,
) -> Result<Vec<AnswerFeedbackDto>, String> {
    let session_id = resolve_scoped_session(ctx, &context).await?;

    // Deserialization already admits only the two verdicts (or null).
    let verdict = payload.verdict.map(AnswerVerdict::as_str);
    let reason = normalize_reason(payload.reason)?;

    let rows = ConversationProjection::get_session_messages(
        &ctx.pool,
        ctx.content_key.as_ref(),
        &ctx.installation_id,
        &session_id,
    )
    .await
    .map_err(|e| e.to_string())?;
    let is_answer = rows
        .iter()
        .any(|r| r.message_id == payload.message_id && r.role == "assistant");
    if !is_answer {
        return Err(
            "VALIDATION_FAILED: feedback is for an assistant answer of this session".to_string(),
        );
    }

    let now_us = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
    let mut tx = ctx
        .pool
        .begin()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
    lock_session_stream_tx(&mut tx, &session_id.to_string()).await?;
    ensure_session_active_tx(&mut tx, &session_id.to_string()).await?;
    match verdict {
        Some(verdict) => {
            sqlx::query(
                "INSERT INTO answer_feedback (session_id, message_id, verdict, reason, updated_at_us)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(session_id, message_id) DO UPDATE SET
                     verdict = excluded.verdict,
                     reason = excluded.reason,
                     updated_at_us = excluded.updated_at_us",
            )
            .bind(session_id.to_string())
            .bind(&payload.message_id)
            .bind(verdict)
            .bind(reason)
            .bind(now_us)
            .execute(&mut *tx)
            .await
            .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        }
        None => {
            sqlx::query("DELETE FROM answer_feedback WHERE session_id = ? AND message_id = ?")
                .bind(session_id.to_string())
                .bind(&payload.message_id)
                .execute(&mut *tx)
                .await
                .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;
        }
    }
    tx.commit()
        .await
        .map_err(|e| format!("STORAGE_UNAVAILABLE: {e}"))?;

    read_answer_feedback(&ctx.pool, &session_id)
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_reason_normalizes_to_none() {
        assert_eq!(normalize_reason(None), Ok(None));
        assert_eq!(normalize_reason(Some("   ".to_string())), Ok(None));
        assert_eq!(normalize_reason(Some("\n\t ".to_string())), Ok(None));
    }

    #[test]
    fn reason_is_trimmed_and_kept() {
        assert_eq!(
            normalize_reason(Some("  too generic  ".to_string())),
            Ok(Some("too generic".to_string()))
        );
    }

    #[test]
    fn overlong_reason_is_refused_at_the_limit() {
        let at_limit = "x".repeat(REASON_MAX_CHARS);
        assert!(normalize_reason(Some(at_limit)).is_ok());
        let over = "x".repeat(REASON_MAX_CHARS + 1);
        let err = normalize_reason(Some(over)).expect_err("refused");
        assert!(err.contains("VALIDATION_FAILED"), "{err}");
    }
}
