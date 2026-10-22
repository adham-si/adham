mod common;
use common::*;

use adham_core_types::history::{EVENT_TYPE_SESSION_DELETED, SessionDeletedV1};
use adham_core_types::*;
use adham_desktop_api::service::{read_bookmarked_message_ids, set_message_bookmark};
use adham_desktop_api::*;
use adham_event_log::AppendEventRequest;

fn context(ws: &str, proj: &str, session: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: Some(session.to_string()),
    }
}

async fn submit(ctx: &ApiContext, ws: &str, proj: &str, session: &str, text: &str) -> String {
    handle_submit_message(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: context(ws, proj, session),
            payload: SubmitMessagePayload {
                text: text.to_string(),
                attachment_ids: Vec::new(),
            },
        },
    )
    .await
    .expect("submit")
    .data
    .message_id
}

async fn append_deleted(ctx: &ApiContext, ws: &str, proj: &str, session: &str) {
    let stream_id = format!("session:{session}");
    let current: Option<i64> =
        sqlx::query_scalar("SELECT current_sequence FROM streams WHERE stream_id = ?")
            .bind(&stream_id)
            .fetch_optional(&ctx.pool)
            .await
            .unwrap();
    ctx.store
        .append_event(AppendEventRequest {
            stream_id,
            stream_kind: "session".to_string(),
            expected_sequence: current.unwrap_or(0) as u64,
            event_type: EVENT_TYPE_SESSION_DELETED.to_string(),
            event_version: 1,
            scope: EventScope {
                installation_id: ctx.installation_id,
                workspace_id: Some(WorkspaceId::from_string(ws).unwrap()),
                project_id: Some(ProjectId::from_string(proj).unwrap()),
                session_id: Some(SessionId::from_string(session).unwrap()),
            },
            actor: EventActor {
                actor_id: ctx.actor_id,
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&SessionDeletedV1 {}).unwrap(),
            metadata_json: b"{}".to_vec(),
        })
        .await
        .unwrap();
}

#[tokio::test]
async fn toggles_bookmarks_and_get_conversation_returns_them() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Bookmarks")).await;
    let first = submit(&ctx, &ws, &proj, &session, "first").await;
    let second = submit(&ctx, &ws, &proj, &session, "second").await;
    let cmd_ctx = context(&ws, &proj, &session);

    let ids = set_message_bookmark(&ctx, &cmd_ctx, &second, true)
        .await
        .expect("bookmark second");
    assert_eq!(ids, vec![second.clone()]);
    let ids = set_message_bookmark(&ctx, &cmd_ctx, &second, true)
        .await
        .expect("bookmark again");
    assert_eq!(
        ids,
        vec![second.clone()],
        "same desired state is idempotent"
    );
    let ids = set_message_bookmark(&ctx, &cmd_ctx, &first, true)
        .await
        .expect("bookmark first");
    assert_eq!(ids, vec![first.clone(), second.clone()]);
    assert_eq!(
        read_bookmarked_message_ids(&ctx.pool, &session)
            .await
            .unwrap(),
        vec![first.clone(), second.clone()]
    );

    let page = handle_get_conversation(&ctx, cmd_ctx.clone())
        .await
        .expect("conversation");
    assert_eq!(
        page.bookmarked_message_ids,
        vec![first.clone(), second.clone()]
    );

    let ids = set_message_bookmark(&ctx, &cmd_ctx, &second, false)
        .await
        .expect("unbookmark second");
    assert_eq!(ids, vec![first.clone()]);

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn rejects_a_message_from_another_session() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let first_session = create_test_session(&ctx, &ws, &proj, Some("First")).await;
    let second_session = create_test_session(&ctx, &ws, &proj, Some("Second")).await;
    let foreign_message = submit(&ctx, &ws, &proj, &first_session, "foreign").await;

    let error = set_message_bookmark(
        &ctx,
        &context(&ws, &proj, &second_session),
        &foreign_message,
        true,
    )
    .await
    .expect_err("foreign message");
    assert!(
        error.contains("VALIDATION_FAILED:message_not_found"),
        "{error}"
    );
    assert!(
        read_bookmarked_message_ids(&ctx.pool, &second_session)
            .await
            .unwrap()
            .is_empty()
    );

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn rejects_a_deleted_session() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Deleted")).await;
    let message = submit(&ctx, &ws, &proj, &session, "gone").await;
    append_deleted(&ctx, &ws, &proj, &session).await;

    let error = set_message_bookmark(&ctx, &context(&ws, &proj, &session), &message, true)
        .await
        .expect_err("deleted session");
    assert!(error.contains("SESSION_DELETED"), "{error}");
    assert!(
        read_bookmarked_message_ids(&ctx.pool, &session)
            .await
            .unwrap()
            .is_empty()
    );

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}
