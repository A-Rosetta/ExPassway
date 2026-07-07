import fs from "node:fs/promises";
import path from "node:path";
import pdfjs from "pdfjs-dist/legacy/build/pdf.js";

const { getDocument } = pdfjs;

const CHEMIS_TXT_DIR = "/home/ubuntu/chemis/txt";
const CHEMIS_ANSWER_DIR = "/home/ubuntu/chemis/answer";
const QP_TXT_RE = /^0620_(s23|w23)_qp_(2[123])(?:\(\d+\))?\.txt$/i;
const MS_PDF_RE = /^0620_(s23|w23)_ms_(2[123]).*\.pdf$/i;

let bankCache = null;
let answerCache = null;

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalize(s) {
  return String(s || "").replace(/\r/g, "").replace(/\s+/g, " ").trim();
}

function optionToIndex(letter) {
  return { A: 0, B: 1, C: 2, D: 3 }[letter] ?? 0;
}

function difficultyByQnum(q) {
  if (q <= 14) return "基础";
  if (q <= 28) return "中等";
  return "冲刺";
}

function parseQpMetaFromTxtName(fileName) {
  const m = fileName.match(QP_TXT_RE);
  if (!m) return null;
  return { season: m[1].toLowerCase(), paperCode: m[2] };
}

function parseMsMetaFromPdfName(fileName) {
  const m = fileName.match(MS_PDF_RE);
  if (!m) return null;
  return { season: m[1].toLowerCase(), paperCode: m[2] };
}

async function readPdfText(absPath) {
  const data = new Uint8Array(await fs.readFile(absPath));
  const doc = await getDocument({ data }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i += 1) {
    const p = await doc.getPage(i);
    const c = await p.getTextContent();
    out += ` ${c.items.map((x) => x.str).join(" ")}`;
  }
  return normalize(out);
}

async function listRecursive(rootDir) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(abs);
      else out.push(abs);
    }
  }
  await walk(rootDir);
  return out;
}

function parseMarkSchemeAnswers(text) {
  const answers = new Map();
  const re = /(?:^|\s)([1-9]|[12]\d|3\d|40)\s+([ABCD])\s+1(?=\s|$)/g;
  let m = re.exec(text);
  while (m) {
    const q = Number(m[1]);
    if (q >= 1 && q <= 40 && !answers.has(q)) {
      answers.set(q, optionToIndex(m[2]));
    }
    m = re.exec(text);
  }
  return answers;
}

async function getAnswerMap() {
  if (answerCache) return answerCache;
  const files = await listRecursive(CHEMIS_ANSWER_DIR);
  const pdfs = files.filter((x) => MS_PDF_RE.test(path.basename(x)));
  const map = new Map();
  for (const abs of pdfs) {
    const meta = parseMsMetaFromPdfName(path.basename(abs));
    if (!meta) continue;
    const key = `${meta.season}_${meta.paperCode}`;
    const txt = await readPdfText(abs);
    const ans = parseMarkSchemeAnswers(txt);
    if (ans.size) map.set(key, ans);
  }
  answerCache = map;
  return map;
}

function extractBodyByQnum(full, q) {
  const next = q + 1;
  const startRe = new RegExp(`\\s${q}\\s{2,}`);
  const endRe = next <= 40 ? new RegExp(`\\s${next}\\s{2,}`) : null;
  const s = full.search(startRe);
  if (s < 0) return "";
  const from = s + String(q).length + 2;
  if (!endRe) return full.slice(from);
  const rest = full.slice(from);
  const e = rest.search(endRe);
  return e < 0 ? rest : rest.slice(0, e);
}

function parseQuestionBody(body) {
  const compact = normalize(body);
  const optRe = /\sA\s{2,}([\s\S]*?)\sB\s{2,}([\s\S]*?)\sC\s{2,}([\s\S]*?)\sD\s{2,}([\s\S]*?)$/;
  const m = compact.match(optRe);
  if (!m) return null;
  const stem = normalize(compact.replace(optRe, ""));
  const options = [normalize(m[1]), normalize(m[2]), normalize(m[3]), normalize(m[4])];
  if (!stem || options.some((x) => !x)) return null;
  return { stem, options };
}

function cleanupPaperText(raw) {
  return normalize(
    raw
      .replace(/=== PAGE \d+ ===/g, " ")
      .replace(/© UCLES 2023/g, " ")
      .replace(/\[Turn over/g, " ")
      .replace(/BLANK PAGE/g, " ")
      .replace(/Group The Periodic Table of Elements[\s\S]*$/i, " ")
  );
}

async function parseSingleTxt(absPath, answerMap) {
  const fileName = path.basename(absPath);
  const meta = parseQpMetaFromTxtName(fileName);
  if (!meta) return [];
  const key = `${meta.season}_${meta.paperCode}`;
  const answerByQ = answerMap.get(key) || new Map();
  const raw = await fs.readFile(absPath, "utf8");
  const text = cleanupPaperText(raw);
  const out = [];
  const fileTag = fileName.replace(/\.txt$/i, "").replace(/[^\w]+/g, "-");
  for (let q = 1; q <= 40; q += 1) {
    const body = extractBodyByQnum(text, q);
    const parsed = parseQuestionBody(body);
    if (!parsed) continue;
    out.push({
      id: `CIE-IGCHEM-${fileTag}-${String(q).padStart(2, "0")}`,
      board: "CIE",
      subject: "IGCSE Chemistry",
      paper: "MCQ",
      difficulty: difficultyByQnum(q),
      topic: "Past Paper MCQ",
      skills: ["igcse-chemistry", "mcq", "past-paper"],
      hints: [],
      stem: parsed.stem,
      options: parsed.options,
      answer: answerByQ.has(q) ? answerByQ.get(q) : 0,
    });
  }
  return out;
}

export async function getChemisQuestionBank() {
  if (bankCache) return bankCache;
  const answers = await getAnswerMap();
  const files = (await fs.readdir(CHEMIS_TXT_DIR)).filter((x) => QP_TXT_RE.test(x)).sort();
  let rows = [];
  for (const f of files) {
    const parsed = await parseSingleTxt(path.join(CHEMIS_TXT_DIR, f), answers);
    rows.push(...parsed);
  }
  bankCache = rows;
  return bankCache;
}

export async function generateChemisPaper(options) {
  const bank = await getChemisQuestionBank();
  const requestedCount = Math.min(Math.max(Number(options?.count || 8), 1), 40);
  const questions = shuffle(bank).slice(0, requestedCount);
  return {
    questions,
    totalCandidates: bank.length || 40,
    requestedCount,
    fallbackApplied: !bank.length,
    topicCoverageCount: 1,
  };
}
