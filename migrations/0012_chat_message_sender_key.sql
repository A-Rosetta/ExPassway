ALTER TABLE chat_messages ADD COLUMN sender_key_id TEXT;
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender_key
  ON chat_messages(sender_user_id, sender_key_id, created_at);
