#!/usr/bin/env node

/**
 * Import a validated 9618 resource package.
 *
 * The default mode is a local, side-effect-free dry run. Applying a package
 * uploads declared files first and then upserts draft D1 rows. Publishing is
 * explicit (`--publish`) so collecting and reviewing resources cannot take
 * content live accidentally.
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { validateResourcePackage } from "../shared/structured-content.js";

const execFileAsync = promisify(execFile);
const DEFAULT_DATABASE = "expassway-db";
const DEFAULT_BUCKET = "expassway-content";
const SUBJECT_BOARD = "CIE";
const SUBJECT_NAME = "Computer Science";
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlJson(value) {
  return sqlString(JSON.stringify(value ?? {}));
}

function sqlInteger(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback === null ? "NULL" : String(fallback);
  const number = Number(value);
  return Number.isInteger(number) ? String(number) : fallback === null ? "NULL" : String(fallback);
}

function nowIso() {
  return new Date().toISOString();
}

function extensionContentType(path) {
  const extension = extname(path).toLowerCase();
  return {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".txt": "text/plain",
    ".json": "application/json",
  }[extension] || "application/octet-stream";
}

function assertInside(root, child, label) {
  const resolvedRoot = resolve(root);
  const resolvedChild = resolve(root, child);
  const childRelative = relative(resolvedRoot, resolvedChild);
  if (!childRelative || childRelative.startsWith("..") || isAbsolute(childRelative)) {
    throw new Error(`${label} must stay inside the package directory: ${child}`);
  }
  return resolvedChild;
}

async function fileDetails(file, packageRoot) {
  if (typeof file.localPath !== "string" || !file.localPath.trim()) {
    throw new Error(`files[${file.storageKey}].localPath is required to apply a package.`);
  }
  const path = assertInside(packageRoot, file.localPath, `files[${file.storageKey}].localPath`);
  const info = await stat(path);
  if (!info.isFile()) throw new Error(`Declared package file is not a regular file: ${file.localPath}`);
  const bytes = await readFile(path);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (file.sha256 && String(file.sha256).toLowerCase() !== sha256) {
    throw new Error(`SHA-256 mismatch for ${file.storageKey}: expected ${file.sha256}, got ${sha256}`);
  }
  return {
    ...file,
    localPath: path,
    bytes: bytes.byteLength,
    sha256,
    contentType: file.contentType || extensionContentType(file.localPath),
  };
}

function contentFallbackStem(question) {
  const blocks = question?.content?.blocks;
  const first = Array.isArray(blocks) ? blocks.find((block) => ["text", "code"].includes(block?.type) && String(block.text || "").trim()) : null;
  return first?.text || `Question ${question.questionNo}`;
}

function paperMetadata(paper) {
  const metadata = paper.metadata && typeof paper.metadata === "object" ? { ...paper.metadata } : {};
  if (paper.qpStorageKey) metadata.qpStorageKey = paper.qpStorageKey;
  if (paper.msStorageKey) metadata.msStorageKey = paper.msStorageKey;
  return metadata;
}

function paperStorageKey(paper, type) {
  const explicit = paper[`${type}StorageKey`] || paper.metadata?.[`${type}StorageKey`];
  return explicit || `papers/${paper.slug}/${type}.pdf`;
}

function sourcePaperMetadata(paper) {
  const slug = typeof paper.slug === "string" ? paper.slug.match(/^(\d{4})_([msw])(\d{2})_qp_([1-4])([1-9])$/) : null;
  return {
    year: paper.year ?? (slug ? 2000 + Number(slug[3]) : null),
    season: paper.season ?? slug?.[2],
    paperNumber: paper.paperNumber ?? (slug ? Number(slug[4]) : null),
    variant: paper.variant ?? (slug ? Number(slug[5]) : null),
  };
}

function importStatus(value, publish, allowed = ["draft", "published", "archived"]) {
  if (publish) return value === "archived" && allowed.includes("archived") ? "archived" : "published";
  return "draft";
}

function buildExamPaperSql(paper, bundle, publish, timestamp, questionCount) {
  const status = importStatus(paper.status, publish, ["draft", "published", "rejected"]);
  const metadata = paperMetadata(paper);
  metadata.qpStorageKey = paperStorageKey(paper, "qp");
  metadata.msStorageKey = paperStorageKey(paper, "ms");
  const { year, season, paperNumber, variant } = sourcePaperMetadata(paper);
  if (!Number.isInteger(paper.sourceQuestionCount) || paper.sourceQuestionCount <= 0) {
    throw new Error(`papers[${paper.slug}].sourceQuestionCount must supply the actual positive original question count.`);
  }
  if (paper.validQuestionCount !== undefined && paper.validQuestionCount !== questionCount) {
    throw new Error(`papers[${paper.slug}].validQuestionCount must match its ${questionCount} imported bank questions.`);
  }
  if (questionCount > paper.sourceQuestionCount) {
    throw new Error(`papers[${paper.slug}] imports more bank questions than its original question count.`);
  }
  const sourceCount = paper.sourceQuestionCount;
  const validCount = questionCount;
  return `INSERT INTO exam_papers (slug, subject_code, year, season, paper_number, variant, paper_type, duration_minutes, source_question_count, valid_question_count, total_marks, discounted_questions, qp_file_name, ms_file_name, data_url, status, metadata, published_at, updated_at)
VALUES (${sqlString(paper.slug)}, ${sqlString(bundle.subjectCode)}, ${sqlInteger(year)}, ${sqlString(season)}, ${sqlInteger(paperNumber)}, ${sqlInteger(variant)}, ${sqlString(paper.paperType || (paperNumber === 4 ? "practical" : "structured"))}, ${sqlInteger(paper.durationMinutes)}, ${sqlInteger(sourceCount)}, ${sqlInteger(validCount, 0)}, ${sqlInteger(paper.totalMarks)}, '[]', ${sqlString(paper.qpFileName || `${paper.slug}.qp.pdf`)}, ${sqlString(paper.msFileName || `${paper.slug}.ms.pdf`)}, NULL, ${sqlString(status)}, ${sqlJson(metadata)}, ${publish ? sqlString(timestamp) : "NULL"}, ${sqlString(timestamp)})
ON CONFLICT(slug) DO UPDATE SET
  subject_code = excluded.subject_code, year = excluded.year, season = excluded.season, paper_number = excluded.paper_number, variant = excluded.variant,
  paper_type = excluded.paper_type, duration_minutes = excluded.duration_minutes, source_question_count = excluded.source_question_count,
  valid_question_count = excluded.valid_question_count, total_marks = excluded.total_marks, qp_file_name = excluded.qp_file_name,
  ms_file_name = excluded.ms_file_name, metadata = excluded.metadata, updated_at = excluded.updated_at,
  status = CASE WHEN exam_papers.status = 'published' AND excluded.status = 'draft' THEN exam_papers.status ELSE excluded.status END ,
  published_at = CASE WHEN excluded.status = 'published' THEN excluded.published_at ELSE exam_papers.published_at END;`;
}

function buildResourceSql(resource, bundle, publish, timestamp, file) {
  const status = importStatus(resource.status, publish);
  const contentType = resource.contentType || file?.contentType || extensionContentType(file?.localPath || resource.storageKey);
  return `INSERT INTO subject_resources (id, subject_code, kind, title, title_zh, version, exam_year_start, exam_year_end, paper_slug, storage_key, content_type, metadata, status, updated_at)
VALUES (${sqlString(resource.id)}, ${sqlString(bundle.subjectCode)}, ${sqlString(resource.kind)}, ${sqlString(resource.title)}, ${sqlString(resource.titleZh)}, ${sqlString(resource.version)}, ${sqlInteger(resource.examYearStart)}, ${sqlInteger(resource.examYearEnd)}, ${sqlString(resource.paperSlug)}, ${sqlString(resource.storageKey)}, ${sqlString(contentType)}, ${sqlJson(resource.metadata)}, ${sqlString(status)}, ${sqlString(timestamp)})
ON CONFLICT(id) DO UPDATE SET
  subject_code = excluded.subject_code, kind = excluded.kind, title = excluded.title, title_zh = excluded.title_zh,
  version = excluded.version, exam_year_start = excluded.exam_year_start, exam_year_end = excluded.exam_year_end,
  paper_slug = excluded.paper_slug, storage_key = excluded.storage_key, content_type = excluded.content_type,
  metadata = excluded.metadata, updated_at = excluded.updated_at,
  status = CASE WHEN subject_resources.status = 'published' AND excluded.status = 'draft' THEN subject_resources.status ELSE excluded.status END;`;
}

function buildQuestionSql(question, paper, bundle, publish) {
  const content = question.content || {};
  const markScheme = question.markScheme || {};
  const questionImages = Array.isArray(question.images) ? question.images : (Array.isArray(content.images) ? content.images : []);
  const source = {
    ...(question.source && typeof question.source === "object" ? question.source : {}),
    importSchemaVersion: bundle.schemaVersion,
    paperSlug: question.paperSlug,
    originalQuestionNo: question.questionNo,
  };
  const stem = question.stem || contentFallbackStem(question);
  const { year } = sourcePaperMetadata(paper);
  return `INSERT INTO question_bank (id, board, subject, paper, difficulty, topic, year, stem, options, answer, mistake_type, template_id, skills, hints, images, source, subject_code, paper_slug, question_no, active, question_type, max_marks, structured_content, mark_scheme)
VALUES (${sqlString(question.id)}, ${sqlString(bundle.board || SUBJECT_BOARD)}, ${sqlString(bundle.subjectName || SUBJECT_NAME)}, ${sqlString(paper.paperType || "structured")}, ${sqlString(question.difficulty || "unmarked")}, ${sqlString(question.topic)}, ${sqlString(year)}, ${sqlString(stem)}, '[]', NULL, 'unknown', ${sqlString(`${question.paperSlug}-${question.questionNo}`)}, '[]', '[]', ${sqlJson(questionImages)}, ${sqlJson(source)}, ${sqlString(bundle.subjectCode)}, ${sqlString(question.paperSlug)}, ${sqlInteger(question.questionNo)}, ${publish ? 1 : 0}, 'structured', ${sqlInteger(question.maxMarks)}, ${sqlJson(content)}, ${sqlJson(markScheme)})
ON CONFLICT(id) DO UPDATE SET
  board = excluded.board, subject = excluded.subject, paper = excluded.paper, difficulty = excluded.difficulty, topic = excluded.topic,
  year = excluded.year, stem = excluded.stem, options = '[]', answer = NULL, mistake_type = excluded.mistake_type, template_id = excluded.template_id,
  skills = '[]', hints = '[]', images = excluded.images, source = excluded.source, subject_code = excluded.subject_code, paper_slug = excluded.paper_slug,
  question_no = excluded.question_no, question_type = 'structured', max_marks = excluded.max_marks, structured_content = excluded.structured_content,
  mark_scheme = excluded.mark_scheme, active = CASE WHEN question_bank.active = 1 AND excluded.active = 0 THEN question_bank.active ELSE excluded.active END;`;
}

export function buildImportSql(bundle, { publish = false, timestamp = nowIso() } = {}) {
  const papersBySlug = new Map(bundle.papers.map((paper) => [paper.slug, paper]));
  const filesByKey = new Map(bundle.files.map((file) => [file.storageKey, file]));
  const questionsByPaper = new Map();
  for (const question of bundle.questions) questionsByPaper.set(question.paperSlug, (questionsByPaper.get(question.paperSlug) || 0) + 1);
  // Wrangler executes SQL files through D1's transaction mechanism. Explicit
  // SQLite BEGIN/COMMIT statements are unsupported by D1's statement API.
  const lines = ["PRAGMA foreign_keys = ON;"];
  for (const paper of bundle.papers) lines.push(buildExamPaperSql(paper, bundle, publish, timestamp, questionsByPaper.get(paper.slug) || 0));
  for (const resource of bundle.resources) lines.push(buildResourceSql(resource, bundle, publish, timestamp, filesByKey.get(resource.storageKey)));
  for (const question of bundle.questions) {
    const paper = papersBySlug.get(question.paperSlug);
    if (!paper) throw new Error(`Question ${question.id} references undeclared paper ${question.paperSlug}`);
    lines.push(buildQuestionSql(question, paper, bundle, publish));
  }
  return lines.join("\n");
}

export async function loadImportPlan(packagePath, { publish = false } = {}) {
  const manifestPath = resolve(packagePath);
  const packageRoot = dirname(manifestPath);
  const bundle = JSON.parse(await readFile(manifestPath, "utf8"));
  const validation = validateResourcePackage(bundle);
  if (!validation.valid) {
    const details = validation.errors.map((error) => `${error.path}: ${error.message}`).join("\n");
    throw new Error(`Resource package validation failed:\n${details}`);
  }
  const files = [];
  for (const file of bundle.files) files.push(await fileDetails(file, packageRoot));
  const fileKeys = new Set(files.map((file) => file.storageKey));
  for (const paper of bundle.papers) {
    for (const kind of ["qp", "ms"]) {
      const key = paperStorageKey(paper, kind);
      if (!fileKeys.has(key)) throw new Error(`papers[${paper.slug}] is missing a declared ${kind.toUpperCase()} file (${key}).`);
    }
  }
  const sql = buildImportSql(bundle, { publish });
  return { bundle, packageRoot, files, sql, publish };
}

export function wranglerInvocation(args) {
  return { executable: process.execPath, args: [resolve(REPOSITORY_ROOT, "node_modules/wrangler/bin/wrangler.js"), ...args] };
}

async function runWrangler(args, options = {}) {
  const command = wranglerInvocation(args);
  const result = await execFileAsync(command.executable, command.args, { cwd: options.cwd || REPOSITORY_ROOT, maxBuffer: 20 * 1024 * 1024 });
  return result.stdout;
}

export async function applyImportPlan(plan, { target, database, bucket, cwd = REPOSITORY_ROOT, run = runWrangler }) {
  const remoteFlag = target === "remote" ? "--remote" : "--local";
  for (const file of plan.files) {
    await run(["r2", "object", "put", `${bucket}/${file.storageKey}`, remoteFlag, "--file", file.localPath, "--content-type", file.contentType, "--force"], { cwd });
  }
  const sqlDirectory = await mkdtemp(resolve(tmpdir(), "expassway-structured-import-sql-"));
  const sqlPath = resolve(sqlDirectory, "package.sql");
  try {
    await writeFile(sqlPath, plan.sql, "utf8");
    await run(["d1", "execute", database, remoteFlag, "--yes", "--file", sqlPath], { cwd });
  } finally {
    await rm(sqlDirectory, { recursive: true, force: true });
  }
}

function argumentValue(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const packagePath = argumentValue(args, "--package") || args.find((arg) => !arg.startsWith("-"));
  if (!packagePath || args.includes("--help")) {
    console.log("Usage: node tools/import-structured-resource-package.mjs --package <package.json> [--mode dry-run|apply] [--target local|remote] [--publish] [--confirm-remote]");
    return;
  }
  const mode = argumentValue(args, "--mode", "dry-run");
  const target = argumentValue(args, "--target", "local");
  const publish = args.includes("--publish");
  if (!["dry-run", "apply"].includes(mode)) throw new Error(`Unsupported mode: ${mode}`);
  if (!["local", "remote"].includes(target)) throw new Error(`Unsupported target: ${target}`);
  if (mode === "dry-run" && publish) throw new Error("--publish requires --mode apply.");
  if (mode === "apply" && target === "remote" && !args.includes("--confirm-remote")) {
    throw new Error("Remote apply requires --confirm-remote. Review the dry-run plan first.");
  }
  const plan = await loadImportPlan(packagePath, { publish });
  const questionsByPaper = new Map();
  for (const question of plan.bundle.questions) questionsByPaper.set(question.paperSlug, (questionsByPaper.get(question.paperSlug) || 0) + 1);
  console.log(`Resource package v${plan.bundle.schemaVersion} is valid.`);
  console.log(`Subject ${plan.bundle.subjectCode}: ${plan.files.length} files (${plan.files.reduce((sum, file) => sum + file.bytes, 0)} bytes), ${plan.bundle.resources.length} resources, ${plan.bundle.papers.length} papers, ${plan.bundle.questions.length} structured questions.`);
  for (const paper of plan.bundle.papers) console.log(`  ${paper.slug}: Paper ${paper.paperNumber}, ${questionsByPaper.get(paper.slug) || 0} bank questions, ${paper.totalMarks} marks, ${paper.durationMinutes} minutes.`);
  if (mode === "dry-run") {
    console.log("Dry run only: no R2 objects or database records were changed.");
    return;
  }
  await applyImportPlan(plan, {
    target,
    database: argumentValue(args, "--database", DEFAULT_DATABASE),
    bucket: argumentValue(args, "--bucket", DEFAULT_BUCKET),
    cwd: REPOSITORY_ROOT,
  });
  console.log(`${publish ? "Published" : "Draft"} import applied to ${target} D1/R2.`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
