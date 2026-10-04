import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { inflateSync } from "node:zlib";
import {
  answerLetter,
  createAnswerKeyPdf,
  createEquivalentPaperZip,
  createPaperZip,
  createQuestionPaperPdf,
  createMarkSchemePdf,
  structuredTextBlocks,
} from "../scripts/paper-export.js";
await import("../scripts/bulk-download.js");

const png = new Uint8Array(await readFile(new URL(
  "../assets/exam-question-images/cie-igcse-physics-0625/papers/0625_w24_qp_23/q01.png",
  import.meta.url
)));
const groups = [{
  section: { chapterNo: 1, chapterTitleEn: "Forces", sectionCode: "1.1", titleEn: "Scalars and vectors" },
  questions: [
    {
      id: "q2",
      answer: 2,
      marks: 2,
      paperSlug: "0625_w24_qp_23",
      questionNo: 9,
      stem: "Which quantity is measured in newtons?",
      options: { A: "mass", B: "time", C: "force", D: "distance" },
      images: [],
    },
    {
      id: "q1",
      answer: 0,
      marks: 1,
      paperSlug: "0625_w24_qp_23",
      questionNo: 4,
      images: [{ url: "/q1.png" }],
    },
  ],
}];
const loadImage = async () => png;
const metadata = {
  paperTitle: "Motion diagnostic",
  paperCode: "0625-AB12CD34",
  subjectName: "Physics",
  totalMarks: 3,
  generatedAt: "2026-09-30T08:00:00.000Z",
};

const questionPdf = await createQuestionPaperPdf(groups, { ...metadata, loadImage });
assert.equal(questionPdf.questionCount, 2);
assert.deepEqual(questionPdf.questionIds, ["q2", "q1"]);
assert.equal(questionPdf.totalMarks, 3);
assert.equal(questionPdf.paperCode, "0625-AB12CD34");
assert.ok(questionPdf.pageCount >= 1);
assert.equal(new TextDecoder().decode(questionPdf.bytes.slice(0, 5)), "%PDF-");

const answerPdf = await createAnswerKeyPdf(groups, metadata);
assert.equal(answerPdf.answerCount, 2);
assert.deepEqual(answerPdf.questionIds, ["q2", "q1"]);
assert.equal(answerPdf.totalMarks, 3);
assert.equal(answerPdf.paperCode, "0625-AB12CD34");
assert.ok(answerPdf.pageCount >= 1);
assert.equal(new TextDecoder().decode(answerPdf.bytes.slice(0, 5)), "%PDF-");
assert.equal(answerLetter(0), "A");
assert.equal(answerLetter(2), "C");
assert.equal(answerLetter(3), "D");

const structuredGroups = [{ section: {}, questions: [{
  id: "9618-q2", questionType: "structured", maxMarks: 7, marks: 1, answer: null,
  content: {
    blocks: [{ type: "text", text: "A processor carries out instructions." }],
    parts: [{ id: "part-a", label: "(a)", maxMarks: 3, prompt: [{ type: "code", text: "IF ready THEN\n  OUTPUT result\nENDIF" }] }],
  },
  markScheme: { parts: [{ partId: "part-a", blocks: [{ type: "table", headers: ["Point", "Marks"], rows: [["Correct output", "3"]] }] }] },
  images: [],
}, {
  id: "9618-q1", questionType: "structured", maxMarks: 5, marks: 99,
  content: { images: [{ url: "/second.png", order: 2 }, { url: "/first.png", order: 1 }] },
  markScheme: { images: [{ url: "/ms.png", order: 1 }] },
}]}];
const loadedSources = [];
const loadStructuredImage = async (source) => { loadedSources.push(source); return png; };
const structuredQuestionPdf = await createQuestionPaperPdf(structuredGroups, { ...metadata, totalMarks: 100, loadImage: loadStructuredImage });
const structuredSchemePdf = await createAnswerKeyPdf(structuredGroups, { ...metadata, totalMarks: 100, loadImage: loadStructuredImage });
assert.equal(structuredQuestionPdf.totalMarks, 12);
assert.equal(structuredSchemePdf.totalMarks, 12);
assert.equal(structuredSchemePdf.kind, "mark-scheme");
assert.deepEqual(structuredQuestionPdf.questionIds, ["9618-q2", "9618-q1"]);
assert.deepEqual(structuredSchemePdf.questionIds, structuredQuestionPdf.questionIds);
const pdfStreams = [...Buffer.from(structuredSchemePdf.bytes).toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
  .map((match) => {
    try { return inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"); } catch { return ""; }
  }).join("\n").replace(/\\([\\()])/g, "$1");
assert.ok(pdfStreams.includes("(a) [3]"), "Mark scheme PDF must print the original QP part label and official part marks.");
assert.ok(!pdfStreams.includes("part-a"), "Stable part IDs must not replace original subpart labels in the PDF.");
assert.deepEqual(loadedSources, ["/first.png", "/second.png", "/ms.png"]);
assert.deepEqual(structuredTextBlocks(structuredGroups[0].questions[0].content), [
  "A processor carries out instructions.", "(a) [3]", "IF ready THEN\n  OUTPUT result\nENDIF",
]);
await assert.rejects(createMarkSchemePdf([{ questions: [{ id: "missing", questionType: "structured", maxMarks: 3, markScheme: {} }] }]), /missing its text and image fragments/);
await assert.rejects(createMarkSchemePdf([{ questions: [{ id: "broken", questionType: "structured", maxMarks: 3, markScheme: { images: [{ url: "/missing.png" }] } }] }], {
  loadImage: async () => { throw new Error("Image missing"); },
}), /Image missing/);

const independentQuestion = { id: "independent", questionType: "structured", maxMarks: 4,
  content: { blocks: [{ type: "text", text: "Describe the fetch-execute cycle." }] }, markScheme: {},
};
assert.equal((await createQuestionPaperPdf([{ questions: [independentQuestion] }])).questionCount, 1);
assert.equal((await createMarkSchemePdf([{ questions: [{ ...independentQuestion, content: {},
  markScheme: { blocks: [{ type: "text", text: "Fetch instruction, decode instruction, execute instruction." }] },
}] }])).markSchemeCount, 1);

for (const maxMarks of [undefined, null, 0, -1, 1.5, "4", NaN, Infinity]) {
  const invalid = { ...independentQuestion, id: "invalid-official-marks", maxMarks, marks: 4,
    markScheme: { blocks: [{ type: "text", text: "Official marking criteria." }] },
  };
  for (const exporter of [createQuestionPaperPdf, createMarkSchemePdf, createAnswerKeyPdf]) {
    await assert.rejects(exporter([{ questions: [invalid] }], { totalMarks: 4 }), (error) => (
      error.code === "STRUCTURED_OFFICIAL_MARKS_REQUIRED"
      && error.questionId === invalid.id
      && error.message.includes(invalid.id)
    ));
  }
}

async function zipEntryNames(archive) {
  const archiveBuffer = await archive.arrayBuffer();
  const archiveView = new DataView(archiveBuffer);
  const names = [];
  let offset = 0;
  while (archiveView.getUint32(offset, true) === 0x04034b50) {
    const nameLength = archiveView.getUint16(offset + 26, true);
    const extraLength = archiveView.getUint16(offset + 28, true);
    const dataLength = archiveView.getUint32(offset + 18, true);
    const nameStart = offset + 30;
    names.push(new TextDecoder().decode(new Uint8Array(archiveBuffer, nameStart, nameLength)));
    const dataStart = nameStart + nameLength + extraLength;
    assert.equal(new TextDecoder().decode(new Uint8Array(archiveBuffer, dataStart, 5)), "%PDF-");
    offset = dataStart + dataLength;
  }
  return names;
}

const normalNames = await zipEntryNames(createPaperZip(questionPdf, answerPdf));
assert.deepEqual(normalNames, ["试卷.pdf", "答案.pdf"]);

const abNames = await zipEntryNames(createEquivalentPaperZip(
  questionPdf,
  answerPdf,
  questionPdf,
  answerPdf
));
assert.deepEqual(abNames, ["A卷.pdf", "A卷答案.pdf", "B卷.pdf", "B卷答案.pdf"]);

console.log("Paper PDF export smoke checks passed.");
