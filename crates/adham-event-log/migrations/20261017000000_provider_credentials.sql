CREATE TABLE IF NOT EXISTS provider_credentials (
    account_id    TEXT PRIMARY KEY,
    protection    TEXT NOT NULL,
    nonce         BLOB NOT NULL,
    ciphertext    BLOB NOT NULL,
    key_reference TEXT NOT NULL,
    updated_at_us INTEGER NOT NULL,
    FOREIGN KEY (account_id) REFERENCES provider_accounts(account_id) ON DELETE CASCADE
);
