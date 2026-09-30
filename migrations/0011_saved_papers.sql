CREATE TABLE saved_papers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT,
  curriculum_version_id TEXT REFERENCES curriculum_versions(id) ON DELETE SET NULL,
  build_mode TEXT NOT NULL CHECK (build_mode IN ('manual', 'smart', 'equivalent')),
  build_seed TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  total_marks INTEGER NOT NULL DEFAULT 0 CHECK (total_marks >= 0),
  settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  blueprint TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(blueprint)),
  parent_paper_id TEXT REFERENCES saved_papers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_saved_papers_user_updated
ON saved_papers(user_id, updated_at DESC);

CREATE INDEX idx_saved_papers_code
ON saved_papers(paper_code);

CREATE INDEX idx_saved_papers_parent
ON saved_papers(parent_paper_id);

CREATE TABLE saved_paper_items (
  paper_id TEXT NOT NULL REFERENCES saved_papers(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  marks INTEGER NOT NULL DEFAULT 1 CHECK (marks > 0),
  section_id TEXT REFERENCES coursebook_sections(id) ON DELETE SET NULL,
  source_group TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (paper_id, question_id),
  UNIQUE (paper_id, position)
);

CREATE INDEX idx_saved_paper_items_order
ON saved_paper_items(paper_id, position);
