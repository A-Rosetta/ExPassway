import fs from 'node:fs/promises';

const INPUT_TXT = '/home/ubuntu/chemis/txt/0620_s23_qp_22.txt';
const OUTPUT_JSON = '/home/ubuntu/alevel-smart-practice/backend/src/data/importedQuestionBank.0620_s23_qp_22.json';

function normalize(s) {
  return String(s || '').replace(/\r/g, ' ').replace(/\s+/g, ' ').trim();
}

function cleanup(raw) {
  return normalize(
    String(raw || '')
      .replace(/=== PAGE \d+ ===/g, ' ')
      .replace(/© UCLES 2023/g, ' ')
      .replace(/\[Turn over/g, ' ')
      .replace(/BLANK PAGE/g, ' ')
      .replace(/Group\s+The Periodic Table of Elements[\s\S]*$/i, ' ')
  );
}

function parseMcq(seg) {
  const t = normalize(seg);
  const idxA = t.search(/\sA\s{1,}/);
  const idxB = t.search(/\sB\s{1,}/);
  const idxC = t.search(/\sC\s{1,}/);
  const idxD = t.search(/\sD\s{1,}/);
  if ([idxA, idxB, idxC, idxD].some((x) => x < 0)) return null;
  if (!(idxA < idxB && idxB < idxC && idxC < idxD)) return null;

  const stem = normalize(t.slice(0, idxA));
  const a = normalize(t.slice(idxA + 2, idxB));
  const b = normalize(t.slice(idxB + 2, idxC));
  const c = normalize(t.slice(idxC + 2, idxD));
  const d = normalize(t.slice(idxD + 2));
  if (!stem || !a || !b || !c || !d) return null;
  return { stem, options: [a, b, c, d] };
}

function allStartIndexes(full, q, startFrom) {
  const out = [];
  const re = new RegExp(`\\s${q}\\s+`, 'g');
  re.lastIndex = startFrom;
  let m = re.exec(full);
  while (m) {
    out.push(m.index);
    m = re.exec(full);
  }
  return out;
}

function firstNextIndex(full, qNext, from) {
  if (qNext > 40) return full.length;
  const re = new RegExp(`\\s${qNext}\\s+`, 'g');
  re.lastIndex = from;
  const m = re.exec(full);
  return m ? m.index : full.length;
}

function extractSequential(full) {
  const out = [];
  let cursor = 0;

  for (let q = 1; q <= 40; q += 1) {
    const starts = allStartIndexes(full, q, cursor);
    let hit = null;

    for (const sIdx of starts) {
      const bodyStart = sIdx + String(q).length + 1;
      const end = firstNextIndex(full, q + 1, bodyStart);
      const seg = full.slice(bodyStart, end);
      const parsed = parseMcq(seg);
      if (parsed) {
        hit = { q, parsed, endCursor: bodyStart };
        break;
      }
    }

    if (hit) {
      out.push({ number: q, stem: hit.parsed.stem, options: hit.parsed.options });
      cursor = hit.endCursor;
    }
  }

  return out;
}

async function main() {
  const raw = await fs.readFile(INPUT_TXT, 'utf8');
  const full = cleanup(raw);
  const parsed = extractSequential(full);

  const rows = parsed.map((q) => ({
    id: `CIE-IGCHEM-2023-22-${String(q.number).padStart(2, '0')}`,
    board: 'CIE',
    subject: 'IGCSE Chemistry',
    paper: 'MCQ',
    difficulty: q.number <= 14 ? '基础' : q.number <= 28 ? '中等' : '冲刺',
    topic: 'Past Paper Summer',
    year: '2023',
    stem: q.stem,
    options: q.options,
    answer: 0,
    mistakeType: 'unknown',
    templateId: `2023-22-${q.number}`,
    skills: [],
    hints: [],
    images: [],
    source: {
      type: 'txt_import_precise',
      fileName: '0620_s23_qp_22.pdf',
      questionNo: q.number,
      optionsParsed: true,
      year: '2023',
      season: 'Past Paper Summer',
      importedAt: new Date().toISOString()
    }
  }));

  await fs.writeFile(OUTPUT_JSON, JSON.stringify(rows, null, 2), 'utf8');
  console.log(`parsed questions: ${rows.length}`);
  const found = new Set(rows.map((x) => x.source.questionNo));
  const missing = [];
  for (let i = 1; i <= 40; i += 1) if (!found.has(i)) missing.push(i);
  console.log(`missing: ${missing.join(',') || '(none)'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
