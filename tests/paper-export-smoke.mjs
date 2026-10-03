import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  answerLetter,
  createAnswerKeyPdf,
  createEquivalentPaperZip,
  createPaperZip,
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
