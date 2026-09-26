import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  answerLetter,
  createAnswerKeyPdf,
  createQuestionPaperPdf,
} from "../scripts/paper-export.js";
await import("../scripts/bulk-download.js");

const png = new Uint8Array(await readFile(new URL(
  "../assets/exam-question-images/cie-igcse-physics-0625/papers/0625_w24_qp_23/q01.png",
  import.meta.url
)));
const groups = [{
  section: { chapterNo: 1, chapterTitleEn: "Forces", sectionCode: "1.1", titleEn: "Scalars and vectors" },
  questions: [
    { id: "q1", answer: 0, questionNo: 4, images: [{ url: "/q1.png" }] },
    {
      id: "q2",
      answer: 2,
      questionNo: 9,
      stem: "Which quantity is measured in newtons?",
      options: { A: "mass", B: "time", C: "force", D: "distance" },
      images: [],
    },
  ],
}];
const loadImage = async () => png;

const questionPdf = await createQuestionPaperPdf(groups, { loadImage });
assert.equal(questionPdf.questionCount, 2);
assert.ok(questionPdf.pageCount >= 1);
assert.equal(new TextDecoder().decode(questionPdf.bytes.slice(0, 5)), "%PDF-");

const answerPdf = await createAnswerKeyPdf(groups, { subjectName: "Physics" });
assert.equal(answerPdf.answerCount, 2);
assert.ok(answerPdf.pageCount >= 1);
assert.equal(new TextDecoder().decode(answerPdf.bytes.slice(0, 5)), "%PDF-");
assert.equal(answerLetter(0), "A");
assert.equal(answerLetter(2), "C");
assert.equal(answerLetter(3), "D");

const archive = globalThis.BulkDownload.createZip([
  { name: "试卷.pdf", data: questionPdf.bytes },
  { name: "答案.pdf", data: answerPdf.bytes },
]);
const archiveBuffer = await archive.arrayBuffer();
const archiveView = new DataView(archiveBuffer);
const archiveNames = [];
let offset = 0;
while (archiveView.getUint32(offset, true) === 0x04034b50) {
  const nameLength = archiveView.getUint16(offset + 26, true);
  const extraLength = archiveView.getUint16(offset + 28, true);
  const dataLength = archiveView.getUint32(offset + 18, true);
  const nameStart = offset + 30;
  archiveNames.push(new TextDecoder().decode(new Uint8Array(archiveBuffer, nameStart, nameLength)));
  const dataStart = nameStart + nameLength + extraLength;
  assert.equal(new TextDecoder().decode(new Uint8Array(archiveBuffer, dataStart, 5)), "%PDF-");
  offset = dataStart + dataLength;
}
assert.deepEqual(archiveNames, ["试卷.pdf", "答案.pdf"]);

console.log("Paper PDF export smoke checks passed.");
