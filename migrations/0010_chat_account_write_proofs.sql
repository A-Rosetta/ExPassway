-- A verified WebAuthn assertion grants only a short, bounded authorization to
-- upload an account key bundle and its opaque vault. Account-login tokens
-- alone must never be able to replace those records.
CREATE TABLE IF NOT EXISTS chat_account_write_proofs (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  uses_remaining INTEGER NOT NULL DEFAULT 5 CHECK(uses_remaining >= 0),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_account_write_proofs_user_expiry
  ON chat_account_write_proofs(user_id, expires_at);
