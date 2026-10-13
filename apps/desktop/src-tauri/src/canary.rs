use adham_core_types::*;
use adham_desktop_api::*;
use std::path::PathBuf;

pub async fn run_canary_recovery_journey(ctx: &ApiContext, mode: &str) {
    match mode {
        "persist_and_quit" => {
            run_persist_and_quit(ctx).await;
        }
        "relaunch_and_resend" => {
            run_relaunch_and_resend(ctx).await;
        }
        other => {
            eprintln!("[CANARY] Unknown recovery mode: {}", other);
            std::process::exit(1);
        }
    }
}

async fn run_persist_and_quit(ctx: &ApiContext) {
    let op_id = std::env::var("ADHAM_CANARY_OP_ID").expect("OP_ID");
    let create_req_id = std::env::var("ADHAM_CANARY_CREATE_REQ_ID").expect("CREATE_REQ_ID");
    let msg_req_id = std::env::var("ADHAM_CANARY_MSG_REQ_ID").expect("MSG_REQ_ID");
    let text = std::env::var("ADHAM_CANARY_TEXT").expect("TEXT");
    let title = std::env::var("ADHAM_CANARY_TITLE").expect("TITLE");
    let scope_file = PathBuf::from(std::env::var("ADHAM_CANARY_SCOPE_FILE").expect("SCOPE_FILE"));

    // 1. Create test workspace and project using the Tauri app's ApiContext
    let ws_res = handle_create_workspace(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext::default(),
            payload: CreateWorkspacePayload {
                name: "Canary Desktop Workspace".to_string(),
                kind: "personal".to_string(),
                preferred_language: "en".to_string(),
            },
        },
    )
    .await
    .expect("create canary workspace");

    let ws_id = ws_res.data.workspace_id;

    let proj_res = handle_create_project(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: None,
                session_id: None,
            },
            payload: CreateProjectPayload {
                name: "Canary Desktop Project".to_string(),
                storage_kind: "isolated".to_string(),
            },
        },
    )
    .await
    .expect("create canary project");

    let proj_id = proj_res.data.project_id;

    // 2. Persist the unresolved operation in SQLite
    handle_record_pending_operation(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.clone()),
                project_id: Some(proj_id.clone()),
                session_id: None,
            },
            payload: RecordPendingOperationPayload {
                operation_id: op_id.clone(),
                kind: "first_send".to_string(),
                message_request_id: msg_req_id,
                create_request_id: Some(create_req_id),
                text,
                title: Some(title),
            },
        },
    )
    .await
    .expect("record pending op");

    // Write scope file so relaunch process knows target IDs
    std::fs::write(&scope_file, format!("{}:{}", ws_id, proj_id)).expect("write scope file");

    // Verify it is committed to SQLite
    let list = handle_list_pending_operations(ctx)
        .await
        .expect("list pending ops");
    assert_eq!(
        list.operations.len(),
        1,
        "pending operation must be committed"
    );
    assert_eq!(list.operations[0].operation_id, op_id);

    println!("[CANARY] PERSIST_SUCCESS: Unresolved operation persisted to SQLite. Quitting desktop process.");
    std::process::exit(0);
}

async fn run_relaunch_and_resend(ctx: &ApiContext) {
    let op_id = std::env::var("ADHAM_CANARY_OP_ID").expect("OP_ID");
    let create_req_id = std::env::var("ADHAM_CANARY_CREATE_REQ_ID").expect("CREATE_REQ_ID");
    let msg_req_id = std::env::var("ADHAM_CANARY_MSG_REQ_ID").expect("MSG_REQ_ID");
    let text = std::env::var("ADHAM_CANARY_TEXT").expect("TEXT");
    let title = std::env::var("ADHAM_CANARY_TITLE").expect("TITLE");
    let scope_file = PathBuf::from(std::env::var("ADHAM_CANARY_SCOPE_FILE").expect("SCOPE_FILE"));

    let scope_str = std::fs::read_to_string(&scope_file).expect("read scope file");
    let mut parts = scope_str.split(':');
    let ws_id = parts.next().expect("ws_id").to_string();
    let proj_id = parts.next().expect("proj_id").to_string();

    // 1. Startup discovery in relaunched desktop process
    let list = handle_list_pending_operations(ctx)
        .await
        .expect("list pending ops on relaunch");

    assert_eq!(
        list.operations.len(),
        1,
        "must discover unresolved operation on relaunch"
    );
    let op = &list.operations[0];
    assert_eq!(op.operation_id, op_id, "operation_id must match original");
    assert_eq!(op.workspace_id, ws_id, "workspace_id must match original");
    assert_eq!(op.project_id, proj_id, "project_id must match original");
    assert_eq!(
        op.create_request_id.as_deref(),
        Some(create_req_id.as_str()),
        "create_request_id must match original"
    );
    assert_eq!(
        op.message_request_id, msg_req_id,
        "message_request_id must match original"
    );
    assert_eq!(op.text, text, "text must match original");
    assert_eq!(
        op.title.as_deref(),
        Some(title.as_str()),
        "title must match original"
    );

    let scope_ctx = CommandContext {
        workspace_id: Some(ws_id.clone()),
        project_id: Some(proj_id.clone()),
        session_id: None,
    };

    // 2. Review & Explicit Resend: replay create_session with original create_request_id
    let create_res = handle_create_session(
        ctx,
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

    // 3. Replay submit_message with original message_request_id
    let submit_res = handle_submit_message(
        ctx,
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

    // 4. Clear resolved pending operation
    handle_clear_pending_operation(
        ctx,
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

    // 5. Verify NO DUPLICATES:
    // Idempotent create_session re-invocation returns receipt with identical session ID
    let dup_create = handle_create_session(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: create_req_id,
            context: scope_ctx,
            payload: CreateSessionPayload { title: Some(title) },
        },
    )
    .await
    .expect("idempotent create session");
    assert_eq!(
        dup_create.data.session_id, recovered_session_id,
        "idempotent create must return identical session ID"
    );

    // Verify conversation history has exactly 1 message (zero duplicate messages)
    let conv = handle_get_conversation(
        ctx,
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

    // Verify pending operations list is empty
    let empty_list = handle_list_pending_operations(ctx)
        .await
        .expect("list pending ops after resolution");
    assert!(
        empty_list.operations.is_empty(),
        "pending ops list must be empty"
    );

    println!(
        "[CANARY] RELAUNCH_SUCCESS: Recovered with original IDs, zero duplicate sessions, zero duplicate messages."
    );
    std::process::exit(0);
}
