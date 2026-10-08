use super::{AppendEventRequest, AppendEventResult, SqliteEventStore};
use adham_core_types::*;
use sqlx::{Row, Sqlite};
use time::OffsetDateTime;

impl SqliteEventStore {
    pub async fn append_event(
        &self,
        req: AppendEventRequest,
    ) -> Result<AppendEventResult, DomainError> {
        let mut tx = self
            .pool
            .begin()
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;
        let res = Self::append_event_tx(&mut tx, req).await?;
        tx.commit()
            .await
            .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(res)
    }

    pub async fn append_event_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        req: AppendEventRequest,
    ) -> Result<AppendEventResult, DomainError> {
        let stream_row =
            sqlx::query("SELECT current_sequence, last_checksum FROM streams WHERE stream_id = ?")
                .bind(&req.stream_id)
                .fetch_optional(&mut **tx)
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
        let checksum = crate::checksum::ChecksumCalculator::calculate(
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
        .execute(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        let global_position = insert_res.last_insert_rowid();
        sqlx::query(
            r#"
            INSERT INTO streams (stream_id, stream_kind, current_sequence, last_checksum, last_event_id, updated_at_us)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(stream_id) DO UPDATE SET
                current_sequence = excluded.current_sequence,
                last_checksum = excluded.last_checksum,
                last_event_id = excluded.last_event_id,
                updated_at_us = excluded.updated_at_us
            "#,
        )
        .bind(&req.stream_id)
        .bind(&req.stream_kind)
        .bind(new_sequence as i64)
        .bind(&checksum)
        .bind(event_id.to_string())
        .bind(now_us)
        .execute(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(AppendEventResult {
            event_id,
            stream_sequence: new_sequence,
            global_position,
            checksum,
        })
    }
}
