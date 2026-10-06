# Five-subject practice and resources rollout

The 2026-10-06 expansion prepares every one of the 78 mainland-China May/June 2024–2026 papers already collected for Physics 9702, Chemistry 9701, Economics 9708, Biology 9700 and Geography 9696. Each original numbered question has its own QP fragments, official MS material and independently checked part marks. The existing Computer Science 9618 practice collection is preserved.

| Subject | Papers | Practice questions | Official June threshold PDFs | Textbook entries |
| --- | ---: | ---: | ---: | ---: |
| Physics 9702 | 18 | 190 | 3 | 1 |
| Chemistry 9701 | 18 | 187 | 3 | 1 |
| Economics 9708 | 12 | 209 | 3 | 1 |
| Biology 9700 | 18 | 187 | 3 | 1 |
| Geography 9696 | 12 | 108 | 3 | 1 |
| Total | 78 | 881 | 15 | 5 |

## Practice and grading

The shared practice envelope remains `question_type = structured`; source paper types remain MCQ, structured or practical. This keeps the legacy MCQ learning routes separate from prepared official-paper questions. Central subject policy accepts science Papers 1–5 and Economics/Geography Papers 1–4, while retaining the existing 9618 Papers 1–3 restriction.

The 539 positive-mark MCQs use the official A–D answer key for deterministic 0/1 scoring. They do not call AI or consume its cooldown. Other questions use the original MS criteria and fragments in the existing structured grading service. The server validates every part and mark total, binds images to the question's own subject/paper namespace and bounds the returned marks. Structured feedback is an estimate, not a Cambridge examiner's certified result.

Science practical papers retain the actual experimental wording and MS. The practice page supports results, calculations, written explanations and uploaded work; students still need the described practical setup to obtain their own experimental readings. This feature does not simulate laboratory equipment.

Non-MCQ answers accept text and up to three PNG/JPEG drawings per parent question. The browser scales and compresses each drawing to at most 128 KiB; the API validates its format and size. Drafts remain in the student's browser, and submitted answers and grades use the existing authenticated, owner-scoped attempt records. Official content assets and student answer images have separate storage paths; student drawings are not published as R2 content.

Every practice paper exposes its actual cover instructions. Optional essay questions are all available for practice, so the pool's maximum marks can exceed the printed examination maximum. The score display uses the practice pool's denominator and explicitly shows the printed examination maximum separately.

Economics `9708_s25_qp_14` question 2 is discounted by the official MS and has zero marks. It is excluded from the scored bank; the source count and printed maximum remain 30, with 29 available positive-mark questions. Chemistry's 2024/2025 practical papers have three numbered questions; the qualitative analysis notes are not a fourth question.

## Source limitations and recovered material

The original PapaCambridge Chemistry `9701_s24_ms_22.pdf` has 13 pages and omits question 5. Preparation recovered the complete 14-page MS from QualifiedQuest. The new immutable key is `imports/9701/practice-china-june-2024-2026-20261006/9701_s24_ms_22.pdf`, SHA-256 `df71d581de9e4d711d8e41b2ee1e1349cdf81a396d499b8ac5dc1104542c7cb5`. The paper now points to the complete version, while the earlier 13-page object remains available for audit. The displayed download URL is versioned by content hash.

Some Cambridge public QPs/Inserts replace copyrighted source images with notices. Questions with an indispensable figure and no verified available source retain their complete official content but explicitly disable grading using `gradingUnavailableReason`. No missing image or answer is fabricated.

Verified original-provider reading links can accompany a question through `content.sourceMaterialLinks`. They appear as external HTTPS links and are not fetched as official grading image assets or copied into the published package. Recovery evidence records the match to the original question and every relevant MS value; any rounding or redraw differences must remain visible. The official MS remains the scoring authority.

Biology `9700_s25_qp_44` question 3's removed cat photograph is disclosed, but the original written no-tail description is independently sufficient for its answers. Question 2's removed pedigree is indispensable and requires a verified recovery before grading can open.

## Grade thresholds and textbooks

The 15 threshold PDFs come directly from Cambridge, one per subject and June session in 2024, 2025 and 2026. Source metadata retains every component and option row. The subject page displays the China components and matching AS/linear combinations beside the appropriate session. Component marks are raw; combination thresholds are weighted. An AS component threshold must not be mistaken for an overall A Level grade boundary. Carry-forward routes require separate review and are not inferred from a single year's raw marks. Where the 2026 source omits an option code, the stored code is null.

Each textbook entry links to Cambridge's endorsed-resource list and the publisher's legitimate purchase/digital access pages, with title, authors, edition, ISBN and compatibility with the selected syllabus including 2027. Available publisher previews are linked separately. These are access links, not a downloaded textbook archive. Geography's selected textbook and syllabus support the revised 2027–2029 course; historical 2024–2026 papers retain their original course context.

## Publication and verification

Prepared packages and source evidence remain outside Git under `D:\Project\EXPW\deployment-as-a-level-expansion`. The `practice` and `resources/packages` manifests pass the shared validator and importer dry run. All declared files have SHA-256 checks; every parent question passes official part-mark and grading-context preparation using its actual PNG bytes. Independent source audits cover QP/MS boundaries, optional-question instructions, official MCQ keys and Geography Insert dependencies. Representative source crops and paper exports receive visual review.

Apply migration `0029_as_a_level_practice_capabilities.sql`, upload validated immutable R2 objects and publish the reviewed SQL plans after code and browser checks. The release retains a pre-publication D1 backup, upload/readback receipts, data audit, browser screenshots, production verification and Worker deployment receipt in that external directory. Browser QA uses Playwright because the browser plugin is unavailable, with real Worker handlers, Miniflare D1/R2 and reviewed packages. Any mocked AI response verifies the transport and UI only; it does not establish live provider grading quality.
