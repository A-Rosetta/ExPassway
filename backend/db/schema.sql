-- Enable UUID generation helper.
create extension if not exists pgcrypto;

-- Application users.
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text not null,
  password_hash text,
  role text not null default 'student' check (role in ('student', 'teacher', 'parent', 'admin')),
  grade text,
  target_score integer check (target_score between 0 and 100),
  language text not null default 'en',
  pet_enabled boolean not null default true,
  pet_skin text not null default 'codex-glass',
  pet_position_x numeric(6, 5) not null default 0.92 check (pet_position_x between 0 and 1),
  pet_position_y numeric(6, 5) not null default 0.84 check (pet_position_y between 0 and 1),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table users
add column if not exists password_hash text;

alter table users
add column if not exists language text not null default 'en';

alter table users
alter column language set default 'en';

alter table users
add column if not exists disabled_at timestamptz;

alter table users
add column if not exists pet_enabled boolean not null default true;

alter table users
add column if not exists pet_skin text not null default 'codex-glass';

alter table users
add column if not exists pet_position_x numeric(6, 5) not null default 0.92;

alter table users
add column if not exists pet_position_y numeric(6, 5) not null default 0.84;

alter table users
drop constraint if exists users_pet_position_x_check;

alter table users
add constraint users_pet_position_x_check check (pet_position_x between 0 and 1);

alter table users
drop constraint if exists users_pet_position_y_check;

alter table users
add constraint users_pet_position_y_check check (pet_position_y between 0 and 1);

alter table users
drop constraint if exists users_role_check;

alter table users
add constraint users_role_check check (role in ('student', 'teacher', 'parent', 'admin'));

create index if not exists idx_users_role on users(role);
create index if not exists idx_users_created_at on users(created_at desc);

-- Generated papers and submitted practice records.
create table if not exists practice_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,

  grade text,
  board text not null,
  subject text not null,
  paper text not null,

  difficulty text,
  topics text[] not null default '{}',
  requested_count integer not null default 8 check (requested_count between 1 and 100),
  fallback_applied boolean not null default false,

  generated_questions jsonb not null,
  answers integer[],
  result jsonb,
  wrong_log jsonb,

  status text not null default 'generated' check (status in ('generated', 'submitted')),
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create index if not exists idx_practice_user_created on practice_sessions(user_id, created_at desc);
create index if not exists idx_practice_status on practice_sessions(status);
create index if not exists idx_practice_board_subject_paper on practice_sessions(board, subject, paper);
create index if not exists idx_practice_topics_gin on practice_sessions using gin(topics);

-- Per-user wrong notebook entries aggregated across submitted practices.
create table if not exists wrong_notebook_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  question_key text not null,
  board text,
  subject text,
  paper text,
  topic text,
  year text,
  stem text,
  answer integer,
  answer_text text,
  last_selected integer,
  last_selected_text text,
  wrong_count integer not null default 1 check (wrong_count >= 1),
  first_wrong_at timestamptz not null default now(),
  last_wrong_at timestamptz not null default now(),
  mastered boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, question_key)
);

create index if not exists idx_wrong_notebook_user_last_wrong
on wrong_notebook_entries(user_id, last_wrong_at desc);

-- Flarum-inspired learning discussions linked to questions and topics.
create table if not exists discussion_threads (
  id uuid primary key default gen_random_uuid(),
  question_key text,
  title text not null,
  board text,
  subject text,
  paper text,
  topic text,
  tags text[] not null default '{}',
  status text not null default 'open' check (status in ('open', 'solved', 'locked', 'hidden')),
  sticky boolean not null default false,
  approved boolean not null default true,
  author_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_post_at timestamptz not null default now()
);

create index if not exists idx_discussion_threads_question
on discussion_threads(question_key, last_post_at desc);

create index if not exists idx_discussion_threads_filters
on discussion_threads(subject, paper, topic, status, last_post_at desc);

create index if not exists idx_discussion_threads_tags
on discussion_threads using gin(tags);

create table if not exists discussion_posts (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references discussion_threads(id) on delete cascade,
  author_id uuid references users(id) on delete set null,
  body text not null,
  approved boolean not null default true,
  hidden boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_discussion_posts_thread_created
on discussion_posts(thread_id, created_at asc);

create table if not exists discussion_post_likes (
  post_id uuid not null references discussion_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table if not exists discussion_thread_follows (
  thread_id uuid not null references discussion_threads(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table if not exists discussion_flags (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references discussion_posts(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  reason text,
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);

-- Convenience analytics view for per-user practice summary.
create or replace view user_practice_summary as
select
  user_id,
  count(*) as total_sessions,
  count(*) filter (where status = 'submitted') as submitted_sessions,
  round(avg((result ->> 'accuracy')::numeric), 2) as avg_accuracy,
  max(submitted_at) as last_submitted_at
from practice_sessions
group by user_id;


-- Published exam catalogue. Frontend subject and paper selectors are driven by these rows.
create table if not exists exam_subjects (
  code text primary key check (code ~ '^\d{4}$'),
  board text not null default 'CIE',
  qualification text not null default 'IGCSE',
  name text not null,
  name_zh text,
  asset_key text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists exam_papers (
  slug text primary key,
  subject_code text not null references exam_subjects(code) on delete restrict,
  year integer not null check (year between 2000 and 2099),
  season text not null check (season in ('m', 's', 'w')),
  paper_number integer not null check (paper_number in (1, 2)),
  variant integer not null check (variant between 1 and 9),
  paper_type text not null default 'MCQ',
  duration_minutes integer not null default 45 check (duration_minutes > 0),
  source_question_count integer not null default 40 check (source_question_count > 0),
  valid_question_count integer not null default 40 check (valid_question_count > 0),
  discounted_questions integer[] not null default '{}',
  qp_file_name text not null,
  ms_file_name text not null,
  data_url text,
  status text not null default 'published' check (status in ('draft', 'published', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_code, year, season, paper_number, variant)
);

alter table exam_papers drop constraint if exists exam_papers_paper_number_check;
alter table exam_papers add constraint exam_papers_paper_number_check
check (paper_number in (1, 2));

create index if not exists idx_exam_papers_subject_status
on exam_papers(subject_code, status, year, season, paper_number, variant);

-- Question bank storage (DB-first mode).
create table if not exists question_bank (
  id text primary key,
  board text not null,
  subject text not null,
  paper text not null,
  difficulty text,
  topic text,
  year text,
  stem text not null,
  options jsonb not null default '[]'::jsonb,
  answer integer not null default 0,
  mistake_type text not null default 'unknown',
  template_id text,
  skills jsonb not null default '[]'::jsonb,
  hints jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  source jsonb
);

alter table question_bank add column if not exists subject_code text;
alter table question_bank add column if not exists paper_slug text;
alter table question_bank add column if not exists question_no integer;
alter table question_bank add column if not exists active boolean not null default true;

create index if not exists idx_qbank_selection on question_bank(board, subject, paper);
create index if not exists idx_qbank_year on question_bank(year);
create index if not exists idx_qbank_paper_question on question_bank(paper_slug, question_no);
create index if not exists idx_qbank_active_selection
on question_bank(active, board, subject, paper);

-- Versioned AI hints are kept separate from imported question data.
create table if not exists question_hint_sets (
  id uuid primary key default gen_random_uuid(),
  question_id text not null references question_bank(id) on delete cascade,
  language text not null check (language in ('zh-CN', 'en')),
  prompt_version text not null,
  question_fingerprint text not null,
  hints jsonb not null,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'approved', 'rejected')),
  model text not null,
  response_id text,
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (question_id, language, prompt_version, question_fingerprint)
);

create index if not exists idx_question_hint_sets_lookup
on question_hint_sets(question_id, language, prompt_version, question_fingerprint, status);

create index if not exists idx_question_hint_sets_review
on question_hint_sets(status, created_at desc);

alter table discussion_threads add column if not exists subject_code text;
alter table discussion_threads add column if not exists paper_slug text;
alter table discussion_threads add column if not exists question_no integer;

create index if not exists idx_discussion_threads_paper_question
on discussion_threads(paper_slug, question_no, last_post_at desc);

-- Long-running CIE import jobs. Uploaded files remain staged until an administrator publishes them.
create table if not exists exam_import_jobs (
  id uuid primary key default gen_random_uuid(),
  subject_code text not null references exam_subjects(code) on delete restrict,
  created_by uuid references users(id) on delete set null,
  status text not null default 'uploading'
    check (status in ('uploading', 'processing', 'validated', 'published', 'failed')),
  input_dir text not null,
  staging_dir text not null,
  manifest_path text,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  published_at timestamptz
);

create table if not exists exam_import_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references exam_import_jobs(id) on delete cascade,
  file_name text not null,
  document_type text not null check (document_type in ('qp', 'ms')),
  paper_slug text not null,
  byte_size integer not null check (byte_size > 0),
  sha256 text not null,
  stored_path text not null,
  created_at timestamptz not null default now(),
  unique (job_id, file_name)
);

create index if not exists idx_exam_import_files_job on exam_import_files(job_id);

create table if not exists exam_import_issues (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references exam_import_jobs(id) on delete cascade,
  paper_slug text,
  severity text not null default 'error' check (severity in ('warning', 'error')),
  code text not null,
  message text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_exam_import_issues_job on exam_import_issues(job_id, severity);

-- Import jobs and review queue for strict publishing workflow.
create table if not exists question_import_jobs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running' check (status in ('running', 'completed', 'failed')),
  input_dir text not null,
  output_json text not null,
  report_json text not null,
  total_candidates integer not null default 0,
  published_count integer not null default 0,
  review_count integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists question_review_queue (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references question_import_jobs(id) on delete set null,
  question_id text,
  board text,
  subject text,
  paper text,
  year text,
  source_file text,
  question_no integer,
  stem text,
  options jsonb not null default '[]'::jsonb,
  images jsonb not null default '[]'::jsonb,
  reasons jsonb not null default '[]'::jsonb,
  quality jsonb not null default '{}'::jsonb,
  source jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_qreview_job on question_review_queue(job_id);
create index if not exists idx_qreview_file_qno on question_review_queue(source_file, question_no);

-- Versioned curriculum and coursebook navigation for chapter practice.
create table if not exists curriculum_versions (
  id text primary key,
  subject_code text not null references exam_subjects(code) on delete restrict,
  qualification text not null,
  exam_year_start integer not null check (exam_year_start between 2000 and 2099),
  exam_year_end integer not null check (exam_year_end between exam_year_start and 2099),
  version text not null,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_code, exam_year_start, exam_year_end, version)
);

create unique index if not exists idx_curriculum_one_active_version
on curriculum_versions(subject_code)
where active = true;

create table if not exists curriculum_sections (
  id text primary key,
  curriculum_version_id text not null references curriculum_versions(id) on delete cascade,
  syllabus_code text not null,
  title_en text not null,
  title_zh text,
  level text not null check (level in ('topic', 'section', 'statement')),
  parent_id text references curriculum_sections(id) on delete cascade,
  core_level text check (core_level in ('core', 'supplement')),
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (curriculum_version_id, syllabus_code)
);

create index if not exists idx_curriculum_sections_tree
on curriculum_sections(curriculum_version_id, parent_id, sort_order);

create table if not exists coursebook_chapters (
  id text primary key,
  book_key text not null,
  chapter_no integer not null check (chapter_no > 0),
  title_en text not null,
  title_zh text,
  pdf_start_page integer,
  pdf_end_page integer,
  printed_start_page integer,
  printed_end_page integer,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (book_key, chapter_no)
);

create table if not exists coursebook_sections (
  id text primary key,
  coursebook_chapter_id text not null references coursebook_chapters(id) on delete cascade,
  section_code text not null,
  title_en text not null,
  title_zh text,
  pdf_start_page integer,
  pdf_end_page integer,
  printed_start_page integer,
  printed_end_page integer,
  sort_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (coursebook_chapter_id, section_code)
);

create index if not exists idx_coursebook_sections_chapter
on coursebook_sections(coursebook_chapter_id, sort_order);

create table if not exists coursebook_section_mappings (
  coursebook_section_id text not null references coursebook_sections(id) on delete cascade,
  curriculum_section_id text not null references curriculum_sections(id) on delete cascade,
  primary key (coursebook_section_id, curriculum_section_id)
);

create table if not exists question_section_mappings (
  question_id text not null references question_bank(id) on delete cascade,
  curriculum_section_id text not null references curriculum_sections(id) on delete cascade,
  coursebook_section_id text references coursebook_sections(id) on delete set null,
  is_primary boolean not null default false,
  confidence numeric(4, 3) check (confidence between 0 and 1),
  status text not null default 'suggested' check (status in ('suggested', 'reviewed', 'rejected')),
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  source text not null default 'manual' check (source in ('model', 'rule', 'manual')),
  similar_question_group text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (question_id, curriculum_section_id)
);

create unique index if not exists idx_question_one_reviewed_primary
on question_section_mappings(question_id)
where is_primary = true and status = 'reviewed';

create index if not exists idx_question_section_public_pool
on question_section_mappings(coursebook_section_id, status, is_primary);

alter table practice_sessions
add column if not exists practice_mode text not null default 'paper';

alter table practice_sessions drop constraint if exists practice_sessions_practice_mode_check;
alter table practice_sessions add constraint practice_sessions_practice_mode_check
check (practice_mode in ('paper', 'chapter', 'review'));

create table if not exists question_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  question_id text not null references question_bank(id) on delete restrict,
  practice_session_id uuid references practice_sessions(id) on delete set null,
  curriculum_section_id text not null references curriculum_sections(id) on delete restrict,
  coursebook_section_id text not null references coursebook_sections(id) on delete restrict,
  mode text not null check (mode in ('chapter', 'paper', 'review')),
  selected_index integer not null check (selected_index between -1 and 20),
  correct boolean not null,
  first_exposure boolean not null,
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  hints_used integer not null default 0 check (hints_used >= 0),
  similar_question_group text,
  attempted_at timestamptz not null default now(),
  unique (practice_session_id, question_id)
);

alter table question_attempts
add column if not exists similar_question_group text;

alter table question_attempts
alter column practice_session_id drop not null;

alter table question_attempts
drop constraint if exists question_attempts_practice_session_id_fkey;

alter table question_attempts
add constraint question_attempts_practice_session_id_fkey
foreign key (practice_session_id) references practice_sessions(id) on delete set null;

create index if not exists idx_question_attempts_user_question
on question_attempts(user_id, question_id, attempted_at);

drop index if exists idx_question_one_first_exposure;
create unique index idx_question_one_first_exposure
on question_attempts(user_id, question_id)
where first_exposure = true and similar_question_group is null;

create unique index if not exists idx_question_group_one_first_exposure
on question_attempts(user_id, similar_question_group)
where first_exposure = true and similar_question_group is not null;

create index if not exists idx_question_attempts_user_coursebook
on question_attempts(user_id, coursebook_section_id, attempted_at);
