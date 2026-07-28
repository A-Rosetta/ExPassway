import { Router } from "express";
import { isDbEnabled } from "../db/client.js";
import { listChapterCatalog, listCurriculumVersions } from "../db/repositories/curriculum.repository.js";
import { getUserById } from "../db/repositories/users.repository.js";
import { readAuthToken, verifyToken } from "../services/auth.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/http.js";

const router = Router();

async function requireUser(req) {
  if (!isDbEnabled()) {
    throw new ApiError(503, "Curriculum API requires PostgreSQL.", "DB_DISABLED");
  }
  const payload = verifyToken(readAuthToken(req));
  const user = await getUserById(payload.sub);
  if (!user) throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  if (user.isDisabled) throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  return user;
}

function requireBiologyCode(value) {
  const subjectCode = String(value || "").trim();
  if (subjectCode !== "0610") {
    throw new ApiError(404, "Chapter practice pilot is currently available for Biology 0610.", "CURRICULUM_NOT_FOUND");
  }
  return subjectCode;
}

router.get("/:subjectCode/versions", asyncHandler(async (req, res) => {
  await requireUser(req);
  const subjectCode = requireBiologyCode(req.params.subjectCode);
  res.json({ ok: true, data: await listCurriculumVersions(subjectCode) });
}));

router.get("/:subjectCode/chapters", asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const subjectCode = requireBiologyCode(req.params.subjectCode);
  const versionId = String(req.query.version || "").trim();
  const catalog = await listChapterCatalog(subjectCode, versionId, user.id);
  if (!catalog) {
    throw new ApiError(404, "Curriculum version not found.", "CURRICULUM_NOT_FOUND");
  }
  res.json({ ok: true, data: catalog });
}));

export default router;
