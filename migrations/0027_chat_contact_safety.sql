PRAGMA foreign_keys = ON;

CREATE TABLE chat_user_blocks (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(user_id, blocked_user_id),
  CHECK(user_id <> blocked_user_id)
);
CREATE INDEX idx_chat_user_blocks_target ON chat_user_blocks(blocked_user_id, user_id);

-- Reports contain the reporter's description, never automatically copied
-- plaintext chat messages or conversation keys.
CREATE TABLE chat_contact_reports (
  id TEXT PRIMARY KEY,
  reporter_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reported_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('spam', 'harassment', 'unsafe', 'other')),
  details TEXT NOT NULL DEFAULT '' CHECK(length(details) <= 2000),
  conversation_id TEXT REFERENCES chat_conversations(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES chat_messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'reviewed', 'closed')),
  CHECK(reporter_user_id <> reported_user_id)
);
CREATE INDEX idx_chat_contact_reports_status ON chat_contact_reports(status, created_at);

-- Triggers serialize safety decisions with D1 mutations. Application checks
-- return helpful retry times; these checks also cover concurrent requests.
-- RAISE ... WHERE avoids the remote D1 splitter confusing CASE's END with
-- the trigger body's END. Keep uppercase BEGIN and LF line endings.
CREATE TRIGGER chat_friend_request_safety BEFORE INSERT ON chat_friend_requests
WHEN NEW.status = 'pending'
BEGIN
  SELECT RAISE(ABORT, 'CHAT_CONTACT_BLOCKED') WHERE EXISTS (SELECT 1 FROM chat_user_blocks b
    WHERE (b.user_id = NEW.sender_user_id AND b.blocked_user_id = NEW.recipient_user_id)
      OR (b.user_id = NEW.recipient_user_id AND b.blocked_user_id = NEW.sender_user_id));
  SELECT RAISE(ABORT, 'FRIEND_REQUEST_COOLDOWN') WHERE NOT EXISTS (SELECT 1 FROM chat_friend_requests r WHERE r.status = 'pending' AND
      ((r.sender_user_id = NEW.sender_user_id AND r.recipient_user_id = NEW.recipient_user_id)
       OR (r.sender_user_id = NEW.recipient_user_id AND r.recipient_user_id = NEW.sender_user_id)))
    AND EXISTS (SELECT 1 FROM chat_friend_requests r WHERE r.sender_user_id = NEW.sender_user_id
      AND r.recipient_user_id = NEW.recipient_user_id
      AND r.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 day'));
  SELECT RAISE(ABORT, 'FRIEND_REQUEST_RATE_LIMITED') WHERE (SELECT COUNT(*) FROM chat_friend_requests r WHERE r.sender_user_id = NEW.sender_user_id
    AND r.created_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')) >= 10;
END;

CREATE TRIGGER chat_friend_accept_safety BEFORE UPDATE OF status ON chat_friend_requests
WHEN NEW.status = 'accepted'
BEGIN
  SELECT RAISE(ABORT, 'CHAT_CONTACT_BLOCKED') WHERE EXISTS (SELECT 1 FROM chat_user_blocks b
    WHERE (b.user_id = NEW.sender_user_id AND b.blocked_user_id = NEW.recipient_user_id)
      OR (b.user_id = NEW.recipient_user_id AND b.blocked_user_id = NEW.sender_user_id));
END;

CREATE TRIGGER chat_direct_membership_safety BEFORE INSERT ON chat_conversation_members
WHEN (SELECT kind FROM chat_conversations WHERE id = NEW.conversation_id) = 'direct'
BEGIN
  SELECT RAISE(ABORT, 'CHAT_CONTACT_BLOCKED') WHERE EXISTS (SELECT 1 FROM chat_conversation_members m JOIN chat_user_blocks b
    ON (b.user_id = NEW.user_id AND b.blocked_user_id = m.user_id)
      OR (b.user_id = m.user_id AND b.blocked_user_id = NEW.user_id)
    WHERE m.conversation_id = NEW.conversation_id AND m.user_id <> NEW.user_id AND m.left_at IS NULL);
END;

CREATE TRIGGER chat_direct_message_safety BEFORE INSERT ON chat_messages
WHEN (SELECT kind FROM chat_conversations WHERE id = NEW.conversation_id) = 'direct'
BEGIN
  SELECT RAISE(ABORT, 'CHAT_CONTACT_BLOCKED') WHERE EXISTS (SELECT 1 FROM chat_conversation_members m JOIN chat_user_blocks b
    ON (b.user_id = COALESCE(NEW.sender_user_id, (SELECT user_id FROM chat_devices WHERE id = NEW.sender_device_id)) AND b.blocked_user_id = m.user_id)
      OR (b.user_id = m.user_id AND b.blocked_user_id = COALESCE(NEW.sender_user_id, (SELECT user_id FROM chat_devices WHERE id = NEW.sender_device_id)))
    WHERE m.conversation_id = NEW.conversation_id AND m.left_at IS NULL
      AND m.user_id <> COALESCE(NEW.sender_user_id, (SELECT user_id FROM chat_devices WHERE id = NEW.sender_device_id)));
  SELECT RAISE(ABORT, 'CHAT_FRIENDSHIP_REQUIRED') WHERE EXISTS (SELECT 1 FROM chat_conversation_members m
    WHERE m.conversation_id = NEW.conversation_id AND m.left_at IS NULL
      AND m.user_id <> COALESCE(NEW.sender_user_id, (SELECT user_id FROM chat_devices WHERE id = NEW.sender_device_id))
      AND NOT EXISTS (SELECT 1 FROM chat_contacts c
        WHERE c.user_id = COALESCE(NEW.sender_user_id, (SELECT user_id FROM chat_devices WHERE id = NEW.sender_device_id))
          AND c.peer_user_id = m.user_id AND c.accepted_at IS NOT NULL));
END;
