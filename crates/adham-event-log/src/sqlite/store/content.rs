use super::SqliteEventStore;
use adham_core_types::*;
use sqlx::{Row, Sqlite};
use time::OffsetDateTime;

impl SqliteEventStore {
    pub async fn put_content(
        &self,
        provider: &dyn super::super::content_key::ContentKeyProvider,
        content_id: &ContentId,
        kind: &str,
        media_type: &str,
        scope: &EventScope,
        plaintext: &[u8],
    ) -> Result<(), DomainError> {
        let sealed =
            super::super::content_crypto::seal(provider, content_id, kind, scope, plaintext)?;
        let now_us = OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000;
        sqlx::query(
            r#"
            INSERT INTO content_records (
                content_id, content_kind, media_type, encoding, protection_scheme,
                key_reference, nonce, protected_bytes, plaintext_size,
                installation_id, workspace_id, project_id, session_id, created_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(content_id.to_string())
        .bind(kind)
        .bind(media_type)
        .bind(super::super::content_crypto::ENCODING_ENCRYPTED)
        .bind(super::super::content_crypto::PROTECTION_AEAD_V1)
        .bind(sealed.key_reference)
        .bind(sealed.nonce)
        .bind(sealed.ciphertext)
        .bind(plaintext.len() as i64)
        .bind(scope.installation_id.to_string())
        .bind(scope.workspace_id.map(|id| id.to_string()))
        .bind(scope.project_id.map(|id| id.to_string()))
        .bind(scope.session_id.map(|id| id.to_string()))
        .bind(now_us as i64)
        .execute(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

        Ok(())
    }

    pub async fn get_content(
        &self,
        provider: &dyn super::super::content_key::ContentKeyProvider,
        content_id: &ContentId,
        expected_scope: &EventScope,
    ) -> Result<Option<Vec<u8>>, DomainError> {
        let row = sqlx::query(
            "SELECT content_kind, protection_scheme, key_reference, nonce, protected_bytes FROM content_records WHERE content_id = ?",
        )
        .bind(content_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        match row {
            None => Ok(None),
            Some(r) => Self::open_row(provider, content_id, expected_scope, &r).map(Some),
        }
    }

    /// Raw ciphertext accessor for tests asserting no cleartext at rest.
    /// Never returns plaintext.
    pub async fn get_content_ciphertext(
        &self,
        content_id: &ContentId,
    ) -> Result<Option<(String, Vec<u8>)>, DomainError> {
        let row = sqlx::query(
            "SELECT protection_scheme, protected_bytes FROM content_records WHERE content_id = ?",
        )
        .bind(content_id.to_string())
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(row.map(|r| {
            (
                r.get::<String, _>("protection_scheme"),
                r.get::<Vec<u8>, _>("protected_bytes"),
            )
        }))
    }

    pub async fn put_content_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        provider: &dyn super::super::content_key::ContentKeyProvider,
        content_id: &ContentId,
        kind: &str,
        media_type: &str,
        scope: &EventScope,
        plaintext: &[u8],
    ) -> Result<(), DomainError> {
        let sealed =
            super::super::content_crypto::seal(provider, content_id, kind, scope, plaintext)?;
        let now_us = OffsetDateTime::now_utc().unix_timestamp_nanos() / 1_000;
        sqlx::query(
            r#"
            INSERT INTO content_records (
                content_id, content_kind, media_type, encoding, protection_scheme,
                key_reference, nonce, protected_bytes, plaintext_size,
                installation_id, workspace_id, project_id, session_id, created_at_us
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            "#,
        )
        .bind(content_id.to_string())
        .bind(kind)
        .bind(media_type)
        .bind(super::super::content_crypto::ENCODING_ENCRYPTED)
        .bind(super::super::content_crypto::PROTECTION_AEAD_V1)
        .bind(sealed.key_reference)
        .bind(sealed.nonce)
        .bind(sealed.ciphertext)
        .bind(plaintext.len() as i64)
        .bind(scope.installation_id.to_string())
        .bind(scope.workspace_id.map(|id| id.to_string()))
        .bind(scope.project_id.map(|id| id.to_string()))
        .bind(scope.session_id.map(|id| id.to_string()))
        .bind(now_us as i64)
        .execute(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        Ok(())
    }

    pub async fn get_content_tx(
        tx: &mut sqlx::Transaction<'_, Sqlite>,
        provider: &dyn super::super::content_key::ContentKeyProvider,
        content_id: &ContentId,
        expected_scope: &EventScope,
    ) -> Result<Option<Vec<u8>>, DomainError> {
        let row = sqlx::query(
            "SELECT content_kind, protection_scheme, nonce, protected_bytes FROM content_records WHERE content_id = ?",
        )
        .bind(content_id.to_string())
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
        match row {
            None => Ok(None),
            Some(r) => Self::open_row(provider, content_id, expected_scope, &r).map(Some),
        }
    }

    fn open_row(
        provider: &dyn super::super::content_key::ContentKeyProvider,
        content_id: &ContentId,
        expected_scope: &EventScope,
        r: &sqlx::sqlite::SqliteRow,
    ) -> Result<Vec<u8>, DomainError> {
        let kind: String = r.get("content_kind");
        let protection: String = r.get("protection_scheme");
        if protection != super::super::content_crypto::PROTECTION_AEAD_V1 {
            return Err(DomainError::Integrity(format!(
                "legacy unprotected content rejected: {protection}"
            )));
        }
        let nonce: Vec<u8> = r.get("nonce");
        let ciphertext: Vec<u8> = r.get("protected_bytes");
        super::super::content_crypto::open(
            provider,
            content_id,
            &kind,
            expected_scope,
            &nonce,
            &ciphertext,
        )
    }
}
