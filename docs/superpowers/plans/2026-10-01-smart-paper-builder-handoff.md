# Smart Paper Builder v1 implementation handoff

Implementation branch: `feature/smart-paper-builder-v1`.

## Implemented workflow

- `pages/paper-builder.html` provides manual selection, smart generation, and My Papers modes sharing one ordered basket.
- Active subjects remain selectable without a curriculum. Section filtering and automatic selection require reviewed mappings.
- Manual filters include year, season, paper number, variant, reviewed section, source paper code, and original question number. Image text search is not offered.
- The basket supports exact duplicate prevention, remove, move, drag, section sort, marks, same-section replacement, and clear.
- Changes remain in memory until explicit Save. Save persists filters, section targets, order, marks, title, status, and build seed. Reopen with `?paper=<id>`.
- My Papers supports open, copy, download, and delete. The server checks ownership for each saved-paper operation.
- The blueprint shows section counts, total marks, source/year/answer distributions, provenance, estimated duration, and specific warnings. Missing targets block finalization and download.
- B generation preserves section counts, marks, and compatible paper types. Strict selection excludes A questions and their similarity groups. A deficit allows an explicit relaxation of similarity groups only. B papers remain editable.
- Downloads contain `试卷.pdf` and `答案.pdf`, or the four A/B PDFs. Answer PDFs include provenance; question PDFs omit added source metadata. Original numbering already embedded in PNG pixels remains part of the image.
- Desktop exposes filters/results/basket columns; mobile exposes a bottom basket drawer. Images offer enlargement and an original-PNG link.

## Database and build

`migrations/0011_saved_papers.sql` creates `saved_papers` and `saved_paper_items`. All 11 migrations were applied successfully to this isolated worktree's local D1 instance. Remote D1 has not received this migration.

The browser bundle is produced in `.cloudflare-dist/scripts/paper-builder.bundle.js` by the existing `cloudflare:build` command and is not committed as a generated asset.

Local commands from the feature worktree:

```cmd
npm run cloudflare:build
node node_modules\wrangler\bin\wrangler.js dev
```

Then open `http://localhost:8787/pages/paper-builder.html`. The authenticated workflow requires locally configured authentication and published local questions; migrations alone do not copy production questions or credentials.

## Delivery evidence and outstanding validation

Lint completed with zero errors and the 16 existing unrelated warnings. Type checking and the asset build completed successfully. Earlier implementation stages ran API, blueprint, and export smoke checks, but those results predate the final UI and API adjustments.

The final automated suite, authenticated browser workflows, and rendered PDF inspection remain outstanding. The branch has not been merged, pushed, or deployed. Follow the approved design's delivery steps before production rollout.
