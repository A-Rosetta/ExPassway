-- One shared cooldown for student AI hints and structured grading, with no
-- hourly quota. Existing event and attempt records remain intact.
CREATE TABLE ai_call_cooldowns (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  reservation_id TEXT NOT NULL,
  called_at INTEGER NOT NULL
);

INSERT INTO ai_call_cooldowns(user_id, reservation_id, called_at)
SELECT user_id, 'migration', MAX(CAST((julianday(created_at) - 2440587.5) * 86400000 AS INTEGER))
FROM (
  SELECT user_id, created_at FROM ai_hint_generation_events
  UNION ALL
  SELECT user_id, created_at FROM structured_practice_attempts WHERE ai_called = 1
)
GROUP BY user_id;
