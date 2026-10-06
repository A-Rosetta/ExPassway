import {
  AuthError,
  failure,
  mapUser,
  readJsonBody,
  requireCurrentUser,
  routeNotFound,
  success,
} from "./auth-api.js";
import { dispatchImportWorkflow, writeAudit } from "./admin-support.js";
import { handleAdminPlatformRoute } from "./admin-platform-api.js";
import { subjectCapabilities } from "./read-api.js";
import { usesSubjectHub } from "../shared/subject-catalogue.js";

const CORS_PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const FILE_PATTERN = /^(\d{4})_([msw])(\d{2})_(qp|ms)_([12])([1-9])\.pdf$/i;
const HINT_PROMPT_VERSION = "igcse-progressive-v1";
const HINT_SAMPLE = {
  version: "biology-hint-sample-v1",
  subjectCode: "0610",
  languages: ["zh-CN", "en"],
  questionIds: [
    "CIE-IGCSE-0610-0610_m21_qp_22-01",
    "CIE-IGCSE-0610-0610_m22_qp_22-02",
    "CIE-IGCSE-0610-0610_w19_qp_21-03",
    "CIE-IGCSE-0610-0610_w23_qp_22-03",
    "CIE-IGCSE-0610-0610_s20_qp_21-03",
    "CIE-IGCSE-0610-0610_m21_qp_22-38",
    "CIE-IGCSE-0610-0610_m21_qp_22-05",
    "CIE-IGCSE-0610-0610_s23_qp_21-04",
    "CIE-IGCSE-0610-0610_w21_qp_22-06",
    "CIE-IGCSE-0610-0610_w20_qp_21-06",
    "CIE-IGCSE-0610-0610_w22_qp_21-06",
    "CIE-IGCSE-0610-0610_m20_qp_22-08",
  ],
};
const POSITION_FALLBACK = [
  ["1.1.1", "1.1"], ["1.3.2", "1.5"], ["2.1.1", "2.1"], ["2.1.6", "2.3"],
  ["2.2.1", "2.4"], ["3.2.2", "3.2"], ["4.1.2", "4.1"], ["5.1.4", "5.1"],
  ["5.1.5", "5.2"], ["6.1.2", "6.1"], ["6.2.2", "6.2"], ["7.1.2", "7.1"],
  ["7.2.1", "7.2"], ["7.4.3", "7.3"], ["8.2.1", "8.2"], ["8.3.1", "8.2"],
  ["8.4.1", "8.3"], ["9.1.3", "9.1"], ["9.2.1", "9.2"], ["10.1.3", "10.1"],
  ["11.1.2", "11.2"], ["12.2.1", "11.1"], ["14.1.4", "12.1"], ["14.2.2", "12.2"],
  ["13.1.3", "13.1"], ["14.4.1", "13.2"], ["16.1.1", "14.1"], ["16.3.5", "14.2"],
  ["16.4.1", "15.1"], ["17.1.10", "16.1"], ["17.4.11", "16.2"], ["18.1.1", "17.1"],
  ["18.2.1", "17.2"], ["18.3.1", "17.2"], ["19.2.1", "18.1"], ["19.3.1", "18.2"],
  ["19.4.1", "18.3"], ["20.1.1", "19.1"], ["20.3.1", "19.1"], ["20.4.4", "19.2"],
];

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function toInteger(value, fallback, min, max, field = "value") {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AuthError(400, `${field} must be an integer from ${min} to ${max}.`, "INVALID_INPUT");
  }
  return number;
}

function limitedText(value, maxLength, field, required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new AuthError(400, `${field} is required.`, "INVALID_INPUT");
  if (text.length > maxLength) throw new AuthError(400, `${field} is too long.`, "INVALID_INPUT");
  return text || null;
}

async function requireAdmin(request, env) {
  const { user } = await requireCurrentUser(request, env);
  if (user.role !== "admin") throw new AuthError(403, "Admin access required.", "FORBIDDEN");
  return user;
}

function mapSubject(row) {
  return {
    code: row.code,
    board: row.board,
    qualification: row.qualification,
    name: row.name,
    nameZh: row.name_zh || "",
    assetKey: row.asset_key,
    active: Boolean(row.active),
    paperCount: Number(row.paper_count || 0),
    questionCount: Number(row.question_count || 0),
    capabilities: subjectCapabilities(row.code),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function subjectReadiness(db, subject) {
  if (!usesSubjectHub(subject.code)) return subject;
  const row = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM subject_resources WHERE subject_code = ? AND status = 'published' AND kind = 'syllabus') AS syllabus,
      (SELECT COUNT(*) FROM subject_resources WHERE subject_code = ? AND status = 'published' AND kind = 'textbook') AS textbooks,
      (SELECT COUNT(*) FROM exam_papers WHERE subject_code = ? AND status = 'published') AS papers,
      (SELECT COUNT(*) FROM question_bank question JOIN exam_papers paper ON paper.slug = question.paper_slug
        WHERE question.subject_code = ? AND question.active = 1 AND paper.status = 'published') AS questions
  `).bind(subject.code, subject.code, subject.code, subject.code).first();
  return {
    ...subject,
    readiness: {
      syllabus: Number(row.syllabus) > 0, textbooks: Number(row.textbooks) > 0,
      papers: Number(row.papers) > 0, questions: Number(row.questions) > 0,
    },
    contentCounts: {
      syllabus: Number(row.syllabus), textbooks: Number(row.textbooks),
      papers: Number(row.papers), questions: Number(row.questions),
    },
    importMode: subject.capabilities.structured ? "structured-package" : "resource-package",
  };
}

function mapPractice(row) {
  return {
    id: row.id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    userEmail: row.user_email,
    grade: row.grade,
    board: row.board,
    subject: row.subject,
    paper: row.paper,
    difficulty: row.difficulty,
    topics: parseJson(row.topics, []),
    requestedCount: Number(row.requested_count),
    status: row.status,
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
  };
}

function mapImportFile(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    fileName: row.file_name,
    documentType: row.document_type,
    paperSlug: row.paper_slug,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    createdAt: row.created_at,
  };
}

function mapImportIssue(row) {
  return {
    id: row.id,
    jobId: row.job_id,
    paperSlug: row.paper_slug || "",
    severity: row.severity,
    code: row.code,
    message: row.message,
    details: parseJson(row.details, {}),
    createdAt: row.created_at,
  };
}

function mapImportJob(row) {
  return {
    id: row.id,
    subjectCode: row.subject_code,
    subjectName: row.subject_name || "",
    createdBy: row.created_by,
    createdByName: row.created_by_name || "",
    status: row.cancelled_at ? "cancelled" : row.status,
    inputDir: row.input_dir,
    stagingDir: row.staging_dir,
    manifestPath: row.manifest_path || "",
    summary: parseJson(row.summary, {}),
    fileCount: Number(row.file_count || 0),
    issueCount: Number(row.issue_count || 0),
    createdAt: row.created_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    publishedAt: row.published_at,
    cancelledAt: row.cancelled_at || null,
    hiddenAt: row.hidden_at || null,
  };
}

const IMPORT_SELECT = `
  SELECT j.*, s.name AS subject_name, u.display_name AS created_by_name,
    (SELECT COUNT(*) FROM exam_import_files f WHERE f.job_id = j.id) AS file_count,
    (SELECT COUNT(*) FROM exam_import_issues i WHERE i.job_id = j.id) AS issue_count
  FROM exam_import_jobs j
  JOIN exam_subjects s ON s.code = j.subject_code
  LEFT JOIN users u ON u.id = j.created_by
`;

async function getImportJob(db, jobId, detail = false) {
  const row = await db.prepare(`${IMPORT_SELECT} WHERE j.id = ? LIMIT 1`).bind(jobId).first();
  if (!row) return null;
  const job = mapImportJob(row);
  if (!detail) return job;
  const [files, issues] = await Promise.all([
    db.prepare("SELECT * FROM exam_import_files WHERE job_id = ? ORDER BY file_name").bind(jobId).all(),
    db.prepare("SELECT * FROM exam_import_issues WHERE job_id = ? ORDER BY created_at, paper_slug").bind(jobId).all(),
  ]);
  return {
    ...job,
    files: files.results.map(mapImportFile),
    issues: issues.results.map(mapImportIssue),
  };
}

function parsePdfFileName(fileName, subjectCode) {
  if (usesSubjectHub(subjectCode)) {
    throw new AuthError(400, `${subjectCode} requires a prepared resource package.`, "UNSUPPORTED_IMPORT_TYPE");
  }
  const name = String(fileName || "");
  const match = name.match(FILE_PATTERN);
  if (!match || match[1] !== subjectCode || (match[5] === "1" && !new Set(["0455", "0625"]).has(subjectCode))) {
    throw new AuthError(400, `Use a supported official MCQ file name for subject ${subjectCode}.`, "INVALID_FILE_NAME");
  }
  return {
    fileName: name,
    documentType: match[4].toLowerCase(),
    paperSlug: `${match[1]}_${match[2].toLowerCase()}${match[3]}_qp_${match[5]}${match[6]}`,
  };
}

function decodePdf(value) {
  const match = String(value || "").match(/^data:application\/pdf;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new AuthError(400, "Upload a PDF file.", "INVALID_PDF");
  let binary;
  try {
    binary = atob(match[1]);
  } catch (_error) {
    throw new AuthError(400, "Uploaded PDF is not valid base64.", "INVALID_PDF");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_PDF_BYTES) {
    throw new AuthError(400, "PDF size must be between 1 byte and 12 MB.", "INVALID_PDF_SIZE");
  }
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") {
    throw new AuthError(400, "Uploaded content is not a valid PDF.", "INVALID_PDF");
  }
  return bytes;
}

async function sha256(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function listMappings(db, url) {
  const status = String(url.searchParams.get("status") || "unverified");
  if (!new Set(["suggested", "unverified", "reviewed", "rejected"]).has(status)) {
    throw new AuthError(400, "Invalid mapping status.", "INVALID_INPUT");
  }
  const subjectCode = String(url.searchParams.get("subjectCode") || "0610");
  if (!/^\d{4}$/.test(subjectCode)) throw new AuthError(400, "Invalid subject code.", "INVALID_INPUT");
  const limit = toInteger(url.searchParams.get("limit"), 100, 1, 300, "limit");
  const offset = toInteger(url.searchParams.get("offset"), 0, 0, 100000, "offset");
  const year = String(url.searchParams.get("year") || "");
  const chapter = toInteger(url.searchParams.get("chapter"), 0, 0, 99, "chapter");
  if (year && !/^20\d{2}$/.test(year)) throw new AuthError(400, "Invalid paper year.", "INVALID_INPUT");
  const version = await db.prepare("SELECT id FROM curriculum_versions WHERE subject_code = ? AND active = 1 LIMIT 1")
    .bind(subjectCode).first();
  if (!version) throw new AuthError(404, "Curriculum version not found.", "CURRICULUM_NOT_FOUND");
  const versionId = version.id;
  const statusFilter = status === "unverified"
    ? "mapping.status = 'reviewed' AND mapping.reviewed_by IS NULL"
    : "mapping.status = ?";
  const statusParams = status === "unverified" ? [] : [status];
  const [rows, count, syllabus, bookSections, years] = await Promise.all([
    db.prepare(`
      SELECT mapping.*, question.stem, question.options, question.answer, question.year, question.paper_slug,
        question.question_no, question.images, syllabus_section.syllabus_code,
        syllabus_section.title_en AS syllabus_title_en,
        syllabus_section.title_zh AS syllabus_title_zh,
        book_section.section_code AS book_section_code,
        book_section.title_en AS book_title_en,
        book_section.title_zh AS book_title_zh
      FROM question_section_mappings mapping
      JOIN question_bank question ON question.id = mapping.question_id
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = mapping.curriculum_section_id
      LEFT JOIN coursebook_sections book_section ON book_section.id = mapping.coursebook_section_id
      LEFT JOIN coursebook_chapters chapter_row ON chapter_row.id = book_section.coursebook_chapter_id
      WHERE ${statusFilter} AND syllabus_section.curriculum_version_id = ?
        AND (? = '' OR question.year = ?)
        AND (? = 0 OR chapter_row.chapter_no = ?)
      ORDER BY mapping.created_at, question.year DESC, question.paper_slug, question.question_no
      LIMIT ? OFFSET ?
    `).bind(...statusParams, versionId, year, year, chapter, chapter, limit, offset).all(),
    db.prepare(`
      SELECT COUNT(*) AS count
      FROM question_section_mappings mapping
      JOIN question_bank question ON question.id = mapping.question_id
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = mapping.curriculum_section_id
      LEFT JOIN coursebook_sections book_section ON book_section.id = mapping.coursebook_section_id
      LEFT JOIN coursebook_chapters chapter_row ON chapter_row.id = book_section.coursebook_chapter_id
      WHERE ${statusFilter} AND syllabus_section.curriculum_version_id = ?
        AND (? = '' OR question.year = ?)
        AND (? = 0 OR chapter_row.chapter_no = ?)
    `).bind(...statusParams, versionId, year, year, chapter, chapter).first(),
    db.prepare(`
      SELECT id, syllabus_code, title_en, title_zh, core_level
      FROM curriculum_sections
      WHERE curriculum_version_id = ?
        AND EXISTS (SELECT 1 FROM coursebook_section_mappings bridge WHERE bridge.curriculum_section_id = curriculum_sections.id)
      ORDER BY sort_order
    `).bind(versionId).all(),
    db.prepare(`
      SELECT book_section.id, book_section.section_code, book_section.title_en,
        book_section.title_zh, chapter.chapter_no,
        chapter.title_en AS chapter_title_en, chapter.title_zh AS chapter_title_zh,
        json_group_array(book_mapping.curriculum_section_id) AS curriculum_section_ids
      FROM coursebook_sections book_section
      JOIN coursebook_chapters chapter ON chapter.id = book_section.coursebook_chapter_id
      JOIN coursebook_section_mappings book_mapping ON book_mapping.coursebook_section_id = book_section.id
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = book_mapping.curriculum_section_id
      WHERE syllabus_section.curriculum_version_id = ?
      GROUP BY book_section.id
      ORDER BY chapter.sort_order, book_section.sort_order
    `).bind(versionId).all(),
    db.prepare("SELECT DISTINCT year FROM question_bank WHERE subject_code = ? AND year GLOB '[0-9][0-9][0-9][0-9]' ORDER BY year DESC")
      .bind(subjectCode).all(),
  ]);
  return {
    subjectCode,
    years: years.results.map((row) => row.year),
    total: Number(count?.count || 0),
    mappings: rows.results.map((row) => ({
      questionId: row.question_id,
      curriculumSectionId: row.curriculum_section_id,
      coursebookSectionId: row.coursebook_section_id,
      isPrimary: Boolean(row.is_primary),
      confidence: row.confidence == null ? null : Number(row.confidence),
      status: row.status,
      source: row.source,
      reviewedBy: row.reviewed_by || null,
      similarQuestionGroup: row.similar_question_group,
      stem: row.stem,
      options: parseJson(row.options, []),
      answer: row.answer == null ? null : Number(row.answer),
      year: row.year,
      paperSlug: row.paper_slug,
      questionNo: row.question_no == null ? null : Number(row.question_no),
      images: parseJson(row.images, []),
      syllabusCode: row.syllabus_code,
      syllabusTitleEn: row.syllabus_title_en,
      syllabusTitleZh: row.syllabus_title_zh,
      bookSectionCode: row.book_section_code,
      bookTitleEn: row.book_title_en,
      bookTitleZh: row.book_title_zh,
    })),
    limit,
    offset,
    syllabusSections: syllabus.results.map((row) => ({
      id: row.id,
      syllabusCode: row.syllabus_code,
      titleEn: row.title_en,
      titleZh: row.title_zh,
      coreLevel: row.core_level,
    })),
    coursebookSections: bookSections.results.map((row) => ({
      id: row.id,
      sectionCode: row.section_code,
      titleEn: row.title_en,
      titleZh: row.title_zh,
      chapterNo: Number(row.chapter_no),
      chapterTitleEn: row.chapter_title_en,
      chapterTitleZh: row.chapter_title_zh,
      curriculumSectionIds: parseJson(row.curriculum_section_ids, []),
    })),
  };
}

async function bulkReviewMappings(request, env, admin) {
  const body = await readJsonBody(request);
  const subjectCode = String(body.subjectCode || "");
  if (!/^\d{4}$/.test(subjectCode) || !Array.isArray(body.mappings)
    || body.mappings.length < 1 || body.mappings.length > 100) {
    throw new AuthError(400, "Select 1 to 100 mappings from one subject.", "INVALID_INPUT");
  }
  const keys = body.mappings.map((item) => ({
    questionId: limitedText(item?.questionId, 200, "Question ID", true),
    curriculumSectionId: limitedText(item?.curriculumSectionId, 200, "Curriculum section ID", true),
  }));
  if (new Set(keys.map((item) => `${item.questionId}\u0000${item.curriculumSectionId}`)).size !== keys.length
    || new Set(keys.map((item) => item.questionId)).size !== keys.length) {
    throw new AuthError(400, "Select each question once.", "INVALID_INPUT");
  }
  const selectedJson = JSON.stringify(keys);
  const rows = await env.DB.prepare(`
    SELECT mapping.question_id, mapping.curriculum_section_id, mapping.status,
      mapping.is_primary, mapping.reviewed_by, question.subject_code,
      section.curriculum_version_id,
      EXISTS (SELECT 1 FROM coursebook_section_mappings bridge
        WHERE bridge.coursebook_section_id = mapping.coursebook_section_id
          AND bridge.curriculum_section_id = mapping.curriculum_section_id) AS valid_section,
      EXISTS (SELECT 1 FROM question_section_mappings other
        WHERE other.question_id = mapping.question_id AND other.status = 'reviewed'
          AND other.is_primary = 1 AND other.curriculum_section_id <> mapping.curriculum_section_id) AS conflicting_primary
    FROM question_section_mappings mapping
    JOIN json_each(?) selected ON mapping.question_id = json_extract(selected.value, '$.questionId')
      AND mapping.curriculum_section_id = json_extract(selected.value, '$.curriculumSectionId')
    JOIN question_bank question ON question.id = mapping.question_id
    JOIN curriculum_sections section ON section.id = mapping.curriculum_section_id
  `).bind(selectedJson).all();
  const version = await env.DB.prepare("SELECT id FROM curriculum_versions WHERE subject_code = ? AND active = 1 LIMIT 1")
    .bind(subjectCode).first();
  if (!version || rows.results.length !== keys.length || rows.results.some((row) =>
    row.subject_code !== subjectCode || row.curriculum_version_id !== version.id
    || !row.valid_section || !row.is_primary || row.reviewed_by
    || !new Set(["suggested", "reviewed"]).has(row.status) || row.conflicting_primary
  )) {
    throw new AuthError(409, "Selection changed or contains an invalid chapter mapping. Reload and try again.", "MAPPING_CONFLICT");
  }
  const now = new Date().toISOString();
  const updated = await env.DB.prepare(`
    UPDATE question_section_mappings SET status = 'reviewed', source = 'manual',
      reviewed_by = ?, reviewed_at = ?, updated_at = ?
    WHERE (question_id, curriculum_section_id) IN (
      SELECT json_extract(value, '$.questionId'), json_extract(value, '$.curriculumSectionId')
      FROM json_each(?)
    )
      AND reviewed_by IS NULL AND status IN ('suggested', 'reviewed') AND is_primary = 1
  `).bind(admin.id, now, now, selectedJson).run();
  await writeAudit(env.DB, admin.id, "curriculum.mapping.bulk_review", "curriculum_mapping", null,
    { subjectCode, count: Number(updated.meta.changes || 0) });
  return { updated: Number(updated.meta.changes || 0) };
}

async function suggestMappings(db, limit) {
  const questions = await db.prepare(`
    SELECT q.id, q.question_no
    FROM question_bank q
    WHERE q.subject_code = '0610' AND q.active = 1
      AND q.year GLOB '[0-9][0-9][0-9][0-9]'
      AND CAST(q.year AS INTEGER) BETWEEN 2019 AND 2024
      AND NOT EXISTS (
        SELECT 1 FROM question_section_mappings mapping
        WHERE mapping.question_id = q.id AND mapping.status IN ('reviewed', 'rejected')
      )
    ORDER BY q.year DESC, q.paper_slug, q.question_no
    LIMIT ?
  `).bind(limit).all();
  const [syllabus, books] = await Promise.all([
    db.prepare(`
      SELECT id, syllabus_code FROM curriculum_sections
      WHERE curriculum_version_id = '0610-2026-2028-v2' AND level = 'statement'
    `).all(),
    db.prepare(`
      SELECT book_section.id, book_section.section_code
      FROM coursebook_sections book_section
      JOIN coursebook_chapters chapter ON chapter.id = book_section.coursebook_chapter_id
      WHERE chapter.book_key = 'biology-igcse-coursebook-4e'
    `).all(),
  ]);
  const syllabusByCode = new Map(syllabus.results.map((row) => [row.syllabus_code, row.id]));
  const bookByCode = new Map(books.results.map((row) => [row.section_code, row.id]));
  const targets = questions.results.map((question) => {
    const index = Math.max(1, Math.min(40, Number(question.question_no || 1))) - 1;
    const [syllabusCode, bookCode] = POSITION_FALLBACK[index];
    return {
      questionId: question.id,
      curriculumSectionId: syllabusByCode.get(syllabusCode),
      coursebookSectionId: bookByCode.get(bookCode),
    };
  }).filter((target) => target.curriculumSectionId && target.coursebookSectionId);
  const existingRows = targets.length
    ? await db.prepare(`
      SELECT question_id, curriculum_section_id
      FROM question_section_mappings
      WHERE question_id IN (${targets.map(() => "?").join(", ")})
    `).bind(...targets.map((target) => target.questionId)).all()
    : { results: [] };
  const existingKeys = new Set(existingRows.results.map((row) => `${row.question_id}:${row.curriculum_section_id}`));
  const statements = targets.map((target) => db.prepare(`
      INSERT INTO question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, source
      ) VALUES (?, ?, ?, 1, 0.35, 'suggested', 'rule')
      ON CONFLICT (question_id, curriculum_section_id) DO UPDATE SET
        coursebook_section_id = excluded.coursebook_section_id,
        is_primary = 1,
        confidence = excluded.confidence,
        source = excluded.source,
        updated_at = excluded.updated_at
      WHERE question_section_mappings.status = 'suggested'
    `).bind(target.questionId, target.curriculumSectionId, target.coursebookSectionId));
  if (statements.length) await db.batch(statements);
  const existing = targets.filter((target) => existingKeys.has(`${target.questionId}:${target.curriculumSectionId}`)).length;
  return {
    matched: targets.length,
    considered: questions.results.length,
    created: targets.length - existing,
    existing,
    keywordMatches: 0,
    positionFallbacks: targets.length,
  };
}

async function reviewMapping(request, env, admin, questionId, currentSectionId) {
  const body = await readJsonBody(request);
  const curriculumSectionId = limitedText(body.curriculumSectionId, 200, "Syllabus statement", true);
  const coursebookSectionId = limitedText(body.coursebookSectionId, 200, "Coursebook section", true);
  const status = String(body.status || "");
  if (!new Set(["reviewed", "rejected"]).has(status)) {
    throw new AuthError(400, "Mapping status must be reviewed or rejected.", "INVALID_INPUT");
  }
  const validMapping = await env.DB.prepare(`
    SELECT 1 FROM coursebook_section_mappings
    WHERE coursebook_section_id = ? AND curriculum_section_id = ? LIMIT 1
  `).bind(coursebookSectionId, curriculumSectionId).first();
  if (!validMapping) {
    throw new AuthError(400, "The syllabus statement is not mapped to the selected coursebook section.", "INVALID_MAPPING");
  }
  const current = await env.DB.prepare(`
    SELECT * FROM question_section_mappings
    WHERE question_id = ? AND curriculum_section_id = ? LIMIT 1
  `).bind(questionId, currentSectionId).first();
  if (!current) throw new AuthError(404, "Question mapping not found.", "MAPPING_NOT_FOUND");
  const primary = status === "reviewed" && body.isPrimary !== false;
  const now = new Date().toISOString();
  const statements = [];
  if (primary) {
    statements.push(env.DB.prepare(`
      UPDATE question_section_mappings SET is_primary = 0, updated_at = ?
      WHERE question_id = ? AND status = 'reviewed' AND is_primary = 1
        AND curriculum_section_id <> ?
    `).bind(now, questionId, curriculumSectionId));
  }
  statements.push(
    env.DB.prepare(`
      DELETE FROM question_section_mappings
      WHERE question_id = ? AND curriculum_section_id = ?
    `).bind(questionId, currentSectionId),
    env.DB.prepare(`
      INSERT INTO question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, reviewed_by, reviewed_at,
        source, similar_question_group, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (question_id, curriculum_section_id) DO UPDATE SET
        coursebook_section_id = excluded.coursebook_section_id,
        is_primary = excluded.is_primary,
        confidence = excluded.confidence,
        status = excluded.status,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        source = excluded.source,
        similar_question_group = excluded.similar_question_group,
        updated_at = excluded.updated_at
    `).bind(
      questionId,
      curriculumSectionId,
      coursebookSectionId,
      primary ? 1 : 0,
      current.confidence,
      status,
      admin.id,
      now,
      status === "reviewed" ? "manual" : current.source,
      current.similar_question_group,
      now
    )
  );
  await env.DB.batch(statements);
  return env.DB.prepare(`
    SELECT * FROM question_section_mappings
    WHERE question_id = ? AND curriculum_section_id = ? LIMIT 1
  `).bind(questionId, curriculumSectionId).first();
}

function mapHintSet(row) {
  return {
    id: row.id,
    questionId: row.question_id,
    language: row.language,
    promptVersion: row.prompt_version,
    questionFingerprint: row.question_fingerprint,
    hints: parseJson(row.hints, []),
    status: row.status,
    model: row.model,
    responseId: row.response_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    question: {
      paperSlug: row.paper_slug,
      questionNo: Number(row.question_no),
      subjectCode: row.subject_code,
      stem: row.stem,
      options: parseJson(row.options, []),
      images: parseJson(row.images, []),
    },
  };
}

async function hintSampleStatus(db) {
  const placeholders = HINT_SAMPLE.questionIds.map(() => "?").join(", ");
  const rows = await db.prepare(`
    SELECT question_id, language, status
    FROM question_hint_sets
    WHERE prompt_version = ? AND question_id IN (${placeholders})
  `).bind(HINT_PROMPT_VERSION, ...HINT_SAMPLE.questionIds).all();
  const byKey = new Map(rows.results.map((row) => [`${row.question_id}:${row.language}`, row.status]));
  const counts = { approved: 0, pendingReview: 0, rejected: 0, missing: 0 };
  HINT_SAMPLE.questionIds.forEach((id) => HINT_SAMPLE.languages.forEach((language) => {
    const status = byKey.get(`${id}:${language}`);
    if (status === "approved") counts.approved += 1;
    else if (status === "pending_review") counts.pendingReview += 1;
    else if (status === "rejected") counts.rejected += 1;
    else counts.missing += 1;
  }));
  const expected = HINT_SAMPLE.questionIds.length * HINT_SAMPLE.languages.length;
  return { version: HINT_SAMPLE.version, expected, ...counts, ready: counts.approved === expected };
}

export async function handleAdminApiRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
  }
  try {
    const admin = await requireAdmin(request, env);
    const platformResponse = await handleAdminPlatformRoute(request, env, admin);
    if (platformResponse) return platformResponse;
    if (request.method === "GET" && url.pathname === "/api/admin/records") {
      const usersLimit = toInteger(url.searchParams.get("usersLimit"), 20, 1, 100, "usersLimit");
      const practicesLimit = toInteger(url.searchParams.get("practicesLimit"), 20, 1, 100, "practicesLimit");
      const [summary, users, practices] = await Promise.all([
        env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM users) AS users_count,
            (SELECT COUNT(*) FROM practice_sessions) AS practice_count,
            (SELECT COUNT(*) FROM practice_sessions WHERE status = 'submitted') AS submitted_count
        `).first(),
        env.DB.prepare("SELECT * FROM users ORDER BY created_at DESC LIMIT ?").bind(usersLimit).all(),
        env.DB.prepare(`
          SELECT p.*, u.display_name AS user_display_name, u.email AS user_email,
            json_extract(p.result, '$.accuracy') AS accuracy
          FROM practice_sessions p LEFT JOIN users u ON u.id = p.user_id
          ORDER BY p.created_at DESC LIMIT ?
        `).bind(practicesLimit).all(),
      ]);
      return success({
        summary: {
          usersCount: Number(summary.users_count),
          practiceCount: Number(summary.practice_count),
          submittedCount: Number(summary.submitted_count),
        },
        latestUsers: users.results.map(mapUser),
        latestPractices: practices.results.map(mapPractice),
      }, request.method);
    }

    const userStatus = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/status$/);
    if (userStatus && request.method === "PATCH") {
      const userId = decodeURIComponent(userStatus[1]);
      if (userId === admin.id) throw new AuthError(409, "Administrators cannot disable their own account.", "ADMIN_SELF_DISABLE");
      const body = await readJsonBody(request);
      if (typeof body.disabled !== "boolean") throw new AuthError(400, "Disabled must be a boolean.", "INVALID_INPUT");
      const target = await env.DB.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(userId).first();
      if (!target) throw new AuthError(404, "User not found.", "USER_NOT_FOUND");
      if (target.role === "admin") throw new AuthError(403, "Administrator accounts cannot be disabled here.", "FORBIDDEN");
      await env.DB.prepare("UPDATE users SET disabled_at = ?, updated_at = ? WHERE id = ?")
        .bind(body.disabled ? new Date().toISOString() : null, new Date().toISOString(), userId).run();
      await writeAudit(env.DB, admin.id, body.disabled ? "user.disable" : "user.enable", "user", userId);
      return success(mapUser(await env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(userId).first()), request.method);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/subjects") {
      const rows = await env.DB.prepare(`
        SELECT s.*, COUNT(DISTINCT p.slug) AS paper_count,
          SUM(CASE WHEN p.status = 'published' THEN p.valid_question_count ELSE 0 END) AS question_count
        FROM exam_subjects s LEFT JOIN exam_papers p ON p.subject_code = s.code
        GROUP BY s.code ORDER BY s.qualification, s.name
      `).all();
      return success(await Promise.all(rows.results.map((row) => subjectReadiness(env.DB, mapSubject(row)))), request.method);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/subjects") {
      const body = await readJsonBody(request);
      const code = String(body.code || "").trim();
      const name = limitedText(body.name, 120, "Subject English name", true);
      const nameZh = limitedText(body.nameZh, 120, "Subject Chinese name");
      const assetKey = String(body.assetKey || "").trim().toLowerCase();
      const qualification = String(body.qualification || "IGCSE").trim();
      if (!/^\d{4}$/.test(code)) throw new AuthError(400, "Subject code must contain four digits.", "INVALID_INPUT");
      if (!new Set(["IGCSE", "AS & A Level"]).has(qualification)) {
        throw new AuthError(400, "Qualification must be IGCSE or AS & A Level.", "INVALID_INPUT");
      }
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetKey)) {
        throw new AuthError(400, "Asset key must use lowercase letters, numbers, and hyphens.", "INVALID_INPUT");
      }
      const now = new Date().toISOString();
      await env.DB.prepare(`
        INSERT INTO exam_subjects (code, board, qualification, name, name_zh, asset_key, active, created_at, updated_at)
        VALUES (?, 'CIE', ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (code) DO UPDATE SET
          qualification = excluded.qualification,
          name = excluded.name, name_zh = excluded.name_zh, asset_key = excluded.asset_key,
          active = excluded.active, updated_at = excluded.updated_at
      `).bind(code, qualification, name, nameZh, assetKey, body.active === false ? 0 : 1, now, now).run();
      await writeAudit(env.DB, admin.id, "subject.save", "subject", code, { name, assetKey, qualification });
      return success(mapSubject(await env.DB.prepare("SELECT * FROM exam_subjects WHERE code = ?").bind(code).first()), request.method, 201);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/imports") {
      const limit = toInteger(url.searchParams.get("limit"), 30, 1, 100, "limit");
      const includeHidden = new Set(["1", "true"]).has(url.searchParams.get("includeHidden"));
      const rows = await env.DB.prepare(`${IMPORT_SELECT} ${includeHidden ? "" : "WHERE j.hidden_at IS NULL"} ORDER BY j.created_at DESC LIMIT ?`).bind(limit).all();
      return success(rows.results.map(mapImportJob), request.method);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/imports") {
      const body = await readJsonBody(request);
      const subjectCode = String(body.subjectCode || "").trim();
      if (!/^\d{4}$/.test(subjectCode)) throw new AuthError(400, "Select a registered subject.", "INVALID_INPUT");
      if (usesSubjectHub(subjectCode)) {
        throw new AuthError(400, `${subjectCode} requires a prepared resource package.`, "UNSUPPORTED_IMPORT_TYPE");
      }
      const subject = await env.DB.prepare("SELECT 1 FROM exam_subjects WHERE code = ?").bind(subjectCode).first();
      if (!subject) throw new AuthError(404, "Register the subject before importing papers.", "SUBJECT_NOT_FOUND");
      const id = crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO exam_import_jobs (id, subject_code, created_by, input_dir, staging_dir)
        VALUES (?, ?, ?, ?, ?)
      `).bind(id, subjectCode, admin.id, `r2://private-imports/imports/${id}/input`, `r2://private-imports/imports/${id}/output`).run();
      await writeAudit(env.DB, admin.id, "import.create", "import_job", id, { subjectCode });
      return success(await getImportJob(env.DB, id, true), request.method, 201);
    }

    const importFiles = url.pathname.match(/^\/api\/admin\/imports\/([^/]+)\/files$/);
    if (importFiles && request.method === "POST") {
      const jobId = decodeURIComponent(importFiles[1]);
      const job = await getImportJob(env.DB, jobId);
      if (!job) throw new AuthError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
      if (usesSubjectHub(job.subjectCode)) {
        throw new AuthError(400, `${job.subjectCode} requires a prepared resource package.`, "UNSUPPORTED_IMPORT_TYPE");
      }
      if (!new Set(["uploading", "failed"]).has(job.status)) {
        throw new AuthError(409, "Files can only be uploaded before processing.", "INVALID_IMPORT_STATE");
      }
      const body = await readJsonBody(request);
      const file = parsePdfFileName(body.fileName, job.subjectCode);
      const bytes = decodePdf(body.dataUrl);
      const hash = await sha256(bytes);
      const key = `imports/${jobId}/input/${file.fileName}`;
      await env.PRIVATE_IMPORTS_BUCKET.put(key, bytes, {
        httpMetadata: { contentType: "application/pdf" },
        customMetadata: { jobId, documentType: file.documentType, paperSlug: file.paperSlug, sha256: hash },
      });
      const existing = await env.DB.prepare(`
        SELECT id FROM exam_import_files WHERE job_id = ? AND file_name = ? LIMIT 1
      `).bind(jobId, file.fileName).first();
      const id = existing?.id || crypto.randomUUID();
      await env.DB.prepare(`
        INSERT INTO exam_import_files (
          id, job_id, file_name, document_type, paper_slug, byte_size, sha256, stored_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (job_id, file_name) DO UPDATE SET
          document_type = excluded.document_type, paper_slug = excluded.paper_slug,
          byte_size = excluded.byte_size, sha256 = excluded.sha256,
          stored_path = excluded.stored_path, created_at = excluded.created_at
      `).bind(id, jobId, file.fileName, file.documentType, file.paperSlug, bytes.length, hash, `r2://${key}`).run();
      return success(mapImportFile(await env.DB.prepare("SELECT * FROM exam_import_files WHERE id = ?").bind(id).first()), request.method, 201);
    }

    const importAction = url.pathname.match(/^\/api\/admin\/imports\/([^/]+)\/(process|publish)$/);
    if (importAction && request.method === "POST") {
      const jobId = decodeURIComponent(importAction[1]);
      const job = await getImportJob(env.DB, jobId);
      if (!job) throw new AuthError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
      if (usesSubjectHub(job.subjectCode)) {
        throw new AuthError(400, `${job.subjectCode} requires a prepared resource package.`, "UNSUPPORTED_IMPORT_TYPE");
      }
      if (importAction[2] === "process" && !new Set(["uploading", "failed"]).has(job.status)) {
        throw new AuthError(409, "Import job cannot be processed in its current state.", "INVALID_IMPORT_STATE");
      }
      if (importAction[2] === "publish" && job.status !== "validated") {
        throw new AuthError(409, "Only validated jobs can be published.", "INVALID_IMPORT_STATE");
      }
      if (importAction[2] === "process") {
        const files = await env.DB.prepare("SELECT COUNT(*) AS count FROM exam_import_files WHERE job_id = ?").bind(jobId).first();
        if (Number(files.count) < 2) throw new AuthError(400, "Upload at least one QP/MS pair.", "IMPORT_FILES_REQUIRED");
      }
      const now = new Date().toISOString();
      if (importAction[2] === "process") {
        await env.DB.prepare(`
          UPDATE exam_import_jobs
          SET status = 'processing', started_at = ?, completed_at = NULL,
            summary = json_set(summary, '$.requestedAction', 'process', '$.requestedAt', ?)
          WHERE id = ?
        `).bind(now, now, jobId).run();
      } else {
        await env.DB.prepare(`
          UPDATE exam_import_jobs
          SET summary = json_set(summary, '$.requestedAction', 'publish', '$.requestedAt', ?)
          WHERE id = ?
        `).bind(now, jobId).run();
      }
      try {
        await dispatchImportWorkflow(env, { action: importAction[2], jobId });
      } catch (error) {
        await env.DB.prepare(`
          UPDATE exam_import_jobs SET status = ?, started_at = ?, completed_at = ?, summary = ?
          WHERE id = ? AND cancelled_at IS NULL
            AND json_extract(summary, '$.requestedAction') = ?
        `).bind(job.status, job.startedAt, job.completedAt, JSON.stringify(job.summary), jobId, importAction[2]).run();
        throw error;
      }
      await writeAudit(env.DB, admin.id, `import.${importAction[2]}`, "import_job", jobId);
      return success(await getImportJob(env.DB, jobId, true), request.method);
    }

    const importDetail = url.pathname.match(/^\/api\/admin\/imports\/([^/]+)$/);
    if (importDetail && request.method === "GET") {
      const job = await getImportJob(env.DB, decodeURIComponent(importDetail[1]), true);
      if (!job) throw new AuthError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
      return success(job, request.method);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/curriculum/mappings") {
      return success(await listMappings(env.DB, url), request.method);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/curriculum/mappings/suggest") {
      const body = await readJsonBody(request);
      return success(await suggestMappings(env.DB, toInteger(body.limit, 100, 1, 100, "limit")), request.method, 201);
    }
    if (request.method === "POST" && url.pathname === "/api/admin/curriculum/mappings/bulk-review") {
      return success(await bulkReviewMappings(request, env, admin), request.method);
    }
    const mappingReview = url.pathname.match(/^\/api\/admin\/curriculum\/mappings\/([^/]+)\/([^/]+)$/);
    if (mappingReview && request.method === "PATCH") {
      return success(await reviewMapping(
        request,
        env,
        admin,
        decodeURIComponent(mappingReview[1]),
        decodeURIComponent(mappingReview[2])
      ), request.method);
    }

    if (request.method === "GET" && url.pathname === "/api/admin/question-hints") {
      const status = String(url.searchParams.get("status") || "pending_review");
      if (!new Set(["pending_review", "approved", "rejected"]).has(status)) {
        throw new AuthError(400, "Invalid question hint status.", "INVALID_INPUT");
      }
      const subjectCode = String(url.searchParams.get("subjectCode") || "");
      if (subjectCode && !/^\d{4}$/.test(subjectCode)) throw new AuthError(400, "Invalid subject code.", "INVALID_INPUT");
      const limit = toInteger(url.searchParams.get("limit"), 50, 1, 100, "limit");
      const rows = await env.DB.prepare(`
        SELECT hint.*, question.paper_slug, question.question_no, question.subject_code,
          question.stem, question.options, question.images
        FROM question_hint_sets hint JOIN question_bank question ON question.id = hint.question_id
        WHERE hint.status = ? AND (? = '' OR question.subject_code = ?)
        ORDER BY hint.created_at DESC LIMIT ?
      `).bind(status, subjectCode, subjectCode, limit).all();
      return success(rows.results.map(mapHintSet), request.method);
    }
    if (request.method === "GET" && url.pathname === "/api/admin/question-hints/sample-status") {
      return success(await hintSampleStatus(env.DB), request.method);
    }
    const hintReview = url.pathname.match(/^\/api\/admin\/question-hints\/([^/]+)$/);
    if (hintReview && request.method === "PATCH") {
      const body = await readJsonBody(request);
      const status = String(body.status || "");
      if (!new Set(["approved", "rejected"]).has(status)) {
        throw new AuthError(400, "Hint status must be approved or rejected.", "INVALID_INPUT");
      }
      const id = decodeURIComponent(hintReview[1]);
      const now = new Date().toISOString();
      await env.DB.prepare(`
        UPDATE question_hint_sets SET status = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?
      `).bind(status, admin.id, now, now, id).run();
      const row = await env.DB.prepare("SELECT * FROM question_hint_sets WHERE id = ? LIMIT 1").bind(id).first();
      if (!row) throw new AuthError(404, "Question hint set not found.", "HINT_SET_NOT_FOUND");
      await writeAudit(env.DB, admin.id, `ai_hints.${status}`, "question_hint_set", id);
      return success({ ...mapHintSet({ ...row, paper_slug: null, question_no: null, subject_code: null, stem: null, options: "[]", images: "[]" }), question: undefined }, request.method);
    }
    return routeNotFound(request, url);
  } catch (error) {
    if (error instanceof AuthError) {
      return failure(error.status, error.code, error.message, request.method, error.details);
    }
    console.error("D1 admin API failed", error);
    return failure(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.", request.method);
  }
}
