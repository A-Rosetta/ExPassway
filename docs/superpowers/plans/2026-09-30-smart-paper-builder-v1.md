# Smart Paper Builder v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-page authenticated question-bank workflow with manual and smart selection, saved papers, transparent blueprint checks, strict/relaxed equivalent B papers, and ordered PDF/ZIP export.

**Architecture:** Keep the existing `paper-builder.html` entry and current chapter-generation endpoint. Add additive D1 persistence and authenticated routes in the learning API, place reusable blueprint calculations in a pure shared module, and bundle the browser controller through the existing esbuild asset build. The browser maintains one ordered basket and writes only on explicit Save.

**Tech Stack:** Cloudflare Workers, D1, vanilla HTML/CSS/JavaScript, Miniflare smoke tests, jsPDF, esbuild, Node.js test scripts.

**Spec:** `docs/superpowers/specs/2026-09-30-smart-paper-builder-v1-design.md`

## Global Constraints

- Work only on branch `feature/smart-paper-builder-v1` in the isolated worktree.
- Do not stage or modify `tools/classify-all-subjects.mjs` or `tools/classify-static-physics-0625.mjs`.
- Do not apply remote D1 migrations, push, merge, or deploy before explicit user approval.
- Preserve the existing `/api/paper-builder/generate` smart-generation behavior.
- Use explicit Save; do not write to D1 on every basket change.
- Chapter filtering and automated generation require primary reviewed mappings.
- Strict B papers exclude both A-paper question IDs and non-empty similarity groups.
- Relaxed B papers may reuse similarity groups but never exact A-paper questions.
- Question PDFs hide source metadata; answer PDFs include source paper, source question number, and section.
- Initial search excludes OCR/image full-text search.
- All API reads and writes enforce authenticated ownership server-side.

---

### Task 1: Add Saved Paper Schema

**Files:**
- Create: `migrations/0011_saved_papers.sql`
- Modify: `tests/cloudflare-learning-api-smoke.mjs`

**Interfaces:**
- Produces tables `saved_papers` and `saved_paper_items` used by Tasks 3 and 5.
- Produces indexes `idx_saved_papers_user_updated`, `idx_saved_papers_code`, and `idx_saved_papers_parent`.

- [ ] **Step 1: Write the failing migration assertions**

Extend the migration list in `tests/cloudflare-learning-api-smoke.mjs` with `../migrations/0011_saved_papers.sql`, then add:

```js
const savedPaperColumns = await db.prepare("PRAGMA table_info(saved_papers)").all();
assert.deepEqual(
  savedPaperColumns.results.map((column) => column.name),
  [
    "id", "user_id", "paper_code", "title", "subject_code",
    "curriculum_version_id", "build_mode", "build_seed", "status",
    "question_count", "total_marks", "settings", "blueprint",
    "parent_paper_id", "created_at", "updated_at",
  ],
);
const savedItemColumns = await db.prepare("PRAGMA table_info(saved_paper_items)").all();
assert.deepEqual(
  savedItemColumns.results.map((column) => column.name),
  ["paper_id", "question_id", "position", "marks", "section_id", "source_group", "created_at"],
);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/cloudflare-learning-api-smoke.mjs`

Expected: FAIL while reading missing `migrations/0011_saved_papers.sql`.

- [ ] **Step 3: Add the additive D1 migration**

Create the two tables exactly as specified in the design. Use D1-compatible checks and defaults:

```sql
CREATE TABLE saved_papers (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  paper_code TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subject_code TEXT NOT NULL REFERENCES exam_subjects(code) ON DELETE RESTRICT,
  curriculum_version_id TEXT REFERENCES curriculum_versions(id) ON DELETE SET NULL,
  build_mode TEXT NOT NULL CHECK (build_mode IN ('manual', 'smart', 'equivalent')),
  build_seed TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  question_count INTEGER NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  total_marks INTEGER NOT NULL DEFAULT 0 CHECK (total_marks >= 0),
  settings TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  blueprint TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(blueprint)),
  parent_paper_id TEXT REFERENCES saved_papers(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE saved_paper_items (
  paper_id TEXT NOT NULL REFERENCES saved_papers(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL REFERENCES question_bank(id) ON DELETE RESTRICT,
  position INTEGER NOT NULL CHECK (position >= 0),
  marks INTEGER NOT NULL DEFAULT 1 CHECK (marks > 0),
  section_id TEXT REFERENCES coursebook_sections(id) ON DELETE SET NULL,
  source_group TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (paper_id, question_id),
  UNIQUE (paper_id, position)
);
```

- [ ] **Step 4: Run the learning API test**

Run: `node tests/cloudflare-learning-api-smoke.mjs`

Expected: PASS and `PRAGMA foreign_key_check` remains empty.

- [ ] **Step 5: Commit**

```bash
git add migrations/0011_saved_papers.sql tests/cloudflare-learning-api-smoke.mjs
git commit -m "feat: add saved paper schema"
```

---

### Task 2: Add Pure Blueprint Calculations

**Files:**
- Create: `shared/paper-blueprint.js`
- Create: `tests/paper-blueprint-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `buildPaperBlueprint(items, options)`.
- Produces `buildBlueprintIssues(blueprint, options)`.
- Produces `compareEquivalentPapers(sourceItems, equivalentItems)`.
- A blueprint item has `{ id, answer, marks, paperSlug, year, season, difficulty, sectionId, sectionCode, sourceGroup, estimatedSeconds }`.

- [ ] **Step 1: Write failing pure-function tests**

Create assertions covering:

```js
const blueprint = buildPaperBlueprint([
  { id: "q1", answer: 0, marks: 1, paperSlug: "0625_s24_qp_22", year: 2024, season: "s", sectionId: "motion", sectionCode: "1.2", sourceGroup: "g1", estimatedSeconds: 60 },
  { id: "q2", answer: 0, marks: 2, paperSlug: "0625_s24_qp_22", year: 2024, season: "s", sectionId: "motion", sectionCode: "1.2", sourceGroup: "g1", estimatedSeconds: 75 },
  { id: "q3", answer: 2, marks: 1, paperSlug: "0625_w23_qp_21", year: 2023, season: "w", sectionId: "energy", sectionCode: "1.7", sourceGroup: "g3", estimatedSeconds: 90 },
]);
assert.equal(blueprint.questionCount, 3);
assert.equal(blueprint.totalMarks, 4);
assert.equal(blueprint.estimatedSeconds, 225);
assert.deepEqual(blueprint.answerDistribution, { A: 2, B: 0, C: 1, D: 0, unknown: 0 });
assert.equal(blueprint.sections.motion.count, 2);

const issues = buildBlueprintIssues(blueprint, { targetSections: { motion: 3 }, difficultyCoverageMinimum: 0.7 });
assert.ok(issues.some((issue) => issue.code === "SIMILAR_GROUP_REPEAT"));
assert.ok(issues.some((issue) => issue.code === "SECTION_TARGET_MISSING" && issue.blocking));
```

Also assert that answer imbalance is emitted only at 20 or more questions and source concentration is emitted over 25%.

- [ ] **Step 2: Run the test to verify it fails**

Run: `node tests/paper-blueprint-smoke.mjs`

Expected: FAIL with missing `shared/paper-blueprint.js`.

- [ ] **Step 3: Implement minimal deterministic calculations**

Use plain objects and arrays. Do not access DOM, D1, or network APIs. Return JSON-serializable values. Issue objects use:

```js
{
  code: "SOURCE_CONCENTRATION",
  severity: "warning",
  blocking: false,
  questionIds: ["q1", "q2"],
  details: { paperSlug: "0625_s24_qp_22", count: 2, ratio: 0.6667 },
}
```

- [ ] **Step 4: Add the smoke test to `test:unit` and run it**

Run: `node tests/paper-blueprint-smoke.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/paper-blueprint.js tests/paper-blueprint-smoke.mjs package.json
git commit -m "feat: add paper blueprint checks"
```

---

### Task 3: Add Authenticated Question Search

**Files:**
- Modify: `cloudflare/learning-api.js`
- Modify: `cloudflare/worker.js`
- Modify: `tests/cloudflare-learning-api-smoke.mjs`
- Modify: `tests/cloudflare-worker-routing-smoke.mjs`

**Interfaces:**
- Produces `GET /api/paper-builder/questions`.
- Returns `{ items, page, pageSize, total, totalPages }`.
- Each item supplies the fields consumed by `buildPaperBlueprint` plus `stem`, `options`, `images`, provenance, and mapping status.

- [ ] **Step 1: Add failing endpoint tests**

Seed one inactive question and one unreviewed mapping. Assert:

```js
const search = await api(handleLearningApiRequest, db, token, "/api/paper-builder/questions?subjectCode=0610&page=1&pageSize=20");
assert.equal(search.response.status, 200);
assert.ok(search.payload.data.items.some((item) => item.id === "question-2019"));
assert.ok(search.payload.data.items.every((item) => item.active !== false));

const reviewedSection = await api(handleLearningApiRequest, db, token, "/api/paper-builder/questions?subjectCode=0610&sectionId=book-section");
assert.deepEqual(reviewedSection.payload.data.items.map((item) => item.id), ["question-2019"]);

const badPageSize = await api(handleLearningApiRequest, db, token, "/api/paper-builder/questions?subjectCode=0610&pageSize=101");
assert.equal(badPageSize.response.status, 400);
```

Add a worker-routing assertion that an unauthenticated search returns 401 instead of static-asset fallback.

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `node tests/cloudflare-learning-api-smoke.mjs && node tests/cloudflare-worker-routing-smoke.mjs`

Expected: FAIL with route not found or an asset fallback.

- [ ] **Step 3: Implement bounded query parsing and parameterized SQL**

Add helpers that accept only the documented filters. Require `subjectCode`. Enforce `page >= 1` and `1 <= pageSize <= 50`. Use `exam_papers` for season, paper number, variant, duration, and source question count. Use a primary mapping left join for general browsing and a reviewed primary mapping requirement when `sectionId` is present.

- [ ] **Step 4: Return provenance and duration metadata**

Map each row to:

```js
{
  id, subjectCode, paperSlug, questionNo, stem, options, answer, images,
  difficulty, year, season, paperNumber, variant,
  sectionId, sectionCode, sectionTitleEn, sectionTitleZh,
  mappingStatus, sourceGroup,
  estimatedSeconds,
}
```

`estimatedSeconds` is the source paper duration divided by source question count, converted to seconds. Return `null` when unavailable.

- [ ] **Step 5: Run focused tests**

Expected: both scripts PASS.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/learning-api.js cloudflare/worker.js tests/cloudflare-learning-api-smoke.mjs tests/cloudflare-worker-routing-smoke.mjs
git commit -m "feat: add paper builder question search"
```

---

### Task 4: Add Saved Paper CRUD and Ownership

**Files:**
- Modify: `cloudflare/learning-api.js`
- Modify: `tests/cloudflare-learning-api-smoke.mjs`

**Interfaces:**
- Produces list, create, get, patch, and delete routes under `/api/paper-builder/papers`.
- Save body uses `{ title, subjectCode, curriculumVersionId, buildMode, buildSeed, status, settings, items }`.
- Each item uses `{ questionId, marks, sectionId }`; position is array order.

- [ ] **Step 1: Add failing CRUD and isolation tests**

Create a paper with two questions, assert normalized positions `0, 1`, reopen it, reorder through PATCH, copy through POST using loaded items, and delete it. Assert another user's token receives 404 for get, patch, and delete.

Required create assertion:

```js
assert.match(created.payload.data.paperCode, /^0610-[A-Z0-9]{8}$/);
assert.equal(created.payload.data.questionCount, 2);
assert.equal(created.payload.data.totalMarks, 3);
assert.deepEqual(created.payload.data.items.map((item) => item.position), [0, 1]);
```

- [ ] **Step 2: Run the learning test and verify failure**

Expected: FAIL with route not found.

- [ ] **Step 3: Implement server-side item validation**

Reload all supplied question IDs from D1. Reject inactive, missing, wrong-subject, invalid-answer, or contentless questions. Reject duplicates before writing. Normalize positions from the client array. Recompute counts, marks, provenance fields, and blueprint server-side.

- [ ] **Step 4: Implement explicit replacement saves**

For PATCH, validate the owned paper, update metadata, delete its existing `saved_paper_items`, and batch-insert the normalized replacement items. Preserve the original `paper_code`, `created_at`, and parent relationship.

- [ ] **Step 5: Run CRUD and foreign-key tests**

Expected: PASS, including ownership isolation and `PRAGMA foreign_key_check`.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/learning-api.js tests/cloudflare-learning-api-smoke.mjs
git commit -m "feat: add saved paper management"
```

---

### Task 5: Add Strict and Relaxed Equivalent B Papers

**Files:**
- Modify: `cloudflare/learning-api.js`
- Modify: `tests/cloudflare-learning-api-smoke.mjs`

**Interfaces:**
- Produces `POST /api/paper-builder/papers/:id/equivalent`.
- Accepts `{ allowSimilarGroups: false }` by default.
- Returns the newly saved B paper or `409 EQUIVALENT_POOL_INSUFFICIENT` with section deficits.

- [ ] **Step 1: Seed equivalent candidates and write failing tests**

Add candidates in the same reviewed section with distinct IDs and source groups. Assert strict generation:

```js
assert.equal(equivalent.response.status, 201);
assert.equal(equivalent.payload.data.parentPaperId, sourcePaperId);
assert.equal(equivalent.payload.data.buildMode, "equivalent");
assert.deepEqual(equivalent.payload.data.items.map((item) => item.sectionId), ["book-section", "book-section-2"]);
assert.ok(equivalent.payload.data.items.every((item) => !sourceIds.has(item.questionId)));
assert.ok(equivalent.payload.data.items.every((item) => !sourceGroups.has(item.sourceGroup)));
```

Add a section with only a same-group replacement. Assert strict mode returns structured deficit and relaxed mode succeeds while still excluding exact IDs.

- [ ] **Step 2: Run the test and verify failure**

Expected: route not found.

- [ ] **Step 3: Implement per-section candidate selection**

Load the owned source paper in position order. Group required counts and marks by section. Query eligible reviewed candidates excluding source IDs and, in strict mode, source groups. Track selected groups across sections. Select randomly but preserve source section order and marks pattern.

- [ ] **Step 4: Return exact deficits without partial writes**

Use:

```js
{
  code: "EQUIVALENT_POOL_INSUFFICIENT",
  details: {
    allowSimilarGroups: false,
    sections: [{ sectionId: "book-section", required: 3, available: 2 }],
  },
}
```

Create the B paper only after every section has enough candidates.

- [ ] **Step 5: Run tests**

Expected: strict, relaxed, exact-ID exclusion, and ownership tests PASS.

- [ ] **Step 6: Commit**

```bash
git add cloudflare/learning-api.js tests/cloudflare-learning-api-smoke.mjs
git commit -m "feat: generate equivalent B papers"
```

---

### Task 6: Extend Browser API and PDF Export

**Files:**
- Modify: `scripts/api.js`
- Modify: `scripts/paper-export.js`
- Modify: `tests/paper-export-smoke.mjs`

**Interfaces:**
- Browser methods: `searchPaperBuilderQuestions`, `listSavedPapers`, `createSavedPaper`, `getSavedPaper`, `updateSavedPaper`, `deleteSavedPaper`, `generateEquivalentPaper`.
- PDF functions consume ordered groups/items and `{ paperTitle, paperCode, subjectName, totalMarks, generatedAt }`.

- [ ] **Step 1: Extend failing PDF tests**

Assert that question and answer PDFs accept paper metadata, preserve item order, and return metadata:

```js
assert.deepEqual(questionPdf.questionIds, ["q2", "q1"]);
assert.deepEqual(answerPdf.questionIds, ["q2", "q1"]);
assert.equal(questionPdf.totalMarks, 3);
assert.equal(answerPdf.totalMarks, 3);
```

Build normal and A/B ZIPs and assert exact UTF-8 entry names:

```js
assert.deepEqual(normalNames, ["试卷.pdf", "答案.pdf"]);
assert.deepEqual(abNames, ["A卷.pdf", "A卷答案.pdf", "B卷.pdf", "B卷答案.pdf"]);
```

- [ ] **Step 2: Run export test and verify failure**

Expected: missing metadata/order properties or filenames.

- [ ] **Step 3: Add API client methods**

Build query parameters only for defined search filters. Use current token handling and existing `request` helper. DELETE must call the saved-paper route with method `DELETE`.

- [ ] **Step 4: Update PDF rendering**

Remove source-question labels from the question PDF. Add title, subject, total questions, total marks, generated date, paper code, and page footer. Add source paper, source question number, and section to each answer line. Keep question and answer order based on the supplied array.

- [ ] **Step 5: Run export and type checks**

Run: `node tests/paper-export-smoke.mjs && npm run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/api.js scripts/paper-export.js tests/paper-export-smoke.mjs
git commit -m "feat: export saved and equivalent papers"
```

---

### Task 7: Build the Three-Mode Page Shell

**Files:**
- Modify: `pages/paper-builder.html`
- Modify: `assets/paper-builder.css`
- Modify: `scripts/i18n.js`
- Create: `tests/paper-builder-ui-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Required IDs: `paperBuilderModeManual`, `paperBuilderModeSmart`, `paperBuilderModeSaved`, `paperBuilderFilters`, `paperBuilderResults`, `paperBuilderBasket`, `paperBuilderBlueprint`, `paperBuilderSavedList`, `paperBuilderSave`, `paperBuilderPreview`, `paperBuilderDownload`, `paperBuilderEquivalent`.
- The controller in Task 8 binds only to these documented IDs.

- [ ] **Step 1: Write a failing static UI smoke test**

Read `pages/paper-builder.html` and assert all required IDs occur exactly once. Assert old chapter controls remain represented inside the smart-mode panel. Read CSS and assert desktop grid and mobile basket drawer selectors exist.

- [ ] **Step 2: Run the UI test and verify failure**

Run: `node tests/paper-builder-ui-smoke.mjs`

Expected: FAIL on missing mode and basket IDs.

- [ ] **Step 3: Replace the page shell surgically**

Keep the existing global styles, scripts, login behavior, and back link. Add semantic tabs/buttons with `aria-selected`, one shared basket, a blueprint tab, and a native `<dialog>` for image enlargement. Do not add external UI dependencies.

- [ ] **Step 4: Add responsive CSS**

Use a desktop grid with bounded left/right columns and a flexible center. At mobile width, hide the persistent right column and expose it as a fixed drawer controlled by a visible basket button. Preserve existing color variables and typography.

- [ ] **Step 5: Add bilingual labels and run test**

Add English and Chinese keys for every new visible control, empty state, warning, and error. Run the UI smoke test and typecheck.

- [ ] **Step 6: Commit**

```bash
git add pages/paper-builder.html assets/paper-builder.css scripts/i18n.js tests/paper-builder-ui-smoke.mjs package.json
git commit -m "feat: add smart paper builder layout"
```

---

### Task 8: Implement Browser State, Search, Basket, and Save

**Files:**
- Modify: `scripts/paper-builder.js`
- Create: `tests/paper-builder-state-smoke.mjs`
- Modify: `package.json`

**Interfaces:**
- Export pure helpers for Node tests: `createPaperBuilderState`, `addBasketItem`, `removeBasketItem`, `moveBasketItem`, `sortBasketItems`, `serializeSavedPaper`.
- Browser startup remains automatic only when `window` and `document` exist.

- [ ] **Step 1: Write failing state tests**

Assert duplicate prevention, stable movement, chapter auto-sort, dirty state, and normalized save payload:

```js
let state = createPaperBuilderState();
state = addBasketItem(state, { id: "q2", sectionCode: "1.7", questionNo: 9, marks: 1 });
state = addBasketItem(state, { id: "q1", sectionCode: "1.2", questionNo: 4, marks: 1 });
assert.throws(() => addBasketItem(state, { id: "q1" }), /already selected/i);
state = sortBasketItems(state);
assert.deepEqual(state.items.map((item) => item.id), ["q1", "q2"]);
assert.equal(serializeSavedPaper(state).items[0].questionId, "q1");
```

- [ ] **Step 2: Run state test and verify failure**

Expected: missing exports.

- [ ] **Step 3: Implement testable state helpers**

Keep helpers immutable and DOM-free. Make the browser controller consume them rather than mutating arrays in multiple event handlers.

- [ ] **Step 4: Implement manual search and question cards**

Bind filters to the new API. Render 20 results per page, image zoom dialog, provenance, answer toggle, reviewed/pending chapter state, and add/remove actions. Never auto-select another subject.

- [ ] **Step 5: Integrate existing smart generation**

Retain section-count validation and current 80-question maximum. Convert returned grouped questions into basket items. Reject duplicates without clearing existing selections.

- [ ] **Step 6: Implement basket and explicit Save**

Render remove, move, drag, mark input, clear, and auto-sort controls. Track dirty state and register `beforeunload`. Create or patch through the API only on Save. Reopening `?paper=<id>` hydrates the same state.

- [ ] **Step 7: Implement My Papers mode**

Render newest-first saved papers with open, copy, download, and delete-confirmation actions. Copy uses the loaded source paper and creates a new manual paper with a new title suffix.

- [ ] **Step 8: Run state, UI, and type tests**

Run: `node tests/paper-builder-state-smoke.mjs && node tests/paper-builder-ui-smoke.mjs && npm run typecheck`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/paper-builder.js tests/paper-builder-state-smoke.mjs package.json
git commit -m "feat: implement manual and saved paper workflow"
```

---

### Task 9: Integrate Blueprint and A/B Workflows in the UI

**Files:**
- Modify: `scripts/paper-builder.js`
- Modify: `tests/paper-builder-state-smoke.mjs`

**Interfaces:**
- Consumes Task 2 blueprint functions and Task 5 equivalent endpoint.
- Adds UI actions `replaceQuestion`, `generateEquivalent`, and `generateEquivalentRelaxed` inside the controller.

- [ ] **Step 1: Add failing state/controller assertions**

Assert blueprint recalculation after add/remove/mark changes. Assert strict deficit data is converted to per-section messages and that relaxed generation is never invoked without an explicit action.

- [ ] **Step 2: Run the test and verify failure**

Expected: missing blueprint/equivalent behavior.

- [ ] **Step 3: Render transparent blueprint indicators**

Show section counts, source distribution, answer distribution, duration, difficulty only with at least 70% coverage, and exact warning rows. Blocking issues disable finalization/download but not Save Draft.

- [ ] **Step 4: Implement replace action**

Search within the same section, exclude current basket IDs, and prefer a different source group. Replace in the same position and preserve marks.

- [ ] **Step 5: Implement strict and relaxed B generation**

Require the A paper to be saved. On strict deficit, show exact section required/available values and a separate button labeled to allow same similarity groups. A successful result opens the saved B paper and displays comparison facts.

- [ ] **Step 6: Run focused tests and commit**

```bash
node tests/paper-builder-state-smoke.mjs
git add scripts/paper-builder.js tests/paper-builder-state-smoke.mjs
git commit -m "feat: add blueprint and equivalent paper UI"
```

---

### Task 10: Build, Integrate, and Verify Locally

**Files:**
- Modify only files required to fix defects found by verification.
- Do not commit `.cloudflare-dist/` output.

**Interfaces:**
- Produces a locally verified branch and evidence report; no remote side effects.

- [ ] **Step 1: Run the full automated suite**

Run: `npm run check`

Expected: exit code 0. Existing unrelated lint warnings may remain, but no new warnings should be introduced by changed files.

- [ ] **Step 2: Apply migrations to a disposable/local D1 database**

Run: `npx wrangler d1 migrations apply expassway-db --local`

Then run: `npx wrangler d1 execute expassway-db --local --command "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('saved_papers', 'saved_paper_items') ORDER BY name;"`

Expected: both table names are returned. Do not use `--remote`.

- [ ] **Step 3: Start local Wrangler and inspect the builder**

Run `npx wrangler dev` after ensuring `.cloudflare-dist` exists from `npm run cloudflare:build`. Use an authenticated local test account or the existing supported local login flow.

- [ ] **Step 4: Run browser verification**

Verify desktop and mobile flows:

1. select each available subject without fallback;
2. filter and paginate questions;
3. add, remove, reorder, and replace;
4. mix smart-generated and manual questions;
5. save, leave, reopen, copy, and delete;
6. view blueprint warnings;
7. trigger strict B deficit and explicit relaxed generation;
8. download normal and A/B ZIPs;
9. inspect all PDFs for order, source visibility rules, footer, page fit, and answer correspondence.

- [ ] **Step 5: Review the diff and repository state**

Run:

```bash
git diff --check
git status --short
git log --oneline --decorate -12
```

Confirm the original classification scripts are absent from the feature diff.

- [ ] **Step 6: Commit verification fixes**

Stage only verified feature files interactively, then commit:

```bash
git add -p -- migrations shared cloudflare pages assets scripts tests package.json
git commit -m "fix: complete smart paper builder verification"
```

- [ ] **Step 7: Stop before remote actions**

Report local test evidence, changed files, migration details, known limitations, and screenshots/PDF observations. Ask for explicit approval before merging, pushing, remote migration, or Cloudflare deployment.
