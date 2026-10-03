PRAGMA foreign_keys = ON;

-- Public, user-chosen chat identifier. Existing profiles are populated lazily
-- by ensureProfile so this migration never needs to generate user-visible IDs.
ALTER TABLE chat_profiles ADD COLUMN chat_user_id TEXT;
UPDATE chat_profiles
SET chat_user_id = 'learner_' || lower(hex(randomblob(6)))
WHERE chat_user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_profiles_user_id
  ON chat_profiles(chat_user_id);

-- A single account-v2 conversation is reserved for the site-wide discussion.
-- The opt-out table prevents the automatic membership reconciliation from
-- silently adding a student back after they leave.
ALTER TABLE chat_conversations ADD COLUMN global_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_conversations_global_slug
  ON chat_conversations(global_slug);

CREATE INDEX IF NOT EXISTS idx_chat_profiles_chat_user_id
  ON chat_profiles(chat_user_id);

CREATE TABLE IF NOT EXISTS chat_global_optouts (
  conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  left_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_global_optouts_user
  ON chat_global_optouts(user_id, conversation_id);
