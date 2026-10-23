mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::service::list_sessions;
use adham_desktop_api::*;

fn context(ws: &str, proj: &str, session: &str) -> CommandContext {
    CommandContext {
        workspace_id: Some(ws.to_string()),
        project_id: Some(proj.to_string()),
        session_id: Some(session.to_string()),
    }
}

fn envelope(
    ws: &str,
    proj: &str,
    session: &str,
    request_id: &str,
    summary: Option<&str>,
) -> CommandEnvelope<SetSessionSummaryPayload> {
    CommandEnvelope {
        protocol_version: 1,
        request_id: request_id.to_string(),
        context: context(ws, proj, session),
        payload: SetSessionSummaryPayload {
            summary: summary.map(str::to_string),
        },
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

async fn summary_content_id(ctx: &ApiContext, session: &str) -> Option<String> {
    let payload: Option<Vec<u8>> = sqlx::query_scalar(
        "SELECT payload_json FROM events WHERE stream_id = ? AND event_type = 'SessionSummaryUpdated' ORDER BY global_position DESC LIMIT 1",
    )
    .bind(format!("session:{session}"))
    .fetch_optional(&ctx.pool)
    .await
    .unwrap();
    payload.map(|bytes| {
        let value: adham_core_types::history::SessionSummaryUpdatedV1 =
            serde_json::from_slice(&bytes).unwrap();
        value.content_id.unwrap().to_string()
    })
}

#[tokio::test]
async fn user_summary_overrides_auto_and_reset_reverts() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Summaries")).await;
    let _ = submit(&ctx, &ws, &proj, &session, "First question").await;

    let before = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    assert_eq!(before.sessions[0].summary_origin.as_deref(), Some("auto"));
    assert_eq!(
        before.sessions[0].summary.as_deref(),
        Some("First question")
    );

    let saved = handle_set_session_summary(
        &ctx,
        envelope(
            &ws,
            &proj,
            &session,
            &RequestId::new_v7().to_string(),
            Some("  Custom summary  "),
        ),
    )
    .await
    .expect("save summary");
    assert_eq!(saved.data.summary_origin.as_deref(), Some("user"));

    let after = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    assert_eq!(after.sessions[0].summary.as_deref(), Some("Custom summary"));
    assert_eq!(after.sessions[0].summary_origin.as_deref(), Some("user"));

    let reset = handle_set_session_summary(
        &ctx,
        envelope(&ws, &proj, &session, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect("reset summary");
    assert_eq!(reset.data.summary_origin.as_deref(), Some("auto"));

    let reverted = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    assert_eq!(
        reverted.sessions[0].summary.as_deref(),
        Some("First question")
    );
    assert_eq!(reverted.sessions[0].summary_origin.as_deref(), Some("auto"));

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn summary_over_500_scalars_is_rejected() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Summaries")).await;
    let stream = format!("session:{session}");
    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = ?")
        .bind(&stream)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let receipts_before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM command_receipts")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();

    let error = handle_set_session_summary(
        &ctx,
        envelope(
            &ws,
            &proj,
            &session,
            &RequestId::new_v7().to_string(),
            Some(&"a".repeat(501)),
        ),
    )
    .await
    .expect_err("too long");
    assert!(
        error.contains("VALIDATION_FAILED:summary_too_long"),
        "{error}"
    );

    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = ?")
        .bind(&stream)
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(after, before, "a rejected summary appends no event");
    let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM command_receipts")
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(
        receipts, receipts_before,
        "a rejected summary records no receipt"
    );

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn replacing_summary_tombstones_the_old_content() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Summaries")).await;
    let _ = submit(&ctx, &ws, &proj, &session, "First question").await;

    handle_set_session_summary(
        &ctx,
        envelope(
            &ws,
            &proj,
            &session,
            &RequestId::new_v7().to_string(),
            Some("first custom"),
        ),
    )
    .await
    .expect("first summary");
    let first_id = summary_content_id(&ctx, &session).await.expect("first id");
    let kind: String =
        sqlx::query_scalar("SELECT content_kind FROM content_records WHERE content_id = ?")
            .bind(&first_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert_eq!(kind, "session_summary");

    handle_set_session_summary(
        &ctx,
        envelope(
            &ws,
            &proj,
            &session,
            &RequestId::new_v7().to_string(),
            Some("second custom"),
        ),
    )
    .await
    .expect("second summary");
    let second_id = summary_content_id(&ctx, &session).await.expect("second id");
    assert_ne!(first_id, second_id);
    let old_present: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM content_records WHERE content_id = ?")
            .bind(&first_id)
            .fetch_optional(&ctx.pool)
            .await
            .unwrap();
    assert!(old_present.is_none(), "replaced content is erased");
    let tombstoned: Option<String> =
        sqlx::query_scalar("SELECT reason_code FROM content_tombstones WHERE content_id = ?")
            .bind(&first_id)
            .fetch_optional(&ctx.pool)
            .await
            .unwrap();
    assert!(tombstoned.is_some(), "replaced content is tombstoned");

    handle_set_session_summary(
        &ctx,
        envelope(&ws, &proj, &session, &RequestId::new_v7().to_string(), None),
    )
    .await
    .expect("clear summary");
    let cleared: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM content_records WHERE content_id = ?")
            .bind(&second_id)
            .fetch_optional(&ctx.pool)
            .await
            .unwrap();
    assert!(cleared.is_none(), "cleared content is erased");
    let cleared_tombstone: Option<i64> =
        sqlx::query_scalar("SELECT 1 FROM content_tombstones WHERE content_id = ?")
            .bind(&second_id)
            .fetch_optional(&ctx.pool)
            .await
            .unwrap();
    assert!(cleared_tombstone.is_some(), "cleared content is tombstoned");

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn unreadable_user_summary_falls_back_to_auto() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Summaries")).await;
    let _ = submit(&ctx, &ws, &proj, &session, "First question").await;
    handle_set_session_summary(
        &ctx,
        envelope(
            &ws,
            &proj,
            &session,
            &RequestId::new_v7().to_string(),
            Some("custom summary"),
        ),
    )
    .await
    .expect("summary");
    let content_id = summary_content_id(&ctx, &session).await.expect("id");
    sqlx::query("DELETE FROM content_records WHERE content_id = ?")
        .bind(&content_id)
        .execute(&ctx.pool)
        .await
        .unwrap();

    let listed = list_sessions(&ctx, &proj, Some(&ws), &ListSessionsOptions::default())
        .await
        .unwrap();
    assert_eq!(
        listed.sessions[0].summary.as_deref(),
        Some("First question")
    );
    assert_eq!(listed.sessions[0].summary_origin.as_deref(), Some("auto"));
    assert!(!listed.sessions[0].summary_unavailable);

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}

#[tokio::test]
async fn summary_receipt_contains_no_summary_text() {
    let db_path = test_db_path();
    let ctx = setup_ctx(&db_path).await;
    let ws = create_test_workspace(&ctx, "WS").await;
    let proj = create_test_project(&ctx, &ws, "Proj").await;
    let session = create_test_session(&ctx, &ws, &proj, Some("Summaries")).await;
    let _ = submit(&ctx, &ws, &proj, &session, "First question").await;
    let canary = "CANARY summary secret text";
    let request_id = RequestId::new_v7().to_string();

    handle_set_session_summary(
        &ctx,
        envelope(&ws, &proj, &session, &request_id, Some(canary)),
    )
    .await
    .expect("summary");

    let receipt: Vec<u8> =
        sqlx::query_scalar("SELECT response_json FROM command_receipts WHERE request_id = ?")
            .bind(&request_id)
            .fetch_one(&ctx.pool)
            .await
            .unwrap();
    assert!(!String::from_utf8_lossy(&receipt).contains(canary));
    let event_payload: Vec<u8> = sqlx::query_scalar(
        "SELECT payload_json FROM events WHERE stream_id = ? AND event_type = 'SessionSummaryUpdated' ORDER BY global_position DESC LIMIT 1",
    )
    .bind(format!("session:{session}"))
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(!String::from_utf8_lossy(&event_payload).contains(canary));
    let protected: Vec<u8> = sqlx::query_scalar(
        "SELECT protected_bytes FROM content_records WHERE content_kind = 'session_summary'",
    )
    .fetch_one(&ctx.pool)
    .await
    .unwrap();
    assert!(
        !protected
            .windows(canary.len())
            .any(|w| w == canary.as_bytes())
    );

    let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = ?")
        .bind(format!("session:{session}"))
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    let replay = handle_set_session_summary(
        &ctx,
        envelope(&ws, &proj, &session, &request_id, Some(canary)),
    )
    .await
    .expect("replay");
    assert_eq!(replay.data.session_id, session);
    let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM events WHERE stream_id = ?")
        .bind(format!("session:{session}"))
        .fetch_one(&ctx.pool)
        .await
        .unwrap();
    assert_eq!(after, before, "replay appends no event");

    drop(ctx);
    let _ = std::fs::remove_file(db_path);
}
