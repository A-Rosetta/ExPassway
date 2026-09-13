PRAGMA foreign_keys = ON;

-- Account scoped E2EE metadata.  Signal-v1 tables remain intact for read/migration compatibility.
CREATE TABLE IF NOT EXISTS chat_account_keys (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version TEXT NOT NULL,
  encryption_public_key TEXT NOT NULL,
  signing_public_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, key_version)
);
CREATE INDEX IF NOT EXISTS idx_chat_account_keys_active ON chat_account_keys(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_passkeys (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  prf_salt TEXT NOT NULL,
  sign_count INTEGER NOT NULL DEFAULT 0,
  transports TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(transports)),
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_passkeys_user ON chat_passkeys(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS chat_vaults (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  key_version TEXT NOT NULL,
  kdf_version TEXT NOT NULL DEFAULT 'hkdf-sha256-v1',
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_webauthn_challenges (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  challenge TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK(kind IN ('registration','authentication')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_webauthn_challenges_expiry ON chat_webauthn_challenges(expires_at, used_at);

CREATE TABLE IF NOT EXISTS chat_conversation_epochs (
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id, epoch)
);

CREATE TABLE IF NOT EXISTS chat_epoch_recipients (
  conversation_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_version TEXT NOT NULL,
  ephemeral_public_key TEXT NOT NULL,
  nonce TEXT NOT NULL,
  envelope_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id, epoch, user_id),
  FOREIGN KEY(conversation_id, epoch) REFERENCES chat_conversation_epochs(conversation_id, epoch) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chat_epoch_recipients_user ON chat_epoch_recipients(user_id, conversation_id, epoch);

CREATE TABLE IF NOT EXISTS chat_group_metadata (
  conversation_id TEXT PRIMARY KEY REFERENCES chat_conversations(id) ON DELETE CASCADE,
  epoch INTEGER NOT NULL,
  ciphertext TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_sync_events (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  entity_id TEXT,
  payload_ciphertext TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_sync_events_conversation ON chat_sync_events(conversation_id, sequence);

CREATE TABLE IF NOT EXISTS chat_legacy_message_migrations (
  source_message_id TEXT PRIMARY KEY,
  target_message_id TEXT,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  migrated_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'migrated' CHECK(status IN ('migrated','failed')),
  error_code TEXT,
  created_at TEXT NOT NULL
);

ALTER TABLE chat_messages ADD COLUMN sender_user_id TEXT REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE chat_messages ADD COLUMN content_epoch INTEGER;
ALTER TABLE chat_messages ADD COLUMN nonce TEXT;
ALTER TABLE chat_messages ADD COLUMN signature TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_user ON chat_messages(sender_user_id, created_at);
