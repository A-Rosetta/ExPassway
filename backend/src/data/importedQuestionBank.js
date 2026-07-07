import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_PATH = path.resolve(__dirname, "./importedQuestionBank.json");
const STRUCTURED_DIR = path.resolve(__dirname, "./pymupdf-batch");
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
