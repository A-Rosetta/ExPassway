import { jsPDF } from "jspdf";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 14;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const PAGE_BOTTOM = PAGE_HEIGHT - MARGIN;

function sectionTitle(section) {
  const chapter = section.chapterNo ? `Chapter ${section.chapterNo}: ${section.chapterTitleEn}` : section.chapterTitleEn;
  return [chapter, `${section.sectionCode} ${section.titleEn}`].filter(Boolean).join(" - ");
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

function addPageHeading(doc, section, continued = false) {
  doc.addPage();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`${sectionTitle(section)}${continued ? " (continued)" : ""}`, MARGIN, 17, {
    maxWidth: CONTENT_WIDTH,
  });
  return 25;
}

function writeTextBlock(doc, text, x, y, maxWidth, section) {
  const lines = doc.splitTextToSize(String(text || ""), maxWidth);
  for (const line of lines) {
    if (y > PAGE_BOTTOM - 7) y = addPageHeading(doc, section, true);
    doc.text(line, x, y);
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

export async function createQuestionPaperPdf(groups, { subjectName = "", loadImage } = {}) {
  const doc = createDocument(`ExPassway Question Paper - ${subjectName}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`ExPassway Question Paper${subjectName ? ` - ${subjectName}` : ""}`, MARGIN, 17);
  let y = 27;
  let currentSection = null;
  let questionNumber = 0;

  for (const group of groups || []) {
    const section = group.section || {};
    const title = sectionTitle(section);
    if (y > PAGE_BOTTOM - 15) y = addPageHeading(doc, section);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title || "Questions", MARGIN, y, { maxWidth: CONTENT_WIDTH });
    y += 7;
    currentSection = section;

    for (const question of group.questions || []) {
      questionNumber += 1;
      const sources = (question.images || []).map(imageUrl).filter(Boolean);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      if (y > PAGE_BOTTOM - 10) y = addPageHeading(doc, currentSection, true);
      const sourceNumber = question.questionNo ? ` (source Q${question.questionNo})` : "";
      doc.text(`Question ${questionNumber}${sourceNumber}`, MARGIN, y);
      y += 5;

      if (sources.length) {
        for (const source of sources) {
          const bytes = loadImage
            ? await loadImage(source)
            : new Uint8Array(await (await fetch(source)).arrayBuffer());
          const dimensions = doc.getImageProperties(bytes);
          const width = Math.min(CONTENT_WIDTH, dimensions.width * 25.4 / 150);
          const naturalHeight = width * dimensions.height / dimensions.width;
          if (y + naturalHeight > PAGE_BOTTOM) y = addPageHeading(doc, currentSection, true);
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

  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    questionCount: questionNumber,
    pageCount: doc.getNumberOfPages(),
  };
}

export async function createAnswerKeyPdf(groups, { subjectName = "" } = {}) {
  const doc = createDocument(`ExPassway Answer Key - ${subjectName}`);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`ExPassway Answer Key${subjectName ? ` - ${subjectName}` : ""}`, MARGIN, 17);
  let y = 29;
  let questionNumber = 0;

  for (const group of groups || []) {
    const section = group.section || {};
    const title = sectionTitle(section);
    if (y > PAGE_BOTTOM - 12) y = addPageHeading(doc, section);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(title || "Answers", MARGIN, y, { maxWidth: CONTENT_WIDTH });
    y += 7;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);

    for (const question of group.questions || []) {
      questionNumber += 1;
      if (y > PAGE_BOTTOM - 7) y = addPageHeading(doc, section, true);
      doc.text(`${questionNumber}. ${answerLetter(question.answer)}`, MARGIN + 2, y);
      y += 6;
    }
    y += 3;
  }

  return {
    bytes: new Uint8Array(doc.output("arraybuffer")),
    answerCount: questionNumber,
    pageCount: doc.getNumberOfPages(),
  };
}
