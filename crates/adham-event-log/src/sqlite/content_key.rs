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
}

impl ContentKeyProvider for OsKeyringProvider {
    fn content_key(&self) -> Result<[u8; 32], DomainError> {
        let entry = keyring::Entry::new(&self.service, &self.account)
            .map_err(|e| DomainError::Storage(format!("keyring open failed: {e}")))?;
        match entry.get_password() {
            Ok(hex) => parse_key_hex(&hex).ok_or_else(|| {
                DomainError::Integrity("corrupt content key in credential store".into())
            }),
            Err(keyring::Error::NoEntry) => {
                let mut key = [0u8; 32];
                rand::rngs::OsRng.fill_bytes(&mut key);
                let hex = hex_encode(&key);
                entry
                    .set_password(&hex)
                    .map_err(|e| DomainError::Storage(format!("keyring store failed: {e}")))?;
                key.zeroize();
                parse_key_hex(&hex)
                    .ok_or_else(|| DomainError::Integrity("key encode failed".into()))
            }
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
