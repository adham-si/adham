mod common;
use common::*;

use adham_core_types::history::{EVENT_TYPE_SESSION_DELETED, SessionDeletedV1};
use adham_core_types::*;
use adham_desktop_api::service::{
    list_sessions, rename_session, set_session_archived, set_session_pinned,
};
use adham_desktop_api::*;
use adham_event_log::AppendEventRequest;
use serde::Serialize;

fn context(ws: &str, proj: &str, session: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: Some(session.to_string()),
    }
}

async fn append_history<T: Serialize>(
    ctx: &ApiContext,
    ws: &str,
    proj: &str,
    session_id: &str,
    event_type: &str,
    payload: T,
) {
    let stream_id = format!("session:{session_id}");
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
            event_type: event_type.to_string(),
            event_version: 1,
            scope: EventScope {
                installation_id: ctx.installation_id.clone(),
                workspace_id: Some(WorkspaceId::from_string(ws).unwrap()),
                project_id: Some(ProjectId::from_string(proj).unwrap()),
                session_id: Some(SessionId::from_string(session_id).unwrap()),
            },
            actor: EventActor {
                actor_id: ctx.actor_id.clone(),
                kind: ActorKind::LocalHuman,
            },
            request_id: RequestId::new_v7(),
            correlation_id: CorrelationId::new_v7(),
            causation_id: None,
            payload_json: serde_json::to_vec(&payload).unwrap(),
            metadata_json: b"{}".to_vec(),
        })
        .await
        .unwrap();
}

async fn event_count(ctx: &ApiContext, session_id: &str, event_type: &str) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = ? AND event_type = ?")
        .bind(format!("session:{session_id}"))
        .bind(event_type)
        .fetch_one(&ctx.pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn rename_pin_archive_append_events_and_replay() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Original")).await;
    let cmd_ctx = context(&ws, &proj, &session);

    let rename_request = RequestId::new_v7().to_string();
    let renamed = rename_session(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: rename_request.clone(),
            context: cmd_ctx.clone(),
            payload: RenameSessionPayload {
                title: "  Renamed  ".to_string(),
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(renamed.data.title.as_deref(), Some("Renamed"));
    assert_eq!(event_count(&ctx, &session, "SessionRenamed").await, 1);

    let replay = rename_session(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: rename_request,
            context: cmd_ctx.clone(),
            payload: RenameSessionPayload {
                title: "  Renamed  ".to_string(),
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(replay.correlation_id, renamed.correlation_id);
    assert_eq!(event_count(&ctx, &session, "SessionRenamed").await, 1);

    let pinned = set_session_pinned(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: cmd_ctx.clone(),
            payload: SetSessionPinnedPayload { pinned: true },
        },
    )
    .await
    .unwrap();
    assert!(pinned.data.pinned);

    let archived = set_session_archived(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: cmd_ctx.clone(),
            payload: SetSessionArchivedPayload { archived: true },
        },
    )
    .await
    .unwrap();
    assert!(archived.data.archived);

    let visible = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    assert!(visible.sessions.is_empty());
    let all = list_sessions(
        &ctx,
        &proj,
        Some(&ws),
        &ListSessionsOptions {
            include_archived: true,
            active_session_id: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(all.sessions.len(), 1);
    assert_eq!(all.sessions[0].title.as_deref(), Some("Renamed"));
    assert!(all.sessions[0].pinned);
    assert!(all.sessions[0].archived);

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn rename_rejects_empty_control_and_over_120_scalars() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Original")).await;
    let cmd_ctx = context(&ws, &proj, &session);

    for title in ["", "   ", "\u{0007}", &"x".repeat(121)] {
        let error = rename_session(
            &ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: cmd_ctx.clone(),
                payload: RenameSessionPayload {
                    title: title.to_string(),
                },
            },
        )
        .await
        .expect_err("invalid title");
        assert!(error.contains("VALIDATION_FAILED:title_invalid"), "{error}");
    }
    assert_eq!(event_count(&ctx, &session, "SessionRenamed").await, 0);

    let boundary = rename_session(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: cmd_ctx,
            payload: RenameSessionPayload {
                title: "x".repeat(120),
            },
        },
    )
    .await
    .unwrap();
    assert_eq!(
        boundary.data.title.as_deref(),
        Some("x".repeat(120).as_str())
    );

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn actions_refuse_a_deleted_session_before_replay() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Deleted")).await;
    let cmd_ctx = context(&ws, &proj, &session);
    let request_id = RequestId::new_v7().to_string();

    rename_session(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: request_id.clone(),
            context: cmd_ctx.clone(),
            payload: RenameSessionPayload {
                title: "Before delete".to_string(),
            },
        },
    )
    .await
    .unwrap();
    append_history(
        &ctx,
        &ws,
        &proj,
        &session,
        EVENT_TYPE_SESSION_DELETED,
        SessionDeletedV1 {},
    )
    .await;

    for envelope in [
        CommandEnvelope {
            protocol_version: 1,
            request_id: request_id.clone(),
            context: cmd_ctx.clone(),
            payload: RenameSessionPayload {
                title: "Before delete".to_string(),
            },
        },
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: cmd_ctx.clone(),
            payload: RenameSessionPayload {
                title: "After delete".to_string(),
            },
        },
    ] {
        let error = rename_session(&ctx, envelope)
            .await
            .expect_err("deleted session");
        assert!(error.starts_with("SESSION_DELETED"), "{error}");
    }
    assert_eq!(event_count(&ctx, &session, "SessionRenamed").await, 1);

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}
