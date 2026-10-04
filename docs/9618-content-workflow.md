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

## Future past-paper source

The user-selected source for later collection is [PapaCambridge's Computer Science 9618 collection](https://pastpapers.papacambridge.com/papers/caie/as-and-a-level-computer-science-for-first-examination-in-2021-9618?theme=lightTheme). Use this page as the first source to try when collecting additional available sessions. This is a collection preference, not a recurring download job.

For each later batch, inventory the available QP, MS, ER, GT, Insert, and source files, pair QP/MS by exact paper code, and record source URLs and checksums in resource metadata. Check the actual PDFs before setting question counts, duration, marks, or publication status. Import only material actually obtained; the library derives year/session cards and availability badges from published records and does not invent forthcoming resources.
