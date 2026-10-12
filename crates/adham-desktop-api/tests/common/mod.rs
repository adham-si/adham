use adham_core_types::*;
use adham_desktop_api::*;
use adham_event_log::create_sqlite_pool;
use std::path::{Path, PathBuf};

pub fn test_db_path() -> PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("adham_p0_01_test_{}.db", uuid::Uuid::now_v7()));
    path
}

pub async fn setup_ctx(db_path: &Path) -> ApiContext {
    let pool = create_sqlite_pool(db_path).await.expect("create pool");
    let provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider> =
        std::sync::Arc::new(adham_event_log::InMemoryProvider::generate());
    ApiContext::load_or_create_with_key(pool, provider)
        .await
        .expect("load identity")
}

#[allow(dead_code)]
pub async fn setup_ctx_with_key(
    db_path: &Path,
    provider: std::sync::Arc<dyn adham_event_log::ContentKeyProvider>,
) -> ApiContext {
    let pool = create_sqlite_pool(db_path).await.expect("create pool");
    ApiContext::load_or_create_with_key(pool, provider)
        .await
        .expect("load identity")
}

pub async fn create_test_workspace(ctx: &ApiContext, name: &str) -> String {
    let res = handle_create_workspace(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext::default(),
            payload: CreateWorkspacePayload {
                name: name.to_string(),
                kind: "personal".to_string(),
                preferred_language: "en".to_string(),
            },
        },
    )
    .await
    .expect("create test workspace");
    res.data.workspace_id
}

pub async fn create_test_project(ctx: &ApiContext, ws_id: &str, name: &str) -> String {
    let res = handle_create_project(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.to_string()),
                project_id: None,
                session_id: None,
            },
            payload: CreateProjectPayload {
                name: name.to_string(),
                storage_kind: "isolated".to_string(),
            },
        },
    )
    .await
    .expect("create test project");
    res.data.project_id
}

#[allow(dead_code)]
pub async fn create_test_session(
    ctx: &ApiContext,
    ws_id: &str,
    proj_id: &str,
    title: Option<&str>,
) -> String {
    let res = handle_create_session(
        ctx,
        CommandEnvelope {
            protocol_version: 1,
            request_id: RequestId::new_v7().to_string(),
            context: CommandContext {
                workspace_id: Some(ws_id.to_string()),
                project_id: Some(proj_id.to_string()),
                session_id: None,
            },
            payload: CreateSessionPayload {
                title: title.map(|t| t.to_string()),
            },
        },
    )
    .await
    .expect("create test session");
    res.data.session_id
}
