use adham_core_types::{DomainError, MessageSubmittedV1, SessionId};
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Row, Sqlite};
use time::OffsetDateTime;
use tracing::info;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConversationMessageView {
    pub message_id: String,
    pub session_id: String,
    pub role: String,
    pub content: String,
    pub created_at_us: i64,
}

pub struct ConversationProjection;

impl ConversationProjection {
    pub async fn insert_message(
        pool: &Pool<Sqlite>,
        message_id: &str,
        workspace_id: &str,
        project_id: &str,
        session_id: &str,
        role: &str,
        content_id: &str,
        source_event_id: &str,
        source_global_position: i64,
        created_at_us: i64,
    ) -> Result<(), DomainError> {
        sqlx::query(
            r#"
            INSERT INTO conversation_messages (
                message_id, workspace_id, project_id, session_id, role,
                content_id, source_event_id, source_global_position, created_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(message_id) DO UPDATE SET
                role = excluded.role,
                source_event_id = excluded.source_event_id,
                source_global_position = excluded.source_global_position,
                created_at_us = excluded.created_at_us
            "#,
        )
        .bind(message_id)
        .bind(workspace_id)
        .bind(project_id)
        .bind(session_id)
        .bind(role)
        .bind(content_id)
        .bind(source_event_id)
        .bind(source_global_position)
        .bind(created_at_us)
        .execute(pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(())
    }

    pub async fn get_session_messages(
        pool: &Pool<Sqlite>,
        session_id: &SessionId,
    ) -> Result<Vec<ConversationMessageView>, DomainError> {
        let rows = sqlx::query(
            r#"
            SELECT cm.message_id, cm.session_id, cm.role, cm.created_at_us, cr.protected_bytes
            FROM conversation_messages cm
            LEFT JOIN content_records cr ON cm.content_id = cr.content_id
            WHERE cm.session_id = ?
            ORDER BY cm.source_global_position ASC
            "#,
        )
        .bind(session_id.to_string())
        .fetch_all(pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        let mut messages = Vec::with_capacity(rows.len());
        for row in rows {
            let message_id: String = row.get("message_id");
            let session_id_str: String = row.get("session_id");
            let role: String = row.get("role");
            let created_at_us: i64 = row.get("created_at_us");
            let bytes_opt: Option<Vec<u8>> = row.get("protected_bytes");

            let content = match bytes_opt {
                Some(b) => String::from_utf8_lossy(&b).to_string(),
                None => String::new(),
            };

            messages.push(ConversationMessageView {
                message_id,
                session_id: session_id_str,
                role,
                content,
                created_at_us,
            });
        }

        Ok(messages)
    }

    pub async fn rebuild(pool: &Pool<Sqlite>) -> Result<u64, DomainError> {
        info!("Rebuilding conversation projection from canonical events...");
        let mut tx = pool.begin().await.map_err(|e| DomainError::Storage(e.to_string()))?;

        // 1. Wipe existing projection
        sqlx::query("DELETE FROM conversation_messages")
            .execute(&mut *tx)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        // 2. Query all message events in strict global order
        let rows = sqlx::query(
            r#"
            SELECT global_position, event_id, workspace_id, project_id, session_id,
                   occurred_at_us, payload_json
            FROM events
            WHERE event_type = 'MessageSubmitted'
            ORDER BY global_position ASC
            "#,
        )
        .fetch_all(&mut *tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        let mut count: u64 = 0;
        let mut last_position: i64 = 0;

        for row in rows {
            let global_position: i64 = row.get("global_position");
            let event_id: String = row.get("event_id");
            let workspace_id: String = row.get("workspace_id");
            let project_id: String = row.get("project_id");
            let session_id: String = row.get("session_id");
            let occurred_at_us: i64 = row.get("occurred_at_us");
            let payload_bytes: Vec<u8> = row.get("payload_json");

            let payload: MessageSubmittedV1 = serde_json::from_slice(&payload_bytes)
                .map_err(|e| DomainError::Validation(format!("Invalid MessageSubmittedV1 payload: {e}")))?;

            sqlx::query(
                r#"
                INSERT INTO conversation_messages (
                    message_id, workspace_id, project_id, session_id, role,
                    content_id, source_event_id, source_global_position, created_at_us
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#,
            )
            .bind(payload.message_id.to_string())
            .bind(&workspace_id)
            .bind(&project_id)
            .bind(&session_id)
            .bind("user")
            .bind(payload.content_id.to_string())
            .bind(&event_id)
            .bind(global_position)
            .bind(occurred_at_us)
            .execute(&mut *tx)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;

            last_position = global_position;
            count += 1;
        }

        // 3. Update projection checkpoint
        let now_us = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
        sqlx::query(
            r#"
            INSERT INTO projection_checkpoints (
                projection_name, projection_version, last_global_position, status, error_code, updated_at_us
            ) VALUES ('conversation_messages', 1, ?, 'active', NULL, ?)
            ON CONFLICT(projection_name) DO UPDATE SET
                last_global_position = excluded.last_global_position,
                status = excluded.status,
                error_code = excluded.error_code,
                updated_at_us = excluded.updated_at_us
            "#,
        )
        .bind(last_position)
        .bind(now_us)
        .execute(&mut *tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        tx.commit().await.map_err(|e| DomainError::Storage(e.to_string()))?;
        info!("Conversation projection rebuilt successfully ({count} messages replayed).");

        Ok(count)
    }
}
