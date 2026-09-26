import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(new URL("../scripts/bulk-download.js", import.meta.url), "utf8");
const context = { console, TextEncoder, Blob, Uint8Array, ArrayBuffer, DataView, Date };
vm.runInNewContext(source, context);
const { buildBulkDownloadEntries, sanitizeZipPart } = context.BulkDownload;

const subjects = [
  {
    code: "0625",
    name: "Physics",
    papers: [
      {
        slug: "0625_s23_qp_21",
        year: 2023,
        season: "s",
        paperNumber: 2,
        variant: 1,
        validQuestionCount: 1,
        questions: [
          {
            id: "physics-1",
            questionNo: 1,
            stem: "A test question",
            options: ["A", "B"],
            answer: 1,
            images: [{ url: "/assets/exam-question-images/physics/q01.png" }],
          },
        ],
      },
    ],
  },
];

const result = buildBulkDownloadEntries(subjects);
const names = result.entries.map((entry) => entry.name);
assert.deepEqual(Array.from(names), [
  "0625-Physics/0625_s23_qp_21/questions.json",
  "0625-Physics/0625_s23_qp_21/images/q01-01.png",
  "manifest.json",
]);

const paperJson = result.entries.find((entry) => entry.name.endsWith("questions.json"));
const paper = JSON.parse(paperJson.data);
assert.equal(Object.hasOwn(paper.subject, "papers"), false);
assert.equal(Object.hasOwn(paper.paper, "questions"), false);
assert.equal(paper.questions[0].answer, 1);
assert.equal(paper.questions[0].images[0].url, "images/q01-01.png");
assert.equal(result.entries.find((entry) => entry.name.endsWith("q01-01.png")).sourceUrl, "/assets/exam-question-images/physics/q01.png");
assert.equal(sanitizeZipPart("Physics: Paper 1/2023"), "Physics Paper 1 2023");

console.log("Bulk download entry checks passed.");
