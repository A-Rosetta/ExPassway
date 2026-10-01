ALTER TABLE chat_conversations ADD COLUMN current_epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_conversations ADD COLUMN control_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_conversations ADD COLUMN rotation_required INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chat_conversations ADD COLUMN legacy_source_id TEXT REFERENCES chat_conversations(id);
ALTER TABLE chat_group_metadata ADD COLUMN nonce TEXT;
ALTER TABLE chat_sync_events ADD COLUMN content_epoch INTEGER;
ALTER TABLE chat_sync_events ADD COLUMN control_json TEXT;
ALTER TABLE chat_attachments ADD COLUMN owner_user_id TEXT REFERENCES users(id);
ALTER TABLE chat_attachments ADD COLUMN content_epoch INTEGER;

CREATE TABLE chat_account_controls (
  signature TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  control_json TEXT NOT NULL CHECK(json_valid(control_json)),
  created_at TEXT NOT NULL
);
CREATE TABLE chat_account_atomic_guards (id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1));

PRAGMA defer_foreign_keys = ON;
ALTER TABLE chat_ws_tickets RENAME TO chat_ws_tickets_old;
CREATE TABLE chat_ws_tickets (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES chat_devices(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
INSERT INTO chat_ws_tickets SELECT * FROM chat_ws_tickets_old;
DROP TABLE chat_ws_tickets_old;
CREATE INDEX idx_chat_ws_ticket_expiry ON chat_ws_tickets(expires_at, used_at);
PRAGMA defer_foreign_keys = OFF;
