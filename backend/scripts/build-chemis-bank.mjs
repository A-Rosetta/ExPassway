import fs from "node:fs/promises";
import path from "node:path";
import pdfjs from "pdfjs-dist/legacy/build/pdf.js";

const { getDocument } = pdfjs;
const CHEMIS_DIR = "/home/ubuntu/chemis";
const ANSWER_DIR = "/home/ubuntu/chemis/answer";
const OUT = "/home/ubuntu/alevel-smart-practice/backend/src/data/chemisBank.json";

const QP_RE = /^0620_(s23|w23)_qp_(2[123])(?:\(\d+\))?\.pdf$/i;
const MS_RE = /^0620_(s23|w23)_ms_(2[123]).*\.pdf$/i;

const letterToIdx = { A: 0, B: 1, C: 2, D: 3 };

async function readPdfText(abs) {
  const data = new Uint8Array(await fs.readFile(abs));
  const doc = await getDocument({ data }).promise;
  let out = "";
  for (let i = 1; i <= doc.numPages; i += 1) {
    const p = await doc.getPage(i);
    const c = await p.getTextContent();
    out += ` ${c.items.map((x) => x.str).join(" ")}`;
  }
  return out.replace(/\s+/g, " ").trim();
}

async function listRecursive(root) {
  const out = [];
  async function walk(dir) {
    const rows = await fs.readdir(dir, { withFileTypes: true });
    for (const r of rows) {
      const abs = path.join(dir, r.name);
      if (r.isDirectory()) await walk(abs);
      else out.push(abs);
    }
  }
  await walk(root);
  return out;
}

function parseAnswers(text) {
  const map = new Map();
  const re = /(?:^|\s)([1-9]|[12]\d|3\d|40)\s+([ABCD])\s+1(?=\s|$)/g;
  let m = re.exec(text);
  while (m) {
    map.set(Number(m[1]), letterToIdx[m[2]]);
    m = re.exec(text);
  }
  return map;
}

function extractQuestions(pageText, fileName, ansMap) {
  const out = [];
  const start = pageText.indexOf(" 1 ");
  const work = start >= 0 ? pageText.slice(start) : pageText;
  const re = /\s([1-9]|[12]\d|3\d|40)\s{2,}([\s\S]*?)(?=\s(?:[1-9]|[12]\d|3\d|40)\s{2,}|$)/g;
  let m = re.exec(work);
  while (m) {
    const q = Number(m[1]);
    const body = m[2].trim();
    const optRe = /\sA\s{2,}([\s\S]*?)\sB\s{2,}([\s\S]*?)\sC\s{2,}([\s\S]*?)\sD\s{2,}([\s\S]*?)$/;
    const om = body.match(optRe);
    if (om) {
      const stem = body.replace(optRe, "").trim();
      out.push({
        id: `CIE-IGCHEM-${fileName.replace(/\.pdf$/i, "").replace(/[^\w]+/g, "-")}-${String(q).padStart(2, "0")}`,
        board: "CIE",
        subject: "IGCSE Chemistry",
        paper: "MCQ",
        difficulty: q <= 14 ? "基础" : q <= 28 ? "中等" : "冲刺",
        topic: "Past Paper MCQ",
        skills: ["igcse-chemistry", "mcq", "past-paper"],
        hints: [],
        stem,
        options: [om[1].trim(), om[2].trim(), om[3].trim(), om[4].trim()],
        answer: ansMap.get(q) ?? 0,
      });
    }
    m = re.exec(work);
  }
  return out;
}

const ansFiles = (await listRecursive(ANSWER_DIR)).filter((x) => MS_RE.test(path.basename(x)));
const ansDict = new Map();
for (const f of ansFiles) {
  const base = path.basename(f);
  const mm = base.match(MS_RE);
  if (!mm) continue;
  const key = `${mm[1].toLowerCase()}_${mm[2]}`;
  ansDict.set(key, parseAnswers(await readPdfText(f)));
}

const qpFiles = (await fs.readdir(CHEMIS_DIR)).filter((x) => QP_RE.test(x)).sort();
const bank = [];
for (const qf of qpFiles) {
  const m = qf.match(QP_RE);
  const key = `${m[1].toLowerCase()}_${m[2]}`;
  const ans = ansDict.get(key) || new Map();
  const txt = await readPdfText(path.join(CHEMIS_DIR, qf));
  const rows = extractQuestions(txt, qf, ans);
  bank.push(...rows);
}

await fs.writeFile(OUT, JSON.stringify(bank, null, 2), "utf8");
console.log(`built ${bank.length} questions -> ${OUT}`);
