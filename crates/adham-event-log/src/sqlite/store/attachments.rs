//! Attachment index over sealed content. Metadata and extraction state only;
//! the text lives in `content_records` and opens only under the recorded scope.

use super::SqliteEventStore;
use adham_core_types::*;
use sqlx::{Row, Sqlite};

/// One ingested attachment. `extracted_chars` and `truncated` describe the
/// text handed to the model budget, not the file the user picked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentRecord {
    pub attachment_id: AttachmentId,
    pub content_id: ContentId,
    pub file_name: String,
    pub media_type: String,
    pub byte_size: i64,
    pub content_hash: String,
    pub hash_algorithm: String,
    pub extracted_chars: i64,
    pub truncated: bool,
    pub retention: String,
    pub workspace_id: WorkspaceId,
    pub project_id: ProjectId,
    pub session_id: SessionId,
    pub created_at_us: i64,
}

fn row_to_record(r: &sqlx::sqlite::SqliteRow) -> Result<AttachmentRecord, DomainError> {
    let bad = |field: &str| DomainError::Storage(format!("attachment row has invalid {field}"));
    Ok(AttachmentRecord {
        attachment_id: AttachmentId::from_string(&r.get::<String, _>("attachment_id"))
            .map_err(|_| bad("attachment_id"))?,
        content_id: ContentId::from_string(&r.get::<String, _>("content_id"))
            .map_err(|_| bad("content_id"))?,
        file_name: r.get("file_name"),
        media_type: r.get("media_type"),
        byte_size: r.get("byte_size"),
        content_hash: r.get("content_hash"),
        hash_algorithm: r.get("hash_algorithm"),
        extracted_chars: r.get("extracted_chars"),
        truncated: r.get::<i64, _>("truncated") != 0,
        retention: r.get("retention"),
        workspace_id: WorkspaceId::from_string(&r.get::<String, _>("workspace_id"))
            .map_err(|_| bad("workspace_id"))?,
        project_id: ProjectId::from_string(&r.get::<String, _>("project_id"))
            .map_err(|_| bad("project_id"))?,
        session_id: SessionId::from_string(&r.get::<String, _>("session_id"))
            .map_err(|_| bad("session_id"))?,
        created_at_us: r.get("created_at_us"),
    })
}

impl SqliteEventStore {
    pub async fn insert_attachment_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        record: &AttachmentRecord,
    ) -> Result<(), DomainError> {
        sqlx::query(
            r#"
            INSERT INTO attachment_records (
                attachment_id, content_id, file_name, media_type, byte_size,
                content_hash, hash_algorithm, extracted_chars, truncated,
                retention, workspace_id, project_id, session_id, created_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(record.attachment_id.to_string())
        .bind(record.content_id.to_string())
        .bind(&record.file_name)
        .bind(&record.media_type)
        .bind(record.byte_size)
        .bind(&record.content_hash)
        .bind(&record.hash_algorithm)
        .bind(record.extracted_chars)
        .bind(i64::from(record.truncated))
        .bind(&record.retention)
        .bind(record.workspace_id.to_string())
        .bind(record.project_id.to_string())
        .bind(record.session_id.to_string())
        .bind(record.created_at_us)
        .execute(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(())
    }

    /// Scope-filtered lookup: a row from another workspace, project or session
    /// is not found even when its id is known.
    pub async fn get_attachment(
        &self,
        workspace_id: &WorkspaceId,
        project_id: &ProjectId,
        session_id: &SessionId,
        attachment_id: &AttachmentId,
    ) -> Result<Option<AttachmentRecord>, DomainError> {
        let row = sqlx::query(
            r#"
            SELECT * FROM attachment_records
            WHERE attachment_id = ? AND workspace_id = ? AND project_id = ? AND session_id = ?
            "#,
        )
        .bind(attachment_id.to_string())
        .bind(workspace_id.to_string())
        .bind(project_id.to_string())
        .bind(session_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        row.as_ref().map(row_to_record).transpose()
    }

    pub async fn link_attachments_to_message_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        message_id: &MessageId,
        attachment_ids: &[AttachmentId],
    ) -> Result<(), DomainError> {
        for (position, attachment_id) in attachment_ids.iter().enumerate() {
            sqlx::query(
                r#"
                INSERT INTO message_attachments (message_id, attachment_id, position)
                VALUES (?, ?, ?)
                "#,
            )
            .bind(message_id.to_string())
            .bind(attachment_id.to_string())
            .bind(position as i64)
            .execute(&mut **tx)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;
        }
        Ok(())
    }

    /// Attachments linked to this session's messages, ordered by message and
    /// selection position. Grouping happens in the caller.
    pub async fn list_session_message_attachments(
        &self,
        session_id: &SessionId,
    ) -> Result<Vec<(String, AttachmentRecord)>, DomainError> {
        let rows = sqlx::query(
            r#"
            SELECT ma.message_id AS linked_message_id, ar.*
            FROM message_attachments ma
            JOIN attachment_records ar ON ar.attachment_id = ma.attachment_id
            WHERE ar.session_id = ?
            ORDER BY ma.message_id, ma.position
            "#,
        )
        .bind(session_id.to_string())
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        rows.iter()
            .map(|r| {
                let message_id: String = r.get("linked_message_id");
                row_to_record(r).map(|record| (message_id, record))
            })
            .collect()
    }
}
