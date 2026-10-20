// ID newtypes are `Copy`; `.clone()` follows codebase style.
#![allow(clippy::clone_on_copy)]
use adham_core_types::*;
use adham_event_log::{AppendEventRequest, SqliteEventStore, create_sqlite_pool};
use adham_projections::{ConversationMessageView, ConversationProjection};
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
        None,
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
        None,
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

// ===== A4: assistant completion persistence + replay =====
struct Harness {
    pool: sqlx::Pool<sqlx::Sqlite>,
    store: SqliteEventStore,
    provider: adham_event_log::InMemoryProvider,
    inst_id: InstallationId,
    sess_id: SessionId,
    scope: EventScope,
    stream_id: String,
    db_path: std::path::PathBuf,
    seq: u64,
}

impl Harness {
    async fn new() -> Self {
        let db_path = test_db_path();
        let pool = create_sqlite_pool(&db_path)
            .await
            .expect("create test pool");
        let store = SqliteEventStore::new(pool.clone());
        let inst_id = InstallationId::new_v7();
        let ws_id = WorkspaceId::new_v7();
        let proj_id = ProjectId::new_v7();
        let sess_id = SessionId::new_v7();
        let scope = EventScope {
            installation_id: inst_id,
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        };
        let stream_id = format!("session:{}", sess_id);
        let provider = adham_event_log::InMemoryProvider::generate();
        Self {
            pool,
            store,
            provider,
            inst_id,
            sess_id,
            scope,
            stream_id,
            db_path,
            seq: 0,
        }
    }

    async fn append(&mut self, event_type: &str, payload: &impl serde::Serialize) -> i64 {
        self.append_versioned(event_type, 1, payload).await
    }

    async fn append_versioned(
        &mut self,
        event_type: &str,
        event_version: u16,
        payload: &impl serde::Serialize,
    ) -> i64 {
        let req = AppendEventRequest {
            stream_id: self.stream_id.clone(),
            stream_kind: "session".to_string(),
            expected_sequence: self.seq,
            event_type: event_type.to_string(),
            event_version,
            scope: self.scope.clone(),
            actor: EventActor {
                actor_id: ActorId::new_v7(),
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(payload).unwrap(),
            metadata_json: b"{}".to_vec(),
        };
        self.seq += 1;
        self.store
            .append_event(req)
            .await
            .expect("append event")
            .global_position
    }

    async fn put_user(&mut self, text: &str) {
        let content_id = ContentId::new_v7();
        self.store
            .put_content(
                &self.provider,
                &content_id,
                "user_text",
                "text/plain",
                &self.scope,
                text.as_bytes(),
            )
            .await
            .expect("put user content");
        self.append(
            "MessageSubmitted",
            &MessageSubmittedV1 {
                message_id: MessageId::new_v7(),
                content_id,
                content_kind: "user_text".to_string(),
                size_bytes: text.len() as u64,
            },
        )
        .await;
    }

    /// Append an assistant terminal with protected content + replay data.
    async fn put_assistant(
        &mut self,
        op_id: OperationId,
        message_id: MessageId,
        text: &str,
        completion: MessageCompletionV1,
        usage: Option<MessageUsageV1>,
    ) {
        let content_id = ContentId::new_v7();
        self.store
            .put_content(
                &self.provider,
                &content_id,
                "assistant_text",
                "text/plain",
                &self.scope,
                text.as_bytes(),
            )
            .await
            .expect("put assistant content");
        self.append(
            EVENT_TYPE_ASSISTANT_MESSAGE_COMPLETED,
            &MessageCompletedV1 {
                op_id,
                message_id,
                content_id,
                content_kind: "assistant_text".to_string(),
                size_bytes: text.len() as u64,
                completion,
                usage,
            },
        )
        .await;
    }

    async fn messages(&self) -> Vec<ConversationMessageView> {
        ConversationProjection::get_session_messages(
            &self.pool,
            &self.provider,
            &self.inst_id,
            &self.sess_id,
        )
        .await
        .expect("get messages")
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.db_path);
    }
}

#[tokio::test]
async fn test_assistant_completed_replays_in_order_with_roles_and_usage() {
    let mut h = Harness::new().await;
    h.put_user("Question").await;

    let op_id = OperationId::new_v7();
    h.put_assistant(
        op_id,
        MessageId::new_v7(),
        "Answer",
        MessageCompletionV1::Completed { truncated: false },
        Some(MessageUsageV1 {
            prompt_tokens: Some(10),
            completion_tokens: Some(5),
            total_tokens: Some(15),
        }),
    )
    .await;

    let replayed = ConversationProjection::rebuild(&h.pool)
        .await
        .expect("rebuild");
    assert_eq!(replayed, 2);

    let view = h.messages().await;
    assert_eq!(view.len(), 2);
    assert_eq!(view[0].role, "user");
    assert_eq!(view[0].content, "Question");
    assert_eq!(view[0].completion, None);
    assert_eq!(view[1].role, "assistant");
    assert_eq!(view[1].content, "Answer");
    assert_eq!(
        view[1].completion,
        Some(MessageCompletionV1::Completed { truncated: false })
    );
    assert_eq!(view[1].usage.as_ref().unwrap().total_tokens, Some(15));
    assert_eq!(view[1].op_id, Some(op_id));
}

#[tokio::test]
async fn test_message_reference_survives_rebuild_and_read_back() {
    let mut h = Harness::new().await;

    // Original message (v2, no reference), then a reply anchored to it.
    let original_id = MessageId::new_v7();
    let original_content = ContentId::new_v7();
    h.store
        .put_content(
            &h.provider,
            &original_content,
            "user_text",
            "text/plain",
            &h.scope,
            b"Original",
        )
        .await
        .expect("put original");
    h.append_versioned(
        "MessageSubmitted",
        2,
        &MessageSubmittedV2 {
            message_id: original_id,
            content_id: original_content,
            content_kind: "user_text".to_string(),
            size_bytes: 8,
            reference: None,
        },
    )
    .await;

    let reply_content = ContentId::new_v7();
    h.store
        .put_content(
            &h.provider,
            &reply_content,
            "user_text",
            "text/plain",
            &h.scope,
            b"Reply",
        )
        .await
        .expect("put reply");
    h.append_versioned(
        "MessageSubmitted",
        2,
        &MessageSubmittedV2 {
            message_id: MessageId::new_v7(),
            content_id: reply_content,
            content_kind: "user_text".to_string(),
            size_bytes: 5,
            reference: Some(MessageReferenceV1 {
                refers_to_message_id: original_id,
                relation: "replied".to_string(),
            }),
        },
    )
    .await;

    let replayed = ConversationProjection::rebuild(&h.pool)
        .await
        .expect("rebuild");
    assert_eq!(replayed, 2);

    let view = h.messages().await;
    assert_eq!(view.len(), 2);
    assert_eq!(view[0].content, "Original");
    assert_eq!(view[0].refers_to_message_id, None);
    assert_eq!(view[0].refers_to_relation, None);
    assert_eq!(view[1].content, "Reply");
    assert_eq!(
        view[1].refers_to_message_id.as_deref(),
        Some(original_id.to_string().as_str())
    );
    assert_eq!(view[1].refers_to_relation.as_deref(), Some("replied"));
}

#[tokio::test]
async fn test_unknown_message_version_stops_rebuild() {
    let mut h = Harness::new().await;

    let content_id = ContentId::new_v7();
    h.store
        .put_content(
            &h.provider,
            &content_id,
            "user_text",
            "text/plain",
            &h.scope,
            b"Future",
        )
        .await
        .expect("put content");
    h.append_versioned(
        "MessageSubmitted",
        3,
        &MessageSubmittedV2 {
            message_id: MessageId::new_v7(),
            content_id,
            content_kind: "user_text".to_string(),
            size_bytes: 6,
            reference: None,
        },
    )
    .await;

    let err = ConversationProjection::rebuild(&h.pool)
        .await
        .expect_err("an unknown version must stop the rebuild, never guess");
    assert!(
        format!("{err:?}").contains("UNSUPPORTED_EVENT_VERSION"),
        "{err:?}"
    );
}

#[path = "projection_tests/terminal.rs"]
mod terminal;
