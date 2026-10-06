import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  hasStructuredContent,
  normalizeStructuredDocument,
  orderedImages,
  pairedMarkScheme,
  stableStructuredQuestionId,
  structuredDisplayBlocks,
  validateResourcePackage,
} from "../shared/structured-content.js";

const fragment = (storageKey, order = 0) => ({
  storageKey, url: "/api/content/" + storageKey, page: 2,
  crop: { x: 40, y: 80, width: 515, height: 200 }, order,
});
const bundle = {
  schemaVersion: 1, subjectCode: "9618",
  files: ["9618/qp.pdf", "9618/ms.pdf", "9618/qp-q1.png", "9618/ms-q1.png", "9618/textbook.pdf"].map((storageKey) => ({ storageKey })),
  papers: [{ slug: "9618_s24_qp_11", paperNumber: 1, totalMarks: 75, durationMinutes: 90, qpStorageKey: "9618/qp.pdf", msStorageKey: "9618/ms.pdf" }],
  resources: [{ id: "9618-textbook", title: "Computer Science textbook", kind: "textbook", storageKey: "9618/textbook.pdf" }],
  questions: [{
    id: stableStructuredQuestionId("9618", "9618_s24_qp_11", 1),
    paperSlug: "9618_s24_qp_11", questionNo: 1, questionType: "structured", maxMarks: 8,
    content: {
      sharedMaterials: [{ type: "text", text: "Use the supplied algorithm for every part." }],
      blocks: [{ type: "code", text: "DECLARE Total : INTEGER\nTotal <- 0" }],
      parts: [{
        id: "q1-a", label: "(a)", maxMarks: 3, prompt: [{ type: "text", text: "Trace the algorithm." }],
        children: [{ id: "q1-a-i", label: "(i)", maxMarks: 2, prompt: [{ type: "table", headers: ["Step", "Total"], rows: [[1, 0]] }], dependsOn: ["q1-a"] }],
      }],
      images: [fragment("9618/qp-q1.png")],
    },
    markScheme: { images: [fragment("9618/ms-q1.png")], parts: [{ partId: "q1-a", blocks: [{ type: "text", text: "Award one mark for each correct value." }] }] },
  }],
};

assert.deepEqual(validateResourcePackage(bundle), { valid: true, errors: [] });
const paperFiveArchive = structuredClone(bundle);
paperFiveArchive.subjectCode = "9702";
paperFiveArchive.papers = [{ slug: "9702_s26_qp_54", paperNumber: 5, year: 2026, season: "s", variant: 4, paperType: "structured", totalMarks: 30, durationMinutes: 75, qpStorageKey: "9618/qp.pdf", msStorageKey: "9618/ms.pdf" }];
paperFiveArchive.questions = [];
assert.deepEqual(validateResourcePackage(paperFiveArchive), { valid: true, errors: [] }, "Paper 5 originals are valid archive content.");
const unsupportedPaper = structuredClone(paperFiveArchive);
unsupportedPaper.papers[0].slug = "9702_s26_qp_64";
unsupportedPaper.papers[0].paperNumber = 6;
assert.equal(validateResourcePackage(unsupportedPaper).valid, false);
paperFiveArchive.questions = [{ ...structuredClone(bundle.questions[0]), paperSlug: "9702_s26_qp_54", id: stableStructuredQuestionId("9702", "9702_s26_qp_54", 1) }];
assert.ok(validateResourcePackage(paperFiveArchive).errors.some((error) => error.path === "questions[0]"), "Expanding archive components must not implicitly enable Paper 5 in the question bank.");
assert.equal(stableStructuredQuestionId("9618", "9618_s24_qp_11", 1), "CIE-ASAL-9618-9618_s24_qp_11-01");
const copy = () => structuredClone(bundle);
const rejected = (mutate, expectedPath) => {
  const changed = copy();
  mutate(changed);
  const result = validateResourcePackage(changed);
  assert.equal(result.valid, false, "Invalid package must be rejected.");
  assert.ok(result.errors.some((error) => error.path === expectedPath), JSON.stringify(result.errors));
};

rejected((value) => { value.schemaVersion = 99; }, "schemaVersion");
rejected((value) => { value.questions[0].id = "unrelated-question"; }, "questions[0].id");
rejected((value) => { value.questions.push(value.questions[0]); }, "questions[1].id");
rejected((value) => { value.questions[0].paperSlug = "9618_w23_qp_21"; }, "questions[0].paperSlug");
rejected((value) => { value.questions[0].questionType = "mcq"; }, "questions[0]");
rejected((value) => {
  value.papers[0].slug = "9618_s24_qp_41";
  value.papers[0].paperNumber = 4;
  value.questions[0].paperSlug = value.papers[0].slug;
  value.questions[0].id = stableStructuredQuestionId("9618", value.papers[0].slug, 1);
}, "questions[0]");
rejected((value) => { value.questions[0].maxMarks = 0; }, "questions[0].maxMarks");
rejected((value) => { value.questions[0].content.parts[0].children[0].dependsOn = ["different-parent-part"]; }, "questions[0].content.parts[0].children[0]");
rejected((value) => { value.questions[0].content.parts[0].children[0].id = "q1-a"; }, "questions[0].content.parts[0].children[0]");
rejected((value) => { value.questions[0].content.parts[0].maxMarks = -1; }, "questions[0].content.parts[0].maxMarks");
rejected((value) => { value.questions[0].markScheme = {}; }, "questions[0].markScheme");
rejected((value) => { value.questions[0].content = {}; }, "questions[0].content");
rejected((value) => { value.questions[0].content.images[0].storageKey = "undeclared.png"; }, "questions[0].content.images[0].storageKey");
rejected((value) => { value.questions[0].content.images[0].storageKey = "../private.png"; }, "questions[0].content.images[0].storageKey");
rejected((value) => { value.questions[0].markScheme.images[0].page = 0; }, "questions[0].markScheme.images[0].page");
rejected((value) => { value.questions[0].markScheme.images[0].crop.height = 0; }, "questions[0].markScheme.images[0].crop");
rejected((value) => { value.questions[0].markScheme.images[0].url = "https://third-party.example/asset.png"; }, "questions[0].markScheme.images[0].url");
rejected((value) => { value.resources[0].storageKey = "undeclared-book.pdf"; }, "resources[0].storageKey");
const discountedPaper = copy();
discountedPaper.papers[0].sourceQuestionCount = 30;
discountedPaper.papers[0].discountedQuestions = [2];
assert.equal(validateResourcePackage(discountedPaper).valid, true);
for (const discountedQuestions of [null, {}, "2"]) {
  rejected((value) => { value.papers[0].discountedQuestions = discountedQuestions; }, "papers[0].discountedQuestions");
}
for (const discountedQuestions of [[0], [-1], [1.5], ["2"], [31], [2, 2]]) {
  const invalidDiscounted = structuredClone(discountedPaper);
  invalidDiscounted.papers[0].discountedQuestions = discountedQuestions;
  const result = validateResourcePackage(invalidDiscounted);
  assert.equal(result.valid, false);
  assert(result.errors.some((error) => error.path.startsWith("papers[0].discountedQuestions[")));
}

// Malformed JSON shapes must produce useful validation errors, never crashes.
for (const value of [null, [], "package", 1]) {
  assert.deepEqual(validateResourcePackage(value), { valid: false, errors: [{ path: "$", message: "Expected an object." }] });
}
for (const key of ["files", "resources", "papers", "questions"]) {
  for (const value of [{}, null, "entries"]) rejected((changed) => { changed[key] = value; }, key);
  for (const value of [null, [], "entry", 1]) rejected((changed) => { changed[key][0] = value; }, `${key}[0]`);
}
for (const document of ["content", "markScheme"]) {
  rejected((value) => { value.questions[0][document] = null; }, `questions[0].${document}`);
  for (const key of ["images", "parts", "blocks"]) {
    for (const shape of [{}, null, "entries"]) {
      rejected((value) => { value.questions[0][document][key] = shape; }, `questions[0].${document}.${key}`);
    }
    rejected((value) => { value.questions[0][document][key] = [null]; }, `questions[0].${document}.${key}[0]`);
  }
}
rejected((value) => { value.questions[0].content.sharedMaterials = {}; }, "questions[0].content.sharedMaterials");
rejected((value) => { value.questions[0].content.parts[0].prompt = {}; }, "questions[0].content.parts[0].prompt");
rejected((value) => { value.questions[0].content.parts[0].children = {}; }, "questions[0].content.parts[0].children");
rejected((value) => { value.questions[0].content.parts[0].dependsOn = {}; }, "questions[0].content.parts[0].dependsOn");
rejected((value) => { value.questions[0].content.parts[0].dependsOn = [null]; }, "questions[0].content.parts[0]");
rejected((value) => { value.questions[0].markScheme.parts[0].partId = "other-question-part"; }, "questions[0].markScheme.parts[0].partId");
rejected((value) => { value.questions[0].markScheme.parts[0].blocks = {}; }, "questions[0].markScheme.parts[0].blocks");
for (const number of [0, -1, 1.5, "1", null]) {
  rejected((value) => { value.questions[0].questionNo = number; }, "questions[0].questionNo");
}
for (const [key, value] of Object.entries({ paperNumber: 2, year: 2025, season: "w", variant: 2 })) {
  rejected((changed) => { changed.papers[0][key] = value; }, `papers[0].${key}`);
}
const consistentPaper = copy();
Object.assign(consistentPaper.papers[0], { year: 2024, season: "s", variant: 1, status: "published" });
consistentPaper.resources[0].status = "archived";
assert.equal(validateResourcePackage(consistentPaper).valid, true);
rejected((value) => { value.papers[0].status = "archived"; }, "papers[0].status");
rejected((value) => { value.resources[0].status = "processing"; }, "resources[0].status");
rejected((value) => { value.resources.push(value.resources[0]); }, "resources[1].id");
rejected((value) => { value.resources.push({ ...value.resources[0], id: "other-resource" }); }, "resources[1].storageKey");
rejected((value) => { value.files.push(value.files[0]); }, "files[5].storageKey");
rejected((value) => { value.files[0].id = "same"; value.files[1].id = "same"; }, "files[1].id");
rejected((value) => { value.questions[0].content.blocks = [{ type: "table", headers: {}, rows: [[1]] }]; }, "questions[0].content.blocks[0].headers");
rejected((value) => { value.questions[0].content.blocks = [{ type: "table", rows: [null] }]; }, "questions[0].content.blocks[0].rows[0]");
rejected((value) => { value.questions[0].content.blocks = [{ type: "code", text: {} }]; }, "questions[0].content.blocks[0].text");
rejected((value) => { value.questions[0].content.images[0].url = {}; }, "questions[0].content.images[0].url");
rejected((value) => { value.questions[0].paperSlug = {}; }, "questions[0].paperSlug");
rejected((value) => { value.questions[0].paperSlug = { toString: null }; }, "questions[0].paperSlug");
rejected((value) => { value.questions[0].questionNo = { toString: null }; }, "questions[0].questionNo");
rejected((value) => { value.subjectCode = { toString: null }; }, "subjectCode");
rejected((value) => { value.questions[0].content.images[0].crop = []; }, "questions[0].content.images[0].crop");
rejected((value) => {
  value.questions[0].content = { parts: [{ id: "a", label: "(a)", maxMarks: 8, prompt: [], children: [] }] };
}, "questions[0].content");

const cliDirectory = await mkdtemp(join(tmpdir(), "expassway-invalid-package-"));
try {
  const manifest = join(cliDirectory, "package.json");
  await writeFile(manifest, JSON.stringify({ ...copy(), files: {} }));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../tools/validate-resource-package.mjs", import.meta.url)), manifest], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /files: Expected an array/);
  assert.doesNotMatch(result.stderr, /TypeError|at validateResourcePackage/);
} finally {
  await rm(cliDirectory, { recursive: true, force: true });
}

const normalized = normalizeStructuredDocument(JSON.stringify(bundle.questions[0].content));
assert.equal(hasStructuredContent(normalized), true);
assert.equal(hasStructuredContent({ blocks: [{ type: "code", text: "OUTPUT 1" }] }), true);
assert.equal(hasStructuredContent({ blocks: [{ type: "table", rows: [[1, 2]] }] }), true);
assert.equal(hasStructuredContent({}), false);
const blocks = structuredDisplayBlocks(normalized);
assert.equal(blocks[0].text, "Use the supplied algorithm for every part.");
assert.equal(blocks[1].type, "code");
assert.equal(blocks[2].text, "(a) [3]");
assert.equal(blocks[4].text, "(i) [2]");
assert.equal(blocks[5].type, "table");
assert.equal(blocks[5].depth, 1);
assert.deepEqual(orderedImages([{ url: "/later.png", order: 2 }, { url: "/first.png", order: 1 }]).map((image) => image.url), ["/first.png", "/later.png"]);

const originalQuestion = {
  parts: [{ id: "part-a", label: "(a)", maxMarks: 3, children: [{ id: "part-a-i", label: "(i)", maxMarks: 2 }] }],
};
const officialScheme = { parts: [
  { partId: "part-a-i", blocks: [{ type: "code", text: "  OUTPUT Result" }] },
  { partId: "part-a", blocks: [{ type: "text", text: "Official criterion." }] },
] };
const paired = pairedMarkScheme(officialScheme, originalQuestion);
assert.deepEqual(paired.parts.map((part) => part.partId), ["part-a-i", "part-a"]);
assert.deepEqual(paired.parts.map((part) => part.label), ["(i)", "(a)"]);
assert.deepEqual(paired.parts.map((part) => part.maxMarks), [2, 3]);
assert.deepEqual(paired.parts.map((part) => part.depth), [1, 0]);
assert.deepEqual(paired.parts.map((part) => part.blocks), officialScheme.parts.map((part) => part.blocks));
assert.equal(officialScheme.parts[0].label, undefined, "Pairing must not mutate official source data.");
const pairedBlocks = structuredDisplayBlocks(paired);
assert.deepEqual(pairedBlocks.map((block) => block.text), ["(i) [2]", "  OUTPUT Result", "(a) [3]", "Official criterion."]);
assert.deepEqual(pairedBlocks.map((block) => block.depth), [1, 1, 0, 0]);
assert.equal(pairedBlocks.some((block) => block.text.includes("part-a")), false);
assert.deepEqual(pairedMarkScheme(JSON.stringify(officialScheme), JSON.stringify(originalQuestion)), paired);

console.log("Structured resource package checks passed.");
