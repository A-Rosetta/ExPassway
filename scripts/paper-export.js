import { jsPDF } from "jspdf";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN;

function orderedQuestions(groups) {
  return (groups || []).flatMap((group) => group.questions || []);
}

function positiveMarks(value) {
  const marks = Number(value);
  return Number.isInteger(marks) && marks > 0 ? marks : 1;
}

function paperMetadata(groups, options, documentTitle) {
  const questions = orderedQuestions(groups);
  const calculatedMarks = questions.reduce((total, question) => total + positiveMarks(question.marks), 0);
  const suppliedMarks = Number(options.totalMarks);
  const generatedAt = options.generatedAt || new Date().toISOString();
  return {
    questions,
    paperTitle: String(options.paperTitle || documentTitle),
    paperCode: String(options.paperCode || ""),
    subjectName: String(options.subjectName || ""),
    totalMarks: Number.isFinite(suppliedMarks) && suppliedMarks >= 0 ? suppliedMarks : calculatedMarks,
    generatedAt: String(generatedAt),
  };
}

function sectionTitle(section) {
  const chapter = section.chapterNo ? `Chapter ${section.chapterNo}: ${section.chapterTitleEn || ""}` : section.chapterTitleEn;
  const title = [section.sectionCode, section.titleEn].filter(Boolean).join(" ");
  return [chapter, title].filter(Boolean).join(" - ");
}

function imageUrl(image) {
  if (typeof image === "string") return image;
  return image?.detailUrl || image?.url || image?.thumbnailUrl || "";
}

function optionRows(options) {
  if (Array.isArray(options)) {
    return options.map((value, index) => [String.fromCharCode(65 + index), value]);
  }
  return Object.entries(options || {});
}

function createDocument(title) {
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title, creator: "ExPassway" });
  return doc;
}

function textCanvas(doc) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const fontSize = doc.getFontSize() * 96 / 72;
  const font = `${doc.getFont().fontStyle.includes("bold") ? "bold " : ""}${fontSize}px Arial, "Microsoft YaHei", sans-serif`;
  context.font = font;
  return { canvas, context, fontSize, font };
}

function textLines(doc, text, maxWidth) {
  const value = String(text || "");
  if (!/[^\u0000-\u00ff]/.test(value)) return doc.splitTextToSize(value, maxWidth);
  const { context } = textCanvas(doc);
  const pixelWidth = maxWidth * 96 / 25.4;
  const lines = [];
  for (const paragraph of value.split("\n")) {
    let line = "";
    for (const character of paragraph) {
      if (line && context.measureText(line + character).width > pixelWidth) {
        lines.push(line);
        line = "";
      }
      line += character;
    }
    lines.push(line);
  }
  return lines;
}

function writeLine(doc, text, x, y) {
  if (!/[^\u0000-\u00ff]/.test(text)) { doc.text(text, x, y); return; }
  const { canvas, context, fontSize, font } = textCanvas(doc);
  const width = Math.ceil(context.measureText(text).width + 2);
  const height = Math.ceil(fontSize * 1.4);
  canvas.width = width * 3;
  canvas.height = height * 3;
  context.scale(3, 3);
  context.font = font;
  context.fillStyle = "#000";
  context.fillText(text, 0, fontSize);
  doc.addImage(canvas.toDataURL("image/png"), "PNG", x, y - fontSize * 25.4 / 96,
    width * 25.4 / 96, height * 25.4 / 96, undefined, "FAST");
}

function writePaperHeader(doc, metadata, label) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = textLines(doc, metadata.paperTitle, CONTENT_WIDTH);
  titleLines.forEach((line, index) => writeLine(doc, line, MARGIN, 16 + index * 7));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const facts = [
    metadata.subjectName,
    `${metadata.questions.length} questions`,
    `${metadata.totalMarks} marks`,
    `Generated ${metadata.generatedAt.slice(0, 10)}`,
  ].filter(Boolean);
  const factsLines = textLines(doc, `${label} | ${facts.join(" | ")}`, CONTENT_WIDTH);
  const factsY = 16 + titleLines.length * 7;
  factsLines.forEach((line, index) => writeLine(doc, line, MARGIN, factsY + index * 4));
  return factsY + factsLines.length * 4 + 6;
}

function addPageFooters(doc, paperCode) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(90);
    doc.text("ExPassway", MARGIN, PAGE_HEIGHT - 7);
    if (paperCode) doc.text(paperCode, PAGE_WIDTH / 2, PAGE_HEIGHT - 7, { align: "center" });
    doc.text(`${page} / ${pageCount}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 7, { align: "right" });
    doc.setTextColor(0);
  }
}

function addPageHeading(doc, section, continued = false) {
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  const lines = textLines(doc, `${sectionTitle(section) || "Questions"}${continued ? " (continued)" : ""}`, CONTENT_WIDTH);
  lines.forEach((line, index) => writeLine(doc, line, MARGIN, 17 + index * 5));
  return 20 + lines.length * 5;
}

function writeTextBlock(doc, text, x, y, maxWidth, section) {
  const lines = textLines(doc, text, maxWidth);
  for (const line of lines) {
    if (y > PAGE_BOTTOM - 7) y = addPageHeading(doc, section, true);
    writeLine(doc, line, x, y);
    y += 5.5;
  }
  return y;
}

export function answerLetter(answer) {
  const index = Number(answer);
  if (!Number.isInteger(index) || index < 0 || index > 3) {
    throw new Error("Question answer must be an index from 0 to 3.");
  }
  return String.fromCharCode(65 + index);
}

export async function createQuestionPaperPdf(groups, options = {}) {
  const metadata = paperMetadata(groups, options, "ExPassway Question Paper");
  const doc = createDocument(`${metadata.paperTitle} - Question Paper`);
  const loadImage = options.loadImage;
  let y = writePaperHeader(doc, metadata, "Question Paper");
  let currentSection = null;
  let questionNumber = 0;
  const questionIds = [];

  for (const group of groups || []) {
    const section = group.section || {};
    const title = sectionTitle(section);
    if (y > PAGE_BOTTOM - 15) y = addPageHeading(doc, section);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    y = writeTextBlock(doc, title || "Questions", MARGIN, y, CONTENT_WIDTH, section) + 2;
    currentSection = section;

    for (const question of group.questions || []) {
      questionNumber += 1;
      questionIds.push(question.id);
      const sources = (question.images || []).map(imageUrl).filter(Boolean);
      const images = [];
      for (const source of sources) {
        const bytes = loadImage
          ? await loadImage(source)
          : new Uint8Array(await (await fetch(source)).arrayBuffer());
        const dimensions = doc.getImageProperties(bytes);
        const width = Math.min(CONTENT_WIDTH, dimensions.width * 25.4 / 150);
        images.push({ bytes, width, height: width * dimensions.height / dimensions.width });
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const neededHeight = images.length ? Math.min(images[0].height + 5, PAGE_BOTTOM - 35) : 16;
      if (y + neededHeight > PAGE_BOTTOM) y = addPageHeading(doc, currentSection, true);
      const marks = positiveMarks(question.marks);
      doc.text(`Question ${questionNumber} [${marks} ${marks === 1 ? "mark" : "marks"}]`, MARGIN, y);
      y += 5;

      if (sources.length) {
        for (const [index, image] of images.entries()) {
          const { bytes, width, height: naturalHeight } = image;
          if (index > 0 && y + naturalHeight > PAGE_BOTTOM) y = addPageHeading(doc, currentSection, true);
          const scale = Math.min(1, (PAGE_BOTTOM - y) / naturalHeight);
          const imageWidth = width * scale;
          const imageHeight = naturalHeight * scale;
          doc.addImage(bytes, "PNG", MARGIN, y, imageWidth, imageHeight, undefined, "FAST");
          y += imageHeight + 6;
        }
      } else {
        if (!String(question.stem || "").trim()) {
          throw new Error(`Question ${questionNumber} has no image or readable text.`);
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        y = writeTextBlock(doc, question.stem, MARGIN, y, CONTENT_WIDTH, currentSection) + 2;
        for (const [letter, text] of optionRows(question.options)) {
          y = writeTextBlock(doc, `${letter}. ${text}`, MARGIN + 4, y, CONTENT_WIDTH - 4, currentSection);
        }
        y += 4;
      }
    }
  }

  addPageFooters(doc, metadata.paperCode);

  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    questionCount: questionNumber,
    questionIds,
    totalMarks: metadata.totalMarks,
    paperTitle: metadata.paperTitle,
    paperCode: metadata.paperCode,
    subjectName: metadata.subjectName,
    generatedAt: metadata.generatedAt,
    pageCount: doc.getNumberOfPages(),
  };
}

export async function createAnswerKeyPdf(groups, options = {}) {
  const metadata = paperMetadata(groups, options, "ExPassway Answer Key");
  const doc = createDocument(`${metadata.paperTitle} - Answer Key`);
  let y = writePaperHeader(doc, metadata, "Answer Key");
  let questionNumber = 0;
  const questionIds = [];

  for (const group of groups || []) {
    const section = group.section || {};
    const title = sectionTitle(section);
    if (y > PAGE_BOTTOM - 12) y = addPageHeading(doc, section);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    y = writeTextBlock(doc, title || "Answers", MARGIN, y, CONTENT_WIDTH, section) + 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    for (const question of group.questions || []) {
      questionNumber += 1;
      questionIds.push(question.id);
      if (y > PAGE_BOTTOM - 12) y = addPageHeading(doc, section, true);
      const source = [
        question.paperSlug || "Source unavailable",
        question.questionNo ? `Q${question.questionNo}` : "",
        sectionTitle(section),
      ].filter(Boolean).join(" | ");
      y = writeTextBlock(
        doc,
        `${questionNumber}. ${answerLetter(question.answer)} - ${source}`,
        MARGIN + 2,
        y,
        CONTENT_WIDTH - 2,
        section
      );
      y += 1;
    }
    y += 3;
  }

  addPageFooters(doc, metadata.paperCode);

  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    answerCount: questionNumber,
    questionIds,
    totalMarks: metadata.totalMarks,
    paperTitle: metadata.paperTitle,
    paperCode: metadata.paperCode,
    subjectName: metadata.subjectName,
    generatedAt: metadata.generatedAt,
    pageCount: doc.getNumberOfPages(),
  };
}

function createZip(entries) {
  if (!globalThis.BulkDownload?.createZip) {
    throw new Error("BulkDownload.createZip is required before creating paper archives.");
  }
  return globalThis.BulkDownload.createZip(entries);
}

export function createPaperZip(questionPdf, answerPdf) {
  return createZip([
    { name: "试卷.pdf", data: questionPdf.bytes },
    { name: "答案.pdf", data: answerPdf.bytes },
  ]);
}

export function createEquivalentPaperZip(aQuestionPdf, aAnswerPdf, bQuestionPdf, bAnswerPdf) {
  return createZip([
    { name: "A卷.pdf", data: aQuestionPdf.bytes },
    { name: "A卷答案.pdf", data: aAnswerPdf.bytes },
    { name: "B卷.pdf", data: bQuestionPdf.bytes },
    { name: "B卷答案.pdf", data: bAnswerPdf.bytes },
  ]);
}
