import fs from 'node:fs/promises';
import path from 'node:path';
import { isDbEnabled, query } from '../src/db/client.js';
import { replaceQuestionBank } from '../src/db/repositories/questionBank.repository.js';
import { loadImportedQuestionBank } from '../src/data/importedQuestionBank.js';

const BANK_PATH = path.resolve(process.cwd(), 'src/data/importedQuestionBank.json');
const REVIEW_PATH = path.resolve(process.cwd(), 'src/data/importReviewQueue.json');
const REPORT_PATH = path.resolve(process.cwd(), 'src/data/import-quality-latest.json');

async function safeReadJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function createJob(report) {
  const sql = `
    insert into question_import_jobs (
      status, input_dir, output_json, report_json,
      total_candidates, published_count, review_count, summary, completed_at
    ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,now())
    returning id
  `;

  const totals = report?.totals || {};
  const summary = {
    byFile: report?.byFile || [],
    reasonBreakdown: report?.reasonBreakdown || {},
    sourceReportGeneratedAt: report?.completedAt || null,
    actualImportedCount: null,
  };

  const res = await query(sql, [
    'completed',
    '/home/ubuntu/chemis/pdf',
    BANK_PATH,
    REPORT_PATH,
    Number(totals.candidates || 0),
    Number(totals.published || 0),
    Number(totals.failed || 0),
    JSON.stringify(summary),
  ]);

  return res.rows[0].id;
}

async function replaceReviewQueue(jobId, reviewRows) {
  await query('delete from question_review_queue');
  const sql = `
    insert into question_review_queue (
      job_id, question_id, board, subject, paper, year,
      source_file, question_no, stem, options, images,
      reasons, quality, source
    ) values (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb
    )
  `;

  for (const row of reviewRows) {
    const src = row.source || {};
    await query(sql, [
      jobId,
      row.id || null,
      row.board || null,
      row.subject || null,
      row.paper || null,
      row.year || null,
      src.fileName || null,
      Number(src.questionNo || 0) || null,
      row.stem || null,
      JSON.stringify(row.options || []),
      JSON.stringify(row.images || []),
      JSON.stringify(row.reviewReasons || row.quality?.reasons || []),
      JSON.stringify(row.quality || {}),
      JSON.stringify(src),
    ]);
  }
}

async function main() {
  if (!isDbEnabled()) {
    throw new Error('DB disabled: set DATABASE_URL first');
  }

  const structuredRows = loadImportedQuestionBank();
  const rows = Array.isArray(structuredRows) && structuredRows.length
    ? structuredRows
    : await safeReadJson(BANK_PATH, []);
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('No rows found in structured loader or importedQuestionBank.json');
  }

  const reviewRows = await safeReadJson(REVIEW_PATH, []);
  const report = await safeReadJson(REPORT_PATH, null);

  await replaceQuestionBank(rows);
  if (report && report.totals) {
    report.totals.candidates = rows.length + (Array.isArray(reviewRows) ? reviewRows.length : 0);
    report.totals.published = rows.length;
    report.totals.failed = Array.isArray(reviewRows) ? reviewRows.length : 0;
  }
  const jobId = await createJob(report || {});
  await replaceReviewQueue(jobId, Array.isArray(reviewRows) ? reviewRows : []);

  const reviewCountRes = await query('select count(*)::int as c from question_review_queue');
  console.log(`Imported ${rows.length} published questions into question_bank`);
  console.log(`Review queue rows: ${reviewCountRes.rows[0]?.c || 0}`);
  console.log(`Import job id: ${jobId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
