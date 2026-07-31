import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DATABASE = "expassway-db";
const PRIVATE_BUCKET = "expassway-private-imports";
const CONTENT_BUCKET = "expassway-content";
const JOB_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VALID_ACTIONS = new Set(["auto", "process", "publish"]);

function argument(name, fallback = "") {
  const index = process.argv.indexOf(name);
  return index >= 0 ? String(process.argv[index + 1] || "") : fallback;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonValue(value) {
  return sqlValue(JSON.stringify(value));
}

async function wrangler(args, options = {}) {
  return execFileAsync("npx", ["wrangler", ...args], {
    cwd: process.cwd(),
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

async function query(sql) {
  const { stdout } = await wrangler([
    "d1", "execute", DATABASE, "--remote", "--json", "--command", sql,
  ]);
  const payload = JSON.parse(stdout);
  return payload.flatMap((part) => part.results || []);
}

async function executeSqlFile(file) {
  await wrangler(["d1", "execute", DATABASE, "--remote", "--yes", "--file", file]);
}

async function r2Get(bucket, key, file) {
  await mkdir(dirname(file), { recursive: true });
  await wrangler(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--file", file]);
}

async function r2Put(bucket, key, file, contentType) {
  const args = ["r2", "object", "put", `${bucket}/${key}`, "--remote", "--force", "--file", file];
  if (contentType) args.push("--content-type", contentType);
  await wrangler(args);
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function listFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

async function selectJob(requestedJobId, requestedAction) {
  if (requestedJobId) {
    if (!JOB_ID_PATTERN.test(requestedJobId)) throw new Error("job-id must be a UUID");
    const rows = await query(`
      SELECT j.*, s.name AS subject_name, s.asset_key, s.board, s.qualification
      FROM exam_import_jobs j JOIN exam_subjects s ON s.code = j.subject_code
      WHERE j.id = ${sqlValue(requestedJobId)} LIMIT 1
    `);
    if (!rows[0]) throw new Error("Import job not found");
    const action = requestedAction === "auto"
      ? JSON.parse(rows[0].summary || "{}").requestedAction
      : requestedAction;
    return { ...rows[0], action };
  }
  const actionFilter = requestedAction === "process"
    ? "j.status = 'processing' AND json_extract(j.summary, '$.requestedAction') = 'process'"
    : requestedAction === "publish"
      ? "j.status = 'validated' AND json_extract(j.summary, '$.requestedAction') = 'publish'"
      : `(
        (j.status = 'processing' AND json_extract(j.summary, '$.requestedAction') = 'process')
        OR (j.status = 'validated' AND json_extract(j.summary, '$.requestedAction') = 'publish')
      )`;
  const rows = await query(`
    SELECT j.*, s.name AS subject_name, s.asset_key, s.board, s.qualification
    FROM exam_import_jobs j JOIN exam_subjects s ON s.code = j.subject_code
    WHERE ${actionFilter}
    ORDER BY COALESCE(json_extract(j.summary, '$.requestedAt'), j.created_at)
    LIMIT 1
  `);
  if (!rows[0]) return null;
  return {
    ...rows[0],
    action: JSON.parse(rows[0].summary || "{}").requestedAction,
  };
}

async function recordFailure(job, error, workDirectory) {
  const now = new Date().toISOString();
  const message = String(error?.stderr || error?.message || error).slice(0, 2000);
  const summary = {
    ...JSON.parse(job.summary || "{}"),
    requestedAction: null,
    failedAt: now,
    failure: message,
  };
  const status = job.action === "publish" ? "validated" : "failed";
  const sql = `
    UPDATE exam_import_jobs
    SET status = ${sqlValue(status)}, summary = ${jsonValue(summary)}, completed_at = ${sqlValue(now)}
    WHERE id = ${sqlValue(job.id)};
    INSERT INTO exam_import_issues (id, job_id, severity, code, message, details)
    VALUES (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
      ${sqlValue(job.id)}, 'error', 'ACTION_FAILED', ${sqlValue(message)}, '{}'
    );
  `;
  const file = join(workDirectory, "failure.sql");
  await writeFile(file, sql);
  await executeSqlFile(file);
}

async function processJob(job, workDirectory) {
  const inputDirectory = join(workDirectory, "input");
  const outputDirectory = join(workDirectory, "output");
  await mkdir(inputDirectory, { recursive: true });
  const files = await query(`
    SELECT * FROM exam_import_files WHERE job_id = ${sqlValue(job.id)} ORDER BY file_name
  `);
  if (files.length < 2) throw new Error("Import job requires at least one QP/MS pair");
  for (const file of files) {
    await r2Get(PRIVATE_BUCKET, `imports/${job.id}/input/${file.file_name}`, join(inputDirectory, file.file_name));
  }
  let processorError = null;
  try {
    await execFileAsync("python3", [
      "backend/scripts/cie-mcq-import.py",
      "--input", inputDirectory,
      "--output", outputDirectory,
      "--subject-code", job.subject_code,
      "--asset-key", job.asset_key,
      "--public-root", `/api/content/question-images/cie-igcse-${job.asset_key}`,
    ], { maxBuffer: 10 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  } catch (error) {
    processorError = error;
  }
  const manifestPath = join(outputDirectory, "manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (_error) {
    throw processorError || new Error("Importer did not create a manifest");
  }
  for (const file of await listFiles(outputDirectory)) {
    const key = `imports/${job.id}/output/${file.slice(outputDirectory.length + 1)}`;
    const contentType = file.endsWith(".json") ? "application/json" : "image/png";
    await r2Put(PRIVATE_BUCKET, key, file, contentType);
  }
  const now = new Date().toISOString();
  const issues = Array.isArray(manifest.issues) ? manifest.issues : [];
  const status = Number(manifest.validatedPaperCount || 0) > 0 ? "validated" : "failed";
  const summary = { ...manifest, requestedAction: null, processedAt: now };
  const issueSql = issues.map((issue) => `
    INSERT INTO exam_import_issues (id, job_id, paper_slug, severity, code, message, details)
    VALUES (
      lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))), 2) || '-a' || substr(lower(hex(randomblob(2))), 2) || '-' || lower(hex(randomblob(6))),
      ${sqlValue(job.id)}, ${sqlValue(issue.paperSlug || null)},
      ${sqlValue(issue.severity || "error")}, ${sqlValue(issue.code || "IMPORT_ERROR")},
      ${sqlValue(issue.message || "Import failed")}, ${jsonValue(issue.details || {})}
    );
  `).join("\n");
  const sql = `
    DELETE FROM exam_import_issues WHERE job_id = ${sqlValue(job.id)};
    UPDATE exam_import_jobs
    SET status = ${sqlValue(status)}, manifest_path = ${sqlValue(`r2://imports/${job.id}/output/manifest.json`)},
      summary = ${jsonValue(summary)}, completed_at = ${sqlValue(now)}
    WHERE id = ${sqlValue(job.id)};
    ${issueSql}
  `;
  const file = join(workDirectory, "processed.sql");
  await writeFile(file, sql);
  await executeSqlFile(file);
  if (processorError && status === "failed") throw processorError;
}

function questionId(job, paper, questionNo) {
  return `CIE-${job.qualification}-${job.subject_code}-${paper.slug}-${String(questionNo).padStart(2, "0")}`;
}

function paperSql(job, paper, payload) {
  const validRows = (payload.rows || []).filter((row) => Number.isInteger(row.answer) && row.answer >= 0 && row.answer <= 3);
  if (validRows.length !== Number(paper.validQuestionCount)) {
    throw new Error(`${paper.slug}: manifest and data question counts differ`);
  }
  const subject = `${job.qualification} ${job.subject_name}`;
  const seasons = { m: "March", s: "Summer", w: "Winter" };
  const questionStatements = validRows.map((row) => {
    const number = Number(row.questionNo);
    const parsed = row.options?.A && row.options?.B && row.options?.C && row.options?.D;
    const options = parsed ? [row.options.A, row.options.B, row.options.C, row.options.D] : ["A", "B", "C", "D"];
    const source = {
      type: "cie_mcq_import",
      importJobId: job.id,
      fileName: paper.qpFileName,
      markScheme: paper.msFileName,
      questionNo: number,
      answerStatus: row.answerStatus || "valid",
    };
    return `
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, template_id, skills, hints, images, source,
        subject_code, paper_slug, question_no, active
      ) VALUES (
        ${sqlValue(questionId(job, paper, number))}, ${sqlValue(job.board)}, ${sqlValue(subject)}, 'MCQ',
        ${sqlValue(number <= 14 ? "基础" : number <= 28 ? "中等" : "冲刺")},
        ${sqlValue(`Past Paper ${seasons[paper.season]}`)}, ${sqlValue(String(paper.year))},
        ${sqlValue(row.stem || row.rawText || `Question ${number}`)}, ${jsonValue(options)},
        ${Number(row.answer)}, 'unknown', ${sqlValue(`${paper.slug}-${number}`)},
        ${jsonValue([job.asset_key, "mcq", "past-paper"])}, '[]',
        ${jsonValue([{ url: row.imageUrl, position: "stem", order: 1 }])}, ${jsonValue(source)},
        ${sqlValue(job.subject_code)}, ${sqlValue(paper.slug)}, ${number}, 1
      ) ON CONFLICT (id) DO UPDATE SET
        board = excluded.board, subject = excluded.subject, paper = excluded.paper,
        difficulty = excluded.difficulty, topic = excluded.topic, year = excluded.year,
        stem = excluded.stem, options = excluded.options, answer = excluded.answer,
        template_id = excluded.template_id, skills = excluded.skills, images = excluded.images,
        source = excluded.source, subject_code = excluded.subject_code,
        paper_slug = excluded.paper_slug, question_no = excluded.question_no, active = 1;
    `;
  }).join("\n");
  const dataUrl = `/api/content/question-data/cie-igcse-${job.asset_key}/data/${paper.slug}.json`;
  return `
    UPDATE question_bank SET active = 0 WHERE paper_slug = ${sqlValue(paper.slug)};
    ${questionStatements}
    INSERT INTO exam_papers (
      slug, subject_code, year, season, paper_number, variant, paper_type,
      duration_minutes, source_question_count, valid_question_count,
      discounted_questions, qp_file_name, ms_file_name, data_url,
      status, metadata, published_at
    ) VALUES (
      ${sqlValue(paper.slug)}, ${sqlValue(job.subject_code)}, ${Number(paper.year)}, ${sqlValue(paper.season)},
      ${Number(paper.paperNumber)}, ${Number(paper.variant)}, 'MCQ', 45,
      ${Number(paper.sourceQuestionCount)}, ${Number(paper.validQuestionCount)},
      ${jsonValue(paper.discountedQuestions || [])}, ${sqlValue(paper.qpFileName)}, ${sqlValue(paper.msFileName)},
      ${sqlValue(dataUrl)}, 'published',
      ${jsonValue({ importJobId: job.id, qpSha256: paper.qpSha256, msSha256: paper.msSha256 })},
      ${sqlValue(new Date().toISOString())}
    ) ON CONFLICT (slug) DO UPDATE SET
      subject_code = excluded.subject_code, year = excluded.year, season = excluded.season,
      paper_number = excluded.paper_number, variant = excluded.variant,
      source_question_count = excluded.source_question_count,
      valid_question_count = excluded.valid_question_count,
      discounted_questions = excluded.discounted_questions,
      qp_file_name = excluded.qp_file_name, ms_file_name = excluded.ms_file_name,
      data_url = excluded.data_url, status = 'published', metadata = excluded.metadata,
      published_at = excluded.published_at, updated_at = excluded.published_at;
  `;
}

async function publishJob(job, workDirectory) {
  const outputDirectory = join(workDirectory, "output");
  const manifestPath = join(outputDirectory, "manifest.json");
  await r2Get(PRIVATE_BUCKET, `imports/${job.id}/output/manifest.json`, manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const papers = (manifest.papers || []).filter((paper) => paper.status === "validated");
  if (!papers.length) throw new Error("Import has no validated papers");
  const inputFiles = await query(`
    SELECT * FROM exam_import_files WHERE job_id = ${sqlValue(job.id)} ORDER BY file_name
  `);
  const sqlParts = [];
  let questionCount = 0;
  for (const paper of papers) {
    const dataPath = join(outputDirectory, "data", `${paper.slug}.json`);
    await r2Get(PRIVATE_BUCKET, `imports/${job.id}/output/data/${paper.slug}.json`, dataPath);
    const payload = JSON.parse(await readFile(dataPath, "utf8"));
    await r2Put(CONTENT_BUCKET, `question-data/cie-igcse-${job.asset_key}/data/${paper.slug}.json`, dataPath, "application/json");
    for (let number = 1; number <= Number(paper.sourceQuestionCount); number += 1) {
      const imageName = `q${String(number).padStart(2, "0")}.png`;
      const imagePath = join(outputDirectory, "papers", paper.slug, imageName);
      await r2Get(PRIVATE_BUCKET, `imports/${job.id}/output/papers/${paper.slug}/${imageName}`, imagePath);
      await r2Put(CONTENT_BUCKET, `question-images/cie-igcse-${job.asset_key}/${paper.slug}/${imageName}`, imagePath, "image/png");
    }
    for (const type of ["qp", "ms"]) {
      const source = inputFiles.find((file) => file.paper_slug === paper.slug && file.document_type === type);
      if (!source) throw new Error(`${paper.slug}: missing ${type} source PDF`);
      const pdfPath = join(workDirectory, "pdf", source.file_name);
      await r2Get(PRIVATE_BUCKET, `imports/${job.id}/input/${source.file_name}`, pdfPath);
      const bytes = await readFile(pdfPath);
      if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
        throw new Error(`${paper.slug}: ${type} source is not a PDF`);
      }
      const actualHash = await sha256File(pdfPath);
      const manifestHash = type === "qp" ? paper.qpSha256 : paper.msSha256;
      if (actualHash !== source.sha256 || actualHash !== manifestHash) {
        throw new Error(`${paper.slug}: ${type} source hash does not match validation records`);
      }
      await r2Put(CONTENT_BUCKET, `papers/${paper.slug}/${type}.pdf`, pdfPath, "application/pdf");
    }
    sqlParts.push(paperSql(job, paper, payload));
    questionCount += Number(paper.validQuestionCount);
  }
  const now = new Date().toISOString();
  const summary = {
    ...manifest,
    requestedAction: null,
    publishedAt: now,
    publishedPaperCount: papers.length,
    publishedQuestionCount: questionCount,
    publishedPapers: papers.map((paper) => paper.slug),
    publishFailures: [],
  };
  sqlParts.push(`
    UPDATE exam_import_jobs
    SET status = 'published', summary = ${jsonValue(summary)}, published_at = ${sqlValue(now)}
    WHERE id = ${sqlValue(job.id)};
  `);
  const file = join(workDirectory, "publish.sql");
  await writeFile(file, sqlParts.join("\n"));
  await executeSqlFile(file);
}

const requestedAction = argument("--action", "auto");
const requestedJobId = argument("--job-id");
if (!VALID_ACTIONS.has(requestedAction)) throw new Error("action must be auto, process, or publish");
const job = await selectJob(requestedJobId, requestedAction);
if (!job) {
  console.log("No queued Cloudflare import job found.");
  process.exit(0);
}
if (!new Set(["process", "publish"]).has(job.action)) throw new Error("Import job has no supported requested action");
if (job.action === "process" && job.status !== "processing") {
  throw new Error("Process action requires a queued processing job");
}
if (job.action === "publish" && job.status !== "validated") {
  throw new Error("Publish action requires a validated job");
}

const workDirectory = await mkdtemp(join(tmpdir(), `expassway-import-${basename(job.id)}-`));
try {
  console.log(`${job.action} import job ${job.id}`);
  if (job.action === "process") await processJob(job, workDirectory);
  else await publishJob(job, workDirectory);
  console.log(`Completed ${job.action} for import job ${job.id}.`);
} catch (error) {
  await recordFailure(job, error, workDirectory).catch((recordError) => {
    console.error("Could not record import failure", recordError);
  });
  throw error;
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}
