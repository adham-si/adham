use adham_core_types::{ActorId, InstallationId, ProjectId, SessionId, WorkspaceId};

fn frame(hasher: &mut blake3::Hasher, field: &str, value: &str) {
    hasher.update(&(field.len() as u32).to_le_bytes());
    hasher.update(field.as_bytes());
    hasher.update(&(value.len() as u32).to_le_bytes());
    hasher.update(value.as_bytes());
}

/// Deterministic scope fingerprint over the full command identity.
///
/// Covers command type + version + actor + installation + workspace + project +
/// session with explicit length-prefix framing (no ambiguous concatenation).
#[allow(clippy::too_many_arguments)]
pub fn scope_fingerprint(
    command_type: &str,
    command_version: u32,
    actor_id: &ActorId,
    installation_id: &InstallationId,
    workspace_id: Option<&WorkspaceId>,
    project_id: Option<&ProjectId>,
    session_id: Option<&SessionId>,
) -> String {
    let mut h = blake3::Hasher::new();
    frame(&mut h, "command_type", command_type);
    frame(&mut h, "command_version", &command_version.to_string());
    frame(&mut h, "actor_id", &actor_id.to_string());
    frame(&mut h, "installation_id", &installation_id.to_string());
    frame(
        &mut h,
        "workspace_id",
        &workspace_id.map(|v| v.to_string()).unwrap_or_default(),
    );
    frame(
        &mut h,
        "project_id",
        &project_id.map(|v| v.to_string()).unwrap_or_default(),
    );
    frame(
        &mut h,
        "session_id",
        &session_id.map(|v| v.to_string()).unwrap_or_default(),
    );
    h.finalize().to_hex().to_string()
}

/// Deterministic request fingerprint over the canonical payload.
///
/// `command_type` and `version` domain-separate identical payloads across
/// commands. Payload must already be canonical (trimmed, normalized).
pub fn request_fingerprint(
    command_type: &str,
    command_version: u32,
    canonical_payload: &str,
) -> String {
    let mut h = blake3::Hasher::new();
    frame(&mut h, "command_type", command_type);
    frame(&mut h, "command_version", &command_version.to_string());
    frame(&mut h, "payload", canonical_payload);
    h.finalize().to_hex().to_string()
}
