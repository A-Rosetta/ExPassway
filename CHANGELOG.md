# Changelog

All notable changes to this project are recorded in this file.

## 2026-07-29 00:27 CST

### Summary
- Refreshed the eight student-facing flows with a scoped, clear light liquid-glass design while preserving subject identity, readable solid question surfaces, existing assets, and all current functionality.
- Reworked the existing Express/PostgreSQL community into a denser Zhihu-inspired central feed, detail, and composer experience with a desktop action rail and a mobile single-column layout.
- Kept administrator, curriculum review, image mapping, and PDF preview layouts intact; these tools inherit only shared colors, controls, focus states, and readability fixes.

### Student Interface
- Added system-font design tokens, translucent materials with opaque fallbacks, `28px` glass blur, restrained `8px` surface radii, safe-area spacing, stable responsive sizing, visible keyboard focus, and reduced-motion behavior.
- Unified the homepage, login, paper picker and timed answering, Biology chapter practice, wrong notebook, practice review, analysis, and community toolbars, filters, data surfaces, option states, and actions.
- Preserved high-contrast question and editor content, subject-specific book colors, the fixed timer, and existing KaTeX, MathLive, question-image, PDF, notebook, profile, forum, logout, and administrator entry flows.
- Updated shared style and community script cache versions to `20260728-3` so the Nginx path loads the refreshed assets.

### Community And Validation
- Changed discussions to switch the central column between list, composer, and question detail while restoring list scroll position; retained pinned/recent ordering, the 30-item limit, paper and status filters, followed-only mode, deep links, and bilingual behavior.
- Presented opening posts as question bodies and replies as an answer stream while retaining question images and references, Markdown, formulas, uploads, follows, likes, reports, reply deletion, moderation, and teacher review state.
- Added separate accessible composer and reply alerts for empty titles, empty bodies, empty or incomplete formulas, excessive content, invalid images and links, upload failures, and publish failures; field-specific errors focus and mark the relevant control and clear as that issue is corrected.
- Routed non-field load and action failures to a persistent dismissible upper-right notification, moved below the navigation and safe area on mobile, while successful notifications dismiss after approximately 3.5 seconds.
- Kept the mobile formula controls usable after closing the bottom keyboard and prevented stale validation callbacks from refocusing formulas after correction.
- Made no discussion API, request, response, permission, schema, table, migration, or database changes.

### Verification
- Added a no-write browser smoke test that serves the real Nginx `/alevel/` frontend and intercepts `/api/**` with in-memory user, question, and community data.
- Passed Chromium desktop at `1440x900` and WebKit mobile at `390x844` across all eight student flows, including an active timed paper and community list, filters, composer, details, replies, actions, images, Markdown, formulas, validation, and notifications.
- Verified no page errors, failed requests, horizontal overflow, clipped controls, content/timer overlap, broken keyboard focus, or reduced-motion regressions; also verified decoded nonblank question images and responsive formula-keyboard behavior.
- Passed JavaScript syntax and Git whitespace checks; confirmed all eight student pages return `200` through Nginx, anonymous `/api/discussions` returns `401 Missing bearer token.`, and the live community page references cache version `20260728-3`.

## 2026-07-28 13:29 CST

### Summary
- Expanded Cambridge IGCSE Biology `0610` chapter practice from the Chapters 1-3 pilot to the complete 20-chapter, 58-section coursebook structure.
- Added the complete official 2026-2028 syllabus hierarchy with 21 topics, 61 syllabus sections, and 389 numbered statements.
- Created one private primary mapping candidate for every one of the 1640 Biology questions while preserving administrator review as the publication boundary.

### Mapping And Review
- Generated 1278 higher-confidence question-text matches and 362 low-confidence question-position fallbacks; all 1556 new mappings remain `suggested` until reviewed.
- Preserved the existing 84 reviewed primary mappings and 2 rejected decisions during repeat generation.
- Added administrator filters for mapping status, paper year, and all 20 coursebook chapters, plus 100-record pagination and stale-request protection.
- Kept every suggested or reviewed primary mapping within a valid coursebook-section-to-syllabus-statement relationship.
- Made repeat suggestion generation idempotent so unchanged suggestions retain their timestamps.

### Assessment Boundary
- Classified all 280 questions from 2024 but continued to exclude them from chapter availability counts and chapter session generation, including after a simulated review inside a rolled-back transaction.
- Kept chapter practice restricted to reviewed questions from 2019-2023.
- Preserved question IDs, `question_bank.topic`, question images, wrong-notebook rows, discussion links, and existing attempts.
- Stored only coursebook directory metadata; no coursebook scans, prose, images, or end-of-chapter exercises were published.

### Verification
- Verified 1640 of 1640 Biology questions have exactly one suggested or reviewed primary mapping and no invalid coursebook/syllabus pairs.
- Verified unchanged hashes for Biology question IDs, topics, and image JSON before and after the expansion.
- Verified the authenticated catalogue returns 20 chapters and 58 sections without answer fields.
- Verified administrator totals and year/chapter filters, including the six `2024 + Chapter 20` suggestions.
- Verified desktop and mobile student/admin browser flows, pagination, rapid filter changes, loaded question images, no runtime errors, no horizontal overflow, and cleanup of temporary sessions.
- Restarted and verified `alevel-backend-3002.service`; health and both pages return `200`, while anonymous curriculum access returns `401`.

## 2026-07-27 22:08 CST

### Summary
- Added the Cambridge IGCSE Biology `0610` chapter-practice pilot for coursebook Chapters 1-3.
- Kept coursebook navigation, official 2026-2028 syllabus statements, and question mappings as separate versioned structures.
- Added administrator review so generated mapping suggestions remain private until explicitly reviewed.

### Added
- Added 3 coursebook chapters, 13 coursebook sections, 53 syllabus nodes, and 45 coursebook-to-syllabus statement mappings.
- Added normalized per-question attempts with separate first-exposure and review results.
- Added authenticated curriculum, chapter-session generation, and server-side chapter submission APIs.
- Added a Biology mode page with `Chapter Practice / Past Papers`, unseen-first selection, progress metrics, and one-question-at-a-time practice.
- Added an administrator curriculum-mapping review page with question images, coursebook section selection, syllabus statement selection, review, and rejection controls.
- Added explicit seed and reviewed-mapping SQL plus a desktop/mobile Playwright smoke script.

### Data And Security
- Preserved all 2749 existing question rows, including all 1640 Biology questions, without changing `question_bank.topic` or question IDs.
- Reserved 2024 Biology papers from chapter practice; chapter pools use reviewed 2019-2023 questions only.
- Published 84 manually checked mappings across 12 of 13 pilot sections; left `1.3 Keys` unavailable instead of publishing uncertain matches.
- Kept 234 rule suggestions private for administrator review and retained 2 rejected conflicts for audit history.
- Omitted correct answers from chapter-generation responses and scored submissions against server-side question records.
- Required authenticated users for chapter progress and administrator role for mapping review.

### Verification
- Applied the schema and pilot seeds to PostgreSQL and restarted `alevel-backend-3002.service`.
- Verified anonymous chapter access returns `401`, generated questions do not expose `answer`, and submissions write first/review attempts and wrong-notebook entries.
- Verified unseen questions are selected before repeated questions and near-duplicate groups count as one exposure.
- Verified deleting a practice session preserves normalized attempts; deleting the user still removes their learning data.
- Verified JavaScript syntax, Git whitespace, live database counts, and desktop/mobile browser flows.
- Verified student and administrator pages at `1440x900` and `390x844` with loaded question images, no script errors, no horizontal overflow, and no overlapping controls.

## 2026-07-24 22:35 CST

### Summary
- Added a dedicated wrong-notebook entry to the signed-in homepage and moved the notebook overview into the notebook page.
- Changed wrong-notebook records to a compact title-first, answered-only, paginated list.
- Added homepage downloads for published question-paper and mark-scheme PDFs.

### Added
- Added a bilingual `错题本 / Notebook` control to the homepage navigation and linked it to the existing notebook page.
- Added previous and next pagination controls for wrong-notebook records, with 10 answered questions per page.
- Added a homepage `下载试卷 PDF / Download Paper PDFs` dialog with subject and published-paper selectors.
- Added separate downloads for the question paper (`QP`) and mark scheme (`MS`).
- Added the controlled catalogue endpoint:
  - `GET /api/catalog/papers/:paperSlug/download/:documentType`
- Added a PDF resolver that prefers registered `exam_import_files` paths and supports the approved legacy Chemistry and Co-ordinated Sciences PDF directories.

### Changed
- Moved the wrong-notebook overview from the homepage into `pages/notebook.html` while retaining the notebook item, total wrong-attempt, mastered, and latest-record summaries.
- Removed the duplicate notebook item card from the notebook page.
- Changed each wrong-notebook record to show its subject, paper, and question number before opening its details.
- Changed the notebook overview, filters, and record list to include only questions the user has answered.
- Preserved the existing notebook grouping, sorting, subject filter, mastery filter, mastery updates, and discussion links.
- Adjusted the mobile homepage navigation to four equal columns.
- Preserved the existing subject-book navigation while adding the PDF download entry beside the homepage subject heading.

### Security
- Restricted catalogue downloads to published papers and the `qp` or `ms` document types.
- Rejected arbitrary paths and filenames from requests.
- Validated that resolved files are regular `.pdf` files inside approved roots before serving them.
- Returned structured `400` and `404` responses for invalid document types, unknown papers, and missing PDF source files without exposing server paths.

### Verification
- Verified JavaScript syntax and Git whitespace checks for the completed changes.
- Verified all four published subjects, 69 published papers, and all 138 QP/MS download endpoints.
- Verified that every PDF response begins with `%PDF-` and uses the official database filename in `Content-Disposition`.
- Verified registered Biology and Economics files plus legacy Chemistry summer/winter and Co-ordinated Sciences files.
- Verified a real browser download of `0620_w23_qp_21.pdf`.
- Verified that subject-book navigation still opens the existing paper-selection page.
- Verified the homepage download dialog at `1280x900` and `390x844` with no horizontal overflow, clipped controls, or overlapping content.
- Restarted and verified `alevel-backend-3002.service` through the live Nginx `/api/` path.

## 2026-07-19 13:08 CST

### Summary
- Replaced the signed-in homepage with a responsive subject-book dashboard backed by the published course catalogue.
- Added a year-only filter to the paper picker shown after selecting a subject book.

### Added
- Added distinct CSS book covers for Biology `0610`, Chemistry `0620`, Co-ordinated Sciences `0654`, and Economics `0455`.
- Added top-level forum, profile, and logout controls to the homepage.
- Added a year selector that derives available years from the selected subject's published papers and sorts them newest first.
- Added a live count of papers matching the selected year.

### Changed
- Changed subject selection from the previous dropdown form to direct book-card navigation.
- Preserved profile and password editing in a profile dialog.
- Preserved the wrong-answer notebook overview and administrator-only dashboard entry.
- Changed the paper picker to default to all years and filter its existing paper list without changing practice or timed-test behavior.

### Verification
- Verified the live catalogue totals for all four subjects.
- Verified Economics opens its single `0455_s25_qp_12` paper and Biology opens all 41 published papers.
- Verified Biology year options from 2019 through 2024 and seven papers for both 2023 and 2024.
- Verified filtered paper selection still opens the existing mode-selection flow.
- Verified desktop and mobile layouts with zero horizontal overflow and no page, API, or runtime errors.

## 2026-05-25 18:30 CST

### Summary
- Completed end-to-end PDF question import flow for Chemistry MCQ with per-question image display.
- Switched Chemistry MCQ generation to unified question service so imported bank is used consistently.
- Upgraded practice page to single-question navigation mode (one-by-one answering with image-first display).

### Added
- Added PDF import script:
  - `backend/scripts/import-pdf-bank.mjs`
- Added imported bank loader:
  - `backend/src/data/importedQuestionBank.js`
- Added image mapping example and generated mapping files:
  - `backend/scripts/import-image-map.example.json`
  - `backend/scripts/image-map.demo.json`
  - `backend/scripts/image-map.auto.json`
  - `backend/scripts/image-map.full.json`
- Added automatic question-image extraction script (PyMuPDF):
  - `backend/scripts/extract-question-images.py`
- Added image mapping tool page for manual/visual binding:
  - `pages/image-mapper.html`
  - `scripts/image-mapper.js`

### Changed
- Changed runtime question source strategy to merge built-in bank and imported bank:
  - `backend/src/services/question.service.js`
- Changed paper generation response to include source marker:
  - `source: imported-bank | built-in-bank`
- Changed Chemistry MCQ route to use unified generator path (removed special parser branch at generate endpoint):
  - `backend/src/routes/papers.routes.js`
- Changed practice rendering to support question images and single-question paging UX:
  - one question visible at a time
  - previous/next navigation
  - progress display (`第 x / n 题`)
  - persistent selected answers across navigation
  - `scripts/generate.js`
- Changed styles to support question image cards:
  - `assets/styles.css`
- Changed admin panel quick access to image mapper:
  - `pages/admin.html`
  - `scripts/admin.js`

### Data Generated
- Imported paper:
  - `/home/ubuntu/chemis/0620_s23_qp_21.pdf`
- Imported bank output:
  - `backend/src/data/importedQuestionBank.json` (40 questions)
- Generated question images:
  - `assets/question-images/0620_s23_qp_21/q01_full.png ... q40_full.png` (40 images)

### Verification
- Verified backend import output:
  - imported question count = 40
- Verified image mapping coverage:
  - mapped questions = 40
  - generated image files = 40
- Verified backend API availability:
  - `GET /` returns service metadata JSON
  - `GET /api/meta/storage` returns storage mode

## 2026-05-01 12:26 CST

### Summary
- Completed first-phase Khan-style upgrade without breaking existing flows.
- Upgraded paper generation logic, practice hint interaction, and analysis recommendations.
- Fixed frontend serving path in Nginx so production pages load the latest project files.

### Added
- Added Khan-style question schema fields:
  - `templateId`
  - `skills`
  - `hints`
- Added progressive hint UI on generated questions:
  - `显示提示`
  - `显示下一条提示`
- Added hint usage metrics in result panel:
  - number of questions where hints were used
  - total hint clicks
- Added hint dependency insight in analysis output:
  - `hintRate` and guidance based on dependency level

### Changed
- Changed backend generator strategy from simple random pick to weighted strategy:
  - difficulty distribution (`基础/中等/冲刺`)
  - template de-duplication via `templateId`
  - fallback retained when strict filtering is too narrow
- Changed submit API to be backward compatible with both formats:
  - old: `answers: number[]`
  - new: `answers: { selectedIndex, hintsUsed }[]`
- Changed frontend local fallback generator to align with upgraded backend strategy.

### Fixed
- Fixed `POST /api/papers/submit` database error when receiving object-style answers.
  - Root cause: DB persistence expected integer array but received objects.
  - Fix: normalize to integer array before persistence while keeping hint metrics in response.
- Fixed Nginx static mapping path:
  - from `/var/www/aifootball.cc/html/alevel/`
  - to `/home/ubuntu/alevel-smart-practice/`
- Fixed static file access issue (HTTP 500 on JS files) caused by directory/file read permissions for `www-data`.

### Files Updated
- `backend/src/services/question.service.js`
- `backend/src/data/questionBank.js`
- `backend/src/routes/papers.routes.js`
- `backend/src/services/evaluation.service.js`
- `backend/src/services/analysis.service.js`
- `scripts/data.js`
- `scripts/generate.js`
- `scripts/analysis.js`
- `/etc/nginx/sites-available/default` (server config)

### Verification
- API smoke checks passed after fixes:
  - `GET /health`
  - `POST /api/papers/generate`
  - `POST /api/papers/submit`
  - `POST /api/analysis`
- Confirmed latest frontend JS is served via:
  - `/alevel/scripts/generate.js`
  - includes strings: `显示提示`, `显示下一条提示`, `提示使用`

### Git Commits
- `f6218b6` feat(generator): add khan-style weighted paper generation and schema
- `50dd6f9` feat(practice): add progressive hints and compatible submit payload
- `134f303` feat(analysis): include hint dependency insights in recommendations

## 2026-05-30 22:45 CST

### Summary
- Implemented a strict, reusable PDF import publishing workflow for Chemistry MCQ.
- Added quality-gate filtering so only high-confidence real questions are published.
- Added review queue and import job records for failed/low-confidence items.

### Added
- Added import quality artifacts:
  - `backend/src/data/import-quality-latest.json`
  - `backend/src/data/import-reports/` (per-job report files)
  - `backend/src/data/importReviewQueue.json`
- Added database tables for import workflow governance:
  - `question_import_jobs`
  - `question_review_queue`

### Changed
- Changed Chemistry bulk import script to strict publish mode with quality checks:
  - `backend/scripts/import-all-chemis-pdfs.mjs`
  - publish only `pass=true`
  - write failed items to review artifact
  - write per-job quality summary report
- Changed DB import script to persist:
  - published questions into `question_bank`
  - failed questions into `question_review_queue`
  - import summary into `question_import_jobs`
  - file: `backend/scripts/import-bank-to-db.mjs`
- Extended DB schema:
  - file: `backend/db/schema.sql`

### Quality Gate Rules (Current)
- Reject if options are missing or malformed.
- Reject if stem/options contain obvious garbled-symbol ratio above threshold.
- Reject if extracted text shows likely cross-question concatenation.

### Verification
- Ran strict import pipeline across all current Chemistry PDFs.
- Import report totals:
  - candidates: `172`
  - published: `154`
  - review queue: `18`
- Database counts verified after import:
  - `question_bank = 154`
  - `question_review_queue = 18`
- Paper generation API smoke check:
  - `/api/papers/generate` returns `source: "db-bank"`

### Notes
- This workflow is designed for future PDF batches: repeat import -> quality report -> publish/review split without placeholder questions.
