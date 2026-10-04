# 9618 resource rollout

## Current collection scope

The published ALCS collection contains June question papers and mark schemes for 2024–2026, the 2027–2029 syllabus, the matching pseudocode guide, available Paper 2 Inserts, examiner reports, and grade thresholds. Do not collect the 2024–2026 syllabus for this rollout. Syllabus editions and applicability remain resource metadata rather than frontend constants.

Paper 4 originals remain available for reading and downloading. Its companion source files have not been supplied. Do not create placeholder companion resources or include Paper 4 in the structured question bank.

The first question-bank pilot is `9618_s24_qp_13`, paired with `9618_s24_ms_13`: seven complete parent questions, with official marks of 9, 9, 7, 14, 11, 3, and 22 (75 in total). Preserve all shared material and nested subparts, and keep the official question and mark-scheme fragments paired by question number and original PDF page. Difficulty and curriculum mappings remain unset until reviewed. Missing mappings must not block manual selection by source paper.

The syllabus area also holds supporting guides, including the pseudocode guide. Past-paper sessions contain exam documents and a per-paper **Practice This Paper** link when complete questions are available. Structured practice uses its own API and attempt records; it must never send structured answers into MCQ judging or correctness analytics.

Practice opens only the first parent question, with every official MS collapsed. Each original leaf subpart has a text answer; code whitespace is preserved. Grading uses the published question and official MS with the same API connection as AI hints and model `gpt-6-luna`. Results are AI practice scores, with bounded official part marks, feedback, and server-calculated totals. Blank answers earn zero, and a question without usable official MS cannot be graded. Keep result validation, user-scoped request IDs, duplicate-request handling, and per-user limits in place when changing the prompt or provider.

## Prepared package and validation

Follow [structured resource package v1](structured-resource-package.md) and use the shared validator and importer. The local ALCS package is kept outside the source repository; derived pilot images are declared with their hashes and source-page crop coordinates. Stable question IDs permit a reviewed repeat import to update the same rows.

Before publication:

1. Check that every parent question and official MS segment is present, with no neighboring question included in a crop.
2. Check the original source question count, per-question marks, total marks, paper code, season, year, and variant.
3. Run package validation and the importer dry run, then verify source-paper browsing and manual selection without chapter mappings in a local environment.
4. Check saved-paper reopening, copying, ordering, and both question and MS PDF exports. Both exports must follow the same selected parent-question order.
5. Upload all declared files, upsert and publish the reviewed records, then reload the live catalogue and verify its question count and content links.

## Expanding the practice collection in batches

The current local source folder, `D:\File\ALCS`, already contains matching QP/MS PDFs for June 2024, 2025, and 2026, variant 3, Papers 1–3: nine eligible papers. Only `9618_s24_qp_13` has been extracted into the question bank. No new source collection is needed for the other eight papers.

The reviewed original-paper inventory gives this next-batch order:

| Batch | Source paper slugs | Original parent questions |
| --- | --- | --- |
| 1: complete 2024 coverage | `9618_s24_qp_23`, `9618_s24_qp_33` | 8 + 11 = 19 |
| 2: expand 2025 | `9618_s25_qp_13`, `9618_s25_qp_23`, `9618_s25_qp_33` | 7 + 7 + 13 = 27 |
| 3: expand 2026 | `9618_s26_qp_13`, `9618_s26_qp_23`, `9618_s26_qp_33` | 8 + 8 + 11 = 27 |

These eight papers supply 73 more parent questions; with the existing seven-question pilot, the collection would have nine practice papers and 80 parent questions. Verify each new extraction against its original PDF before publication. Paper 4 remains outside this expansion.

The importer already accepts multiple entries in `papers` and `questions`, so one reviewed package can publish a whole batch. The remaining work is preparation, rather than another website page: locate complete QP and official MS boundaries, preserve multi-page diagrams/tables/code and shared materials, build the original subpart tree, and check that leaf-part marks add up to each parent total. Paper 2 Inserts already exist for these years; include necessary material in the parent question's grading context instead of relying on a separate download that the grader cannot see.

Use the existing pilot directory, `D:\Project\EXPW\deployment-9618\pilot-paper1`, as an example of the package layout, crop references, hashes, and review artifacts. Its `build-pilot.py` contains paper-specific content and crop definitions; it is not a general automatic PDF parser. Merely changing its paper slug does not extract another paper correctly. Neither the grading model nor the legacy MCQ “validate and split” importer creates the official question data.

For each batch, create a new package directory outside the source repository and follow resource package v1. Include the QP/MS PDFs, all declared question/MS PNG fragments, paper metadata, and the complete prepared questions. Optional textbook/chapter mappings can remain absent. Maintain stable parent and part IDs on corrections. Every referenced paper needs its declared QP/MS files even when those originals already exist in R2.

Run these commands from `D:\Project\EXPW\expassway`, replacing the package path with the actual reviewed batch:

```powershell
$batchManifest = 'D:\Project\EXPW\deployment-9618\batch-2024-p2-p3\package.json'
node tools/validate-resource-package.mjs $batchManifest
node tools/import-structured-resource-package.mjs --package $batchManifest
node node_modules/wrangler/bin/wrangler.js d1 migrations apply expassway-db --local
node tools/import-structured-resource-package.mjs --package $batchManifest --mode apply --target local --publish
```

The first command checks the schema; the dry run also checks actual declared files, SHA-256 hashes, QP/MS references, and question counts. Local `--publish` makes the candidate content visible to the local catalogue for browser QA. After reviewing local question browsing, answer fields, official MS pairing, grading, and PDF export, publish the same package remotely:

```powershell
node tools/import-structured-resource-package.mjs --package $batchManifest --mode apply --target remote --confirm-remote --publish
```

The existing importer uploads every declared file to `expassway-content` before executing the D1 upserts in `expassway-db`. It preserves rows omitted from the package. For a correction to a previously imported paper, include all its prepared questions and set `validQuestionCount` to that package's question count; do not reuse a source-only paper entry with a zero count for a paper that already has bank questions. A repeat import updates published rows even without `--publish`, because the importer preserves existing publication/active status. Therefore, remote draft import is not an isolated staging area for corrections; finish local review before any remote apply.

After publication, reloading the catalogue enables **Practice This Paper** from the published structured questions and paper metadata. No new frontend configuration or per-paper deployment is required. Migration `0019` supplies content storage and migration `0020` supplies practice attempts; both are needed in a fresh environment. The grader also needs the existing AI service configuration.

Check these current grading limits when preparing longer questions: QP and MS together may contain at most 32 registered image fragments; each PNG may be at most 4 MiB and their combined bytes at most 16 MiB. The serialized question/rubric context may be at most 150,000 characters. Official leaf marks must match the parent total, and usable official MS text or images must be present. Keep images readable; use meaningful fragments and avoid registering duplicate renderings of the same content. These are grading preflight checks in addition to the general package validator.

The current per-user allowance is 20 AI-backed parent-question submissions in a rolling hour. Empty submissions do not call AI, and repeating the same successful request ID does not consume another call. Importing more papers does not raise this allowance. Verify provider availability and representative long/code/table questions before opening a larger batch to students.

## Future past-paper source

The user-selected source for later collection is [PapaCambridge's Computer Science 9618 collection](https://pastpapers.papacambridge.com/papers/caie/as-and-a-level-computer-science-for-first-examination-in-2021-9618?theme=lightTheme). Use this page as the first source to try when collecting additional available sessions. This is a collection preference, not a recurring download job.

For each later batch, inventory the available QP, MS, ER, GT, Insert, and source files, pair QP/MS by exact paper code, and record source URLs and checksums in resource metadata. Check the actual PDFs before setting question counts, duration, marks, or publication status. Import only material actually obtained; the library derives year/session cards and availability badges from published records and does not invent forthcoming resources.
