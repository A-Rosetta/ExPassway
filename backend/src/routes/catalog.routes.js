import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/http.js";
import { isDbEnabled } from "../db/client.js";
import {
  getPublishedPaper,
  listPublishedPapers,
  listPublishedSubjects,
} from "../db/repositories/examCatalog.repository.js";
import { listQuestionBankByPaperSlug } from "../db/repositories/questionBank.repository.js";

const router = Router();

function assertCatalogEnabled() {
  if (!isDbEnabled()) {
    throw new ApiError(503, "Exam catalogue requires PostgreSQL.", "DB_DISABLED");
  }
}

router.get("/subjects", asyncHandler(async (_req, res) => {
  assertCatalogEnabled();
  res.json({ ok: true, data: await listPublishedSubjects() });
}));

router.get("/subjects/:subjectCode/papers", asyncHandler(async (req, res) => {
  assertCatalogEnabled();
  const code = String(req.params.subjectCode || "").trim();
  if (!/^\d{4}$/.test(code)) {
    throw new ApiError(400, "Subject code must contain four digits.", "INVALID_INPUT");
  }
  res.json({ ok: true, data: await listPublishedPapers(code) });
}));

router.get("/papers/:paperSlug", asyncHandler(async (req, res) => {
  assertCatalogEnabled();
  const paper = await getPublishedPaper(String(req.params.paperSlug || "").toLowerCase());
  if (!paper) throw new ApiError(404, "Published paper not found.", "PAPER_NOT_FOUND");
  res.json({ ok: true, data: paper });
}));

router.get("/papers/:paperSlug/questions", asyncHandler(async (req, res) => {
  assertCatalogEnabled();
  const slug = String(req.params.paperSlug || "").toLowerCase();
  const paper = await getPublishedPaper(slug);
  if (!paper) throw new ApiError(404, "Published paper not found.", "PAPER_NOT_FOUND");
  const questions = await listQuestionBankByPaperSlug(slug);
  res.json({
    ok: true,
    data: questions.map((question) => ({
      id: question.id,
      board: question.board,
      subject: question.subject,
      subjectCode: question.subjectCode,
      paper: question.paper,
      paperSlug: question.paperSlug,
      questionNo: question.questionNo,
      difficulty: question.difficulty,
      topic: question.topic,
      year: question.year,
      stem: question.stem,
      options: question.options,
      answer: question.answer,
      images: question.images,
      skills: question.skills,
      hints: question.hints,
    })),
  });
}));

export default router;
