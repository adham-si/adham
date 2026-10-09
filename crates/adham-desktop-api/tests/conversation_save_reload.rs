mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;

// P0-AUDIT-03 native evidence: the production frontend renders only
// backend-issued identities. This contract test pins that submit_message
// mints the IDs, echoes the session scope, persists across restart, and
// rejects empty text (the same guard the UI applies before sending).
// Synthetic disposable database; no user content.
#[tokio::test]
async fn test_backend_issued_ids_survive_restart_reload() {
    let db_path = test_db_path();
    let (ws_id, proj_id, sess_id, first_id, second_id): (String, String, String, String, String);
    {
        let ctx = setup_ctx(&db_path).await;
        ws_id = create_test_workspace(&ctx, "WS").await;
        proj_id = create_test_project(&ctx, &ws_id, "Proj").await;
        sess_id = create_test_session(&ctx, &ws_id, &proj_id, None).await;

        let submit_envelope = |text: String| CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: Some(sess_id.clone()),
            },
            payload: SubmitMessagePayload { text },
        };

        let first = handle_submit_message(&ctx, submit_envelope("first truth".to_string()))
            .await
            .expect("submit first");
        let second = handle_submit_message(&ctx, submit_envelope("second truth".to_string()))
            .await
            .expect("submit second");
        assert!(!first.data.message_id.is_empty());
        assert!(!second.data.message_id.is_empty());
        assert_ne!(first.data.message_id, second.data.message_id);
        assert_eq!(first.data.session_id, sess_id);
        assert_eq!(second.data.session_id, sess_id);
        first_id = first.data.message_id;
        second_id = second.data.message_id;

        let empty = handle_submit_message(
            &ctx,
            CommandEnvelope {
                protocol_version: 1,
                request_id: RequestId::new_v7().to_string(),
                context: CommandContext {
                    workspace_id: Some(ws_id.clone()),
                    project_id: Some(proj_id.clone()),
                    session_id: Some(sess_id.clone()),
                },
                payload: SubmitMessagePayload {
                    text: "   ".to_string(),
                },
            },
        )
        .await;
        assert!(empty.is_err(), "empty text must be rejected");

        std::fs::write(
            db_path.with_extension("key"),
            ctx.content_key
                .content_key()
                .expect("export key")
                .iter()
                .map(|b| format!("{:02x}", b))
                .collect::<String>(),
        )
        .expect("persist test key");
    }

    let key_hex = std::fs::read_to_string(db_path.with_extension("key")).expect("read key");
    let mut key = [0u8; 32];
    for (i, chunk) in key_hex.as_bytes().chunks(2).enumerate() {
        let hi = (chunk[0] as char).to_digit(16).unwrap() as u8;
        let lo = (chunk[1] as char).to_digit(16).unwrap() as u8;
        key[i] = (hi << 4) | lo;
    }
    let provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
        std::sync::Arc::new(adham_event_log::InMemoryProvider::from_key(key));
    let restarted = setup_ctx_with_key(&db_path, provider).await;
    let conv = handle_get_conversation(
        &restarted,
        CommandContext {
            workspace_id: None,
            project_id: None,
            session_id: None,
        },
    )
    .await;
    // Scoped read requires the session scope; unscoped must not leak.
    assert!(conv.is_err());
    let conv = handle_get_conversation(
        &restarted,
        CommandContext {
            workspace_id: Some(ws_id),
            project_id: Some(proj_id),
            session_id: Some(sess_id),
        },
    )
    .await
    .expect("reload after restart");
    assert_eq!(conv.items.len(), 2);
    assert_eq!(conv.items[0].message_id, first_id);
    assert_eq!(conv.items[1].message_id, second_id);
    assert_eq!(conv.items[0].text, "first truth");
}
