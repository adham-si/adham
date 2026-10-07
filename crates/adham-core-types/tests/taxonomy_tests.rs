use adham_core_types::*;
use std::fs;
use std::path::PathBuf;
use time::OffsetDateTime;

#[test]
fn test_serde_roundtrip_all_events() {
    let ws = WorkspaceCreatedV1 {
        workspace_id: WorkspaceId::new_v7(),
        name: "Personal Workspace".to_string(),
        kind: "personal".to_string(),
        preferred_language: "en".to_string(),
    };
    let ws_json = serde_json::to_string(&ws).expect("serialize ws");
    let ws_de: WorkspaceCreatedV1 = serde_json::from_str(&ws_json).expect("deserialize ws");
    assert_eq!(ws, ws_de);

    let proj = ProjectCreatedV1 {
        project_id: ProjectId::new_v7(),
        workspace_id: ws.workspace_id.clone(),
        name: "Adham Core".to_string(),
        storage_kind: "isolated".to_string(),
    };
    let proj_json = serde_json::to_string(&proj).expect("serialize proj");
    let proj_de: ProjectCreatedV1 = serde_json::from_str(&proj_json).expect("deserialize proj");
    assert_eq!(proj, proj_de);

    let sess = SessionCreatedV1 {
        session_id: SessionId::new_v7(),
        project_id: proj.project_id.clone(),
        title: Some("Taxonomy Discussion".to_string()),
    };
    let sess_json = serde_json::to_string(&sess).expect("serialize sess");
    let sess_de: SessionCreatedV1 = serde_json::from_str(&sess_json).expect("deserialize sess");
    assert_eq!(sess, sess_de);

    let msg = MessageSubmittedV1 {
        message_id: MessageId::new_v7(),
        content_id: ContentId::new_v7(),
        content_kind: "user_text".to_string(),
        size_bytes: 42,
    };
    let msg_json = serde_json::to_string(&msg).expect("serialize msg");
    let msg_de: MessageSubmittedV1 = serde_json::from_str(&msg_json).expect("deserialize msg");
    assert_eq!(msg, msg_de);
}

#[test]
fn test_sensitive_content_segregation_invariant() {
    let msg = MessageSubmittedV1 {
        message_id: MessageId::new_v7(),
        content_id: ContentId::new_v7(),
        content_kind: "user_text".to_string(),
        size_bytes: 1024,
    };
    let json = serde_json::to_string(&msg).unwrap();
    // Prove that user text/body/prompt fields are strictly absent from the event payload
    assert!(!json.contains("\"text\":"));
    assert!(!json.contains("\"body\":"));
    assert!(!json.contains("\"prompt\":"));
    assert!(json.contains("content_id"));
    assert!(json.contains("size_bytes"));
}

#[test]
fn test_payload_validation_invariants() {
    // 1. Workspace validations
    let bad_ws_name = WorkspaceCreatedV1 {
        workspace_id: WorkspaceId::new_v7(),
        name: "   ".to_string(),
        kind: "personal".to_string(),
        preferred_language: "en".to_string(),
    };
    assert!(bad_ws_name.validate().is_err());

    let bad_ws_lang = WorkspaceCreatedV1 {
        workspace_id: WorkspaceId::new_v7(),
        name: "Personal".to_string(),
        kind: "personal".to_string(),
        preferred_language: "fr".to_string(),
    };
    assert!(bad_ws_lang.validate().is_err());

    let bad_ws_kind = WorkspaceCreatedV1 {
        workspace_id: WorkspaceId::new_v7(),
        name: "Personal".to_string(),
        kind: "enterprise".to_string(),
        preferred_language: "en".to_string(),
    };
    assert!(bad_ws_kind.validate().is_err());

    // 2. Project validations
    let bad_proj_kind = ProjectCreatedV1 {
        project_id: ProjectId::new_v7(),
        workspace_id: WorkspaceId::new_v7(),
        name: "Test".to_string(),
        storage_kind: "shared".to_string(),
    };
    assert!(bad_proj_kind.validate().is_err());

    // 3. Message validations
    let bad_msg_kind = MessageSubmittedV1 {
        message_id: MessageId::new_v7(),
        content_id: ContentId::new_v7(),
        content_kind: "executable_binary".to_string(),
        size_bytes: 100,
    };
    assert!(bad_msg_kind.validate().is_err());

    let bad_msg_size = MessageSubmittedV1 {
        message_id: MessageId::new_v7(),
        content_id: ContentId::new_v7(),
        content_kind: "user_text".to_string(),
        size_bytes: 100_000, // exceeds 64KB
    };
    assert!(bad_msg_size.validate().is_err());
}

#[test]
fn test_schema_registry_consistency() {
    let mut manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest_path.pop(); // crates/
    manifest_path.pop(); // root/
    manifest_path.push("schemas");
    manifest_path.push("events");

    let registry_file = manifest_path.join("registry.json");
    assert!(registry_file.exists(), "registry.json must exist");

    let content = fs::read_to_string(&registry_file).expect("read registry.json");
    let parsed: serde_json::Value = serde_json::from_str(&content).expect("parse registry.json");

    assert_eq!(parsed["registryVersion"], 1);
    let events = parsed["events"].as_array().expect("events array");
    assert_eq!(events.len(), 4);

    for event in events {
        let schema_rel = event["schema"].as_str().expect("schema relative path");
        let schema_path = manifest_path.join(schema_rel.trim_start_matches("./"));
        assert!(
            schema_path.exists(),
            "Schema file {:?} must exist",
            schema_path
        );
    }
}

#[test]
fn test_event_envelope_roundtrip() {
    let envelope = EventEnvelope {
        event_id: EventId::new_v7(),
        event_type: EVENT_TYPE_WORKSPACE_CREATED.to_string(),
        event_version: 1,
        stream_id: "workspace:01925b68-0000-7000-8000-000000000001".to_string(),
        stream_sequence: 1,
        request_id: RequestId::new_v7(),
        correlation_id: CorrelationId::new_v7(),
        causation_id: None,
        actor: EventActor {
            actor_id: ActorId::new_v7(),
            kind: ActorKind::LocalHuman,
        },
        scope: EventScope {
            installation_id: InstallationId::new_v7(),
            workspace_id: Some(WorkspaceId::new_v7()),
            project_id: None,
            session_id: None,
        },
        occurred_at: OffsetDateTime::now_utc(),
        payload: WorkspaceCreatedV1 {
            workspace_id: WorkspaceId::new_v7(),
            name: "WS".to_string(),
            kind: "personal".to_string(),
            preferred_language: "en".to_string(),
        },
        previous_checksum: None,
        checksum: "abc123blake3hash".to_string(),
    };

    let json = serde_json::to_string(&envelope).expect("serialize envelope");
    let de: EventEnvelope<WorkspaceCreatedV1> =
        serde_json::from_str(&json).expect("deserialize envelope");
    assert_eq!(de.event_id, envelope.event_id);
    assert_eq!(de.event_type, EVENT_TYPE_WORKSPACE_CREATED);
    assert_eq!(de.payload.name, "WS");
}
