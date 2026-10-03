-- Conversation routing must distinguish account-v2 from preserved legacy history.
-- Existing conversations retain their Signal protocol and retention settings.
ALTER TABLE chat_conversations ADD COLUMN protocol_version TEXT NOT NULL DEFAULT 'signal-v1';
CREATE INDEX idx_chat_conversations_protocol ON chat_conversations(protocol_version, updated_at DESC);
