// ID newtypes are `Copy`; `.clone()` follows codebase style.
#![allow(clippy::clone_on_copy)]
use adham_core_types::*;
use adham_event_log::{create_sqlite_pool, AppendEventRequest, SqliteEventStore};
use adham_projections::ConversationProjection;
use std::path::PathBuf;

fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_proj_test_{}.db", uuid::Uuid::now_v7()));
    path
}

#[tokio::test]
async fn test_conversation_projection_and_deterministic_rebuild() {
    let db_path = test_db_path();
    let pool = create_sqlite_pool(&db_path)
        .await
        .expect("create test pool");
    let store = SqliteEventStore::new(pool.clone());

    let inst_id = InstallationId::new_v7();
    let ws_id = WorkspaceId::new_v7();
    let proj_id = ProjectId::new_v7();
    let sess_id = SessionId::new_v7();
    let provider = adham_event_log::InMemoryProvider::generate();
    let scope = EventScope {
        installation_id: inst_id.clone(),
        workspace_id: Some(ws_id.clone()),
        project_id: Some(proj_id.clone()),
        session_id: Some(sess_id.clone()),
    };

    // 1. Submit message 1
    let msg1_id = MessageId::new_v7();
    let content1_id = ContentId::new_v7();
    let msg1_text = b"Hello, Adham system!";
    store
        .put_content(
            &provider,
            &content1_id,
            "user_text",
            "text/plain",
            &scope,
            msg1_text,
        )
        .await
        .expect("put content 1");

    let payload1 = MessageSubmittedV1 {
        message_id: msg1_id.clone(),
        content_id: content1_id.clone(),
        content_kind: "user_text".to_string(),
        size_bytes: msg1_text.len() as u64,
    };

    let stream_id = format!("session:{}", sess_id);
    let evt1 = store
        .append_event(AppendEventRequest {
            stream_id: stream_id.clone(),
            stream_kind: "session".to_string(),
            expected_sequence: 0,
            event_type: "MessageSubmitted".to_string(),
            event_version: 1,
            scope: EventScope {
                installation_id: inst_id.clone(),
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            actor: EventActor {
                actor_id: ActorId::new_v7(),
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&payload1).unwrap(),
            metadata_json: b"{}".to_vec(),
        })
        .await
        .expect("append event 1");

    ConversationProjection::insert_message(
        &pool,
        &msg1_id.to_string(),
        &ws_id.to_string(),
        &proj_id.to_string(),
        &sess_id.to_string(),
        "user",
        &content1_id.to_string(),
        &evt1.event_id.to_string(),
        evt1.global_position,
        1000,
    )
    .await
    .expect("insert message 1 projection");

    let cp1 = ConversationProjection::get_checkpoint(&pool)
        .await
        .expect("get checkpoint 1");
    assert_eq!(cp1, Some(evt1.global_position));

    // 2. Submit message 2
    let msg2_id = MessageId::new_v7();
    let content2_id = ContentId::new_v7();
    let msg2_text = b"This is a second prompt.";
    store
        .put_content(
            &provider,
            &content2_id,
            "user_text",
            "text/plain",
            &scope,
            msg2_text,
        )
        .await
        .expect("put content 2");

    let payload2 = MessageSubmittedV1 {
        message_id: msg2_id.clone(),
        content_id: content2_id.clone(),
        content_kind: "user_text".to_string(),
        size_bytes: msg2_text.len() as u64,
    };

    let evt2 = store
        .append_event(AppendEventRequest {
            stream_id: stream_id.clone(),
            stream_kind: "session".to_string(),
            expected_sequence: 1,
            event_type: "MessageSubmitted".to_string(),
            event_version: 1,
            scope: EventScope {
                installation_id: inst_id.clone(),
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            actor: EventActor {
                actor_id: ActorId::new_v7(),
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&payload2).unwrap(),
            metadata_json: b"{}".to_vec(),
        })
        .await
        .expect("append event 2");

    ConversationProjection::insert_message(
        &pool,
        &msg2_id.to_string(),
        &ws_id.to_string(),
        &proj_id.to_string(),
        &sess_id.to_string(),
        "user",
        &content2_id.to_string(),
        &evt2.event_id.to_string(),
        evt2.global_position,
        2000,
    )
    .await
    .expect("insert message 2 projection");

    let cp2 = ConversationProjection::get_checkpoint(&pool)
        .await
        .expect("get checkpoint 2");
    assert_eq!(cp2, Some(evt2.global_position));

    // 3. Query projection
    let messages =
        ConversationProjection::get_session_messages(&pool, &provider, &inst_id, &sess_id)
            .await
            .expect("get messages");
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0].content, "Hello, Adham system!");
    assert_eq!(messages[1].content, "This is a second prompt.");

    // 4. Rebuild projection and verify
    let replayed = ConversationProjection::rebuild(&pool)
        .await
        .expect("rebuild projection");
    assert_eq!(replayed, 2);

    let cp_rebuilt = ConversationProjection::get_checkpoint(&pool)
        .await
        .expect("get checkpoint after rebuild");
    assert_eq!(cp_rebuilt, Some(evt2.global_position));

    let messages_after_rebuild =
        ConversationProjection::get_session_messages(&pool, &provider, &inst_id, &sess_id)
            .await
            .expect("get messages after rebuild");
    assert_eq!(messages_after_rebuild.len(), 2);
    assert_eq!(messages_after_rebuild[0].content, "Hello, Adham system!");
    assert_eq!(
        messages_after_rebuild[1].content,
        "This is a second prompt."
    );

    let _ = std::fs::remove_file(db_path);
}
