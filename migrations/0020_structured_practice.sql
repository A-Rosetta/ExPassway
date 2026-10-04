-- Structured AI grading has its own records and never writes MCQ attempts.
CREATE TABLE structured_practice_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  paper_slug TEXT NOT NULL REFERENCES exam_papers(slug) ON DELETE RESTRICT,
  input_hash TEXT NOT NULL,
  question_fingerprint TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('en', 'zh-CN')),
  answers TEXT NOT NULL CHECK (json_valid(answers)),
  status TEXT NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
  ai_called INTEGER NOT NULL DEFAULT 1 CHECK (ai_called IN (0, 1)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  model TEXT,
  response_id TEXT,
  error_code TEXT,
  error_message TEXT,
  error_status INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  UNIQUE(user_id, request_id)
);

CREATE INDEX idx_structured_practice_user_question
ON structured_practice_attempts(user_id, question_id, status, created_at DESC);
CREATE INDEX idx_structured_practice_user_rate
ON structured_practice_attempts(user_id, ai_called, created_at DESC);

UPDATE exam_subject_components
SET capabilities = json_set(capabilities, '$.onlinePractice', json('true'), '$.structuredAiGrading', json('true'))
WHERE subject_code = '9618' AND paper_number BETWEEN 1 AND 3;
