-- Original-paper archives for five Cambridge AS & A Level subjects.
-- Keep the existing papers and structured-practice attempts intact while
-- allowing Paper 5. The replacement attempt table initially references the
-- replacement paper table; SQLite updates that reference when it is renamed.
-- Never rename the old paper table, which would retarget existing foreign keys.
PRAGMA foreign_keys = ON;

CREATE TABLE exam_papers_0028 (
  slug TEXT PRIMARY KEY,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2099),
  season TEXT NOT NULL CHECK (season IN ('m', 's', 'w')),
  paper_number INTEGER NOT NULL CHECK (paper_number BETWEEN 1 AND 5),
  variant INTEGER NOT NULL CHECK (variant BETWEEN 1 AND 9),
  paper_type TEXT NOT NULL DEFAULT 'MCQ',
  duration_minutes INTEGER NOT NULL DEFAULT 45 CHECK (duration_minutes > 0),
  source_question_count INTEGER NOT NULL DEFAULT 40 CHECK (source_question_count > 0),
  valid_question_count INTEGER NOT NULL DEFAULT 40 CHECK (valid_question_count >= 0),
  total_marks INTEGER CHECK (total_marks IS NULL OR total_marks > 0),
  discounted_questions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(discounted_questions)),
  qp_file_name TEXT NOT NULL,
  ms_file_name TEXT NOT NULL,
  data_url TEXT,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'rejected')),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (subject_code, year, season, paper_number, variant)
);
INSERT INTO exam_papers_0028 (
  slug, subject_code, year, season, paper_number, variant, paper_type,
  duration_minutes, source_question_count, valid_question_count, total_marks,
  discounted_questions, qp_file_name, ms_file_name, data_url, status, metadata,
  published_at, created_at, updated_at
)
SELECT slug, subject_code, year, season, paper_number, variant, paper_type,
  duration_minutes, source_question_count, valid_question_count, total_marks,
  discounted_questions, qp_file_name, ms_file_name, data_url, status, metadata,
  published_at, created_at, updated_at
FROM exam_papers;

CREATE TABLE structured_practice_attempts_0028 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  paper_slug TEXT NOT NULL REFERENCES exam_papers_0028(slug) ON DELETE RESTRICT,
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
INSERT INTO structured_practice_attempts_0028 (
  id, user_id, request_id, question_id, paper_slug, input_hash,
  question_fingerprint, language, answers, status, ai_called, result, model,
  response_id, error_code, error_message, error_status, created_at, updated_at,
  completed_at
)
SELECT id, user_id, request_id, question_id, paper_slug, input_hash,
  question_fingerprint, language, answers, status, ai_called, result, model,
  response_id, error_code, error_message, error_status, created_at, updated_at,
  completed_at
FROM structured_practice_attempts;
DROP TABLE structured_practice_attempts;
DROP TABLE exam_papers;
ALTER TABLE exam_papers_0028 RENAME TO exam_papers;
ALTER TABLE structured_practice_attempts_0028 RENAME TO structured_practice_attempts;
CREATE INDEX idx_exam_papers_subject_status
ON exam_papers(subject_code, status, year, season, paper_number, variant);
CREATE INDEX idx_structured_practice_user_question
ON structured_practice_attempts(user_id, question_id, status, created_at DESC);
CREATE INDEX idx_structured_practice_user_rate
ON structured_practice_attempts(user_id, ai_called, created_at DESC);

CREATE TABLE exam_subject_components_0028 (
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE CASCADE,
  paper_number INTEGER NOT NULL CHECK (paper_number BETWEEN 1 AND 5),
  name TEXT NOT NULL,
  name_zh TEXT,
  paper_type TEXT NOT NULL DEFAULT 'structured',
  question_type TEXT NOT NULL DEFAULT 'structured' CHECK (question_type IN ('mcq', 'structured', 'practical')),
  duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
  total_marks INTEGER NOT NULL CHECK (total_marks > 0),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  capabilities TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(capabilities)),
  PRIMARY KEY (subject_code, paper_number)
);
INSERT INTO exam_subject_components_0028 (
  subject_code, paper_number, name, name_zh, paper_type, question_type,
  duration_minutes, total_marks, enabled, capabilities
)
SELECT subject_code, paper_number, name, name_zh, paper_type, question_type,
  duration_minutes, total_marks, enabled, capabilities
FROM exam_subject_components;
DROP TABLE exam_subject_components;
ALTER TABLE exam_subject_components_0028 RENAME TO exam_subject_components;

INSERT INTO exam_subjects (code, board, qualification, name, name_zh, asset_key, active)
VALUES
  ('9702', 'CIE', 'AS & A Level', 'Physics', '物理', 'physics-9702', 1),
  ('9701', 'CIE', 'AS & A Level', 'Chemistry', '化学', 'chemistry-9701', 1),
  ('9708', 'CIE', 'AS & A Level', 'Economics', '经济学', 'economics-9708', 1),
  ('9700', 'CIE', 'AS & A Level', 'Biology', '生物', 'biology-9700', 1),
  ('9696', 'CIE', 'AS & A Level', 'Geography', '地理', 'geography-9696', 1)
ON CONFLICT(code) DO UPDATE SET
  board = excluded.board, qualification = excluded.qualification,
  name = excluded.name, name_zh = excluded.name_zh, asset_key = excluded.asset_key,
  active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- Official current syllabuses, assessment overview:
-- https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf (p11)
-- https://www.cambridgeinternational.org/Images/664563-2025-2027-syllabus.pdf (p11)
-- https://www.cambridgeinternational.org/Images/664560-2025-2027-syllabus.pdf (p10)
-- https://www.cambridgeinternational.org/Images/697423-2026-2028-syllabus.pdf (p11)
-- https://www.cambridgeinternational.org/Images/718332-2027-2029-syllabus.pdf (p10)
-- Historical paper names, duration and marks stay on individual paper records.
-- This release publishes originals only, so practice and builder capabilities
-- stay disabled until reviewed, complete question-bank content is imported.
INSERT INTO exam_subject_components
  (subject_code, paper_number, name, name_zh, paper_type, question_type, duration_minutes, total_marks, capabilities)
SELECT subject.code, component.paper_number, component.name, component.name_zh,
  component.paper_type, component.question_type, component.duration_minutes,
  component.total_marks,
  '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'
FROM (SELECT '9702' AS code UNION ALL SELECT '9701' UNION ALL SELECT '9700') subject
CROSS JOIN (
  SELECT 1 AS paper_number, 'Multiple Choice' AS name, '选择题' AS name_zh,
    'mcq' AS paper_type, 'mcq' AS question_type, 75 AS duration_minutes, 40 AS total_marks
  UNION ALL SELECT 2, 'AS Level Structured Questions', 'AS 结构化试题', 'structured', 'structured', 75, 60
  UNION ALL SELECT 3, 'Advanced Practical Skills', '高级实验技能', 'practical', 'practical', 120, 40
  UNION ALL SELECT 4, 'A Level Structured Questions', 'A Level 结构化试题', 'structured', 'structured', 120, 100
  UNION ALL SELECT 5, 'Planning, Analysis and Evaluation', '规划、分析与评价', 'structured', 'structured', 75, 30
) component
WHERE 1
ON CONFLICT(subject_code, paper_number) DO UPDATE SET
  name = excluded.name, name_zh = excluded.name_zh, paper_type = excluded.paper_type,
  question_type = excluded.question_type, duration_minutes = excluded.duration_minutes,
  total_marks = excluded.total_marks, capabilities = excluded.capabilities;

INSERT INTO exam_subject_components
  (subject_code, paper_number, name, name_zh, paper_type, question_type, duration_minutes, total_marks, capabilities)
VALUES
  ('9708', 1, 'AS Level Multiple Choice', 'AS 选择题', 'mcq', 'mcq', 60, 30, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'),
  ('9708', 2, 'AS Level Data Response and Essays', 'AS 数据分析与论述', 'structured', 'structured', 120, 60, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'),
  ('9708', 3, 'A Level Multiple Choice', 'A Level 选择题', 'mcq', 'mcq', 75, 30, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'),
  ('9708', 4, 'A Level Data Response and Essays', 'A Level 数据分析与论述', 'structured', 'structured', 120, 60, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'),
  ('9696', 1, 'Physical Geography', '自然地理', 'structured', 'structured', 90, 60, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'),
  ('9696', 2, 'Human Geography', '人文地理', 'structured', 'structured', 90, 60, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'),
  ('9696', 3, 'Global Environments', '全球环境', 'structured', 'structured', 90, 60, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}'),
  ('9696', 4, 'Global Themes', '全球议题', 'structured', 'structured', 90, 60, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"structuredAiGrading":false,"aiHints":false}')
ON CONFLICT(subject_code, paper_number) DO UPDATE SET
  name = excluded.name, name_zh = excluded.name_zh, paper_type = excluded.paper_type,
  question_type = excluded.question_type, duration_minutes = excluded.duration_minutes,
  total_marks = excluded.total_marks, capabilities = excluded.capabilities;
