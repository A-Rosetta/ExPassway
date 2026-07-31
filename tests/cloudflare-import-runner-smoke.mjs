import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { failureSql, paperSql } from "../tools/run-cloudflare-import.mjs";

const mf = new Miniflare({
  compatibilityDate: "2026-07-29",
  d1Databases: { DB: "import-runner-test" },
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});

async function execute(db, sql) {
  for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
}

function fixture(jobId, paperSlug) {
  const job = {
    id: jobId,
    subject_code: "0610",
    subject_name: "Biology",
    qualification: "IGCSE",
    asset_key: "biology-0610",
    board: "CIE",
  };
  const paper = {
    slug: paperSlug,
    year: 2023,
    season: "s",
    paperNumber: 2,
    variant: paperSlug.endsWith("22") ? 2 : 1,
    sourceQuestionCount: 1,
    validQuestionCount: 1,
    discountedQuestions: [],
    qpFileName: `${paperSlug}.pdf`,
    msFileName: `${paperSlug.replace("_qp_", "_ms_")}.pdf`,
    qpSha256: "qp-hash",
    msSha256: "ms-hash",
  };
  const payload = {
    rows: [{
      questionNo: 1,
      answer: 1,
      stem: "Which structure controls the cell?",
      options: { A: "Wall", B: "Nucleus", C: "Vacuole", D: "Membrane" },
    }],
  };
  return { job, paper, payload };
}

try {
  const db = await mf.getD1Database("DB");
  for (const file of [
    "../migrations/0001_initial.sql",
    "../migrations/0002_supabase_auth.sql",
    "../migrations/0003_admin_platform.sql",
  ]) {
    await execute(db, await readFile(new URL(file, import.meta.url), "utf8"));
  }
  await db.prepare("INSERT INTO exam_subjects (code, name, asset_key) VALUES ('0610', 'Biology', 'biology-0610')").run();

  const active = fixture("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "0610_s23_qp_22");
  await db.prepare(`
    INSERT INTO exam_import_jobs (id, subject_code, status, input_dir, staging_dir, summary)
    VALUES (?, '0610', 'validated', 'input', 'staging', '{"requestedAction":"publish"}')
  `).bind(active.job.id).run();
  await execute(db, paperSql(active.job, active.paper, active.payload, "2026-07-31T00:00:00.000Z"));
  const publishedPaper = await db.prepare("SELECT data_url, metadata FROM exam_papers WHERE slug = ?").bind(active.paper.slug).first();
  assert.match(publishedPaper.data_url, new RegExp(active.job.id));
  assert.equal(JSON.parse(publishedPaper.metadata).contentPrefix, `releases/${active.job.id}`);
  const publishedQuestion = await db.prepare("SELECT images, active FROM question_bank WHERE paper_slug = ?").bind(active.paper.slug).first();
  assert.equal(publishedQuestion.active, 1);
  assert.match(JSON.parse(publishedQuestion.images)[0].url, new RegExp(active.job.id));

  const cancelled = fixture("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "0610_s23_qp_21");
  await db.prepare(`
    INSERT INTO exam_import_jobs (id, subject_code, status, input_dir, staging_dir, summary, cancelled_at)
    VALUES (?, '0610', 'validated', 'input', 'staging', '{"requestedAction":"publish"}', '2026-07-31T00:01:00.000Z')
  `).bind(cancelled.job.id).run();
  await execute(db, paperSql(cancelled.job, cancelled.paper, cancelled.payload, "2026-07-31T00:02:00.000Z"));
  assert.equal(await db.prepare("SELECT 1 FROM exam_papers WHERE slug = ?").bind(cancelled.paper.slug).first(), null);
  assert.equal(await db.prepare("SELECT 1 FROM question_bank WHERE paper_slug = ?").bind(cancelled.paper.slug).first(), null);

  await db.prepare("UPDATE question_bank SET active = 1 WHERE paper_slug = ?").bind(active.paper.slug).run();
  await db.prepare("UPDATE exam_import_jobs SET cancelled_at = '2026-07-31T00:03:00.000Z' WHERE id = ?").bind(active.job.id).run();
  const changedPayload = { rows: [{ ...active.payload.rows[0], stem: "Cancelled replacement" }] };
  await execute(db, paperSql(active.job, active.paper, changedPayload, "2026-07-31T00:04:00.000Z"));
  const unchanged = await db.prepare("SELECT stem, active FROM question_bank WHERE paper_slug = ?").bind(active.paper.slug).first();
  assert.equal(unchanged.stem, "Which structure controls the cell?");
  assert.equal(unchanged.active, 1);

  const failedJobId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const failedJob = { id: failedJobId, action: "process", summary: '{"requestedAction":"process"}' };
  await db.prepare(`
    INSERT INTO exam_import_jobs (id, subject_code, status, input_dir, staging_dir, summary)
    VALUES (?, '0610', 'processing', 'input', 'staging', ?)
  `).bind(failedJobId, failedJob.summary).run();
  await execute(db, failureSql(failedJob, "Processor failed", "2026-07-31T00:05:00.000Z"));
  const failedState = await db.prepare("SELECT status, summary FROM exam_import_jobs WHERE id = ?").bind(failedJobId).first();
  assert.equal(failedState.status, "failed");
  assert.equal(JSON.parse(failedState.summary).failure, "Processor failed");
  const failedIssue = await db.prepare("SELECT code, message FROM exam_import_issues WHERE job_id = ?").bind(failedJobId).first();
  assert.deepEqual(failedIssue, { code: "ACTION_FAILED", message: "Processor failed" });

  const cancelledFailureId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const cancelledFailure = { id: cancelledFailureId, action: "process", summary: '{"requestedAction":"process"}' };
  await db.prepare(`
    INSERT INTO exam_import_jobs (id, subject_code, status, input_dir, staging_dir, summary, cancelled_at)
    VALUES (?, '0610', 'processing', 'input', 'staging', ?, '2026-07-31T00:06:00.000Z')
  `).bind(cancelledFailureId, cancelledFailure.summary).run();
  await execute(db, failureSql(cancelledFailure, "Must not be recorded", "2026-07-31T00:07:00.000Z"));
  const cancelledState = await db.prepare("SELECT status FROM exam_import_jobs WHERE id = ?").bind(cancelledFailureId).first();
  assert.equal(cancelledState.status, "processing");
  assert.equal(await db.prepare("SELECT 1 FROM exam_import_issues WHERE job_id = ?").bind(cancelledFailureId).first(), null);

  console.log("Cloudflare import runner cancellation guard smoke checks passed.");
} finally {
  await mf.dispose();
}
