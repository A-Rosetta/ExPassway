-- D1 (SQLite) migration: extend wrong_notebook_entries with mistake reasons,
-- starred bookmark, note, and last redone timestamp.
--
-- Deployment:
--   wrangler d1 execute expassway-db --file=migrations/0004_wrong_notebook_extend.sql --remote

ALTER TABLE wrong_notebook_entries ADD COLUMN mistake_type TEXT NOT NULL DEFAULT 'unknown'
  CHECK (mistake_type IN ('concept','calculation','question_reading','careless','time_pressure','unknown'));

ALTER TABLE wrong_notebook_entries ADD COLUMN mistake_reasons TEXT NOT NULL DEFAULT '[]'
  CHECK (json_valid(mistake_reasons));

ALTER TABLE wrong_notebook_entries ADD COLUMN starred INTEGER NOT NULL DEFAULT 0
  CHECK (starred IN (0, 1));

ALTER TABLE wrong_notebook_entries ADD COLUMN note TEXT NOT NULL DEFAULT '';

ALTER TABLE wrong_notebook_entries ADD COLUMN last_redone_at TEXT;

CREATE INDEX IF NOT EXISTS idx_wrong_notebook_starred
  ON wrong_notebook_entries(user_id, starred) WHERE starred = 1;

CREATE INDEX IF NOT EXISTS idx_wrong_notebook_mistake_type
  ON wrong_notebook_entries(user_id, mistake_type);
