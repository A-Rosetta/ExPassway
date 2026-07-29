import { Router } from "express";
import { env } from "../config/env.js";
import { isDbEnabled } from "../db/client.js";
import { getQuestionBankById } from "../db/repositories/questionBank.repository.js";
import { getUserById } from "../db/repositories/users.repository.js";
import { readAuthToken, verifyToken } from "../services/auth.service.js";
import { getOrGenerateQuestionHints } from "../services/questionHints.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/http.js";

const router = Router();
const generationWindows = new Map();
const MAX_GENERATIONS_PER_HOUR = 10;

async function requireUser(req) {
  if (!isDbEnabled()) throw new ApiError(503, "Question hints require PostgreSQL.", "DB_DISABLED");
  const payload = verifyToken(readAuthToken(req));
  const user = await getUserById(payload.sub);
  if (!user) throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  if (user.isDisabled) throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  return user;
}

function countGeneration(userId) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recent = (generationWindows.get(userId) || []).filter((time) => time >= cutoff);
  if (recent.length >= MAX_GENERATIONS_PER_HOUR) {
    throw new ApiError(429, "Hourly question hint limit reached.", "AI_HINT_RATE_LIMITED");
  }
  recent.push(Date.now());
  generationWindows.set(userId, recent);
}

router.post("/:questionKey", asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const questionKey = String(req.params.questionKey || "");
  const question = await getQuestionBankById(questionKey);
  if (!question?.active) throw new ApiError(404, "Question not found.", "QUESTION_NOT_FOUND");

  const hintSet = await getOrGenerateQuestionHints(question, {
    language: req.body?.language,
    allowGeneration: env.aiHintMode === "live",
    requireSampleApproval: true,
    status: "approved",
    beforeGenerate: () => countGeneration(user.id),
  });
  res.json({
    ok: true,
    data: {
      questionKey,
      language: hintSet.language,
      hints: hintSet.hints,
      source: hintSet.source,
      promptVersion: hintSet.promptVersion,
    },
  });
}));

export default router;
