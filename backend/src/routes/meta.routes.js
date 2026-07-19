import { Router } from "express";
import { curriculumData } from "../data/curriculum.js";
import { questionBank } from "../data/questionBank.js";
import { isDbEnabled } from "../db/client.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { listPublishedSubjects } from "../db/repositories/examCatalog.repository.js";

const router = Router();

router.get("/curriculum", asyncHandler(async (_req, res) => {
  if (isDbEnabled()) {
    const subjects = await listPublishedSubjects();
    const boards = {};
    subjects.forEach((subject) => {
      const board = subject.board || "CIE";
      boards[board] ||= {};
      boards[board][`${subject.qualification} ${subject.name}`] = ["MCQ"];
    });
    res.json({
      ok: true,
      data: {
        grades: [...new Set(subjects.map((subject) => subject.qualification))],
        boards,
        subjectCodes: Object.fromEntries(subjects.map((subject) => [
          `${subject.qualification} ${subject.name}`,
          subject.code,
        ])),
      },
    });
    return;
  }
  res.json({
    ok: true,
    data: curriculumData,
  });
}));

router.get("/stats", (_req, res) => {
  const boardCounts = questionBank.reduce((acc, question) => {
    acc[question.board] = (acc[question.board] || 0) + 1;
    return acc;
  }, {});

  const subjectCounts = questionBank.reduce((acc, question) => {
    acc[question.subject] = (acc[question.subject] || 0) + 1;
    return acc;
  }, {});

  res.json({
    ok: true,
    data: {
      totalQuestions: questionBank.length,
      boardCounts,
      subjectCounts,
    },
  });
});

router.get("/storage", (_req, res) => {
  res.json({
    ok: true,
    data: {
      mode: isDbEnabled() ? "postgresql" : "memory",
    },
  });
});

export default router;
