-- Shared account Passkeys are the canonical WebAuthn credentials for login and secure chat.
CREATE TABLE IF NOT EXISTS auth_passkey_challenges (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL UNIQUE,
  rp_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  prf_salt TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_auth_passkey_challenges_expiry
  ON auth_passkey_challenges(expires_at, used_at);

CREATE TABLE IF NOT EXISTS chat_account_vault_wrappers (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version TEXT NOT NULL,
  credential_id TEXT NOT NULL REFERENCES chat_passkeys(credential_id) ON DELETE CASCADE,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, key_version, credential_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_account_vault_wrappers_user
  ON chat_account_vault_wrappers(user_id, key_version, updated_at);

INSERT OR IGNORE INTO chat_account_vault_wrappers
  (user_id, key_version, credential_id, nonce, ciphertext, updated_at)
SELECT v.user_id, v.key_version, v.credential_id, v.nonce, v.ciphertext, v.updated_at
FROM chat_account_vault_versions v
WHERE v.credential_id IS NOT NULL;
