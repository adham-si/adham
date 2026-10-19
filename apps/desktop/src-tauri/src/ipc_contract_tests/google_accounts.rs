use super::common::*;
use super::*;
use tauri::Manager;
/// (AEAD ciphertext); no event, projection, or pending-op row may hold it.
/// G2: Google account configuration — consent gate, sealed credential,
/// rotation, disconnect. The API key may reach only `provider_credentials`
/// (AEAD ciphertext); no event, projection, or pending-op row may hold it.
#[test]
fn google_account_configure_consent_rotation_and_disconnect() {
    use adham_event_log::read_provider_credential_plaintext;

    let (runtime, ctx) = disposable_context();
    let pool = ctx.pool.clone();
    let content_key = ctx.content_key.clone();
    let installation = ctx.installation_id;
    let app = provider_mock_app(ctx);
    let webview = mock_webview(&app);
    let (ws, proj, sess) = provision_scope(&webview);
    let scope_ctx = context_for(&ws, &proj, &sess);
    let installation_str = installation.0.to_string();
    let ctx_direct = app.state::<ApiContext>().inner().clone();
    use adham_desktop_api::handle_configure_google_account;

    let consent_envelope = |ack: bool| CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: None,
            project_id: None,
            session_id: None,
        },
        payload: ConfigureGoogleAccountPayload {
            account_id: None,
            alias: Some("Google".into()),
            api_key: "AIza-test-key".into(),
            acknowledge_cloud_transfer: ack,
        },
    };

    // consent gate: a configuration without the cloud-transfer consent
    // acknowledgment must save nothing — no account row, no credential. The
    // refusable detail lives at the handler level (IPC envelopes carry only
    // the public code); this call pins the cause.
    let refused = runtime
        .block_on(handle_configure_google_account(
            &ctx_direct,
            consent_envelope(false),
        ))
        .unwrap_err();
    assert!(
        refused.contains("VALIDATION_FAILED"),
        "no consent must be refused: {refused}"
    );
    runtime.block_on(async {
        let google_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM provider_accounts WHERE kind = 'google_gemini'",
        )
        .fetch_one(&pool)
        .await
        .expect("accounts count");
        assert_eq!(google_rows, 0, "refused configure persists nothing");
    });

    // consented configure: account minted cloud_only at the fixed endpoint,
    // credential sealed — plaintext present only inside the vault frame.
    let response = invoke(
        &webview,
        "configure_google_account",
        args_for(
            scope_ctx.clone(),
            json!({
                "accountId": null,
                "alias": "Google",
                "apiKey": "AIza-test-key",
                "acknowledgeCloudTransfer": true
            }),
        ),
    )
    .expect("configure");
    let account_id = response["data"]["accountId"]
        .as_str()
        .expect("id")
        .to_string();
    assert_eq!(response["data"]["kind"], json!("google_gemini"));
    assert_eq!(response["data"]["privacyClass"], json!("cloud_standard"));
    assert_eq!(
        response["data"]["endpointUrl"],
        json!("https://generativelanguage.googleapis.com")
    );

    runtime.block_on(async {
        let key_rows: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM provider_credentials \
             WHERE account_id = ? AND protection = 'aead-xchacha20poly1305-v1'",
        )
        .bind(&account_id)
        .fetch_one(&pool)
        .await
        .expect("credential row");
        assert_eq!(key_rows, 1, "exactly one sealed credential row");

        // no plaintext anywhere in the event domain
        for (table, column) in [
            ("events", "payload_json"),
            ("content_records", "CAST(protected_bytes AS TEXT)"),
        ] {
            let leaks: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {table} WHERE {column} LIKE '%AIza-test-key%'"
            ))
            .fetch_one(&pool)
            .await
            .expect("leak scan");
            assert_eq!(leaks, 0, "plaintext leaked into {table}.{column}");
        }
    });

    // rotation: same account, new key → the single row decrypts to the new key
    let response = invoke(
        &webview,
        "configure_google_account",
        args_for(
            scope_ctx.clone(),
            json!({
                "accountId": account_id,
                "apiKey": "AIza-rotated-key",
                "acknowledgeCloudTransfer": true
            }),
        ),
    )
    .expect("rotate");
    assert_eq!(response["data"]["accountId"], json!(account_id));
    let rotated = runtime
        .block_on(read_provider_credential_plaintext(
            &pool,
            content_key.as_ref(),
            &account_id,
            &installation_str,
        ))
        .expect("open rotated");
    assert_eq!(rotated, "AIza-rotated-key");

    // kind guard: an Ollama account must never receive a Google credential
    let ollama = invoke(
        &webview,
        "update_provider_account",
        args_for(
            scope_ctx.clone(),
            json!({"accountId": null, "alias": "Local", "endpointUrl": "http://127.0.0.1:9"}),
        ),
    )
    .expect("create ollama account");
    let ollama_id = ollama["data"]["accountId"]
        .as_str()
        .expect("id")
        .to_string();
    let kind_envelope = CommandEnvelope {
        protocol_version: 1,
        request_id: uuid::Uuid::now_v7().to_string(),
        context: CommandContext {
            workspace_id: None,
            project_id: None,
            session_id: None,
        },
        payload: ConfigureGoogleAccountPayload {
            account_id: Some(ollama_id.clone()),
            alias: None,
            api_key: "AIza-x".into(),
            acknowledge_cloud_transfer: true,
        },
    };
    let refused_two = runtime
        .block_on(handle_configure_google_account(&ctx_direct, kind_envelope))
        .unwrap_err();
    assert!(
        refused_two.contains("VALIDATION_FAILED"),
        "non-Google account must be refused: {refused_two}"
    );
    assert!(
        refused_two.contains("is not a Google Gemini account"),
        "the refusal names the kind guard: {refused_two}"
    );

    // disconnect removes the account and its credential together
    let response = invoke(
        &webview,
        "disconnect_google_account",
        args_for(scope_ctx.clone(), json!({"accountId": account_id})),
    )
    .expect("disconnect");
    assert_eq!(response["data"]["accountId"], json!(account_id));
    runtime.block_on(async {
        let google_rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM provider_accounts WHERE account_id = ?")
                .bind(&account_id)
                .fetch_one(&pool)
                .await
                .expect("accounts after disconnect");
        let cred_rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM provider_credentials WHERE account_id = ?")
                .bind(&account_id)
                .fetch_one(&pool)
                .await
                .expect("credentials after disconnect");
        assert_eq!(google_rows, 0);
        assert_eq!(cred_rows, 0);
    });
}
