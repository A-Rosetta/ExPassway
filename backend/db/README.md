# Database Design

Schema file: `db/schema.sql`

## Tables

1. `users`
- Basic user profile table.
- Supports roles: `student`, `teacher`, `parent`, `admin`.
- Fields include optional `grade` and `target_score`.

2. `practice_sessions`
- Stores generated paper data and submitted result.
- `generated_questions` keeps full question snapshot for reproducible scoring.
- `result` and `wrong_log` are JSONB payloads for analysis and reporting.
- `status` tracks `generated` vs `submitted`.

3. `question_bank`
- Stores active and historical questions.
- `subject_code`, `paper_slug`, and `question_no` are stable catalogue references.
- `active = false` preserves old IDs and history when a replacement import discounts or removes a question.

4. `exam_subjects` and `exam_papers`
- Drive frontend subject, paper, year, season, and variant selectors.
- Store official paper metadata and discounted question numbers.

5. `exam_import_jobs`, `exam_import_files`, and `exam_import_issues`
- Record administrator PDF upload, validation, and publishing status.
- Import files remain staged until a validated job is explicitly published.

6. `discussion_threads` and related discussion tables
- Store discussions, replies, likes, follows, and flags.
- Standard question references allow new catalogue subjects without subject-specific ID parsing.

## View

`user_practice_summary` provides quick aggregate metrics by `user_id`.
