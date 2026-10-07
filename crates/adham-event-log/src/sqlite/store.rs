use crate::checksum::ChecksumCalculator;
use adham_core_types::*;
use sqlx::{Pool, Row, Sqlite};
use time::OffsetDateTime;

pub struct SqliteEventStore {
    pool: Pool<Sqlite>,
}

#[derive(Debug, Clone)]
pub struct AppendEventRequest {
    pub stream_id: String,
    pub stream_kind: String,
    pub expected_sequence: u64,
    pub event_type: String,
    pub event_version: u16,
    pub scope: EventScope,
    pub actor: EventActor,
    pub request_id: RequestId,
    pub correlation_id: CorrelationId,
    pub causation_id: Option<EventId>,
    pub payload_json: Vec<u8>,
    pub metadata_json: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct AppendEventResult {
    pub event_id: EventId,
    pub stream_sequence: u64,
    pub global_position: i64,
    pub checksum: String,
}

impl SqliteEventStore {
    pub fn new(pool: Pool<Sqlite>) -> Self {
        Self { pool }
    }

    pub fn pool(&self) -> &Pool<Sqlite> {
        &self.pool
    }

    pub async fn check_receipt(&self, request_id: &RequestId) -> Result<Option<Vec<u8>>, DomainError> {
        let row = sqlx::query("SELECT response_json FROM command_receipts WHERE request_id = ?")
            .bind(request_id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(row.map(|r| r.get::<Vec<u8>, _>("response_json")))
    }

    pub async fn put_content(
        &self,
        content_id: &ContentId,
        kind: &str,
        media_type: &str,
        encoding: &str,
        protection: &str,
        bytes: &[u8],
    ) -> Result<(), DomainError> {
        let now_us = OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000;
        sqlx::query(
            r#"
            INSERT INTO content_records (
                content_id, content_kind, media_type, encoding, protection_scheme,
                protected_bytes, plaintext_size, created_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(content_id.to_string())
        .bind(kind)
        .bind(media_type)
        .bind(encoding)
        .bind(protection)
        .bind(bytes)
        .bind(bytes.len() as i64)
        .bind(now_us as i64)
        .execute(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(())
    }

    pub async fn get_content(&self, content_id: &ContentId) -> Result<Option<Vec<u8>>, DomainError> {
        let row = sqlx::query("SELECT protected_bytes FROM content_records WHERE content_id = ?")
            .bind(content_id.to_string())
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(row.map(|r| r.get::<Vec<u8>, _>("protected_bytes")))
    }

    pub async fn append_event(
        &self,
        req: AppendEventRequest,
    ) -> Result<AppendEventResult, DomainError> {
        let mut tx = self.pool.begin().await.map_err(|e| DomainError::Storage(e.to_string()))?;

        // 1. Check or initialize stream
        let stream_row = sqlx::query(
            "SELECT current_sequence, last_checksum FROM streams WHERE stream_id = ?"
        )
        .bind(&req.stream_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        let (current_seq, last_checksum): (u64, Option<String>) = match stream_row {
            Some(row) => (
                row.get::<i64, _>("current_sequence") as u64,
                row.get::<Option<String>, _>("last_checksum"),
            ),
            None => (0, None),
        };

        if current_seq != req.expected_sequence {
            return Err(DomainError::ConcurrencyConflict(
                req.stream_id.clone(),
                req.expected_sequence,
                current_seq,
            ));
        }

        let new_sequence = current_seq + 1;
        let event_id = EventId::new_v7();

        // 2. Compute checksum
        let checksum = ChecksumCalculator::calculate(
            last_checksum.as_deref(),
            &req.stream_id,
            new_sequence,
            &event_id.to_string(),
            &req.event_type,
            req.event_version,
            &req.payload_json,
            &req.metadata_json,
        );

        let now = OffsetDateTime::now_utc();
        let now_us = (now.unix_timestamp_nanos() / 1_000) as i64;

        // 3. Insert event
        let insert_res = sqlx::query(
            r#"
            INSERT INTO events (
                event_id, event_type, event_version, stream_id, stream_kind, stream_sequence,
                installation_id, workspace_id, project_id, session_id,
                actor_id, actor_kind, request_id, correlation_id, causation_id,
                occurred_at_us, recorded_at_us, payload_json, metadata_json,
                previous_checksum, checksum
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(event_id.to_string())
        .bind(&req.event_type)
        .bind(req.event_version as i32)
        .bind(&req.stream_id)
        .bind(&req.stream_kind)
        .bind(new_sequence as i64)
        .bind(req.scope.installation_id.to_string())
        .bind(req.scope.workspace_id.map(|id| id.to_string()))
        .bind(req.scope.project_id.map(|id| id.to_string()))
        .bind(req.scope.session_id.map(|id| id.to_string()))
        .bind(req.actor.actor_id.to_string())
        .bind(format!("{:?}", req.actor.kind))
        .bind(req.request_id.to_string())
        .bind(req.correlation_id.to_string())
        .bind(req.causation_id.map(|id| id.to_string()))
        .bind(now_us)
        .bind(now_us)
        .bind(&req.payload_json)
        .bind(&req.metadata_json)
        .bind(last_checksum)
        .bind(&checksum)
        .execute(&mut *tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        let global_position = insert_res.last_insert_rowid();

        // 4. Update or insert stream tracking
        sqlx::query(
            r#"
            INSERT INTO streams (stream_id, stream_kind, current_sequence, last_checksum, last_event_id, updated_at_us)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(stream_id) DO UPDATE SET
                current_sequence = excluded.current_sequence,
                last_checksum = excluded.last_checksum,
                last_event_id = excluded.last_event_id,
                updated_at_us = excluded.updated_at_us
            "#
        )
        .bind(&req.stream_id)
        .bind(&req.stream_kind)
        .bind(new_sequence as i64)
        .bind(&checksum)
        .bind(event_id.to_string())
        .bind(now_us)
        .execute(&mut *tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        tx.commit().await.map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(AppendEventResult {
            event_id,
            stream_sequence: new_sequence,
            global_position,
            checksum,
        })
    }

    pub async fn record_receipt(
        &self,
        request_id: &RequestId,
        command_type: &str,
        command_version: i32,
        scope_fingerprint: &str,
        request_fingerprint: &str,
        correlation_id: &CorrelationId,
        outcome_code: &str,
        response_json: &[u8],
        global_pos: i64,
    ) -> Result<(), DomainError> {
        let now_us = (OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
        sqlx::query(
            r#"
            INSERT INTO command_receipts (
                request_id, command_type, command_version, scope_fingerprint, request_fingerprint,
                correlation_id, outcome_code, response_json, first_global_position, last_global_position,
                committed_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(request_id.to_string())
        .bind(command_type)
        .bind(command_version)
        .bind(scope_fingerprint)
        .bind(request_fingerprint)
        .bind(correlation_id.to_string())
        .bind(outcome_code)
        .bind(response_json)
        .bind(global_pos)
        .bind(global_pos)
        .bind(now_us)
        .execute(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(())
    }
}
