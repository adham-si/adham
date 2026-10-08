use adham_core_types::*;
use adham_event_log::{
    create_sqlite_pool, AppendEventRequest, ChecksumCalculator, SqliteEventStore,
};
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_test_{}.db", uuid::Uuid::now_v7()));
    path
}

#[tokio::test]
async fn test_event_store_append_and_concurrency() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");
    let store = SqliteEventStore::new(pool.clone());

    let inst_id = InstallationId::new_v7();
    let ws_id = WorkspaceId::new_v7();
    let req_id = RequestId::new_v7();
    let corr_id = CorrelationId::new_v7();

    let req = AppendEventRequest {
        stream_id: format!("workspace:{}", ws_id),
        stream_kind: "workspace".to_string(),
        expected_sequence: 0,
        event_type: "WorkspaceCreated".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: inst_id,
            workspace_id: Some(ws_id),
            project_id: None,
            session_id: None,
        },
        actor: EventActor {
            actor_id: ActorId::new_v7(),
            kind: ActorKind::LocalHuman,
        },
        request_id: req_id,
        correlation_id: corr_id,
        causation_id: None,
        payload_json: b"{\"name\":\"Test WS\"}".to_vec(),
        metadata_json: b"{}".to_vec(),
    };

    let res = store.append_event(req).await.expect("append event");
    assert_eq!(res.stream_sequence, 1);
    assert_eq!(res.global_position, 1);
    assert!(!res.checksum.is_empty());

    // Concurrency conflict test: appending with wrong expected_sequence
    let conflict_req = AppendEventRequest {
        stream_id: format!("workspace:{}", ws_id),
        stream_kind: "workspace".to_string(),
        expected_sequence: 0, // Should be 1
        event_type: "WorkspaceUpdated".to_string(),
        event_version: 1,
        scope: EventScope {
            installation_id: inst_id,
            workspace_id: Some(ws_id),
            project_id: None,
            session_id: None,
        },
        actor: EventActor {
            actor_id: ActorId::new_v7(),
            kind: ActorKind::LocalHuman,
        },
        request_id: RequestId::new_v7(),
        correlation_id: CorrelationId::new_v7(),
        causation_id: None,
        payload_json: b"{}".to_vec(),
        metadata_json: b"{}".to_vec(),
    };

    let err = store.append_event(conflict_req).await.unwrap_err();
    match err {
        DomainError::ConcurrencyConflict(stream, expected, current) => {
            assert_eq!(stream, format!("workspace:{}", ws_id));
            assert_eq!(expected, 0);
            assert_eq!(current, 1);
        }
        _ => panic!("Expected ConcurrencyConflict error"),
    }

    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn test_sensitive_content_segregation() {
    use adham_event_log::{InMemoryProvider, UnavailableKeyProvider};
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");
    let store = SqliteEventStore::new(pool.clone());
    let provider = InMemoryProvider::generate();

    let inst = InstallationId::new_v7();
    let ws = WorkspaceId::new_v7();
    let scope = EventScope {
        installation_id: inst,
        workspace_id: Some(ws),
        project_id: None,
        session_id: None,
    };

    let content_id = ContentId::new_v7();
    let payload = b"Super sensitive user prompt";

    store
        .put_content(
            &provider,
            &content_id,
            "user_prompt",
            "text/plain",
            &scope,
            payload,
        )
        .await
        .expect("put content");

    // Authenticated round-trip.
    let retrieved = store
        .get_content(&provider, &content_id, &scope)
        .await
        .expect("get content")
        .expect("content should exist");
    assert_eq!(retrieved, payload);

    // Ciphertext at rest differs from plaintext (and is not mere encoding:
    // tamper and wrong-scope below prove authentication).
    let (scheme, at_rest) = store
        .get_content_ciphertext(&content_id)
        .await
        .expect("ciphertext")
        .expect("row");
    assert_eq!(scheme, adham_event_log::PROTECTION_AEAD_V1);
    assert_ne!(at_rest, payload);

    // Tamper rejection: flip a ciphertext byte directly.
    let mut tampered = at_rest.clone();
    tampered[0] ^= 0x01;
    sqlx::query("UPDATE content_records SET protected_bytes = ? WHERE content_id = ?")
        .bind(&tampered)
        .bind(content_id.to_string())
        .execute(&pool)
        .await
        .expect("tamper");
    let err = store
        .get_content(&provider, &content_id, &scope)
        .await
        .expect_err("tamper must fail");
    assert!(matches!(err, DomainError::Integrity(_)), "got: {err}");

    // Restore, then wrong-scope rejection.
    sqlx::query("UPDATE content_records SET protected_bytes = ? WHERE content_id = ?")
        .bind(&at_rest)
        .bind(content_id.to_string())
        .execute(&pool)
        .await
        .expect("restore");
    let wrong_scope = EventScope {
        installation_id: inst,
        workspace_id: Some(WorkspaceId::new_v7()),
        project_id: None,
        session_id: None,
    };
    let err = store
        .get_content(&provider, &content_id, &wrong_scope)
        .await
        .expect_err("wrong scope must fail");
    assert!(matches!(err, DomainError::Integrity(_)), "got: {err}");

    // Unavailable-key behavior: explicit storage error, no fallback.
    let missing = UnavailableKeyProvider;
    let err = store
        .get_content(&missing, &content_id, &scope)
        .await
        .expect_err("unavailable key must fail");
    assert!(matches!(err, DomainError::Storage(_)), "got: {err}");

    let _ = std::fs::remove_file(db_path);
}

#[test]
fn test_blake3_checksum_chaining() {
    let hash1 = ChecksumCalculator::calculate(
        None,
        "stream-1",
        1,
        "evt-1",
        "TypeA",
        1,
        b"payload-1",
        b"{}",
    );
    assert_eq!(hash1.len(), 64);

    let hash2 = ChecksumCalculator::calculate(
        Some(&hash1),
        "stream-1",
        2,
        "evt-2",
        "TypeB",
        1,
        b"payload-2",
        b"{}",
    );
    assert_ne!(hash1, hash2);

    // Tampering test: different payload must produce different hash
    let tampered_hash = ChecksumCalculator::calculate(
        Some(&hash1),
        "stream-1",
        2,
        "evt-2",
        "TypeB",
        1,
        b"payload-tampered",
        b"{}",
    );
    assert_ne!(hash2, tampered_hash);
}
