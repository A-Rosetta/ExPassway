alter table wrong_notebook_entries
  add column if not exists mistake_type text default 'unknown'
    check (mistake_type in ('concept','calculation','question_reading','careless','time_pressure','unknown')),
  add column if not exists mistake_reasons text[] not null default '{}',
  add column if not exists starred boolean not null default false,
  add column if not exists note text default '',
  add column if not exists last_redone_at timestamptz;

create index if not exists idx_wrong_notebook_starred
  on wrong_notebook_entries(user_id, starred) where starred = true;

create index if not exists idx_wrong_notebook_mistake_type
  on wrong_notebook_entries(user_id, mistake_type);
