use adham_core_types::DomainError;
use adham_event_log::ContentKeyProvider;
use std::sync::{Arc, Mutex};
use zeroize::Zeroize;

/// Per-command content-key cache. The keychain is read at most once, and the
/// cached copy is zeroized when the command drops it.
pub struct CachedContentKeyProvider {
    inner: Arc<dyn ContentKeyProvider>,
    key: Mutex<Option<[u8; 32]>>,
    key_reference: String,
}

impl CachedContentKeyProvider {
    pub fn new(inner: Arc<dyn ContentKeyProvider>) -> Self {
        let key_reference = inner.key_reference();
        Self {
            inner,
            key: Mutex::new(None),
            key_reference,
        }
    }
}

impl ContentKeyProvider for CachedContentKeyProvider {
    fn content_key(&self) -> Result<[u8; 32], DomainError> {
        let mut guard = self
            .key
            .lock()
            .map_err(|_| DomainError::Storage("content key cache poisoned".into()))?;
        if let Some(key) = guard.as_ref() {
            return Ok(*key);
        }
        let key = self.inner.content_key()?;
        *guard = Some(key);
        Ok(key)
    }

    fn key_reference(&self) -> String {
        self.key_reference.clone()
    }
}

impl Drop for CachedContentKeyProvider {
    fn drop(&mut self) {
        if let Ok(mut guard) = self.key.lock() {
            if let Some(mut key) = guard.take() {
                key.zeroize();
            }
        }
    }
}
