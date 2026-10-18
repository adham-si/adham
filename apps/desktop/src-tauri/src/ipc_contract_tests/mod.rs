//! Real-IPC contract tests.
//!
//! These replay the exact payload shapes the typed frontend client
//! (`apps/desktop/src/shared/api/adham-client.ts`) sends — pinned in
//! `apps/desktop/fixtures/ipc-basic-send.json` and asserted TS-side in
//! `adham-client.test.ts` — through the real `tauri::generate_handler!`
//! dispatch and the real command/service/store path on a disposable
//! temp-file database with an in-memory content key.
//!
//! Boundaries: this covers command names, argument key naming (`request` /
//! `context`), camelCase envelope serde, and response shapes. It does NOT
//! cover the webview postMessage transport (Tauri's own JS→Rust layer), and
//! it does NOT cover the durable pending-send recovery chain
//! (`record_pending_operation` → `clear_pending_operation`), which has its
//! own backend coverage in `crates/adham-desktop-api/tests`.
//!
//! Platform: non-Windows only. Enabling tauri's `test` feature on Windows
//! makes the lib test binary fail at load (STATUS_ENTRYPOINT_NOT_FOUND,
//! tauri-apps/tauri#11028); the TS-side fixture assertions still run on
//! every platform.

use super::*;
use serde_json::{json, Value};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{get_ipc_response, mock_builder, MockRuntime, INVOKE_KEY};

mod common;
mod dispatch_adapters;
mod google_accounts;
mod provider_commands;
mod streaming_contract;
mod streaming_recovery;

/// Disposable context: temp-dir SQLite database, in-memory content key,
/// never the OS credential store. The runtime is returned so pool tasks
/// stay alive for the test duration.
pub(crate) fn disposable_context() -> (tokio::runtime::Runtime, ApiContext) {
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let runtime = tokio::runtime::Runtime::new().expect("tokio runtime");
    let db_path = std::env::temp_dir().join(format!(
        "adham_ipc_contract_{}_{}_{}.db",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::SeqCst),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos()
    ));
    let ctx = runtime.block_on(async {
        let pool = adham_event_log::create_sqlite_pool(&db_path)
            .await
            .expect("create sqlite pool");
        let provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
            std::sync::Arc::new(adham_event_log::InMemoryProvider::generate());
        ApiContext::load_or_create_with_key(pool, provider)
            .await
            .expect("load installation identity")
    });
    (runtime, ctx)
}

/// The webview origin Tauri treats as local on this platform
/// (`Webview::is_local_url` / `tauri_protocol_url`). Any other origin is
/// treated as remote and ACL-rejected before reaching app commands.
#[cfg(any(windows, target_os = "android"))]
const LOCAL_INVOKE_URL: &str = "http://tauri.localhost";
#[cfg(not(any(windows, target_os = "android")))]
const LOCAL_INVOKE_URL: &str = "tauri://localhost";

pub(crate) fn invoke(
    webview: &tauri::WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<Value, Value> {
    let body = get_ipc_response(
        webview,
        tauri::webview::InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: LOCAL_INVOKE_URL.parse().expect("invoke url"),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )?;
    Ok(body.deserialize::<Value>().expect("response is json"))
}

/// Async-harness proof: one async command through the mock IPC bridge.
/// If this hangs or fails, the harness cannot drive sqlx async commands and
/// the contract tests below must not be trusted.
#[test]
fn async_command_harness_probe() {
    let (_runtime, ctx) = disposable_context();
    let app = mock_builder()
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![get_bootstrap_state])
        // The app's real generated context (shared single expansion in
        // lib.rs): real ACL/capability resolution, matching `mock_builder`'s
        // documented pattern for app crates.
        .build(app_context())
        .expect("build mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");

    let response = invoke(&webview, "get_bootstrap_state", json!({})).expect("command ok");
    assert_eq!(response["isInitialized"], json!(false));
    assert_eq!(response["activeWorkspaceId"], json!(null));
}

/// Fixture replay: provisioning → session creation → submit → history
/// read-back, using the exact envelope/payload shapes the typed client sends
/// (asserted TS-side against the same fixture), through the real
/// `tauri::generate_handler!` dispatch, real context/ACL, and real
/// command/service/store path.
///
/// The fixture's scope ids are the client's mocked responses; the server
/// generates its own, so later contexts rebind them. The fixture pins the
/// wire shape (command names, `request`/`context` keys, camelCase fields,
/// payload field names); the server pins the returned values.
#[test]
fn basic_send_chain_matches_client_fixture() {
    let fixture: Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../fixtures/ipc-basic-send.json"
        ))
        .expect("fixture file"),
    )
    .expect("fixture json");
    let calls = fixture["calls"].as_array().expect("calls array");
    assert_eq!(calls.len(), 5, "fixture call count");

    let (_runtime, ctx) = disposable_context();
    let app = mock_builder()
        .manage(ctx)
        .invoke_handler(tauri::generate_handler![
            create_workspace,
            create_project,
            create_session,
            submit_message,
            get_conversation
        ])
        .build(app_context())
        .expect("build mock app");
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .expect("build mock webview");

    // 1. create_workspace — fixture args verbatim (fresh scope, null context).
    let response =
        invoke(&webview, "create_workspace", calls[0]["args"].clone()).expect("create_workspace");
    assert_eq!(
        response["requestId"], calls[0]["args"]["request"]["requestId"],
        "request id round-trip"
    );
    assert_eq!(
        response["data"]["name"],
        calls[0]["args"]["request"]["payload"]["name"]
    );
    assert_eq!(
        response["data"]["kind"],
        calls[0]["args"]["request"]["payload"]["kind"]
    );
    assert_eq!(
        response["data"]["preferredLanguage"],
        calls[0]["args"]["request"]["payload"]["preferredLanguage"]
    );
    let workspace_id = response["data"]["workspaceId"]
        .as_str()
        .expect("workspaceId string")
        .to_string();

    // 2. create_project — rebind the server workspace id into the context.
    let mut args = calls[1]["args"].clone();
    args["request"]["context"]["workspaceId"] = json!(&workspace_id);
    let response = invoke(&webview, "create_project", args).expect("create_project");
    assert_eq!(
        response["data"]["name"],
        calls[1]["args"]["request"]["payload"]["name"]
    );
    assert_eq!(
        response["data"]["storageKind"],
        calls[1]["args"]["request"]["payload"]["storageKind"]
    );
    assert_eq!(response["data"]["workspaceId"], json!(&workspace_id));
    let project_id = response["data"]["projectId"]
        .as_str()
        .expect("projectId string")
        .to_string();

    // 3. create_session.
    let mut args = calls[2]["args"].clone();
    args["request"]["context"]["workspaceId"] = json!(&workspace_id);
    args["request"]["context"]["projectId"] = json!(&project_id);
    let response = invoke(&webview, "create_session", args).expect("create_session");
    assert_eq!(
        response["requestId"],
        calls[2]["args"]["request"]["requestId"]
    );
    assert_eq!(response["data"]["projectId"], json!(&project_id));
    assert_eq!(response["data"]["title"], json!(null));
    let session_id = response["data"]["sessionId"]
        .as_str()
        .expect("sessionId string")
        .to_string();

    // 4. submit_message — basic send: one command, one transaction.
    let text = calls[3]["args"]["request"]["payload"]["text"].clone();
    let mut args = calls[3]["args"].clone();
    args["request"]["context"]["workspaceId"] = json!(&workspace_id);
    args["request"]["context"]["projectId"] = json!(&project_id);
    args["request"]["context"]["sessionId"] = json!(&session_id);
    let response = invoke(&webview, "submit_message", args).expect("submit_message");
    assert_eq!(
        response["requestId"],
        calls[3]["args"]["request"]["requestId"]
    );
    assert_eq!(response["data"]["sessionId"], json!(&session_id));
    assert_eq!(response["data"]["text"], text);

    // 5. get_conversation — read-back proves the stored, encrypted content
    // decrypts back to exactly what the client sent.
    let mut args = calls[4]["args"].clone();
    args["context"]["workspaceId"] = json!(&workspace_id);
    args["context"]["projectId"] = json!(&project_id);
    args["context"]["sessionId"] = json!(&session_id);
    let response = invoke(&webview, "get_conversation", args).expect("get_conversation");
    // Unlike the envelope commands, `get_conversation` returns the page
    // directly (mirrors the client's `ConversationPageSchema.parse(raw)`).
    let items = response["items"].as_array().expect("items array");
    assert_eq!(items.len(), 1, "one message in history");
    assert_eq!(items[0]["role"], "user");
    assert_eq!(items[0]["text"], text);
    assert_eq!(response["nextCursor"], json!(null));
}
