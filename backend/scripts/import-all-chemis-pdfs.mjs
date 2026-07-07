import fs from 'node:fs/promises';
import path from 'node:path';

const INPUT_DIR = '/home/ubuntu/chemis/pdf';
const TXT_DIR = '/home/ubuntu/chemis/txt';
const OUTPUT = '/home/ubuntu/alevel-smart-practice/backend/src/data/importedQuestionBank.json';
const REPORT_DIR = '/home/ubuntu/alevel-smart-practice/backend/src/data/import-reports';
const LATEST_REPORT = '/home/ubuntu/alevel-smart-practice/backend/src/data/import-quality-latest.json';
const REVIEW_OUTPUT = '/home/ubuntu/alevel-smart-practice/backend/src/data/importReviewQueue.json';

const IMAGE_MAP_BY_FILE = {
  '0620_s23_qp_21.pdf': '/home/ubuntu/alevel-smart-practice/backend/scripts/image-map.full.json'
};

function normalize(s) {
  return String(s || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanupPaperText(raw) {
  return normalize(
    raw
      .replace(/=== PAGE \d+ ===/g, ' ')
      .replace(/© UCLES 2023/g, ' ')
      .replace(/\[Turn over/g, ' ')
      .replace(/BLANK PAGE/g, ' ')
      .replace(/Group The Periodic Table of Elements[\s\S]*$/i, ' ')
  );
}

function extractBodyByQnum(full, q) {
  const next = q + 1;
  const startRe = new RegExp(`\\s${q}\\s{1,}`);
  const s = full.search(startRe);
  if (s < 0) return '';
  const from = s + String(q).length + 1;
  if (q === 40) return full.slice(from);
  const endRe = new RegExp(`\\s${next}\\s{1,}`);
  const rest = full.slice(from);
  const e = rest.search(endRe);
  return e < 0 ? rest : rest.slice(0, e);
}

function parseQuestionBody(body) {
  const compact = normalize(body);
  const idxA = compact.search(/\sA\s{1,}/);
  const idxB = compact.search(/\sB\s{1,}/);
  const idxC = compact.search(/\sC\s{1,}/);
  const idxD = compact.search(/\sD\s{1,}/);
  if ([idxA, idxB, idxC, idxD].some((x) => x < 0)) return null;
  if (!(idxA < idxB && idxB < idxC && idxC < idxD)) return null;

  const stem = normalize(compact.slice(0, idxA));
  const options = [
    normalize(compact.slice(idxA + 2, idxB)),
    normalize(compact.slice(idxB + 2, idxC)),
    normalize(compact.slice(idxC + 2, idxD)),
    normalize(compact.slice(idxD + 2)),
  ];

  if (!stem || options.some((x) => !x || /^[ABCD]$/i.test(x))) return null;
  return { stem, options };
}

function parseYearAndPaperLabel(fileName) {
  const m = fileName.match(/^0620_([sw])(\d{2})_qp_(\d{2})/i);
  if (!m) return { year: 'Unknown', season: '', paperCode: '', seasonCode: 'X' };
  const seasonCode = m[1].toLowerCase() === 's' ? 'S' : 'W';
  const season = seasonCode === 'S' ? 'Past Paper Summer' : 'Past Paper Winter';
  const yy = Number(m[2]);
  const year = String(2000 + yy);
  const paperCode = m[3];
  return { year, season, paperCode, seasonCode };
}

async function maybeReadImageMap(fileName) {
  const mapPath = IMAGE_MAP_BY_FILE[fileName];
  if (!mapPath) return {};
  try {
    const raw = await fs.readFile(mapPath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function scoreQuality(stem, options) {
  const reasons = [];
  const text = `${stem} ${options.join(' ')}`;

  if (!stem || stem.length < 16) reasons.push('stem_too_short');
  if (!Array.isArray(options) || options.length !== 4) reasons.push('missing_options');
  if (Array.isArray(options) && options.some((x) => !x || x.length < 2)) reasons.push('empty_option');

  const badChars = (text.match(/[�□]/g) || []).length;
  const ratio = text.length ? badChars / text.length : 1;
  if (ratio > 0.01) reasons.push('garbled_symbol_ratio');

  if (/\s\d{1,2}\s+[A-D]\s+/.test(text)) reasons.push('cross_question_concat');

  const pass = reasons.length === 0;
  return { pass, reasons, metrics: { badCharCount: badChars, badCharRatio: Number(ratio.toFixed(4)) } };
}

async function parseSingleTxt(fileName) {
  const txtPath = path.join(TXT_DIR, fileName.replace(/\.pdf$/i, '.txt'));
  const raw = await fs.readFile(txtPath, 'utf8');
  const text = cleanupPaperText(raw);
  const out = [];
  for (let q = 1; q <= 40; q += 1) {
    const body = extractBodyByQnum(text, q);
    const fallbackStem = normalize(body);
    if (!fallbackStem || fallbackStem.length < 12) continue;
    const parsed = parseQuestionBody(body);
    if (parsed) {
      out.push({ q, stem: parsed.stem, options: parsed.options, optionsParsed: true });
    }
  }
  return out;
}

function buildReport(jobId, startedAt, filesStats, candidates, published, reviewQueue) {
  const reasonCounts = {};
  for (const r of reviewQueue) {
    for (const reason of r.quality?.reasons || []) {
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    }
  }
  return {
    jobId,
    startedAt,
    completedAt: new Date().toISOString(),
    totals: {
      candidates: candidates.length,
      published: published.length,
      failed: reviewQueue.length,
      passRate: candidates.length ? Number((published.length / candidates.length).toFixed(4)) : 0
    },
    byFile: filesStats,
    reasonBreakdown: reasonCounts
  };
}

async function main() {
  const files = (await fs.readdir(INPUT_DIR))
    .filter((f) => f.toLowerCase().endsWith('.pdf'))
    .sort();

  const jobId = `job-${Date.now()}`;
  const startedAt = new Date().toISOString();
  await fs.mkdir(REPORT_DIR, { recursive: true });

  const candidates = [];
  const published = [];
  const reviewQueue = [];
  const filesStats = [];

  for (const fileName of files) {
    const meta = parseYearAndPaperLabel(fileName);
    const imageMap = await maybeReadImageMap(fileName);
    let parsed = [];
    try {
      parsed = await parseSingleTxt(fileName);
    } catch {
      parsed = [];
    }

    let filePass = 0;
    let fileFail = 0;

    for (const row of parsed) {
      const record = {
        id: `CIE-IGCHEM-${meta.year}-${meta.seasonCode}-${meta.paperCode}-${String(row.q).padStart(2, '0')}`,
        board: 'CIE',
        subject: 'IGCSE Chemistry',
        paper: 'MCQ',
        difficulty: row.q <= 14 ? '基础' : row.q <= 28 ? '中等' : '冲刺',
        topic: meta.season,
        year: meta.year,
        stem: row.stem,
        options: row.options,
        answer: 0,
        mistakeType: 'unknown',
        templateId: `${meta.year}-${meta.seasonCode}-${meta.paperCode}-${row.q}`,
        skills: [],
        hints: [],
        images: Array.isArray(imageMap[String(row.q)])
          ? imageMap[String(row.q)].map((url, idx) => ({ url: String(url), position: 'stem', order: idx + 1 }))
          : [],
        source: {
          type: 'txt_import_hybrid',
          fileName,
          questionNo: row.q,
          optionsParsed: Boolean(row.optionsParsed),
          year: meta.year,
          season: meta.season,
          importedAt: new Date().toISOString()
        }
      };

      const quality = scoreQuality(record.stem, record.options);
      candidates.push({ ...record, quality });

      if (quality.pass) {
        filePass += 1;
        published.push(record);
      } else {
        fileFail += 1;
        reviewQueue.push({
          ...record,
          quality,
          reviewReasons: quality.reasons,
          importJobId: jobId
        });
      }
    }

    filesStats.push({ fileName, parsed: parsed.length, pass: filePass, fail: fileFail });
    console.log(`parsed ${fileName}: ${parsed.length}, pass=${filePass}, fail=${fileFail}`);
  }

  const report = buildReport(jobId, startedAt, filesStats, candidates, published, reviewQueue);
  const reportPath = path.join(REPORT_DIR, `${jobId}.json`);

  await fs.writeFile(OUTPUT, JSON.stringify(published, null, 2), 'utf8');
  await fs.writeFile(REVIEW_OUTPUT, JSON.stringify(reviewQueue, null, 2), 'utf8');
  await fs.writeFile(LATEST_REPORT, JSON.stringify(report, null, 2), 'utf8');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');

  console.log(`total candidates: ${candidates.length}`);
  console.log(`published: ${published.length}`);
  console.log(`review_queue: ${reviewQueue.length}`);
  console.log(`output: ${OUTPUT}`);
  console.log(`review output: ${REVIEW_OUTPUT}`);
  console.log(`report: ${reportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
