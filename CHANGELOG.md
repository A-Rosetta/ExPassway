# Changelog

All notable changes to this project are recorded in this file.

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
