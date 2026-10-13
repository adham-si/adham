mod common;
use common::*;

use adham_core_types::*;
use adham_desktop_api::*;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;

const CANARY_KEY_BYTES: [u8; 32] = *b"canary_secret_key_32bytes_fixed!";

#[tokio::test]
async fn test_desktop_multi_process_quit_relaunch_recovery() {
    let stage = std::env::var("ADHAM_MULTI_PROCESS_STAGE").ok();

    match stage.as_deref() {
        Some("stage1_record_and_quit") => {
            run_stage1().await;
        }
        Some("stage2_relaunch_and_resend") => {
            run_stage2().await;
        }
        _ => {
            run_parent_orchestrator().await;
        }
    }
}

async fn run_stage1() {
    let db_path = PathBuf::from(std::env::var("ADHAM_CANARY_DB").expect("ADHAM_CANARY_DB"));
    let op_id = std::env::var("ADHAM_CANARY_OP_ID").expect("OP_ID");
    let create_req_id = std::env::var("ADHAM_CANARY_CREATE_REQ_ID").expect("CREATE_REQ_ID");
    let msg_req_id = std::env::var("ADHAM_CANARY_MSG_REQ_ID").expect("MSG_REQ_ID");
    let text = std::env::var("ADHAM_CANARY_TEXT").expect("TEXT");
    let title = std::env::var("ADHAM_CANARY_TITLE").expect("TITLE");

    let provider: Arc<dyn adham_event_log::ContentKeyProvider> = Arc::new(
        adham_event_log::InMemoryProvider::from_key(CANARY_KEY_BYTES),
    );

    let ctx = setup_ctx_with_key(&db_path, provider).await;
    let ws = create_test_workspace(&ctx, "WS-Canary-Quit").await;
    let proj = create_test_project(&ctx, &ws, "Proj-Canary-Quit").await;

    // Record pending first_send operation to SQLite
    handle_record_pending_operation(
        &ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws.clone()),
                project_id: Some(proj.clone()),
                session_id: None,
            },
            payload: RecordPendingOperationPayload {
                operation_id: op_id,
                kind: "first_send".to_string(),
                message_request_id: msg_req_id,
                create_request_id: Some(create_req_id),
                text,
                title: Some(title),
            },
        },
    )
    .await
    .expect("record pending op in stage 1");

    // Pass the created ws and proj IDs to stage 2 via a temporary file
    let ws_proj_file = db_path.with_extension("scope.txt");
    std::fs::write(&ws_proj_file, format!("{}:{}", ws, proj)).expect("write scope file");

    println!("STAGE 1 SUCCESS: RECORD COMMITTED TO DISK");
    // Hard exit to terminate Process 1 (simulating quit before submit dispatch)
    std::process::exit(0);
}

async fn run_stage2() {
    let db_path = PathBuf::from(std::env::var("ADHAM_CANARY_DB").expect("ADHAM_CANARY_DB"));
    let op_id = std::env::var("ADHAM_CANARY_OP_ID").expect("OP_ID");
    let create_req_id = std::env::var("ADHAM_CANARY_CREATE_REQ_ID").expect("CREATE_REQ_ID");
    let msg_req_id = std::env::var("ADHAM_CANARY_MSG_REQ_ID").expect("MSG_REQ_ID");
    let text = std::env::var("ADHAM_CANARY_TEXT").expect("TEXT");
    let title = std::env::var("ADHAM_CANARY_TITLE").expect("TITLE");

    let ws_proj_file = db_path.with_extension("scope.txt");
    let scope_str = std::fs::read_to_string(&ws_proj_file).expect("read scope file");
    let mut parts = scope_str.split(':');
    let ws_id = parts.next().unwrap().to_string();
    let proj_id = parts.next().unwrap().to_string();

    let provider: Arc<dyn adham_event_log::ContentKeyProvider> = Arc::new(
        adham_event_log::InMemoryProvider::from_key(CANARY_KEY_BYTES),
    );

    // Brand-new process initializes fresh pool and ApiContext from disk
    let relaunch_ctx = setup_ctx_with_key(&db_path, provider).await;

    // 1. Startup discovery
    let list = handle_list_pending_operations(&relaunch_ctx)
        .await
        .expect("list pending ops on relaunch");

    assert_eq!(list.operations.len(), 1, "must find unresolved operation");
    let op = &list.operations[0];
    assert_eq!(op.operation_id, op_id);
    assert_eq!(op.workspace_id, ws_id);
    assert_eq!(op.project_id, proj_id);
    assert_eq!(
        op.create_request_id.as_deref(),
        Some(create_req_id.as_str())
    );
    assert_eq!(op.message_request_id, msg_req_id);
    assert_eq!(op.text, text);
    assert_eq!(op.title.as_deref(), Some(title.as_str()));

    let scope_ctx = CommandContext {
        workspace_id: Some(ws_id.clone()),
        project_id: Some(proj_id.clone()),
        session_id: None,
    };

    // 2. Replay creation with original create_request_id
    let create_res = handle_create_session(
        &relaunch_ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: create_req_id.clone(),
            context: scope_ctx.clone(),
            payload: CreateSessionPayload {
                title: Some(title.clone()),
            },
        },
    )
    .await
    .expect("replay create session on resend");

    let recovered_session_id = create_res.data.session_id;
    let session_ctx = CommandContext {
        session_id: Some(recovered_session_id.clone()),
        ..scope_ctx.clone()
    };

    // 3. Replay message submission with original message_request_id
    let submit_res = handle_submit_message(
        &relaunch_ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: msg_req_id.clone(),
            context: session_ctx.clone(),
            payload: SubmitMessagePayload { text: text.clone() },
        },
    )
    .await
    .expect("replay submit message on resend");

    assert_eq!(submit_res.data.session_id, recovered_session_id);

    // 4. Clear pending operation
    handle_clear_pending_operation(
        &relaunch_ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: session_ctx.clone(),
            payload: ClearPendingOperationPayload {
                operation_id: op_id,
                expected_message_request_id: msg_req_id,
                reason: "resolved".to_string(),
            },
        },
    )
    .await
    .expect("clear resolved pending operation");

    // 5. Verification of ZERO duplicates:
    // Replay creation again with create_request_id -> idempotent receipt check
    let dup_create = handle_create_session(
        &relaunch_ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: create_req_id,
            context: scope_ctx,
            payload: CreateSessionPayload { title: Some(title) },
        },
    )
    .await
    .expect("idempotent create session call");
    assert_eq!(dup_create.data.session_id, recovered_session_id);

    // Check conversation history has exactly 1 message
    let conv = handle_get_conversation(
        &relaunch_ctx,
        CommandContext {
            workspace_id: Some(ws_id.clone()),
            project_id: Some(proj_id.clone()),
            session_id: Some(recovered_session_id),
        },
    )
    .await
    .expect("get conversation");

    assert_eq!(
        conv.items.len(),
        1,
        "exactly one message in history: zero duplicate messages"
    );
    assert_eq!(conv.items[0].text, text);

    // Check pending operations is empty
    let empty_list = handle_list_pending_operations(&relaunch_ctx)
        .await
        .expect("list pending ops");
    assert!(
        empty_list.operations.is_empty(),
        "pending ops list must be empty"
    );

    println!("STAGE 2 SUCCESS: RECOVERED AND RESENT ZERO DUPLICATES");
    std::process::exit(0);
}

async fn run_parent_orchestrator() {
    let temp_dir = std::env::temp_dir();
    let canary_id = uuid::Uuid::now_v7().to_string();
    let db_path = temp_dir.join(format!("adham_canary_quit_relaunch_{}.db", canary_id));
    let ws_proj_file = db_path.with_extension("scope.txt");

    let op_id = uuid::Uuid::now_v7().to_string();
    let create_req_id = uuid::Uuid::now_v7().to_string();
    let msg_req_id = uuid::Uuid::now_v7().to_string();
    let text = format!("Canary prompt for multi-process recovery {}", canary_id);
    let title = format!("Canary Title {}", canary_id);

    let exe = std::env::current_exe().expect("current test binary path");

    // Process 1: Record and quit
    let status1 = Command::new(&exe)
        .arg("--exact")
        .arg("test_desktop_multi_process_quit_relaunch_recovery")
        .arg("--nocapture")
        .env("ADHAM_MULTI_PROCESS_STAGE", "stage1_record_and_quit")
        .env("ADHAM_CANARY_DB", &db_path)
        .env("ADHAM_CANARY_OP_ID", &op_id)
        .env("ADHAM_CANARY_CREATE_REQ_ID", &create_req_id)
        .env("ADHAM_CANARY_MSG_REQ_ID", &msg_req_id)
        .env("ADHAM_CANARY_TEXT", &text)
        .env("ADHAM_CANARY_TITLE", &title)
        .status()
        .expect("spawn Process 1");

    assert!(
        status1.success(),
        "Process 1 (record and quit) failed with status: {:?}",
        status1
    );

    // Process 2: Relaunch and resend
    let status2 = Command::new(&exe)
        .arg("--exact")
        .arg("test_desktop_multi_process_quit_relaunch_recovery")
        .arg("--nocapture")
        .env("ADHAM_MULTI_PROCESS_STAGE", "stage2_relaunch_and_resend")
        .env("ADHAM_CANARY_DB", &db_path)
        .env("ADHAM_CANARY_OP_ID", &op_id)
        .env("ADHAM_CANARY_CREATE_REQ_ID", &create_req_id)
        .env("ADHAM_CANARY_MSG_REQ_ID", &msg_req_id)
        .env("ADHAM_CANARY_TEXT", &text)
        .env("ADHAM_CANARY_TITLE", &title)
        .status()
        .expect("spawn Process 2");

    assert!(
        status2.success(),
        "Process 2 (relaunch and resend) failed with status: {:?}",
        status2
    );

    // Cleanup disposable canary data
    let _ = std::fs::remove_file(&db_path);
    let _ = std::fs::remove_file(format!("{}-shm", db_path.display()));
    let _ = std::fs::remove_file(format!("{}-wal", db_path.display()));
    let _ = std::fs::remove_file(&ws_proj_file);
}
