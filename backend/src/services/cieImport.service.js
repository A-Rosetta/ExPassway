import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { getPool } from "../db/client.js";
import {
  addImportFile,
  completeJobProcessing,
  createImportJob,
  getImportJob,
  listImportFiles,
  listImportIssues,
  markJobProcessing,
  markJobPublished,
} from "../db/repositories/examImports.repository.js";
import { getSubjectByCode } from "../db/repositories/examCatalog.repository.js";
import { ApiError } from "../utils/http.js";

const execFileAsync = promisify(execFile);
const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SERVICE_DIR, "../../..");
const BACKEND_ROOT = path.join(PROJECT_ROOT, "backend");
const IMPORT_ROOT = path.join(BACKEND_ROOT, "imports");
const PYTHON = path.join(PROJECT_ROOT, ".venv-pdf", "bin", "python");
const PROCESSOR = path.join(BACKEND_ROOT, "scripts", "cie-mcq-import.py");
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const FILE_PATTERN = /^(\d{4})_([msw])(\d{2})_(qp|ms)_(2)([1-9])\.pdf$/i;

function safeAssetKey(value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new ApiError(400, "Subject asset key is invalid.", "INVALID_SUBJECT_ASSET_KEY");
  }
  return value;
}

function parsePdfFileName(fileName, subjectCode) {
  const safeName = path.basename(String(fileName || ""));
  if (safeName !== fileName) {
    throw new ApiError(400, "File name must not contain a path.", "INVALID_FILE_NAME");
  }
  const match = safeName.match(FILE_PATTERN);
  if (!match || match[1] !== subjectCode) {
    throw new ApiError(
      400,
      `Use an official Paper 2 file name for subject ${subjectCode}, such as ${subjectCode}_s25_qp_22.pdf.`,
      "INVALID_FILE_NAME"
    );
  }
  return {
    fileName: safeName,
    documentType: match[4].toLowerCase(),
    paperSlug: `${match[1]}_${match[2].toLowerCase()}${match[3]}_qp_${match[5]}${match[6]}`,
  };
}

function decodePdf(dataUrl) {
  const match = String(dataUrl || "").match(/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new ApiError(400, "Upload a PDF file.", "INVALID_PDF");
  const buffer = Buffer.from(match[1], "base64");
  if (!buffer.length || buffer.length > MAX_PDF_BYTES) {
    throw new ApiError(400, "PDF size must be between 1 byte and 12 MB.", "INVALID_PDF_SIZE");
  }
  if (buffer.subarray(0, 5).toString("ascii") !== "%PDF-") {
    throw new ApiError(400, "Uploaded content is not a valid PDF.", "INVALID_PDF");
  }
  return buffer;
}

function jobPaths(jobId) {
  const root = path.join(IMPORT_ROOT, jobId);
  return { root, input: path.join(root, "input"), output: path.join(root, "output") };
}

export async function createCieImportJob(subjectCode, userId) {
  const subject = await getSubjectByCode(subjectCode);
  if (!subject) throw new ApiError(404, "Register the subject before importing papers.", "SUBJECT_NOT_FOUND");
  const jobId = crypto.randomUUID();
  const paths = jobPaths(jobId);
  await fs.mkdir(paths.input, { recursive: true });
  await fs.mkdir(paths.output, { recursive: true });
  return createImportJob({
    id: jobId,
    subjectCode,
    createdBy: userId,
    inputDir: paths.input,
    stagingDir: paths.output,
  });
}

export async function uploadCieImportFile(jobId, input) {
  const job = await getImportJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
  if (job.status !== "uploading" && job.status !== "failed") {
    throw new ApiError(409, "Files can only be uploaded before processing.", "INVALID_IMPORT_STATE");
  }
  const meta = parsePdfFileName(input.fileName, job.subjectCode);
  const buffer = decodePdf(input.dataUrl);
  const storedPath = path.join(job.inputDir, meta.fileName);
  await fs.writeFile(storedPath, buffer);
  return addImportFile({
    jobId,
    ...meta,
    byteSize: buffer.length,
    sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    storedPath,
  });
}

export async function processCieImportJob(jobId) {
  const job = await getImportJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
  if (job.status !== "uploading" && job.status !== "failed") {
    throw new ApiError(409, "Import job cannot be processed in its current state.", "INVALID_IMPORT_STATE");
  }
  const files = await listImportFiles(jobId);
  if (files.length < 2) {
    throw new ApiError(400, "Upload at least one QP/MS pair.", "IMPORT_FILES_REQUIRED");
  }
  const subject = await getSubjectByCode(job.subjectCode);
  await markJobProcessing(jobId);
  let manifest = null;
  let processError = null;
  try {
    await fs.rm(job.stagingDir, { recursive: true, force: true });
    await fs.mkdir(job.stagingDir, { recursive: true });
    await execFileAsync(PYTHON, [
      PROCESSOR,
      "--input", job.inputDir,
      "--output", job.stagingDir,
      "--subject-code", job.subjectCode,
      "--asset-key", safeAssetKey(subject.assetKey),
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  } catch (error) {
    processError = error;
  }
  const manifestPath = path.join(job.stagingDir, "manifest.json");
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
  }
  const issues = Array.isArray(manifest?.issues) ? [...manifest.issues] : [];
  if (!manifest && processError) {
    issues.push({
      severity: "error",
      code: "PROCESSOR_FAILED",
      message: processError.stderr || processError.message || "CIE processor failed.",
    });
  }
  const validatedCount = Number(manifest?.validatedPaperCount || 0);
  const status = validatedCount > 0 ? "validated" : "failed";
  const summary = manifest || { validatedPaperCount: 0, rejectedPaperCount: 0, issues };
  await completeJobProcessing(jobId, {
    status,
    manifestPath: manifest ? manifestPath : "",
    summary,
    issues,
  });
  return getCieImportJob(jobId);
}

async function preparePaperAssets(job, subject, paper) {
  const finalRoot = path.join(
    PROJECT_ROOT,
    "assets",
    "exam-question-images",
    `cie-igcse-${safeAssetKey(subject.assetKey)}`
  );
  const sourceImages = path.join(job.stagingDir, "papers", paper.slug);
  const sourceData = path.join(job.stagingDir, "data", `${paper.slug}.json`);
  const targetImages = path.join(finalRoot, paper.slug);
  const targetDataDir = path.join(finalRoot, "data");
  const targetData = path.join(targetDataDir, `${paper.slug}.json`);
  const publishId = `${job.id}-${crypto.randomUUID()}`;
  const pendingImages = path.join(finalRoot, `.pending-${publishId}`);
  const pendingData = path.join(targetDataDir, `.${paper.slug}.${publishId}.pending`);
  const backupImages = path.join(finalRoot, `.backup-${publishId}`);
  const backupData = path.join(targetDataDir, `.${paper.slug}.${publishId}.backup`);
  const assets = {
    payload: JSON.parse(await fs.readFile(sourceData, "utf8")),
    paths: {
      targetImages,
      targetData,
      pendingImages,
      pendingData,
      backupImages,
      backupData,
    },
    activatedImages: false,
    activatedData: false,
    backedUpImages: false,
    backedUpData: false,
  };
  try {
    await fs.mkdir(targetDataDir, { recursive: true });
    await fs.cp(sourceImages, pendingImages, { recursive: true });
    await fs.copyFile(sourceData, pendingData);
    return assets;
  } catch (error) {
    await restorePaperAssets(assets).catch(() => {});
    throw error;
  }
}

async function activatePaperAssets(assets) {
  const { paths } = assets;
  try {
    await fs.rename(paths.targetImages, paths.backupImages);
    assets.backedUpImages = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  try {
    await fs.rename(paths.targetData, paths.backupData);
    assets.backedUpData = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await fs.rename(paths.pendingImages, paths.targetImages);
  assets.activatedImages = true;
  await fs.rename(paths.pendingData, paths.targetData);
  assets.activatedData = true;
}

async function restorePaperAssets(assets) {
  const { paths } = assets;
  await fs.rm(paths.pendingImages, { recursive: true, force: true });
  await fs.rm(paths.pendingData, { force: true });
  if (assets.activatedImages) await fs.rm(paths.targetImages, { recursive: true, force: true });
  if (assets.activatedData) await fs.rm(paths.targetData, { force: true });
  if (assets.backedUpImages) await fs.rename(paths.backupImages, paths.targetImages);
  if (assets.backedUpData) await fs.rename(paths.backupData, paths.targetData);
}

async function removePaperAssetBackups(assets) {
  await fs.rm(assets.paths.backupImages, { recursive: true, force: true });
  await fs.rm(assets.paths.backupData, { force: true });
}

function newQuestionId(subject, paperSlug, questionNo) {
  return `CIE-${subject.qualification}-${subject.code}-${paperSlug}-${String(questionNo).padStart(2, "0")}`;
}

async function publishPaper(job, subject, paper) {
  const assets = await preparePaperAssets(job, subject, paper);
  const { payload } = assets;
  const validRows = (payload.rows || []).filter((row) => (
    Number.isInteger(row.answer) && row.answer >= 0 && row.answer <= 3
  ));
  if (validRows.length !== Number(paper.validQuestionCount)) {
    await restorePaperAssets(assets);
    throw new Error(`${paper.slug}: manifest and data question counts differ`);
  }
  const subjectName = `${subject.qualification} ${subject.name}`;
  const seasonNames = { m: "March", s: "Summer", w: "Winter" };
  let client = null;
  try {
    client = await getPool().connect();
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [paper.slug]);
    const existing = await client.query(`
      select id, question_no from question_bank where paper_slug = $1
    `, [paper.slug]);
    const ids = new Map(existing.rows.map((row) => [Number(row.question_no), row.id]));
    await client.query("update question_bank set active = false where paper_slug = $1", [paper.slug]);
    for (const row of validRows) {
      const questionNo = Number(row.questionNo);
      const parsedOptions = row.options?.A && row.options?.B && row.options?.C && row.options?.D;
      const id = ids.get(questionNo) || newQuestionId(subject, paper.slug, questionNo);
      const options = parsedOptions
        ? [row.options.A, row.options.B, row.options.C, row.options.D]
        : ["A", "B", "C", "D"];
      await client.query(`
        insert into question_bank (
          id, board, subject, paper, difficulty, topic, year, stem, options,
          answer, mistake_type, template_id, skills, hints, images, source,
          subject_code, paper_slug, question_no, active
        ) values (
          $1,$2,$3,'MCQ',$4,$5,$6,$7,$8::jsonb,$9,'unknown',$10,$11::jsonb,
          '[]'::jsonb,$12::jsonb,$13::jsonb,$14,$15,$16,true
        )
        on conflict (id) do update set
          board = excluded.board, subject = excluded.subject, paper = excluded.paper,
          difficulty = excluded.difficulty, topic = excluded.topic, year = excluded.year,
          stem = excluded.stem, options = excluded.options, answer = excluded.answer,
          template_id = excluded.template_id, skills = excluded.skills,
          images = excluded.images, source = excluded.source,
          subject_code = excluded.subject_code, paper_slug = excluded.paper_slug,
          question_no = excluded.question_no, active = true
      `, [
        id,
        subject.board,
        subjectName,
        questionNo <= 14 ? "基础" : questionNo <= 28 ? "中等" : "冲刺",
        `Past Paper ${seasonNames[paper.season]}`,
        String(paper.year),
        row.stem || row.rawText || `Question ${questionNo}`,
        JSON.stringify(options),
        row.answer,
        `${paper.slug}-${questionNo}`,
        JSON.stringify([safeAssetKey(subject.assetKey), "mcq", "past-paper"]),
        JSON.stringify([{ url: row.imageUrl, position: "stem", order: 1 }]),
        JSON.stringify({
          type: "cie_mcq_import",
          importJobId: job.id,
          fileName: paper.qpFileName,
          markScheme: paper.msFileName,
          questionNo,
          answerStatus: row.answerStatus || "valid",
        }),
        subject.code,
        paper.slug,
        questionNo,
      ]);
    }
    await client.query(`
      insert into exam_papers (
        slug, subject_code, year, season, paper_number, variant, paper_type,
        duration_minutes, source_question_count, valid_question_count,
        discounted_questions, qp_file_name, ms_file_name, data_url,
        status, metadata, published_at
      ) values ($1,$2,$3,$4,2,$5,'MCQ',45,$6,$7,$8,$9,$10,$11,'published',$12::jsonb,now())
      on conflict (slug) do update set
        subject_code = excluded.subject_code, year = excluded.year,
        season = excluded.season, paper_number = 2, variant = excluded.variant,
        source_question_count = excluded.source_question_count,
        valid_question_count = excluded.valid_question_count,
        discounted_questions = excluded.discounted_questions,
        qp_file_name = excluded.qp_file_name, ms_file_name = excluded.ms_file_name,
        data_url = excluded.data_url, status = 'published',
        metadata = excluded.metadata, published_at = now(), updated_at = now()
    `, [
      paper.slug,
      subject.code,
      paper.year,
      paper.season,
      paper.variant,
      paper.sourceQuestionCount,
      paper.validQuestionCount,
      paper.discountedQuestions || [],
      paper.qpFileName,
      paper.msFileName,
      paper.dataUrl,
      JSON.stringify({ importJobId: job.id, qpSha256: paper.qpSha256, msSha256: paper.msSha256 }),
    ]);
    await activatePaperAssets(assets);
    await client.query("commit");
  } catch (error) {
    await client?.query("rollback").catch(() => {});
    await restorePaperAssets(assets).catch(() => {});
    throw error;
  } finally {
    client?.release();
  }
  await removePaperAssetBackups(assets).catch(() => {});
  return validRows.length;
}

export async function publishCieImportJob(jobId) {
  const job = await getImportJob(jobId);
  if (!job) throw new ApiError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
  if (job.status !== "validated") {
    throw new ApiError(409, "Only validated jobs can be published.", "INVALID_IMPORT_STATE");
  }
  const subject = await getSubjectByCode(job.subjectCode);
  const manifest = JSON.parse(await fs.readFile(job.manifestPath, "utf8"));
  const papers = (manifest.papers || []).filter((paper) => paper.status === "validated");
  let questionCount = 0;
  const publishedPapers = [];
  const failures = [];
  for (const paper of papers) {
    try {
      questionCount += await publishPaper(job, subject, paper);
      publishedPapers.push(paper.slug);
    } catch (error) {
      failures.push({ paperSlug: paper.slug, message: error.message });
    }
  }
  const summary = {
    ...manifest,
    publishedPaperCount: publishedPapers.length,
    publishedQuestionCount: questionCount,
    publishedPapers,
    publishFailures: failures,
  };
  if (failures.length) {
    await completeJobProcessing(jobId, {
      status: "failed",
      manifestPath: job.manifestPath,
      summary,
      issues: failures.map((failure) => ({
        severity: "error",
        code: "PUBLISH_FAILED",
        message: failure.message,
        paperSlug: failure.paperSlug,
      })),
    });
    throw new ApiError(
      500,
      publishedPapers.length
        ? "Some validated papers could not be published."
        : "No validated paper could be published.",
      "PUBLISH_FAILED",
      failures
    );
  }
  await markJobPublished(jobId, summary);
  return getCieImportJob(jobId);
}

export async function getCieImportJob(jobId) {
  const job = await getImportJob(jobId);
  if (!job) return null;
  const [files, issues] = await Promise.all([
    listImportFiles(jobId),
    listImportIssues(jobId),
  ]);
  return { ...job, files, issues };
}
