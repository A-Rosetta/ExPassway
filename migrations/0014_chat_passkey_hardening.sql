-- Keep every encrypted vault version. The former single-row table is retained
-- as a historical compatibility source and is never written by account-v2.
CREATE TABLE chat_account_vault_versions (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version TEXT NOT NULL,
  credential_id TEXT REFERENCES chat_passkeys(credential_id),
  kdf_version TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, key_version)
);
INSERT INTO chat_account_vault_versions
  SELECT user_id,key_version,NULL,kdf_version,nonce,ciphertext,updated_at FROM chat_vaults;
CREATE TABLE chat_account_identity_heads (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_version TEXT NOT NULL,
  credential_id TEXT REFERENCES chat_passkeys(credential_id)
);
INSERT INTO chat_account_identity_heads
  SELECT v.user_id,v.key_version,NULL FROM chat_vaults v
  JOIN chat_account_keys k ON k.user_id=v.user_id AND k.key_version=v.key_version AND k.status='active';

ALTER TABLE chat_passkeys ADD COLUMN key_version TEXT;
ALTER TABLE chat_passkeys ADD COLUMN reserved_key_version TEXT;
ALTER TABLE chat_passkeys ADD COLUMN replaces_key_version TEXT;
ALTER TABLE chat_passkeys ADD COLUMN backup_eligible INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_passkeys ADD COLUMN backup_state INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_webauthn_challenges ADD COLUMN credential_id TEXT;
ALTER TABLE chat_webauthn_challenges ADD COLUMN reserved_key_version TEXT;
ALTER TABLE chat_webauthn_challenges ADD COLUMN replaces_key_version TEXT;
ALTER TABLE chat_account_write_proofs ADD COLUMN credential_id TEXT;
ALTER TABLE chat_account_write_proofs ADD COLUMN key_version TEXT;
ALTER TABLE chat_account_write_proofs ADD COLUMN replaces_key_version TEXT;
ALTER TABLE chat_account_write_proofs ADD COLUMN purpose TEXT;
CREATE TABLE chat_account_initialization_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1));
