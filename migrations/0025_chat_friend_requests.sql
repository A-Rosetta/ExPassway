PRAGMA foreign_keys = ON;

-- Contact rows remain accepted friendships. Pending verification is kept
-- separately so it cannot grant access to contact keys or direct chats.
CREATE TABLE chat_friend_requests (
  id TEXT PRIMARY KEY,
  sender_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  introduction TEXT NOT NULL DEFAULT '' CHECK(length(introduction) <= 500),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  CHECK(sender_user_id <> recipient_user_id),
  CHECK((status = 'pending' AND resolved_at IS NULL) OR (status <> 'pending' AND resolved_at IS NOT NULL))
);

-- Opposite requests share one pending verification instead of silently
-- accepting one another. The recipient must explicitly accept the request.
CREATE UNIQUE INDEX idx_chat_friend_requests_pending_pair
  ON chat_friend_requests(min(sender_user_id, recipient_user_id), max(sender_user_id, recipient_user_id))
  WHERE status = 'pending';
CREATE INDEX idx_chat_friend_requests_recipient
  ON chat_friend_requests(recipient_user_id, status, created_at DESC);
CREATE INDEX idx_chat_friend_requests_sender
  ON chat_friend_requests(sender_user_id, status, created_at DESC);

-- Voluntary departures can be reversed by the account itself. A moderation
-- removal must continue to exclude the account from automatic reconciliation.
ALTER TABLE chat_global_optouts ADD COLUMN reason TEXT NOT NULL DEFAULT 'left'
  CHECK(reason IN ('left', 'removed'));
