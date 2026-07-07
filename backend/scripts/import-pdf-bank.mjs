import fs from 'node:fs/promises';
import path from 'node:path';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
const { getDocument } = pdfjs;

function usage() {
  console.log('Usage: node scripts/import-pdf-bank.mjs --input <pdf> --board CIE --subject "IGCSE Chemistry" --paper MCQ [--output src/data/importedQuestionBank.json] [--image-map scripts/import-image-map.example.json]');
}

function getArg(flag, args, fallback = '') {
  const i = args.indexOf(flag);
  return i >= 0 ? (args[i + 1] || fallback) : fallback;
}

async function extractTextFromPdf(pdfPath) {
  const data = await fs.readFile(pdfPath);
  const doc = await getDocument({ data: new Uint8Array(data) }).promise;
  const chunks = [];
  for (let p = 1; p <= doc.numPages; p += 1) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((it) => ('str' in it ? it.str : '')).join(' ');
    chunks.push(text);
  }
  return chunks.join('\n');
}

function splitQuestions(text) {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const matches = [...normalized.matchAll(/(?:^|\s)(\d{1,2})\s+(?=[A-Za-z(])/g)];
  const out = [];
  for (let i = 0; i < matches.length; i += 1) {
    const qNo = Number(matches[i][1]);
    const start = matches[i].index + matches[i][0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : normalized.length;
    const segment = normalized.slice(start, end).trim();
    if (qNo >= 1 && qNo <= 40 && segment.length > 10) {
      out.push({ number: qNo, segment });
    }
  }
  const dedup = new Map();
  out.forEach((q) => dedup.set(q.number, q));
  return [...dedup.values()].sort((a, b) => a.number - b.number);
}

function buildRows(questionBlocks, meta) {
  return questionBlocks.map((q) => ({
    id: `${meta.board}-${meta.subject}-${meta.paper}-${String(q.number).padStart(3, '0')}`.replace(/\s+/g, '-').toUpperCase(),
    board: meta.board,
    subject: meta.subject,
    paper: meta.paper,
    difficulty: '中等',
    topic: 'Imported',
    stem: q.segment,
    options: ['A', 'B', 'C', 'D'],
    answer: 0,
    mistakeType: 'unknown',
    templateId: `${meta.paper.toLowerCase()}-import-${q.number}`,
    skills: [],
    hints: [],
    images: Array.isArray(meta.imageMap?.[String(q.number)])
      ? meta.imageMap[String(q.number)].map((url, idx) => ({
          url: String(url),
          position: "stem",
          order: idx + 1
        }))
      : [],
    source: { type: 'pdf_import', questionNo: q.number, importedAt: new Date().toISOString() }
  }));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) return usage();

  const input = getArg('--input', args);
  if (!input) {
    usage();
    process.exit(1);
  }

  const meta = {
    board: getArg('--board', args, 'CIE'),
    subject: getArg('--subject', args, 'IGCSE Chemistry'),
    paper: getArg('--paper', args, 'MCQ')
  };

  const output = getArg('--output', args, 'src/data/importedQuestionBank.json');
  const imageMapPath = getArg('--image-map', args, '');
  const fullInput = path.resolve(process.cwd(), input);
  const fullOutput = path.resolve(process.cwd(), output);
  let imageMap = {};
  if (imageMapPath) {
    const fullImageMap = path.resolve(process.cwd(), imageMapPath);
    const rawMap = await fs.readFile(fullImageMap, 'utf8');
    imageMap = JSON.parse(rawMap);
  }

  const text = await extractTextFromPdf(fullInput);
  const questionBlocks = splitQuestions(text);
  if (!questionBlocks.length) throw new Error('No questions found. You may need format-specific regex tuning.');

  const rows = buildRows(questionBlocks, { ...meta, imageMap });
  await fs.mkdir(path.dirname(fullOutput), { recursive: true });
  await fs.writeFile(fullOutput, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`Imported ${rows.length} questions to ${fullOutput}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
