-- signal-v1 messages retain their device sender. account-v2 messages have no
-- device identity, so rebuild the table with a nullable sender_device_id.
PRAGMA defer_foreign_keys = ON;

CREATE TABLE chat_reports_saved AS SELECT * FROM chat_reports;
DROP TABLE chat_reports;
ALTER TABLE chat_message_deliveries RENAME TO chat_message_deliveries_legacy;
ALTER TABLE chat_messages RENAME TO chat_messages_legacy;

CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_device_id TEXT REFERENCES chat_devices(id) ON DELETE CASCADE,
  sender_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  client_message_id TEXT NOT NULL,
  protocol_version TEXT NOT NULL DEFAULT 'signal-v1',
  ciphertext TEXT NOT NULL,
  content_epoch INTEGER,
  nonce TEXT,
  signature TEXT,
  attachment_refs TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(attachment_refs)),
  size_bucket TEXT NOT NULL DEFAULT 'small',
  created_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT,
  UNIQUE(sender_device_id, client_message_id)
);

INSERT INTO chat_messages (
  id, conversation_id, sender_device_id, sender_user_id, client_message_id,
  protocol_version, ciphertext, content_epoch, nonce, signature, attachment_refs,
  size_bucket, created_at, expires_at, deleted_at
)
SELECT
  id, conversation_id, sender_device_id, sender_user_id, client_message_id,
  protocol_version, ciphertext, content_epoch, nonce, signature, attachment_refs,
  size_bucket, created_at, expires_at, deleted_at
FROM chat_messages_legacy;

CREATE TABLE chat_message_deliveries (
  message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES chat_devices(id) ON DELETE CASCADE,
  delivered_at TEXT,
  PRIMARY KEY(message_id, device_id)
);
INSERT INTO chat_message_deliveries (message_id, device_id, delivered_at)
SELECT message_id, device_id, delivered_at FROM chat_message_deliveries_legacy;

DROP TABLE chat_message_deliveries_legacy;
DROP TABLE chat_messages_legacy;

CREATE TABLE chat_reports (
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
INSERT INTO chat_reports SELECT * FROM chat_reports_saved;
DROP TABLE chat_reports_saved;

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages(conversation_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_user
  ON chat_messages(sender_user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_messages_account_client
  ON chat_messages(sender_user_id, client_message_id)
  WHERE sender_user_id IS NOT NULL;

PRAGMA defer_foreign_keys = OFF;
