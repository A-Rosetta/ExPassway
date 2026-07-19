import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(__dirname, "./importedQuestionBank.json");
const STRUCTURED_DIR = path.resolve(__dirname, "./pymupdf-batch");
const COORDINATED_DATA_DIR = path.resolve(
  __dirname,
  "../../../assets/exam-question-images/cie-igcse-coordinated-sciences-0654/data"
);
let importedQuestionBankCache = null;

function yearSeasonPaperFromSlug(slug) {
  const m = String(slug || "").match(/^0620_([sw])(\d{2})_qp_(\d{2})/i);
  if (!m) {
    return { year: "", seasonCode: "X", paperCode: "00", topic: "Past Paper" };
  }
  const seasonCode = m[1].toLowerCase() === "s" ? "S" : "W";
  const year = String(2000 + Number(m[2]));
  const paperCode = m[3];
  const topic = seasonCode === "S" ? "Past Paper Summer" : "Past Paper Winter";
  return { year, seasonCode, paperCode, topic };
}

function mapStructuredRow(fileName, row) {
  const slug = fileName.replace(/\.structured\.json$/i, "");
  const meta = yearSeasonPaperFromSlug(slug);
  const qNo = Number(row.questionNo || 0);
  return {
    id: `CIE-IGCHEM-${meta.year}-${meta.seasonCode}-${meta.paperCode}-${String(qNo).padStart(2, "0")}`,
    board: "CIE",
    subject: "IGCSE Chemistry",
    paper: "MCQ",
    difficulty: qNo <= 14 ? "基础" : qNo <= 28 ? "中等" : "冲刺",
    topic: meta.topic,
    year: meta.year,
    stem: row.stem || row.rawText || "",
    options: [row.options?.A || "", row.options?.B || "", row.options?.C || "", row.options?.D || ""],
    answer: 0,
    mistakeType: "unknown",
    templateId: `${slug}-${qNo}`,
    skills: [],
    hints: [],
    images: row.imageUrl ? [{ url: row.imageUrl, position: "stem", order: 1 }] : [],
    source: {
      type: "pymupdf_structured_import",
      fileName: fileName.replace(/\.structured\.json$/i, ".pdf"),
      questionNo: qNo,
      importedAt: new Date().toISOString(),
    },
  };
}

function loadStructuredQuestionBank() {
  try {
    if (!fs.existsSync(STRUCTURED_DIR)) return [];
    const files = fs.readdirSync(STRUCTURED_DIR).filter((file) => file.endsWith(".structured.json")).sort();
    const rows = [];
    for (const fileName of files) {
      const fullPath = path.join(STRUCTURED_DIR, fileName);
      const raw = fs.readFileSync(fullPath, "utf8");
      const parsed = JSON.parse(raw);
      const items = Array.isArray(parsed?.rows) ? parsed.rows : [];
      for (const row of items) {
        if (!(row.options?.A && row.options?.B && row.options?.C && row.options?.D)) {
          continue;
        }
        rows.push(mapStructuredRow(fileName, row));
      }
    }
    return rows;
  } catch {
    return [];
  }
}

export function loadImportedQuestionBank() {
  if (importedQuestionBankCache) {
    return importedQuestionBankCache;
  }

  try {
    const structuredRows = loadStructuredQuestionBank();
    if (structuredRows.length) {
      importedQuestionBankCache = structuredRows;
      return importedQuestionBankCache;
    }
    if (!fs.existsSync(DATA_PATH)) return [];
    const raw = fs.readFileSync(DATA_PATH, "utf8");
    const parsed = JSON.parse(raw);
    importedQuestionBankCache = Array.isArray(parsed) ? parsed : [];
    return importedQuestionBankCache;
  } catch {
    return [];
  }
}

function referenceParts(questionKey) {
  const key = String(questionKey || "").trim();
  const paperSet = key.match(/^CIE-IGCHEM-SET-(0620_[sw]\d{2}_qp_\d{2})-(\d{1,2})$/i);
  if (paperSet) {
    return { source: "chemistry", paperSlug: paperSet[1].toLowerCase(), questionNo: Number(paperSet[2]) };
  }

  const coordinatedSet = key.match(/^CIE-IGCOORD-SET-(0654_[msw]\d{2}_qp_\d{2})-(\d{1,2})$/i);
  if (coordinatedSet) {
    return {
      source: "coordinated-sciences",
      paperSlug: coordinatedSet[1].toLowerCase(),
      questionNo: Number(coordinatedSet[2]),
    };
  }

  const standard = key.match(/^CIE-IGCHEM-(\d{4})-([SW])-(\d{2})-(\d{1,2})$/i);
  if (!standard) return null;
  return {
    source: "chemistry",
    paperSlug: `0620_${standard[2].toLowerCase()}${standard[1].slice(-2)}_qp_${standard[3]}`,
    questionNo: Number(standard[4]),
  };
}

export function getImportedQuestionReference(questionKey) {
  const parts = referenceParts(questionKey);
  if (!parts || !Number.isInteger(parts.questionNo) || parts.questionNo < 1) return null;

  if (parts.source === "coordinated-sciences") {
    try {
      const dataPath = path.join(COORDINATED_DATA_DIR, `${parts.paperSlug}.json`);
      const payload = JSON.parse(fs.readFileSync(dataPath, "utf8"));
      const row = (payload.rows || []).find((item) => Number(item.questionNo) === parts.questionNo);
      if (!row || !Number.isInteger(row.answer)) return null;
      return {
        id: String(questionKey),
        questionKey: String(questionKey),
        paperSlug: parts.paperSlug,
        questionNo: parts.questionNo,
        imageUrl: row.imageUrl || "",
        board: "CIE",
        subject: "IGCSE Co-ordinated Sciences",
        paper: "MCQ",
      };
    } catch {
      return null;
    }
  }

  const templateId = `${parts.paperSlug}-${parts.questionNo}`.toLowerCase();
  const question = loadImportedQuestionBank().find(
    (item) => String(item.templateId || "").toLowerCase() === templateId
  );
  if (!question) return null;

  const firstImage = Array.isArray(question.images) ? question.images[0] : null;
  return {
    id: question.id,
    questionKey: String(questionKey),
    paperSlug: parts.paperSlug,
    questionNo: parts.questionNo,
    imageUrl: typeof firstImage === "string" ? firstImage : firstImage?.url || "",
    board: question.board,
    subject: question.subject,
    paper: question.paper,
  };
}
