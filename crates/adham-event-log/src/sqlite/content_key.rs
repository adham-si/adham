use adham_core_types::DomainError;
use rand::RngCore;
use zeroize::Zeroize;

/// Content-encryption key provider.
///
/// Production uses the OS credential store; tests use an in-memory key.
/// The key itself never enters SQLite or logs.
pub trait ContentKeyProvider: Send + Sync {
    fn content_key(&self) -> Result<[u8; 32], DomainError>;
    fn key_reference(&self) -> String;
}

/// OS credential-store provider (Windows Credential Manager / macOS Keychain /
/// Linux Secret Service via the `keyring` crate).
pub struct OsKeyringProvider {
    service: String,
    account: String,
}

impl OsKeyringProvider {
    pub fn new(service: &str, account: &str) -> Self {
        Self {
            service: service.to_string(),
            account: account.to_string(),
        }
    }

    pub fn default_for_installation(installation_id: &str) -> Self {
        Self::new("adham-content-key", installation_id)
    }

    /// Reject non-persistent (mock/test) credential backends before any
    /// initialization write. Zero store mutation: only opens an entry and
    /// inspects its concrete credential type.
    ///
    /// The selected credential builder is process-global, so the probe entry
    /// needs no real service/account.
    pub fn ensure_persistent_backend() -> Result<(), DomainError> {
        let entry = keyring::Entry::new("adham-backend-probe", "probe")
            .map_err(|e| DomainError::Storage(format!("keyring open failed: {e}")))?;
        if entry
            .get_credential()
            .downcast_ref::<keyring::mock::MockCredential>()
            .is_some()
        {
            return Err(DomainError::Storage(
                "no supported OS credential backend for this platform (mock store selected); refusing to store content key".into(),
            ));
        }
        Ok(())
    }

    /// First-time key initialization. Creates the key only when absent and
    /// verifies persistence with a fresh-Entry read-back before admitting it;
    /// never overwrites an existing credential.
    pub fn initialize_content_key(&self) -> Result<[u8; 32], DomainError> {
        let entry = keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| DomainError::Storage(format!("keyring open failed: {e}")))?;
        match entry.get_password() {
            Ok(hex) => parse_key_hex(&hex).ok_or_else(|| {
                DomainError::Integrity("corrupt content key in credential store".into())
            }),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0u8; 32];
                rand::rngs::OsRng.fill_bytes(&mut key);
                let mut hex = hex_encode(&key);
                key.zeroize();
                entry
                    .set_password(&hex)
                    .map_err(|e| DomainError::Storage(format!("keyring store failed: {e}")))?;
                // Read-back verify with a fresh Entry: catches stores that
                // accept writes but do not persist them.
                let verify = keyring::Entry::new(&self.service, &self.account)
                    .map_err(|e| DomainError::Storage(format!("keyring open failed: {e}")))?;
                let verified = match verify.get_password() {
                    Ok(stored) if stored == hex => parse_key_hex(&hex).ok_or_else(|| {
                        DomainError::Integrity("key encode failed".into())
                    }),
                    Ok(_) => Err(DomainError::Storage(
                        "content key read-back mismatch after create; store did not persist the written key".into(),
                    )),
                    Err(keyring::Error::NoEntry) => Err(DomainError::Storage(
                        "content key missing after create; store did not persist the written key".into(),
                    )),
                    Err(e) => Err(DomainError::Storage(format!(
                        "keyring verify read failed: {e}"
                    ))),
                };
                hex.zeroize();
                verified
            }
            Err(e) => Err(DomainError::Storage(format!("keyring read failed: {e}"))),
        }
    }
}

impl ContentKeyProvider for OsKeyringProvider {
    /// Read-only. Never creates: NoEntry is an explicit key-loss error.
    fn content_key(&self) -> Result<[u8; 32], DomainError> {
        let entry = keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| DomainError::Storage(format!("keyring open failed: {e}")))?;
        match entry.get_password() {
            Ok(hex) => parse_key_hex(&hex).ok_or_else(|| {
                DomainError::Integrity("corrupt content key in credential store".into())
            }),
            Err(keyring::Error::NoEntry) => Err(DomainError::Storage(
                "content key missing from credential store; automatic (re)creation is disabled"
                    .into(),
            )),
            Err(e) => Err(DomainError::Storage(format!("keyring read failed: {e}"))),
        }
    }

    fn key_reference(&self) -> String {
        format!("keyring:{}/{}:v1", self.service, self.account)
    }
}

/// In-memory provider for tests and sealed environments.
pub struct InMemoryProvider {
    key: [u8; 32],
    reference: String,
}

impl InMemoryProvider {
    pub fn generate() -> Self {
        let mut key = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut key);
        Self {
            key,
            reference: "in-memory:v1".to_string(),
        }
    }

    pub fn from_key(key: [u8; 32]) -> Self {
        Self {
            key,
            reference: "in-memory:v1".to_string(),
        }
    }
}

impl ContentKeyProvider for InMemoryProvider {
    fn content_key(&self) -> Result<[u8; 32], DomainError> {
        Ok(self.key)
    }

    fn key_reference(&self) -> String {
        self.reference.clone()
    }
}

/// Always-failing provider for unavailable-key behavior tests.
pub struct UnavailableKeyProvider;

impl ContentKeyProvider for UnavailableKeyProvider {
    fn content_key(&self) -> Result<[u8; 32], DomainError> {
        Err(DomainError::Storage("content key unavailable".into()))
    }

    fn key_reference(&self) -> String {
        "unavailable:v1".to_string()
    }
}

fn hex_encode(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xf) as usize] as char);
    }
    s
}

fn parse_key_hex(hex: &str) -> Option<[u8; 32]> {
    if hex.len() != 64 {
        return None;
    }
    let mut key = [0u8; 32];
    for (i, chunk) in hex.as_bytes().chunks(2).enumerate() {
        let hi = (chunk[0] as char).to_digit(16)? as u8;
        let lo = (chunk[1] as char).to_digit(16)? as u8;
        key[i] = (hi << 4) | lo;
    }
    Some(key)
}
