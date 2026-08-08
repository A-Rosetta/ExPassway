PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS chat_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  chat_alias TEXT NOT NULL UNIQUE,
  identity_fingerprint TEXT,
  profile_ciphertext TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  identity_public_key TEXT NOT NULL,
  device_number INTEGER NOT NULL,
  registration_id INTEGER NOT NULL,
  signed_prekey_id INTEGER NOT NULL,
  signed_prekey_public TEXT NOT NULL,
  signed_prekey_signature TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, id),
  UNIQUE(user_id, device_number)
);

CREATE INDEX IF NOT EXISTS idx_chat_devices_user_active
  ON chat_devices(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS chat_device_prekeys (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES chat_devices(id) ON DELETE CASCADE,
  key_id INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(device_id, key_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_prekeys_available
  ON chat_device_prekeys(device_id, consumed_at);

CREATE TABLE IF NOT EXISTS chat_invites (
  id TEXT PRIMARY KEY,
  creator_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_invites_creator
  ON chat_invites(creator_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS chat_contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  peer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  accepted_at TEXT NOT NULL,
  UNIQUE(user_id, peer_user_id),
  CHECK(user_id <> peer_user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_contacts_user
  ON chat_contacts(user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS chat_conversations (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'direct' CHECK(kind IN ('direct', 'group')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  retention_seconds INTEGER NOT NULL DEFAULT 2592000
    CHECK(retention_seconds IN (86400, 604800, 2592000, 0)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_conversation_members (
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('member', 'admin', 'owner')),
  joined_at TEXT NOT NULL,
  left_at TEXT,
  PRIMARY KEY(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_members_user
  ON chat_conversation_members(user_id, left_at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_device_id TEXT NOT NULL REFERENCES chat_devices(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL DEFAULT 'signal-v1',
  ciphertext TEXT NOT NULL,
  attachment_refs TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attachment_refs)),
  size_bucket TEXT NOT NULL DEFAULT 'small',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT,
  UNIQUE(sender_device_id, client_message_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages(conversation_id, created_at, id);

CREATE TABLE IF NOT EXISTS chat_message_deliveries (
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES chat_devices(id) ON DELETE CASCADE,
  delivered_at TEXT,
  PRIMARY KEY(message_id, device_id)
);

CREATE TABLE IF NOT EXISTS chat_attachments (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  size_bytes INTEGER NOT NULL,
  size_bucket TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'complete', 'deleted')),
  created_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_expiry
  ON chat_attachments(expires_at, status);

CREATE TABLE IF NOT EXISTS chat_key_backups (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kdf_version TEXT NOT NULL,
  salt TEXT NOT NULL,
  nonce TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
  evidence_ciphertext TEXT NOT NULL,
  evidence_key_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'closed'))
);

CREATE TABLE IF NOT EXISTS chat_ws_tickets (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES chat_devices(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_ws_ticket_expiry
  ON chat_ws_tickets(expires_at, used_at);

CREATE TABLE IF NOT EXISTS chat_device_approval_tickets (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issuer_device_id TEXT NOT NULL REFERENCES chat_devices(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_device_approval_expiry
  ON chat_device_approval_tickets(expires_at, used_at);

CREATE TABLE IF NOT EXISTS chat_rate_limits (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, action)
);
