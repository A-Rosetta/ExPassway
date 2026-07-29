import { Router } from "express";
import { ApiError } from "../utils/http.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { toClampedInteger } from "../utils/validate.js";
import { isDbEnabled, query } from "../db/client.js";
import { getUserById, listUsers, setUserDisabled } from "../db/repositories/users.repository.js";
import { getPracticeSummaryCounts, listRecentPracticeSessions } from "../db/repositories/practice.repository.js";
import { readAuthToken, verifyToken } from "../services/auth.service.js";
import {
  listAllSubjects,
  upsertSubject,
} from "../db/repositories/examCatalog.repository.js";
import { listImportJobs } from "../db/repositories/examImports.repository.js";
import {
  createCieImportJob,
  getCieImportJob,
  processCieImportJob,
  publishCieImportJob,
  uploadCieImportFile,
} from "../services/cieImport.service.js";
import {
  listQuestionMappingsForReview,
  reviewQuestionMapping,
} from "../db/repositories/chapterPractice.repository.js";
import { listCurriculumReviewOptions } from "../db/repositories/curriculum.repository.js";
import { generateBiologyMappingSuggestions } from "../services/chapterMapping.service.js";
import {
  listQuestionHintSetsForReview,
  reviewQuestionHintSet,
} from "../db/repositories/questionHints.repository.js";
import { getBiologyHintSampleReviewStatus } from "../services/questionHints.service.js";

const router = Router();

function assertAdminApiEnabled() {
  if (!isDbEnabled()) {
    throw new ApiError(
      503,
      "Admin records API requires PostgreSQL. Set DATABASE_URL and run DB schema first.",
      "DB_DISABLED"
    );
  }
}

let moderationColumnsReady = false;

async function ensureModerationColumns() {
  if (moderationColumnsReady) return;
  await query(`
    alter table users
    add column if not exists disabled_at timestamptz
  `);
  moderationColumnsReady = true;
}

async function requireAdmin(req) {
  const token = readAuthToken(req);
  const payload = verifyToken(token);
  const user = await getUserById(payload.sub);
  if (!user || user.isDisabled) {
    throw new ApiError(401, "Administrator session is no longer valid.", "UNAUTHORIZED");
  }
  if (user.role !== "admin") {
    throw new ApiError(403, "Admin access required.", "FORBIDDEN");
  }
  return user;
}

router.get("/records", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await ensureModerationColumns();
  await requireAdmin(req);

  const usersLimit = toClampedInteger(req.query.usersLimit, 20, 1, 100);
  const practicesLimit = toClampedInteger(req.query.practicesLimit, 20, 1, 100);
  const summary = await getPracticeSummaryCounts();
  const latestUsers = await listUsers(usersLimit);
  const latestPractices = await listRecentPracticeSessions(practicesLimit);

  res.json({
    ok: true,
    data: {
      summary,
      latestUsers,
      latestPractices,
    },
  });
}));

router.patch("/users/:userId/status", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await ensureModerationColumns();
  const admin = await requireAdmin(req);
  const userId = String(req.params.userId || "").trim();
  if (!userId) {
    throw new ApiError(400, 'Field "userId" is required.', "INVALID_INPUT");
  }
  if (typeof req.body?.disabled !== "boolean") {
    throw new ApiError(400, 'Field "disabled" must be a boolean.', "INVALID_INPUT");
  }
  if (String(admin.id) === userId) {
    throw new ApiError(409, "Administrators cannot disable their own account.", "ADMIN_SELF_DISABLE");
  }

  const target = await getUserById(userId);
  if (!target) {
    throw new ApiError(404, "User not found.", "USER_NOT_FOUND");
  }
  if (target.role === "admin") {
    throw new ApiError(403, "Administrator accounts cannot be disabled here.", "FORBIDDEN");
  }

  const updated = await setUserDisabled(userId, req.body.disabled);
  res.json({ ok: true, data: updated });
}));

router.get("/subjects", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  res.json({ ok: true, data: await listAllSubjects() });
}));

router.post("/subjects", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  const body = req.body || {};
  const code = String(body.code || "").trim();
  const name = String(body.name || "").trim();
  const nameZh = String(body.nameZh || "").trim();
  const assetKey = String(body.assetKey || "").trim().toLowerCase();
  if (!/^\d{4}$/.test(code)) {
    throw new ApiError(400, "Subject code must contain four digits.", "INVALID_INPUT");
  }
  if (!name || name.length > 120) {
    throw new ApiError(400, "Subject English name is required.", "INVALID_INPUT");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(assetKey)) {
    throw new ApiError(400, "Asset key must use lowercase letters, numbers, and hyphens.", "INVALID_INPUT");
  }
  const subject = await upsertSubject({
    code,
    board: "CIE",
    qualification: "IGCSE",
    name,
    nameZh: nameZh || null,
    assetKey,
    active: body.active !== false,
  });
  res.status(201).json({ ok: true, data: subject });
}));

router.get("/imports", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  res.json({
    ok: true,
    data: await listImportJobs(toClampedInteger(req.query.limit, 30, 1, 100)),
  });
}));

router.post("/imports", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  const admin = await requireAdmin(req);
  const subjectCode = String(req.body?.subjectCode || "").trim();
  if (!/^\d{4}$/.test(subjectCode)) {
    throw new ApiError(400, "Select a registered subject.", "INVALID_INPUT");
  }
  const job = await createCieImportJob(subjectCode, admin.id);
  res.status(201).json({ ok: true, data: job });
}));

router.get("/imports/:jobId", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  const job = await getCieImportJob(String(req.params.jobId || ""));
  if (!job) throw new ApiError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
  res.json({ ok: true, data: job });
}));

router.post("/imports/:jobId/files", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  const file = await uploadCieImportFile(String(req.params.jobId || ""), {
    fileName: String(req.body?.fileName || ""),
    dataUrl: String(req.body?.dataUrl || ""),
  });
  res.status(201).json({ ok: true, data: file });
}));

router.post("/imports/:jobId/process", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  res.json({ ok: true, data: await processCieImportJob(String(req.params.jobId || "")) });
}));

router.post("/imports/:jobId/publish", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  res.json({ ok: true, data: await publishCieImportJob(String(req.params.jobId || "")) });
}));

router.get("/curriculum/mappings", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  const status = String(req.query.status || "suggested").trim();
  if (status && !["suggested", "reviewed", "rejected"].includes(status)) {
    throw new ApiError(400, "Invalid mapping status.", "INVALID_INPUT");
  }
  const limit = toClampedInteger(req.query.limit, 100, 1, 300);
  const offset = toClampedInteger(req.query.offset, 0, 0, 100000);
  const year = String(req.query.year || "").trim();
  if (year && !/^20(?:19|20|21|22|23|24)$/.test(year)) {
    throw new ApiError(400, "Invalid Biology paper year.", "INVALID_INPUT");
  }
  const chapterNo = toClampedInteger(req.query.chapter, 0, 0, 20);
  const [mappingPage, options] = await Promise.all([
    listQuestionMappingsForReview({
      status,
      limit,
      offset,
      year,
      chapterNo,
      versionId: "0610-2026-2028-v2",
    }),
    listCurriculumReviewOptions("0610-2026-2028-v2"),
  ]);
  res.json({ ok: true, data: { ...mappingPage, limit, offset, ...options } });
}));

router.post("/curriculum/mappings/suggest", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  const limit = toClampedInteger(req.body?.limit, 2000, 1, 2000);
  res.status(201).json({
    ok: true,
    data: await generateBiologyMappingSuggestions(limit),
  });
}));

router.patch("/curriculum/mappings/:questionId/:currentCurriculumSectionId", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  const admin = await requireAdmin(req);
  const questionId = String(req.params.questionId || "").trim();
  const currentCurriculumSectionId = String(req.params.currentCurriculumSectionId || "").trim();
  const curriculumSectionId = String(req.body?.curriculumSectionId || "").trim();
  const coursebookSectionId = String(req.body?.coursebookSectionId || "").trim();
  const status = String(req.body?.status || "").trim();
  if (!questionId || !currentCurriculumSectionId || !curriculumSectionId || !coursebookSectionId) {
    throw new ApiError(400, "Question, syllabus statement and coursebook section are required.", "INVALID_INPUT");
  }
  if (!["reviewed", "rejected"].includes(status)) {
    throw new ApiError(400, "Mapping status must be reviewed or rejected.", "INVALID_INPUT");
  }
  const updated = await reviewQuestionMapping({
    questionId,
    currentCurriculumSectionId,
    curriculumSectionId,
    coursebookSectionId,
    isPrimary: status === "reviewed" && req.body?.isPrimary !== false,
    status,
    adminId: admin.id,
  });
  if (updated.status === "not_found") {
    throw new ApiError(404, "Question mapping not found.", "MAPPING_NOT_FOUND");
  }
  if (updated.status === "invalid_mapping") {
    throw new ApiError(
      400,
      "The selected syllabus statement is not mapped to the selected coursebook section.",
      "INVALID_MAPPING"
    );
  }
  res.json({ ok: true, data: updated.mapping });
}));

router.get("/question-hints", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  const status = String(req.query.status || "pending_review");
  if (!['pending_review', 'approved', 'rejected'].includes(status)) {
    throw new ApiError(400, "Invalid question hint status.", "INVALID_INPUT");
  }
  const subjectCode = String(req.query.subjectCode || "").trim();
  if (subjectCode && !/^\d{4}$/.test(subjectCode)) {
    throw new ApiError(400, "Invalid subject code.", "INVALID_INPUT");
  }
  res.json({
    ok: true,
    data: await listQuestionHintSetsForReview({
      status,
      subjectCode,
      limit: toClampedInteger(req.query.limit, 50, 1, 100),
    }),
  });
}));

router.get("/question-hints/sample-status", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  await requireAdmin(req);
  res.json({ ok: true, data: await getBiologyHintSampleReviewStatus() });
}));

router.patch("/question-hints/:hintSetId", asyncHandler(async (req, res) => {
  assertAdminApiEnabled();
  const admin = await requireAdmin(req);
  const status = String(req.body?.status || "");
  if (!['approved', 'rejected'].includes(status)) {
    throw new ApiError(400, "Hint status must be approved or rejected.", "INVALID_INPUT");
  }
  const updated = await reviewQuestionHintSet({
    id: String(req.params.hintSetId || ""),
    status,
    reviewerId: admin.id,
  });
  if (!updated) throw new ApiError(404, "Question hint set not found.", "HINT_SET_NOT_FOUND");
  res.json({ ok: true, data: updated });
}));

export default router;
