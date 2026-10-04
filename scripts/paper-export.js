import { jsPDF } from "jspdf";
import { normalizeStructuredDocument, orderedImages, pairedMarkScheme, structuredDisplayBlocks } from "../shared/structured-content.js";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN;

function orderedQuestions(groups) {
  return (groups || []).flatMap((group) => group.questions || []);
}

function sourceQuestionLabel(question) {
  return [question.paperSlug, question.questionNo ? `Q${question.questionNo}` : ""].filter(Boolean).join(" | ");
}

function positiveMarks(value) {
  const marks = Number(value);
  return Number.isInteger(marks) && marks > 0 ? marks : 1;
}

function questionMarks(question) {
  if (!isStructuredQuestion(question)) return positiveMarks(question.marks);
  if (!Number.isInteger(question.maxMarks) || question.maxMarks <= 0) {
    const questionId = String(question.id || question.questionId || "unknown");
    const error = new Error(`Question "${questionId}" requires official maxMarks as a positive integer.`);
    error.code = "STRUCTURED_OFFICIAL_MARKS_REQUIRED";
    error.questionId = questionId;
    throw error;
  }
  return question.maxMarks;
}

function paperMetadata(groups, options, documentTitle) {
  const questions = orderedQuestions(groups);
  const calculatedMarks = questions.reduce((total, question) => total + questionMarks(question), 0);
  const suppliedMarks = Number(options.totalMarks);
  const generatedAt = options.generatedAt || new Date().toISOString();
  return {
    questions,
    paperTitle: String(options.paperTitle || documentTitle),
    paperCode: String(options.paperCode || ""),
    subjectName: String(options.subjectName || ""),
    totalMarks: questions.some(isStructuredQuestion) ? calculatedMarks
      : Number.isFinite(suppliedMarks) && suppliedMarks >= 0 ? suppliedMarks : calculatedMarks,
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

export function isStructuredQuestion(question) {
  return String(question?.questionType ?? question?.question_type ?? "mcq").trim().toLowerCase() === "structured";
}

function blockText(block) {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object") return "";
  if (block.type === "table") {
    return [block.headers, ...(block.rows || [])].filter(Array.isArray).map((row) => row.map(String).join(" | ")).join("\n");
  }
  return String(block.text || "");
}

export function structuredTextBlocks(value = {}) {
  return structuredDisplayBlocks(value).map(blockText).filter((text) => text.trim());
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
  const family = doc.getFont().fontName === "courier" ? 'Consolas, "Courier New", monospace' : 'Arial, "Microsoft YaHei", sans-serif';
  const font = `${doc.getFont().fontStyle.includes("bold") ? "bold " : ""}${fontSize}px ${family}`;
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
    if (y > PAGE_BOTTOM - 7) {
      const font = doc.getFont();
      const size = doc.getFontSize();
      y = addPageHeading(doc, section, true);
      doc.setFont(font.fontName, font.fontStyle);
      doc.setFontSize(size);
    }
    writeLine(doc, line, x, y);
    y += 5.5;
  }
  return y;
}

async function writeImageFragment(doc, image, y, section, loadImage) {
  const source = imageUrl(image);
  if (!source) throw new Error("A question image fragment has no URL.");
  let bytes;
  if (loadImage) bytes = await loadImage(source);
  else {
    const response = await fetch(source);
    if (!response.ok) throw new Error(`Unable to load question image (${response.status}): ${source}`);
    bytes = new Uint8Array(await response.arrayBuffer());
  }
  const dimensions = doc.getImageProperties(bytes);
  if (!(dimensions.width > 0 && dimensions.height > 0)) throw new Error(`Invalid question image: ${source}`);
  const width = Math.min(CONTENT_WIDTH, dimensions.width * 25.4 / 150);
  const height = width * dimensions.height / dimensions.width;
  let pixels = null;
  if (typeof createImageBitmap === "function" && typeof document !== "undefined") {
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);
    pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    bitmap.close?.();
  }
  let offset = 0;
  while (offset < height - 0.01) {
    if (PAGE_BOTTOM - y < 12) y = addPageHeading(doc, section, true);
    let slice = Math.min(height - offset, PAGE_BOTTOM - y);
    if (pixels && offset + slice < height) {
      // Prefer a nearby blank scanline so diagrams and printed text do not split
      // through their ink at the page edge. Keep the image width/scale constant.
      const target = Math.floor((offset + slice) * pixels.height / height);
      const minimum = Math.max(Math.ceil(offset * pixels.height / height) + 1, target - Math.ceil(12 * pixels.height / height));
      let blankRun = 0;
      for (let row = target; row >= minimum; row -= 1) {
        let blank = true;
        for (let column = 0; column < pixels.width; column += 1) {
          const index = (row * pixels.width + column) * 4;
          if (pixels.data[index + 3] > 20 && Math.min(pixels.data[index], pixels.data[index + 1], pixels.data[index + 2]) < 245) {
            blank = false;
            break;
          }
        }
        blankRun = blank ? blankRun + 1 : 0;
        if (blankRun >= 3) {
          slice = (row + 1) * height / pixels.height - offset;
          break;
        }
      }
    }
    doc.saveGraphicsState();
    doc.rect(MARGIN, y, width, slice, null);
    doc.clip();
    doc.discardPath();
    doc.addImage(bytes, dimensions.fileType || "PNG", MARGIN, y - offset, width, height, undefined, "FAST");
    doc.restoreGraphicsState();
    offset += slice;
    y += slice;
    if (offset < height - 0.01) y = addPageHeading(doc, section, true);
  }
  return y + 6;
}

async function writeStructuredContent(doc, value, y, section, loadImage, fallbackImages = []) {
  const normalized = normalizeStructuredDocument(value);
  const images = normalized.images.length ? normalized.images : fallbackImages;
  const entries = images.length ? [] : structuredDisplayBlocks(normalized);
  if (!images.length && !entries.some((entry) => entry.type === "image" || blockText(entry).trim())) {
    throw new Error("Structured content is missing its text and image fragments.");
  }
  for (const entry of entries) {
    if (entry.type === "image") {
      y = await writeImageFragment(doc, entry, y, section, loadImage);
      continue;
    }
    const text = blockText(entry);
    if (!text.trim()) continue;
    doc.setFont(entry.type === "code" || entry.type === "table" ? "courier" : "helvetica", entry.type === "heading" ? "bold" : "normal");
    doc.setFontSize(entry.type === "code" || entry.type === "table" ? 9 : 10);
    const indent = Math.min(5, Math.max(0, Number(entry.depth) || 0)) * 3;
    y = writeTextBlock(doc, text, MARGIN + indent, y, CONTENT_WIDTH - indent, section) + (entry.type === "heading" ? 1 : 2);
  }
  for (const image of orderedImages(images)) y = await writeImageFragment(doc, image, y, section, loadImage);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
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
      if (isStructuredQuestion(question)) {
        if (y > PAGE_BOTTOM - 18) y = addPageHeading(doc, currentSection, true);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(10);
        const marks = questionMarks(question);
        doc.text(`Question ${questionNumber} [${marks} ${marks === 1 ? "mark" : "marks"}]`, MARGIN, y);
        y += 5;
        const source = sourceQuestionLabel(question);
        if (source) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          y = writeTextBlock(doc, `Source: ${source}`, MARGIN, y, CONTENT_WIDTH, currentSection) + 2;
        }
        y = await writeStructuredContent(doc, question.content, y, currentSection, loadImage, question.images || []);
        y += 4;
        continue;
      }
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
      const marks = questionMarks(question);
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
      }
      if (!sources.length) {
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
  if (orderedQuestions(groups).some(isStructuredQuestion)) return createMarkSchemePdf(groups, options);
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

export async function createMarkSchemePdf(groups, options = {}) {
  const metadata = paperMetadata(groups, options, "ExPassway Mark Scheme");
  const doc = createDocument(`${metadata.paperTitle} - Mark Scheme`);
  let y = writePaperHeader(doc, metadata, "Mark Scheme");
  let questionNumber = 0;
  const questionIds = [];

  for (const group of groups || []) {
    const section = group.section || {};
    const title = sectionTitle(section);
    if (y > PAGE_BOTTOM - 12) y = addPageHeading(doc, section);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    y = writeTextBlock(doc, title || "Mark Scheme", MARGIN, y, CONTENT_WIDTH, section) + 2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    for (const question of group.questions || []) {
      questionNumber += 1;
      questionIds.push(question.id);
      if (y > PAGE_BOTTOM - 12) y = addPageHeading(doc, section, true);
      const marks = questionMarks(question);
      y = writeTextBlock(doc, `${questionNumber}. [${marks} ${marks === 1 ? "mark" : "marks"}]`, MARGIN + 2, y, CONTENT_WIDTH - 2, section);
      if (isStructuredQuestion(question)) {
        const source = sourceQuestionLabel(question);
        if (source) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8);
          y = writeTextBlock(doc, `Source: ${source}`, MARGIN + 2, y, CONTENT_WIDTH - 2, section) + 2;
        }
        y = await writeStructuredContent(doc, pairedMarkScheme(question.markScheme, question.content), y, section, options.loadImage);
      } else {
        y = writeTextBlock(doc, `${answerLetter(question.answer)} - ${[
          question.paperSlug || "Source unavailable",
          question.questionNo ? `Q${question.questionNo}` : "",
          sectionTitle(section),
        ].filter(Boolean).join(" | ")}`, MARGIN + 6, y, CONTENT_WIDTH - 6, section);
      }
      y += 2;
    }
    y += 3;
  }

  addPageFooters(doc, metadata.paperCode);

  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    answerCount: questionNumber,
    markSchemeCount: questionNumber,
    questionIds,
    totalMarks: metadata.totalMarks,
    paperTitle: metadata.paperTitle,
    paperCode: metadata.paperCode,
    subjectName: metadata.subjectName,
    generatedAt: metadata.generatedAt,
    pageCount: doc.getNumberOfPages(),
    kind: "mark-scheme",
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
