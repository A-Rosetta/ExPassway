import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { deflateSync, inflateSync } from "node:zlib";
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

function imageFixture(width, height) {
  const checksum = (bytes) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(checksum(payload));
    return Buffer.concat([size, payload, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4);
  header[8] = 8; // Greyscale PNG: one byte per pixel, with no alpha or palette.
  const pixels = Buffer.alloc((width + 1) * height, 255);
  for (let row = 0; row < height; row += 1) {
    pixels[row * (width + 1)] = 0;
    if (row % 30 === 0) pixels.fill(60, row * (width + 1) + 1, (row + 1) * (width + 1));
  }
  return new Uint8Array(Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0)),
  ]));
}

function imagePageStreams(pdf) {
  return [...Buffer.from(pdf.bytes).toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
    .map((match) => { try { return inflateSync(Buffer.from(match[1], "latin1")).toString("latin1"); } catch { return ""; } })
    .filter((stream) => /\/I\d+ Do/.test(stream));
}

const paginationImages = new Map([
  ["/preceding.png", imageFixture(900, 1100)], // 186mm at the exporter's normal image scale.
  ["/table.png", imageFixture(900, 1000)], // 169mm: fits a fresh page but not the first page remainder.
  ["/long.png", imageFixture(900, 2100)], // 356mm: exceeds a full page and must still be sliced.
]);
const paginationLoads = [];
const loadPaginationImage = async (source) => { paginationLoads.push(source); return paginationImages.get(source); };
const paginationQuestion = (id, questionNo, urls) => ({
  id, questionNo, paperSlug: "9618_s24_qp_13", questionType: "structured", maxMarks: 4,
  content: { images: urls.map((url, order) => ({ url, order })) },
  markScheme: { images: urls.map((url, order) => ({ url, order })) },
});

for (const exporter of [createQuestionPaperPdf, createMarkSchemePdf]) {
  paginationLoads.length = 0;
  const tablePdf = await exporter([{ questions: [paginationQuestion("table", 1, ["/preceding.png", "/table.png"])] }], { ...metadata, loadImage: loadPaginationImage });
  const tablePages = imagePageStreams(tablePdf);
  assert.equal(tablePdf.pageCount, 2);
  assert.equal(tablePages.length, 2);
  assert.deepEqual(paginationLoads, ["/preceding.png", "/table.png"], "Preflight must reuse the leading fragment, not fetch it twice.");
  assert.deepEqual(tablePages.map((stream) => [...stream.matchAll(/\/I\d+ Do/g)].map((match) => match[0])), [["/I0 Do"], ["/I1 Do"]], "A page-sized table fragment must be drawn intact on the next page, rather than clipped across two pages.");

  const headingsPdf = await exporter([{ questions: [paginationQuestion("first", 1, ["/preceding.png"]), paginationQuestion("second", 2, ["/table.png"])] }], { ...metadata, loadImage: loadPaginationImage });
  const headingPages = imagePageStreams(headingsPdf);
  assert.equal(headingsPdf.pageCount, 2);
  assert.ok(!headingPages[0].includes("9618_s24_qp_13 | Q2"), "The next question's source must not be orphaned above the page break.");
  assert.ok(headingPages[1].includes("9618_s24_qp_13 | Q2"), "The next question's source must appear on the same page as its leading image.");
  assert.ok(headingPages[1].includes(exporter === createQuestionPaperPdf ? "Question 2" : "2. [4 marks]"), "The question heading must move with its leading image.");

  const longPdf = await exporter([{ questions: [paginationQuestion("long", 1, ["/long.png"])] }], { ...metadata, loadImage: loadPaginationImage });
  assert.equal(longPdf.pageCount, 2);
  const longPages = imagePageStreams(longPdf);
  assert.deepEqual(longPages.map((stream) => [...stream.matchAll(/\/I\d+ Do/g)].map((match) => match[0])), [["/I0 Do"], ["/I0 Do"]], "A fragment taller than a full page must retain its scale and continue on the next page.");
}

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
