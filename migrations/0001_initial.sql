PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student'
    CHECK (role IN ('student', 'teacher', 'parent', 'admin')),
  grade TEXT,
  target_score INTEGER CHECK (target_score BETWEEN 0 AND 100),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  password_hash TEXT,
  language TEXT NOT NULL DEFAULT 'en',
  disabled_at TEXT,
  pet_enabled INTEGER NOT NULL DEFAULT 1 CHECK (pet_enabled IN (0, 1)),
  pet_skin TEXT NOT NULL DEFAULT 'codex-glass',
  pet_position_x REAL NOT NULL DEFAULT 0.92 CHECK (pet_position_x BETWEEN 0 AND 1),
  pet_position_y REAL NOT NULL DEFAULT 0.84 CHECK (pet_position_y BETWEEN 0 AND 1)
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_created_at ON users(created_at DESC);

CREATE TABLE exam_subjects (
  code TEXT PRIMARY KEY CHECK (code GLOB '[0-9][0-9][0-9][0-9]'),
  board TEXT NOT NULL DEFAULT 'CIE',
  qualification TEXT NOT NULL DEFAULT 'IGCSE',
  name TEXT NOT NULL,
  name_zh TEXT,
  asset_key TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE exam_papers (
  slug TEXT PRIMARY KEY,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT,
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2099),
  season TEXT NOT NULL CHECK (season IN ('m', 's', 'w')),
  paper_number INTEGER NOT NULL CHECK (paper_number IN (1, 2)),
  variant INTEGER NOT NULL CHECK (variant BETWEEN 1 AND 9),
  paper_type TEXT NOT NULL DEFAULT 'MCQ',
  duration_minutes INTEGER NOT NULL DEFAULT 45 CHECK (duration_minutes > 0),
  source_question_count INTEGER NOT NULL DEFAULT 40 CHECK (source_question_count > 0),
  valid_question_count INTEGER NOT NULL DEFAULT 40 CHECK (valid_question_count > 0),
  discounted_questions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(discounted_questions)),
  qp_file_name TEXT NOT NULL,
  ms_file_name TEXT NOT NULL,
  data_url TEXT,
  status TEXT NOT NULL DEFAULT 'published'
    CHECK (status IN ('draft', 'published', 'rejected')),
  metadata TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata)),
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (subject_code, year, season, paper_number, variant)
);

CREATE INDEX idx_exam_papers_subject_status
ON exam_papers(subject_code, status, year, season, paper_number, variant);

CREATE TABLE question_bank (
  id TEXT PRIMARY KEY,
  board TEXT NOT NULL,
  subject TEXT NOT NULL,
  paper TEXT NOT NULL,
  difficulty TEXT,
  topic TEXT,
  year TEXT,
  stem TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options)),
  answer INTEGER NOT NULL DEFAULT 0,
  mistake_type TEXT NOT NULL DEFAULT 'unknown',
  template_id TEXT,
  skills TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(skills)),
  hints TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(hints)),
  images TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(images)),
  source TEXT CHECK (source IS NULL OR json_valid(source)),
  subject_code TEXT,
  paper_slug TEXT,
  question_no INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);

CREATE INDEX idx_qbank_selection ON question_bank(board, subject, paper);
CREATE INDEX idx_qbank_year ON question_bank(year);
CREATE INDEX idx_qbank_paper_question ON question_bank(paper_slug, question_no);
CREATE INDEX idx_qbank_active_selection ON question_bank(active, board, subject, paper);

CREATE TABLE practice_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  grade TEXT,
  board TEXT NOT NULL,
  subject TEXT NOT NULL,
  paper TEXT NOT NULL,
  difficulty TEXT,
  topics TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(topics)),
  requested_count INTEGER NOT NULL DEFAULT 8 CHECK (requested_count BETWEEN 1 AND 100),
  fallback_applied INTEGER NOT NULL DEFAULT 0 CHECK (fallback_applied IN (0, 1)),
  generated_questions TEXT NOT NULL CHECK (json_valid(generated_questions)),
  answers TEXT CHECK (answers IS NULL OR json_valid(answers)),
  result TEXT CHECK (result IS NULL OR json_valid(result)),
  wrong_log TEXT CHECK (wrong_log IS NULL OR json_valid(wrong_log)),
  status TEXT NOT NULL DEFAULT 'generated' CHECK (status IN ('generated', 'submitted')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  submitted_at TEXT,
  practice_mode TEXT NOT NULL DEFAULT 'paper'
    CHECK (practice_mode IN ('paper', 'chapter', 'review'))
);

CREATE INDEX idx_practice_user_created ON practice_sessions(user_id, created_at DESC);
CREATE INDEX idx_practice_status ON practice_sessions(status);
CREATE INDEX idx_practice_board_subject_paper ON practice_sessions(board, subject, paper);

CREATE TABLE wrong_notebook_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  board TEXT,
  subject TEXT,
  paper TEXT,
  topic TEXT,
  year TEXT,
  stem TEXT,
  answer INTEGER,
  answer_text TEXT,
  last_selected INTEGER,
  last_selected_text TEXT,
  wrong_count INTEGER NOT NULL DEFAULT 1 CHECK (wrong_count >= 1),
  first_wrong_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_wrong_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  mastered INTEGER NOT NULL DEFAULT 0 CHECK (mastered IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (user_id, question_key)
);

CREATE INDEX idx_wrong_notebook_user_last_wrong
ON wrong_notebook_entries(user_id, last_wrong_at DESC);

CREATE TABLE discussion_threads (
  id TEXT PRIMARY KEY,
  question_key TEXT,
  title TEXT NOT NULL,
  board TEXT,
  subject TEXT,
  paper TEXT,
  topic TEXT,
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'solved', 'locked', 'hidden')),
  sticky INTEGER NOT NULL DEFAULT 0 CHECK (sticky IN (0, 1)),
  approved INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0, 1)),
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_post_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  subject_code TEXT,
  paper_slug TEXT,
  question_no INTEGER
);

CREATE INDEX idx_discussion_threads_question
ON discussion_threads(question_key, last_post_at DESC);
CREATE INDEX idx_discussion_threads_filters
ON discussion_threads(subject, paper, topic, status, last_post_at DESC);
CREATE INDEX idx_discussion_threads_paper_question
ON discussion_threads(paper_slug, question_no, last_post_at DESC);

CREATE TABLE discussion_posts (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  approved INTEGER NOT NULL DEFAULT 1 CHECK (approved IN (0, 1)),
  hidden INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_discussion_posts_thread_created
ON discussion_posts(thread_id, created_at ASC);

CREATE TABLE discussion_post_likes (
  post_id TEXT NOT NULL REFERENCES discussion_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (post_id, user_id)
);

CREATE TABLE discussion_thread_follows (
  thread_id TEXT NOT NULL REFERENCES discussion_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE discussion_flags (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES discussion_posts(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (post_id, user_id)
);

CREATE TABLE question_hint_sets (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  language TEXT NOT NULL CHECK (language IN ('zh-CN', 'en')),
  prompt_version TEXT NOT NULL,
  question_fingerprint TEXT NOT NULL,
  hints TEXT NOT NULL CHECK (json_valid(hints)),
  status TEXT NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  model TEXT NOT NULL,
  response_id TEXT,
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (question_id, language, prompt_version, question_fingerprint)
);

CREATE INDEX idx_question_hint_sets_lookup
ON question_hint_sets(question_id, language, prompt_version, question_fingerprint, status);
CREATE INDEX idx_question_hint_sets_review
ON question_hint_sets(status, created_at DESC);

CREATE TABLE exam_import_jobs (
  id TEXT PRIMARY KEY,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'uploading'
    CHECK (status IN ('uploading', 'processing', 'validated', 'published', 'failed')),
  input_dir TEXT NOT NULL,
  staging_dir TEXT NOT NULL,
  manifest_path TEXT,
  summary TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at TEXT,
  completed_at TEXT,
  published_at TEXT
);

CREATE TABLE exam_import_files (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES exam_import_jobs(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL CHECK (document_type IN ('qp', 'ms')),
  paper_slug TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size > 0),
  sha256 TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (job_id, file_name)
);

CREATE INDEX idx_exam_import_files_job ON exam_import_files(job_id);

CREATE TABLE exam_import_issues (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES exam_import_jobs(id) ON DELETE CASCADE,
  paper_slug TEXT,
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('warning', 'error')),
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(details)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_exam_import_issues_job ON exam_import_issues(job_id, severity);

CREATE TABLE question_import_jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  input_dir TEXT NOT NULL,
  output_json TEXT NOT NULL,
  report_json TEXT NOT NULL,
  total_candidates INTEGER NOT NULL DEFAULT 0,
  published_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(summary)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT
);

CREATE TABLE question_review_queue (
  id TEXT PRIMARY KEY,
  job_id TEXT REFERENCES question_import_jobs(id) ON DELETE SET NULL,
  question_id TEXT,
  board TEXT,
  subject TEXT,
  paper TEXT,
  year TEXT,
  source_file TEXT,
  question_no INTEGER,
  stem TEXT,
  options TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(options)),
  images TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(images)),
  reasons TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(reasons)),
  quality TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(quality)),
  source TEXT CHECK (source IS NULL OR json_valid(source)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_qreview_job ON question_review_queue(job_id);
CREATE INDEX idx_qreview_file_qno ON question_review_queue(source_file, question_no);

CREATE TABLE curriculum_versions (
  id TEXT PRIMARY KEY,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT,
  qualification TEXT NOT NULL,
  exam_year_start INTEGER NOT NULL CHECK (exam_year_start BETWEEN 2000 AND 2099),
  exam_year_end INTEGER NOT NULL CHECK (exam_year_end BETWEEN exam_year_start AND 2099),
  version TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (subject_code, exam_year_start, exam_year_end, version)
);

CREATE UNIQUE INDEX idx_curriculum_one_active_version
ON curriculum_versions(subject_code) WHERE active = 1;

CREATE TABLE curriculum_sections (
  id TEXT PRIMARY KEY,
  curriculum_version_id TEXT NOT NULL REFERENCES curriculum_versions(id) ON DELETE CASCADE,
  syllabus_code TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_zh TEXT,
  level TEXT NOT NULL CHECK (level IN ('topic', 'section', 'statement')),
  parent_id TEXT REFERENCES curriculum_sections(id) ON DELETE CASCADE,
  core_level TEXT CHECK (core_level IN ('core', 'supplement')),
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (curriculum_version_id, syllabus_code)
);

CREATE INDEX idx_curriculum_sections_tree
ON curriculum_sections(curriculum_version_id, parent_id, sort_order);

CREATE TABLE coursebook_chapters (
  id TEXT PRIMARY KEY,
  book_key TEXT NOT NULL,
  chapter_no INTEGER NOT NULL CHECK (chapter_no > 0),
  title_en TEXT NOT NULL,
  title_zh TEXT,
  pdf_start_page INTEGER,
  pdf_end_page INTEGER,
  printed_start_page INTEGER,
  printed_end_page INTEGER,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (book_key, chapter_no)
);

CREATE TABLE coursebook_sections (
  id TEXT PRIMARY KEY,
  coursebook_chapter_id TEXT NOT NULL REFERENCES coursebook_chapters(id) ON DELETE CASCADE,
  section_code TEXT NOT NULL,
  title_en TEXT NOT NULL,
  title_zh TEXT,
  pdf_start_page INTEGER,
  pdf_end_page INTEGER,
  printed_start_page INTEGER,
  printed_end_page INTEGER,
  sort_order INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (coursebook_chapter_id, section_code)
);

CREATE INDEX idx_coursebook_sections_chapter
ON coursebook_sections(coursebook_chapter_id, sort_order);

CREATE TABLE coursebook_section_mappings (
  coursebook_section_id TEXT NOT NULL REFERENCES coursebook_sections(id) ON DELETE CASCADE,
  curriculum_section_id TEXT NOT NULL REFERENCES curriculum_sections(id) ON DELETE CASCADE,
  PRIMARY KEY (coursebook_section_id, curriculum_section_id)
);

CREATE TABLE question_section_mappings (
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE CASCADE,
  curriculum_section_id TEXT NOT NULL REFERENCES curriculum_sections(id) ON DELETE CASCADE,
  coursebook_section_id TEXT REFERENCES coursebook_sections(id) ON DELETE SET NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  confidence REAL CHECK (confidence BETWEEN 0 AND 1),
  status TEXT NOT NULL DEFAULT 'suggested' CHECK (status IN ('suggested', 'reviewed', 'rejected')),
  reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('model', 'rule', 'manual')),
  similar_question_group TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (question_id, curriculum_section_id)
);

CREATE UNIQUE INDEX idx_question_one_reviewed_primary
ON question_section_mappings(question_id) WHERE is_primary = 1 AND status = 'reviewed';
CREATE INDEX idx_question_section_public_pool
ON question_section_mappings(coursebook_section_id, status, is_primary);

CREATE TABLE question_attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
  practice_session_id TEXT REFERENCES practice_sessions(id) ON DELETE SET NULL,
  curriculum_section_id TEXT NOT NULL REFERENCES curriculum_sections(id) ON DELETE RESTRICT,
  coursebook_section_id TEXT NOT NULL REFERENCES coursebook_sections(id) ON DELETE RESTRICT,
  mode TEXT NOT NULL CHECK (mode IN ('chapter', 'paper', 'review')),
  selected_index INTEGER NOT NULL CHECK (selected_index BETWEEN -1 AND 20),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  first_exposure INTEGER NOT NULL CHECK (first_exposure IN (0, 1)),
  elapsed_seconds INTEGER NOT NULL DEFAULT 0 CHECK (elapsed_seconds >= 0),
  hints_used INTEGER NOT NULL DEFAULT 0 CHECK (hints_used >= 0),
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  similar_question_group TEXT,
  UNIQUE (practice_session_id, question_id)
);

CREATE INDEX idx_question_attempts_user_question
ON question_attempts(user_id, question_id, attempted_at);
CREATE UNIQUE INDEX idx_question_one_first_exposure
ON question_attempts(user_id, question_id)
WHERE first_exposure = 1 AND similar_question_group IS NULL;
CREATE UNIQUE INDEX idx_question_group_one_first_exposure
ON question_attempts(user_id, similar_question_group)
WHERE first_exposure = 1 AND similar_question_group IS NOT NULL;
CREATE INDEX idx_question_attempts_user_coursebook
ON question_attempts(user_id, coursebook_section_id, attempted_at);

CREATE VIEW user_practice_summary AS
SELECT
  user_id,
  COUNT(*) AS total_sessions,
  SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted_sessions,
  ROUND(AVG(CAST(json_extract(result, '$.accuracy') AS REAL)), 2) AS avg_accuracy,
  MAX(submitted_at) AS last_submitted_at
FROM practice_sessions
GROUP BY user_id;
