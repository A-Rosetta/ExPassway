PRAGMA foreign_keys = ON;

-- Read state is per member. The message id disambiguates messages that share a
-- timestamp (SQLite stores chat timestamps as ISO strings).
ALTER TABLE chat_conversation_members ADD COLUMN last_read_at TEXT;
ALTER TABLE chat_conversation_members ADD COLUMN last_read_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_chat_members_read_state
  ON chat_conversation_members(user_id, conversation_id, last_read_at, last_read_message_id);
