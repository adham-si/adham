use super::{CommandReceiptRecord, SqliteEventStore};
use adham_core_types::*;
use sqlx::{Row, Sqlite};

fn read_row(r: &sqlx::sqlite::SqliteRow) -> CommandReceiptRecord {
    CommandReceiptRecord {
        request_id: r.get::<String, _>("request_id"),
        command_type: r.get("command_type"),
        command_version: r.get("command_version"),
        scope_fingerprint: r.get("scope_fingerprint"),
        request_fingerprint: r.get("request_fingerprint"),
        actor_id: r
            .try_get::<Option<String>, _>("actor_id")
            .ok()
            .flatten()
            .unwrap_or_default(),
        correlation_id: r.get("correlation_id"),
        outcome_code: r.get("outcome_code"),
        response_json: r.get("response_json"),
    }
}

impl SqliteEventStore {
    pub async fn check_receipt(
        &self,
        request_id: &RequestId,
    ) -> Result<Option<CommandReceiptRecord>, DomainError> {
        // Request-identity boundary is request_id alone. Callers MUST compare
        // command, version, actor, scope, and payload and return
        // REQUEST_ID_CONFLICT on any mismatch without mutation or disclosure.
        let row = sqlx::query(
            "SELECT request_id, command_type, command_version, scope_fingerprint, request_fingerprint, actor_id, correlation_id, outcome_code, response_json FROM command_receipts WHERE request_id = ?"
        )
        .bind(request_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(row.as_ref().map(read_row))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn record_receipt(
        &self,
        request_id: &RequestId,
        command_type: &str,
        command_version: i32,
        scope_fingerprint: &str,
        request_fingerprint: &str,
        actor_id: &ActorId,
        correlation_id: &CorrelationId,
        outcome_code: &str,
        response_json: &[u8],
        global_pos: i64,
    ) -> Result<(), DomainError> {
        let now_us = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
        sqlx::query(
            r#"
            INSERT INTO command_receipts (
                request_id, command_type, command_version, scope_fingerprint, request_fingerprint,
                actor_id, correlation_id, outcome_code, response_json, first_global_position, last_global_position,
                committed_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(request_id.to_string())
        .bind(command_type)
        .bind(command_version)
        .bind(scope_fingerprint)
        .bind(request_fingerprint)
        .bind(actor_id.to_string())
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

    pub async fn check_receipt_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        request_id: &RequestId,
    ) -> Result<Option<CommandReceiptRecord>, DomainError> {
        let row = sqlx::query(
            "SELECT request_id, command_type, command_version, scope_fingerprint, request_fingerprint, actor_id, correlation_id, outcome_code, response_json FROM command_receipts WHERE request_id = ?"
        )
        .bind(request_id.to_string())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(row.as_ref().map(read_row))
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn record_receipt_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        request_id: &RequestId,
        command_type: &str,
        command_version: i32,
        scope_fingerprint: &str,
        request_fingerprint: &str,
        actor_id: &ActorId,
        correlation_id: &CorrelationId,
        outcome_code: &str,
        response_json: &[u8],
        global_pos: i64,
    ) -> Result<(), DomainError> {
        let now_us = (time::OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000) as i64;
        sqlx::query(
            r#"
            INSERT INTO command_receipts (
                request_id, command_type, command_version, scope_fingerprint, request_fingerprint,
                actor_id, correlation_id, outcome_code, response_json, first_global_position, last_global_position,
                committed_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(request_id.to_string())
        .bind(command_type)
        .bind(command_version)
        .bind(scope_fingerprint)
        .bind(request_fingerprint)
        .bind(actor_id.to_string())
        .bind(correlation_id.to_string())
        .bind(outcome_code)
        .bind(response_json)
        .bind(global_pos)
        .bind(global_pos)
        .bind(now_us)
        .execute(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(())
    }
}
