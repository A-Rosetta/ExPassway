# Past-paper source replacement — 2026-10-18

**Published and verified on 2026-10-18.** Release: `15abab2c-5f11-4683-a4a8-9a23e41effbd`. The production database now references the verified replacement PDF and practice-image objects.

## Scope and method

The 2026-10-17 production inventory contains 11 subjects, 195 paper records and 32 subject/year groups. A seeded random sample selected up to two papers in each group, checking both QP and MS. Of 126 requests, 114 returned PDFs and 12 existing IGCSE Physics 0625 download routes returned `PDF_NOT_FOUND` (404). Unavailable samples are unverified, rather than clean.

The six AS/A Level subjects 9618, 9696, 9700, 9701, 9702 and 9708 triggered whole-year replacement for 2026. All 60 QP/MS PDFs in those deployed groups were checked and contained known PapaCambridge page marks. The other available subject/year samples did not contain the reported marks. Negative sample results do not certify every unsampled document.

Replacement files come from [Past Papers Academy](https://pastpapersacademy.com/past-papers/). Each accepted PDF has matching subject, year, session, component, page count, geometry and original content. The original and candidate word positions match within 0.05 points. The accepted PDFs are published unchanged; their page content is not edited. Both decoded PDF content/Form objects and extracted text were checked for known third-party marks. This does not guarantee absence of every unknown type of watermark.

## Release contents

| Subject               |  QP |  MS | Insert | Regenerated practice images |
| --------------------- | --: | --: | -----: | --------------------------: |
| Computer Science 9618 |   4 |   4 |      1 |                         120 |
| Biology 9700          |   6 |   0 |      0 |                         129 |
| Chemistry 9701        |   6 |   6 |      0 |                         274 |
| Physics 9702          |   6 |   6 |      0 |                         267 |
| Economics 9708        |   4 |   4 |      0 |                         236 |
| Total                 |  26 |  20 |      1 |                       1,026 |

The affected practice material contains 286 question records and 1,118 unique image objects. In addition to 1,026 regenerated images, 92 existing Biology MS images retain their original bytes because the replacement MS files also contain watermarks. All images use a new immutable release namespace. Existing official question parts, answer choices, correct answers, marking text, marks, crop coordinates and image order are preserved. The accepted Insert is included in the regenerated practice images.

The original R2 objects remain available for rollback. Publication changes only the affected paper metadata, image references/source provenance in question records, and the one replaced Insert resource. Other resources, student work and scoring records are outside the release. The SQL import has exact old-value assertions and an inverse rollback artifact.

## 待处理的 23 份原文件

这些原件继续保留，不能视为已经解决水印问题。

| 文件                                       | 检测结果与未替换原因                             |
| ------------------------------------------ | ------------------------------------------------ |
| `9696_s26_qp_12.pdf`, `9696_s26_ms_12.pdf` | PapaCambridge；替代站没有 A Level Geography 9696 |
| `9696_s26_qp_22.pdf`, `9696_s26_ms_22.pdf` | PapaCambridge；替代站没有 A Level Geography 9696 |
| `9696_s26_qp_32.pdf`, `9696_s26_ms_32.pdf` | PapaCambridge；替代站没有 A Level Geography 9696 |
| `9696_s26_qp_42.pdf`, `9696_s26_ms_42.pdf` | PapaCambridge；替代站没有 A Level Geography 9696 |
| `9700_s26_ms_14.pdf`                       | 替代站的同卷 MS 也含 PapaCambridge 页内水印      |
| `9700_s26_ms_24.pdf`                       | 替代站的同卷 MS 也含 PapaCambridge 页内水印      |
| `9700_s26_ms_37.pdf`                       | 替代站的同卷 MS 也含 PapaCambridge 页内水印      |
| `9700_s26_ms_38.pdf`                       | 替代站的同卷 MS 也含 PapaCambridge 页内水印      |
| `9700_s26_ms_44.pdf`                       | 替代站的同卷 MS 也含 PapaCambridge 页内水印      |
| `9700_s26_ms_54.pdf`                       | 替代站的同卷 MS 也含 PapaCambridge 页内水印      |
| `9618_s21_gt.pdf`                          | PapersDaddy 页内文字；替代站未提供对应 GT PDF    |
| `9618_s22_gt.pdf`                          | PapersDaddy 页内文字；替代站未提供对应 GT PDF    |
| `9618_s23_gt.pdf`                          | PapersDaddy 页内文字；替代站未提供对应 GT PDF    |
| `9618_s24_gt.pdf`                          | PapersDaddy 页内文字；替代站未提供对应 GT PDF    |
| `9618_s26_gt.pdf`                          | PapaCambridge；替代站未提供对应 GT PDF           |
| `9696_s26_in_12.pdf`                       | PapaCambridge；替代站没有该科目                  |
| `9696_s26_in_22.pdf`                       | PapaCambridge；替代站没有该科目                  |
| `9696_s26_in_32.pdf`                       | PapaCambridge；替代站没有该科目                  |
| `9696_s26_in_42.pdf`                       | PapaCambridge；替代站没有该科目                  |

45 份已部署附加 PDF 中，10 份命中已知页内标记；其中 `9618_s26_in_23.pdf` 有合格替代文件，另外 9 份列于上表。现有 ER 与六份 Syllabus 未命中已知页内标记。此次线上资源清单中没有 Confidential Instructions PDF，该类型没有可审计的已部署文件。

## 单独保留为未验证的抽样

下列六个卷号的 QP 与 MS，共 12 个请求，原下载接口返回 404：

- `0625_w23_qp_23`、`0625_w23_qp_12`
- `0625_s24_qp_13`、`0625_w24_qp_22`
- `0625_m25_qp_22`、`0625_m25_qp_12`

这些记录没有原始 PDF 可供水印验证，未标记为无水印。它们与已经确认有水印但缺少合格替代源的 23 份文件分别记录。

## Scope corrections

`9708_s24_qp_12.pdf` and its MS are unavailable from Academy, but 2024 was not triggered for replacement. `9702_s26_ms_21.pdf` and `9700_s26_ci_38.pdf` do not exist in the deployed snapshot used by this release. These source-research observations are not outstanding replacement items in this release.

## Verification receipts

Local evidence is retained in `D:/Project/EXPW/deployment-watermark-remediation-20261017/`, including the original snapshot, seeded sample results, candidate checks, complete pending list, practice rendering audit, publication manifest, upload/readback receipts, exact before/after database checks and rollback SQL. No credentials are included in this report.

### Completed production checks

- All 1,165 R2 objects (189,314,566 bytes) were read back and SHA-256 verified before publication.
- The atomic D1 import updated exactly 313 intended records: 26 papers, 286 questions and one Insert resource. All changed column values match the staged release after publication.
- Public downloads of all 46 replacement QP/MS PDFs and all 1,118 practice images have matching SHA-256 hashes. The authenticated Insert is verified by its R2 hash and exact D1 resource pointer; anonymous resource access remains HTTP 401.
- All 286 local grading contexts load correctly. Correct official answers score full marks for 180 MCQs. No live model grading requests or student submissions were created.
- The local SQL rehearsal verified the exact forward change, exact inverse rollback, and transaction rollback when a before-value assertion fails. Maximum SQL statement size is 67,574 bytes.
- Existing Cloudflare content, AS/A Level archives and AS/A Level practice smoke tests passed.
- Paper download links use the new document hash query parameter; refresh the subject page and download again to obtain the new source. Previously saved local PDFs need to be downloaded again.

The [machine-readable release report](watermark-remediation-2026-10-18.json) records the accepted source URLs/hashes, unresolved items and evidence-file fingerprints.
