use adham_core_types::{ContentId, DomainError, EventScope};
use chacha20poly1305::{aead::Aead, KeyInit, XChaCha20Poly1305};
use rand::RngCore;

use super::content_key::ContentKeyProvider;

pub const PROTECTION_AEAD_V1: &str = "aead-xchacha20poly1305-v1";
pub const ENCODING_ENCRYPTED: &str = "encrypted";

fn frame(buf: &mut Vec<u8>, field: &str, value: &str) {
    buf.extend_from_slice(&(field.len() as u32).to_le_bytes());
    buf.extend_from_slice(field.as_bytes());
    buf.extend_from_slice(&(value.len() as u32).to_le_bytes());
    buf.extend_from_slice(value.as_bytes());
}

/// Associated data binding ciphertext to its structural scope.
///
/// Any scope mismatch (including copied DB row reused under another session)
/// fails authentication. No plain content hash is used as a privacy
/// workaround: low-entropy content would be guessable.
pub fn associated_data(content_id: &ContentId, kind: &str, scope: &EventScope) -> Vec<u8> {
    let mut ad = Vec::with_capacity(256);
    frame(&mut ad, "v", "1");
    frame(&mut ad, "content_id", &content_id.to_string());
    frame(&mut ad, "kind", kind);
    frame(&mut ad, "installation", &scope.installation_id.to_string());
    frame(
        &mut ad,
        "workspace",
        &scope
            .workspace_id
            .map(|v| v.to_string())
            .unwrap_or_default(),
    );
    frame(
        &mut ad,
        "project",
        &scope.project_id.map(|v| v.to_string()).unwrap_or_default(),
    );
    frame(
        &mut ad,
        "session",
        &scope.session_id.map(|v| v.to_string()).unwrap_or_default(),
    );
    ad
}

pub struct SealedContent {
    pub nonce: Vec<u8>,
    pub ciphertext: Vec<u8>,
    pub key_reference: String,
}

pub fn seal(
    provider: &dyn ContentKeyProvider,
    content_id: &ContentId,
    kind: &str,
    scope: &EventScope,
    plaintext: &[u8],
) -> Result<SealedContent, DomainError> {
    let key_bytes = provider.content_key()?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key_bytes)
        .map_err(|e| DomainError::Integrity(format!("key init failed: {e}")))?;
    let mut nonce_bytes = [0u8; 24];
    rand::rngs::OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = chacha20poly1305::XNonce::from_slice(&nonce_bytes);
    let ad = associated_data(content_id, kind, scope);
    let payload = chacha20poly1305::aead::Payload {
        msg: plaintext,
        aad: &ad,
    };
    let ciphertext = cipher
        .encrypt(nonce, payload)
        .map_err(|e| DomainError::Integrity(format!("encrypt failed: {e}")))?;
    Ok(SealedContent {
        nonce: nonce_bytes.to_vec(),
        ciphertext,
        key_reference: provider.key_reference(),
    })
}

pub fn open(
    provider: &dyn ContentKeyProvider,
    content_id: &ContentId,
    kind: &str,
    scope: &EventScope,
    nonce: &[u8],
    ciphertext: &[u8],
) -> Result<Vec<u8>, DomainError> {
    let key_bytes = provider.content_key()?;
    let cipher = XChaCha20Poly1305::new_from_slice(&key_bytes)
        .map_err(|e| DomainError::Integrity(format!("key init failed: {e}")))?;
    let nonce = chacha20poly1305::XNonce::from_slice(nonce);
    let ad = associated_data(content_id, kind, scope);
    let payload = chacha20poly1305::aead::Payload {
        msg: ciphertext,
        aad: &ad,
    };
    cipher
        .decrypt(nonce, payload)
        .map_err(|_| DomainError::Integrity("content authentication failed".into()))
}
