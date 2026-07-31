PRAGMA foreign_keys = ON;

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL CHECK (json_valid(value)),
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO app_settings (key, value)
VALUES ('ai_hint_live_generation', 'false');

CREATE TABLE admin_audit_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_admin_audit_events_created
ON admin_audit_events(created_at DESC);

CREATE INDEX idx_admin_audit_events_target
ON admin_audit_events(target_type, target_id, created_at DESC);

CREATE TABLE community_mutes (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted_until TEXT NOT NULL,
  reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_community_mutes_until
ON community_mutes(muted_until);

CREATE TABLE ai_hint_generation_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_ai_hint_generation_user_created
ON ai_hint_generation_events(user_id, created_at DESC);

ALTER TABLE discussion_flags ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'
  CHECK (status IN ('pending', 'resolved', 'dismissed'));
ALTER TABLE discussion_flags ADD COLUMN resolved_at TEXT;
ALTER TABLE discussion_flags ADD COLUMN resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_discussion_flags_status_created
ON discussion_flags(status, created_at DESC);

ALTER TABLE exam_import_jobs ADD COLUMN cancelled_at TEXT;
ALTER TABLE exam_import_jobs ADD COLUMN hidden_at TEXT;

CREATE INDEX idx_exam_import_jobs_visibility_created
ON exam_import_jobs(hidden_at, created_at DESC);
