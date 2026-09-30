# ExPassway Smart Paper Builder v1 Design

Date: 2026-09-30
Status: Approved for implementation planning
Branch: `feature/smart-paper-builder-v1`

## 1. Purpose

Upgrade the existing chapter paper builder into a single-page question-bank workflow that supports manual selection, smart generation, saved papers, paper quality checks, and equivalent A/B papers.

The feature must reuse the existing ExPassway question bank, reviewed curriculum mappings, PDF export code, authentication, and Cloudflare D1 deployment model. It must not copy Exam Easy branding, code, visual assets, or page structure verbatim.

## 2. Confirmed Product Scope

The initial release contains:

1. Manual question-bank filtering and selection.
2. Existing chapter-based smart generation.
3. One shared ordered selection basket.
4. Explicitly saved and editable papers.
5. A transparent paper blueprint checker.
6. Strict equivalent B-paper generation with an explicit relaxation option.
7. Question provenance and review-state details.
8. ZIP export containing question and answer PDFs.

The initial release does not contain:

- assignments or student submission flows;
- reports or class analytics;
- payment, subscriptions, or entitlements;
- teacher collaboration or public sharing;
- Word or LaTeX export;
- AI-authored questions;
- OCR or image full-text search;
- mixed-subject papers;
- adaptive remediation papers;
- more than one A/B pair per generation request.

## 3. Page Architecture

The implementation remains in `pages/paper-builder.html`. It will expose three modes without creating duplicate builder pages:

1. **Manual selection**: filters, question results, and selection controls.
2. **Smart generation**: the current section-count workflow, with generated questions added to the shared basket.
3. **My papers**: saved-paper list with open, copy, download, and delete actions.

All modes share one in-memory ordered basket. Switching modes must not discard unsaved selections.

Desktop layout:

- top bar: title, subject, paper name, mode switch, save, preview, and download;
- left column: filters or smart-generation controls;
- center column: question results or saved-paper list;
- right column: selected questions and blueprint-check tabs.

Mobile layout:

- filters and results remain in the main flow;
- the right column becomes a bottom drawer;
- all essential actions remain keyboard and touch accessible.

## 4. Save Behaviour

Saving is explicit rather than continuous.

- The first Save action creates a D1 record.
- Later Save actions update that record.
- Any basket, title, marks, order, filter-setting, or blueprint change marks the page dirty.
- The page displays an unsaved-state indicator.
- `beforeunload` warns before leaving with unsaved changes.
- Reordering does not immediately write to D1.
- Generated PDFs are not persisted in D1 or R2; they are generated on demand.
- Copying creates a new paper ID, paper code, and timestamps.

## 5. Question Eligibility

Subjects are loaded from `exam_subjects` where `active = 1`.

General browsing may show active questions with recognizable subject, paper, and question metadata. Chapter filtering, smart generation, and A/B generation use only questions that meet every rule below:

- `question_bank.active = 1`;
- valid PNG/image content or a non-empty readable stem;
- MCQ answer index between 0 and 3;
- recognizable subject code, source paper, and source question number;
- a primary `question_section_mappings` record with `status = 'reviewed'` for chapter-based operations.

Rule-classified but unreviewed questions may appear in general browsing with a visible "chapter pending review" label. They may not enter chapter-based automatic generation.

A subject with insufficient reviewed data remains selectable and displays a clear readiness message. It must never redirect or silently fall back to Biology or another subject.

## 6. Manual Question Search

The initial search supports:

- `subjectCode`;
- `paperNumber`;
- `sectionId`;
- `year`;
- `season`;
- `variant`;
- `paperSlug`;
- `questionNo`;
- `page`;
- `pageSize`.

The initial page size is 20. The API must enforce a safe upper limit.

Image keyword search is excluded because many imported questions contain no reliable OCR text. The UI must not imply that image content is searchable.

Each result card displays:

- question image or text content;
- source paper and question number;
- year, season, paper, and variant;
- reviewed chapter, or pending-review state;
- add/remove state;
- image enlargement;
- answer visibility toggle;
- provenance details.

## 7. Shared Selection Basket

The basket stores ordered items with:

- question ID;
- display position;
- positive integer mark value;
- selected section ID where applicable;
- source similarity group.

The basket supports:

- add and remove;
- duplicate-question prevention;
- move up and move down;
- drag reorder;
- section-based auto-sort;
- single-question replacement;
- clear all;
- save;
- preview;
- download.

Smart-generated questions are inserted into this same basket and remain fully editable.

## 8. Database Model

Add `migrations/0011_saved_papers.sql` with additive-only schema changes.

### 8.1 `saved_papers`

Required columns:

- `id TEXT PRIMARY KEY`;
- `user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE`;
- `paper_code TEXT NOT NULL UNIQUE`;
- `title TEXT NOT NULL`;
- `subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT`;
- `curriculum_version_id TEXT REFERENCES curriculum_versions(id) ON DELETE SET NULL`;
- `build_mode TEXT NOT NULL CHECK (build_mode IN ('manual', 'smart', 'equivalent'))`;
- `build_seed TEXT`;
- `status TEXT NOT NULL CHECK (status IN ('draft', 'final'))`;
- `question_count INTEGER NOT NULL`;
- `total_marks INTEGER NOT NULL`;
- `settings TEXT NOT NULL CHECK (json_valid(settings))`;
- `blueprint TEXT NOT NULL CHECK (json_valid(blueprint))`;
- `parent_paper_id TEXT REFERENCES saved_papers(id) ON DELETE SET NULL`;
- `created_at TEXT NOT NULL`;
- `updated_at TEXT NOT NULL`.

Indexes cover user/update ordering, paper code, subject, and parent paper.

### 8.2 `saved_paper_items`

Required columns:

- `paper_id TEXT NOT NULL REFERENCES saved_papers(id) ON DELETE CASCADE`;
- `question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT`;
- `position INTEGER NOT NULL`;
- `marks INTEGER NOT NULL CHECK (marks > 0)`;
- `section_id TEXT REFERENCES coursebook_sections(id) ON DELETE SET NULL`;
- `source_group TEXT`;
- `created_at TEXT NOT NULL`.

Constraints:

- primary key on `(paper_id, question_id)` prevents duplicate questions;
- unique `(paper_id, position)` preserves one question per position;
- positions are normalized on each explicit save.

No additional saved-section table is required. Section details are resolved from current mappings and retained in the saved blueprint JSON for historical display.

## 9. API Surface

Extend the existing authenticated learning/paper-builder API without refactoring unrelated endpoints.

### 9.1 Search

`GET /api/paper-builder/questions`

Returns paginated result metadata and question cards. Answer data is returned only to authenticated users through the same controls already used by the application.

### 9.2 Saved papers

- `GET /api/paper-builder/papers`
- `POST /api/paper-builder/papers`
- `GET /api/paper-builder/papers/:id`
- `PATCH /api/paper-builder/papers/:id`
- `DELETE /api/paper-builder/papers/:id`

Every operation filters by the authenticated user ID. A paper owned by another user is treated as not found.

### 9.3 Existing smart generation

Retain `POST /api/paper-builder/generate`. Its response continues to return grouped questions, and the client converts them into basket items.

### 9.4 Equivalent paper

`POST /api/paper-builder/papers/:id/equivalent`

The default request is strict. An optional explicit request flag may relax only the similarity-group exclusion. It never permits reuse of the same question ID.

The endpoint validates ownership, active source questions, section availability, total marks, and question count before returning or saving the B-paper draft.

## 10. Blueprint Checker

The checker uses transparent indicators instead of one opaque quality score.

Initial rules:

- duplicate question: block insertion;
- repeated non-empty `similar_question_group`: warning;
- more than 25% of questions from one source paper: source-concentration warning;
- for papers with at least 20 questions, one answer letter over 40%: distribution warning only;
- unmet user-defined section count: block finalization;
- missing section pool: report the exact deficit and do not silently borrow from another section;
- difficulty metadata coverage below 70%: suppress difficulty distribution and report insufficient data;
- missing source, answer, or usable image/text: exclude from final paper;
- all warnings identify the affected questions and offer a replacement action.

Estimated duration is calculated from source-paper duration divided by source question count. Where a question has no usable source duration, use the median per-question duration for the same subject. If the subject has no reliable duration data, report that the estimate is unavailable.

The blueprint also reports:

- chapter and section counts;
- source-paper and year distribution;
- total questions and marks;
- answer-letter distribution;
- difficulty distribution when sufficiently populated;
- estimated duration;
- provenance completeness.

## 11. Equivalent A/B Paper Rules

Strict B-paper generation must preserve:

- subject;
- total question count;
- total marks;
- per-section question counts;
- paper-type compatibility where metadata is available;
- similar year distribution where the pool allows it;
- similar difficulty distribution only when reliable difficulty data exists.

Strict mode excludes:

- every A-paper question ID;
- every non-empty A-paper `similar_question_group`.

If the strict pool is insufficient, the endpoint returns a structured deficit for each affected section. It does not create a partial B paper.

The UI may then offer one explicit relaxation:

> Allow the same similarity group while still excluding every A-paper question.

No other automatic relaxation is permitted in v1.

The comparison view reports exact facts rather than a fabricated overall equivalence percentage:

- question-count match;
- total-marks match;
- section-count match;
- repeated exact questions;
- repeated similarity groups;
- estimated duration difference;
- year-distribution comparison;
- difficulty comparison when data coverage is sufficient.

## 12. Paper Codes and Reproducibility

Each saved paper receives a non-secret unique paper code. The code identifies a paper but does not grant access.

- Access always requires authentication and ownership.
- The code appears in saved-paper lists and PDF footers.
- Smart generation stores a build seed.
- Reproducibility is best-effort against the same eligible question-bank state. Disabled or remapped questions may prevent exact regeneration and must produce a clear explanation.

Public share links are excluded from v1.

## 13. Marks and PDF Export

MCQs default to one mark. Basket marks may be changed to positive integers.

Question PDF:

- displays new question numbers only;
- hides source paper and source question number;
- includes paper title, subject, total questions, total marks, and generated date;
- includes ExPassway, paper code, and page number in the footer.

Answer PDF:

- displays new question number and correct answer;
- includes source paper, source question number, and reviewed section;
- uses exactly the same ordered basket as the question PDF.

Normal ZIP:

- `试卷.pdf`
- `答案.pdf`

A/B ZIP:

- `A卷.pdf`
- `A卷答案.pdf`
- `B卷.pdf`
- `B卷答案.pdf`

PDF bytes remain client-generated through the existing export path unless a verified browser limitation requires a narrowly scoped server-side change.

## 14. Error Handling

The UI must distinguish:

- authentication failure;
- subject not ready;
- no matching questions;
- insufficient reviewed questions;
- B-paper section deficit;
- stale or disabled saved question;
- image load failure;
- save conflict or failed network request;
- PDF generation failure.

Failures must preserve the current in-memory basket. No failed API request may silently clear selections.

## 15. Security and Ownership

- All saved-paper routes require the current authenticated user.
- Queries include `user_id`; authorization is not performed only in the browser.
- Other users' paper IDs and codes return not found.
- Request arrays, counts, marks, page sizes, and filter values are bounded.
- Question IDs supplied by the client are reloaded and revalidated server-side.
- JSON fields are generated with `JSON.stringify`, not interpolated SQL.
- D1 statements use bound parameters.

## 16. Files in Scope

Expected modifications:

- `pages/paper-builder.html`
- `assets/paper-builder.css`
- `scripts/paper-builder.js`
- generated paper-builder browser bundle
- `scripts/api.js`
- `scripts/paper-export.js`
- `scripts/i18n.js`
- `cloudflare/learning-api.js`
- `cloudflare/worker.js` only if route recognition needs adjustment
- `package.json` only for required build/test commands

Expected additions:

- `migrations/0011_saved_papers.sql`
- focused API smoke tests
- focused paper-builder/export tests

Out of scope and preserved unchanged:

- `tools/classify-all-subjects.mjs`
- `tools/classify-static-physics-0625.mjs`
- forum/community pages;
- chat functionality;
- unrelated administration pages.

## 17. Testing Strategy

Baseline remains `npm run check`.

New automated coverage must include:

- question filters and pagination bounds;
- active/eligible question enforcement;
- reviewed-mapping enforcement for chapter operations;
- no cross-subject fallback;
- saved-paper create/read/update/delete;
- user ownership isolation;
- duplicate-question and duplicate-position rejection;
- ordering persistence;
- blueprint warnings and thresholds;
- strict B-paper exclusions;
- structured insufficient-pool errors;
- explicit relaxed similarity-group generation;
- PDF question/answer order and paper-code footer;
- normal and A/B ZIP filenames.

Manual browser verification must cover:

- desktop three-column layout;
- mobile basket drawer;
- manual and smart modes sharing one basket;
- dirty-state and leave warning;
- image enlargement;
- saved-paper reopen and copy;
- strict and relaxed B-paper flows;
- PDF visual output for long and image-heavy papers.

## 18. Delivery and Deployment

Implementation occurs in the isolated branch `feature/smart-paper-builder-v1`.

Before any merge or remote deployment:

1. run the complete local checks;
2. apply the additive migration to a local D1 instance;
3. complete browser and PDF verification;
4. report changed files, test evidence, remaining limitations, and migration details;
5. obtain explicit user approval.

Only after that approval may the work be merged to `main`, pushed to GitHub, applied to remote D1, and deployed to Cloudflare.

The existing uncommitted classification-script changes in the primary worktree must not be copied, overwritten, staged, or committed as part of this feature.

## 19. Definition of Done

The initial release is complete when:

- active subjects remain independently selectable;
- eligible questions can be filtered and paginated;
- users can manually add, remove, and reorder questions;
- smart-generated questions enter the same editable basket;
- duplicate questions cannot be added;
- papers can be explicitly saved, reopened, copied, and deleted;
- ownership prevents cross-user access;
- blueprint checks update after basket changes;
- strict B papers preserve count, marks, and section structure without exact or similarity-group overlap;
- explicit relaxed B generation never repeats an exact A-paper question;
- question and answer PDFs use identical ordering;
- normal and A/B ZIPs contain the required filenames;
- the existing chapter paper builder workflow remains functional;
- `npm run check` passes;
- no unrelated files or user changes are included.
