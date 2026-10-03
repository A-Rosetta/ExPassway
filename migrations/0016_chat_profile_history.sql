-- Chat profile images are public routing metadata, like the existing nickname.
ALTER TABLE chat_profiles ADD COLUMN avatar_data_url TEXT NOT NULL DEFAULT '';

-- History removal only hides the conversation for this account. Other members,
-- encrypted messages and vaults remain available independently.
ALTER TABLE chat_conversation_members ADD COLUMN history_hidden_at TEXT;
CREATE INDEX idx_chat_members_visible
  ON chat_conversation_members(user_id, left_at, history_hidden_at);
