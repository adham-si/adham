use super::SqliteEventStore;
use adham_core_types::*;
use sqlx::{Row, Sqlite};
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingOperationRecord {
    pub operation_id: String,
    pub kind: String,
    pub workspace_id: String,
    pub project_id: String,
    pub session_id: Option<String>,
    pub create_request_id: Option<String>,
    pub message_request_id: String,
    pub content_id: String,
    pub title_content_id: Option<String>,
    pub status: String,
    pub created_at_us: i64,
    pub updated_at_us: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HydratedPendingOperation {
    pub operation_id: String,
    pub kind: String,
    pub workspace_id: String,
    pub project_id: String,
    pub session_id: Option<String>,
    pub create_request_id: Option<String>,
    pub message_request_id: String,
    pub text: String,
    pub title: Option<String>,
    pub status: String,
    pub created_at: String,
}

impl SqliteEventStore {
    #[allow(clippy::too_many_arguments)]
    pub async fn record_pending_operation_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        provider: &dyn super::super::content_key::ContentKeyProvider,
        operation_id: &str,
        kind: &str,
        scope: &EventScope,
        create_request_id: Option<&str>,
        message_request_id: &str,
        text: &str,
        title: Option<&str>,
    ) -> Result<PendingOperationRecord, DomainError> {
        let ws_str = scope
            .workspace_id
            .as_ref()
            .map(|w| w.to_string())
            .ok_or_else(|| DomainError::Validation("workspace_id context required".into()))?;
        let proj_str = scope
            .project_id
            .as_ref()
            .map(|p| p.to_string())
            .ok_or_else(|| DomainError::Validation("project_id context required".into()))?;
        let sess_str = scope.session_id.as_ref().map(|s| s.to_string());

        // Idempotency check: see if operation_id or message_request_id is already recorded
        let existing_row = sqlx::query(
            r#"
            SELECT operation_id, kind, workspace_id, project_id, session_id,
                   create_request_id, message_request_id, content_id, title_content_id,
                   status, created_at_us, updated_at_us
            FROM pending_operations
            WHERE operation_id = ? OR message_request_id = ?
            "#,
        )
        .bind(operation_id)
        .bind(message_request_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        if let Some(r) = existing_row {
            let existing = PendingOperationRecord {
                operation_id: r.get("operation_id"),
                kind: r.get("kind"),
                workspace_id: r.get("workspace_id"),
                project_id: r.get("project_id"),
                session_id: r.get("session_id"),
                create_request_id: r.get("create_request_id"),
                message_request_id: r.get("message_request_id"),
                content_id: r.get("content_id"),
                title_content_id: r.get("title_content_id"),
                status: r.get("status"),
                created_at_us: r.get("created_at_us"),
                updated_at_us: r.get("updated_at_us"),
            };

            // Check if all fields and payloads match
            let is_match = existing.operation_id == operation_id
                && existing.kind == kind
                && existing.workspace_id == ws_str
                && existing.project_id == proj_str
                && existing.session_id.as_deref() == sess_str.as_deref()
                && existing.create_request_id.as_deref() == create_request_id
                && existing.message_request_id == message_request_id;

            if !is_match {
                return Err(DomainError::RequestIdConflict(
                    "operation scope or IDs mismatch".into(),
                ));
            }

            // Verify content payload matches
            let cid = ContentId::from_string(&existing.content_id)
                .map_err(|e| DomainError::Validation(e.to_string()))?;
            let decrypted_bytes = Self::get_content_tx(tx, provider, &cid, scope)
                .await?
                .ok_or_else(|| {
                    DomainError::Integrity("pending operation content missing".into())
                })?;
            let decrypted_text = String::from_utf8(decrypted_bytes)
                .map_err(|e| DomainError::Integrity(e.to_string()))?;

            if decrypted_text != text {
                return Err(DomainError::RequestIdConflict(
                    "operation payload text mismatch".into(),
                ));
            }

            if let Some(expected_title) = title {
                let t_cid_str = existing.title_content_id.as_ref().ok_or_else(|| {
                    DomainError::RequestIdConflict("title presence mismatch".into())
                })?;
                let t_cid = ContentId::from_string(t_cid_str)
                    .map_err(|e| DomainError::Validation(e.to_string()))?;
                let decrypted_t_bytes = Self::get_content_tx(tx, provider, &t_cid, scope)
                    .await?
                    .ok_or_else(|| {
                        DomainError::Integrity("pending operation title content missing".into())
                    })?;
                let decrypted_title = String::from_utf8(decrypted_t_bytes)
                    .map_err(|e| DomainError::Integrity(e.to_string()))?;
                if decrypted_title != expected_title {
                    return Err(DomainError::RequestIdConflict(
                        "operation title mismatch".into(),
                    ));
                }
            } else if existing.title_content_id.is_some() {
                return Err(DomainError::RequestIdConflict(
                    "title presence mismatch".into(),
                ));
            }

            return Ok(existing);
        }

        // New record: seal message text into content_records
        let content_id = ContentId::new_v7();
        Self::put_content_tx(
            tx,
            provider,
            &content_id,
            "pending_user_text",
            "text/plain",
            scope,
            text.as_bytes(),
        )
        .await?;

        // If title provided, seal title into content_records
        let title_content_id = if let Some(t) = title {
            let t_cid = ContentId::new_v7();
            Self::put_content_tx(
                tx,
                provider,
                &t_cid,
                "pending_session_title",
                "text/plain",
                scope,
                t.as_bytes(),
            )
            .await?;
            Some(t_cid)
        } else {
            None
        };

        let now_us = OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000;
        let t_cid_str = title_content_id.as_ref().map(|id| id.to_string());

        sqlx::query(
            r#"
            INSERT INTO pending_operations (
                operation_id, kind, workspace_id, project_id, session_id,
                create_request_id, message_request_id, content_id, title_content_id,
                status, created_at_us, updated_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(operation_id)
        .bind(kind)
        .bind(&ws_str)
        .bind(&proj_str)
        .bind(&sess_str)
        .bind(create_request_id)
        .bind(message_request_id)
        .bind(content_id.to_string())
        .bind(&t_cid_str)
        .bind("pending")
        .bind(now_us as i64)
        .bind(now_us as i64)
        .execute(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(PendingOperationRecord {
            operation_id: operation_id.to_string(),
            kind: kind.to_string(),
            workspace_id: ws_str,
            project_id: proj_str,
            session_id: sess_str,
            create_request_id: create_request_id.map(str::to_string),
            message_request_id: message_request_id.to_string(),
            content_id: content_id.to_string(),
            title_content_id: t_cid_str,
            status: "pending".to_string(),
            created_at_us: now_us as i64,
            updated_at_us: now_us as i64,
        })
    }

    pub async fn list_pending_operations(
        &self,
        provider: &dyn super::super::content_key::ContentKeyProvider,
        installation_id: &InstallationId,
        limit: usize,
    ) -> Result<(Vec<HydratedPendingOperation>, bool), DomainError> {
        let fetch_limit = (limit + 1) as i64;
        let rows = sqlx::query(
            r#"
            SELECT operation_id, kind, workspace_id, project_id, session_id,
                   create_request_id, message_request_id, content_id, title_content_id,
                   status, created_at_us
            FROM pending_operations
            ORDER BY created_at_us DESC
            LIMIT ?
            "#,
        )
        .bind(fetch_limit)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        let truncated = rows.len() > limit;
        let to_process = if truncated { &rows[..limit] } else { &rows[..] };

        let mut hydrated = Vec::with_capacity(to_process.len());
        for r in to_process {
            let op_id: String = r.get("operation_id");
            let kind: String = r.get("kind");
            let ws_str: String = r.get("workspace_id");
            let proj_str: String = r.get("project_id");
            let sess_str: Option<String> = r.get("session_id");
            let create_req: Option<String> = r.get("create_request_id");
            let msg_req: String = r.get("message_request_id");
            let cid_str: String = r.get("content_id");
            let t_cid_str: Option<String> = r.get("title_content_id");
            let status: String = r.get("status");
            let created_at_us: i64 = r.get("created_at_us");

            let scope = EventScope {
                installation_id: *installation_id,
                workspace_id: Some(
                    WorkspaceId::from_string(&ws_str)
                        .map_err(|e| DomainError::Validation(e.to_string()))?,
                ),
                project_id: Some(
                    ProjectId::from_string(&proj_str)
                        .map_err(|e| DomainError::Validation(e.to_string()))?,
                ),
                session_id: sess_str
                    .as_deref()
                    .map(|s| {
                        SessionId::from_string(s)
                            .map_err(|e| DomainError::Validation(e.to_string()))
                    })
                    .transpose()?,
            };

            let cid = ContentId::from_string(&cid_str)
                .map_err(|e| DomainError::Validation(e.to_string()))?;
            let text_bytes = self
                .get_content(provider, &cid, &scope)
                .await?
                .ok_or_else(|| {
                    DomainError::Integrity(format!(
                        "content record missing for pending operation {op_id}"
                    ))
                })?;
            let text =
                String::from_utf8(text_bytes).map_err(|e| DomainError::Integrity(e.to_string()))?;

            let title = if let Some(t_str) = t_cid_str {
                let t_cid = ContentId::from_string(&t_str)
                    .map_err(|e| DomainError::Validation(e.to_string()))?;
                let t_bytes = self
                    .get_content(provider, &t_cid, &scope)
                    .await?
                    .ok_or_else(|| {
                        DomainError::Integrity(format!(
                            "title content missing for pending operation {op_id}"
                        ))
                    })?;
                Some(
                    String::from_utf8(t_bytes)
                        .map_err(|e| DomainError::Integrity(e.to_string()))?,
                )
            } else {
                None
            };

            let created_dt =
                OffsetDateTime::from_unix_timestamp_nanos(created_at_us as i128 * 1_000)
                    .map_err(|e| DomainError::Integrity(e.to_string()))?;
            let created_at = created_dt
                .format(&time::format_description::well_known::Rfc3339)
                .map_err(|e| DomainError::Integrity(e.to_string()))?;

            hydrated.push(HydratedPendingOperation {
                operation_id: op_id,
                kind,
                workspace_id: ws_str,
                project_id: proj_str,
                session_id: sess_str,
                create_request_id: create_req,
                message_request_id: msg_req,
                text,
                title,
                status,
                created_at,
            });
        }

        Ok((hydrated, truncated))
    }

    pub async fn clear_pending_operation_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        operation_id: &str,
        expected_message_request_id: &str,
        reason: &str,
    ) -> Result<(), DomainError> {
        if reason != "resolved" && reason != "dismissed" {
            return Err(DomainError::Validation(
                "reason must be resolved or dismissed".into(),
            ));
        }
        let row = sqlx::query(
            "SELECT message_request_id, content_id, title_content_id FROM pending_operations WHERE operation_id = ?",
        )
        .bind(operation_id)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        let (cid_str, t_cid_str) = match row {
            None => return Ok(()), // Already cleared idempotently
            Some(r) => {
                let recorded_req: String = r.get("message_request_id");
                if recorded_req != expected_message_request_id {
                    return Err(DomainError::RequestIdConflict(
                        "operation message_request_id mismatch on clear".into(),
                    ));
                }
                let cid: String = r.get("content_id");
                let t_cid: Option<String> = r.get("title_content_id");
                (cid, t_cid)
            }
        };

        sqlx::query("DELETE FROM pending_operations WHERE operation_id = ?")
            .bind(operation_id)
            .execute(&mut **tx)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        sqlx::query("DELETE FROM content_records WHERE content_id = ? AND content_kind = 'pending_user_text'")
            .bind(&cid_str)
            .execute(&mut **tx)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        if let Some(t_cid) = t_cid_str {
            sqlx::query("DELETE FROM content_records WHERE content_id = ? AND content_kind = 'pending_session_title'")
                .bind(&t_cid)
                .execute(&mut **tx)
                .await
                .map_err(|e| DomainError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    /// Mark a provider-completion operation resolved (terminal event written).
    /// The row stays for audit + reload reconstruction; idempotent.
    pub async fn resolve_pending_operation_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        operation_id: &str,
        expected_message_request_id: &str,
    ) -> Result<(), DomainError> {
        let now_us = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
        sqlx::query(
            "UPDATE pending_operations SET status = 'resolved', updated_at_us = ? \
             WHERE operation_id = ? AND message_request_id = ?",
        )
        .bind(now_us)
        .bind(operation_id)
        .bind(expected_message_request_id)
        .execute(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(())
    }
}
