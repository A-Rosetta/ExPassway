-- 9618 AS/A Level structured-question foundation.
-- Preserve question_bank itself: renaming it would retarget every existing
-- foreign key and dropping it could erase hint, mapping, and saved-paper rows.
-- Structured rows keep the legacy answer storage slot; APIs return null for it.
ALTER TABLE question_bank RENAME COLUMN answer TO legacy_answer;
ALTER TABLE question_bank ADD COLUMN answer INTEGER CHECK (answer IS NULL OR answer BETWEEN 0 AND 3);
UPDATE question_bank SET answer = legacy_answer;
ALTER TABLE question_bank ADD COLUMN question_type TEXT NOT NULL DEFAULT 'mcq'
  CHECK (question_type IN ('mcq', 'structured', 'practical'));
ALTER TABLE question_bank ADD COLUMN max_marks INTEGER NOT NULL DEFAULT 1 CHECK (max_marks > 0);
ALTER TABLE question_bank ADD COLUMN structured_content TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(structured_content));
ALTER TABLE question_bank ADD COLUMN mark_scheme TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(mark_scheme));
CREATE INDEX idx_qbank_subject_type ON question_bank(subject_code, question_type, active);

-- Nothing references exam_papers through a foreign key. Build the expanded
-- table alongside it and rename only the replacement after copying the data.
CREATE TABLE exam_papers_0019 (
  slug TEXT PRIMARY KEY,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2099),
  season TEXT NOT NULL CHECK (season IN ('m', 's', 'w')),
  paper_number INTEGER NOT NULL CHECK (paper_number BETWEEN 1 AND 4),
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
INSERT INTO exam_papers_0019 (
  slug, subject_code, year, season, paper_number, variant, paper_type,
  duration_minutes, source_question_count, valid_question_count, total_marks,
  discounted_questions, qp_file_name, ms_file_name, data_url, status, metadata,
  published_at, created_at, updated_at
)
SELECT slug, subject_code, year, season, paper_number, variant, paper_type,
  duration_minutes, source_question_count, valid_question_count, valid_question_count,
  discounted_questions, qp_file_name, ms_file_name, data_url, status, metadata,
  published_at, created_at, updated_at
FROM exam_papers;
DROP TABLE exam_papers;
ALTER TABLE exam_papers_0019 RENAME TO exam_papers;
CREATE INDEX idx_exam_papers_subject_status
ON exam_papers(subject_code, status, year, season, paper_number, variant);
CREATE TABLE IF NOT EXISTS exam_subject_components (
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE CASCADE,
  paper_number INTEGER NOT NULL CHECK (paper_number BETWEEN 1 AND 4),
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

CREATE TABLE IF NOT EXISTS subject_resources (
  id TEXT PRIMARY KEY,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('syllabus', 'textbook', 'insert', 'source', 'qp', 'ms', 'other')),
  title TEXT NOT NULL,
  title_zh TEXT,
  version TEXT,
  exam_year_start INTEGER CHECK (exam_year_start IS NULL OR exam_year_start BETWEEN 2000 AND 2099),
  exam_year_end INTEGER CHECK (exam_year_end IS NULL OR exam_year_end BETWEEN exam_year_start AND 2099),
  paper_slug TEXT,
  storage_key TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'archived')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_subject_resources_lookup
ON subject_resources(subject_code, status, kind, exam_year_start, exam_year_end);

INSERT INTO exam_subjects (code, board, qualification, name, name_zh, asset_key, active)
VALUES ('9618', 'CIE', 'AS & A Level', 'Computer Science', '计算机科学', 'computer-science-9618', 1)
ON CONFLICT(code) DO UPDATE SET
  board = excluded.board,
  qualification = excluded.qualification,
  name = excluded.name,
  name_zh = excluded.name_zh,
  asset_key = excluded.asset_key,
  active = 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

INSERT INTO exam_subject_components
  (subject_code, paper_number, name, name_zh, paper_type, question_type, duration_minutes, total_marks, capabilities)
VALUES
  ('9618', 1, 'Theory Fundamentals', '理论基础', 'structured', 'structured', 90, 75, '{"manualPaperBuilder":true,"smartPaperBuilder":false,"onlinePractice":false,"aiHints":false}'),
  ('9618', 2, 'Fundamental Problem-solving and Programming Skills', '基础问题解决与编程技能', 'structured', 'structured', 120, 75, '{"manualPaperBuilder":true,"smartPaperBuilder":false,"onlinePractice":false,"aiHints":false}'),
  ('9618', 3, 'Advanced Theory', '高级理论', 'structured', 'structured', 90, 75, '{"manualPaperBuilder":true,"smartPaperBuilder":false,"onlinePractice":false,"aiHints":false}'),
  ('9618', 4, 'Practical', '实践', 'practical', 'practical', 150, 75, '{"manualPaperBuilder":false,"smartPaperBuilder":false,"onlinePractice":false,"aiHints":false}')
ON CONFLICT(subject_code, paper_number) DO UPDATE SET
  name = excluded.name, name_zh = excluded.name_zh, paper_type = excluded.paper_type,
  question_type = excluded.question_type, duration_minutes = excluded.duration_minutes,
  total_marks = excluded.total_marks, capabilities = excluded.capabilities;
