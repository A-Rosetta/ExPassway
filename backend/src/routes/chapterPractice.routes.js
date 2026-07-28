import { Router } from "express";
import { isDbEnabled } from "../db/client.js";
import {
  createChapterPracticeSession,
  submitChapterPracticeSession,
} from "../db/repositories/chapterPractice.repository.js";
import { getCoursebookSection, getCurriculumVersion } from "../db/repositories/curriculum.repository.js";
import { getUserById } from "../db/repositories/users.repository.js";
import { upsertWrongNotebookEntries } from "../db/repositories/wrongNotebook.repository.js";
import { readAuthToken, verifyToken } from "../services/auth.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/http.js";
import { requireArray, requireString, toClampedInteger } from "../utils/validate.js";

const router = Router();

async function requireUser(req) {
  if (!isDbEnabled()) {
    throw new ApiError(503, "Chapter practice requires PostgreSQL.", "DB_DISABLED");
  }
  const payload = verifyToken(readAuthToken(req));
  const user = await getUserById(payload.sub);
  if (!user) throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  if (user.isDisabled) throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  return user;
}

function sanitizeQuestion(question) {
  return {
    id: question.id,
    board: question.board,
    subject: question.subject,
    subjectCode: question.subjectCode,
    paper: question.paper,
    paperSlug: question.paperSlug,
    questionNo: question.questionNo,
    year: question.year,
    stem: question.stem,
    options: question.options,
    images: question.images,
    skills: question.skills,
    hints: question.hints,
    syllabusCode: question.syllabusCode,
  };
}

router.post("/sessions", asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const versionId = requireString(req.body?.curriculumVersion, "curriculumVersion");
  const coursebookSectionId = requireString(req.body?.coursebookSectionId, "coursebookSectionId");
  const count = toClampedInteger(req.body?.count, 10, 1, 20);
  const version = await getCurriculumVersion("0610", versionId);
  if (!version) throw new ApiError(404, "Curriculum version not found.", "CURRICULUM_NOT_FOUND");
  const section = await getCoursebookSection(coursebookSectionId, version.id);
  if (!section) throw new ApiError(404, "Coursebook section not found.", "SECTION_NOT_FOUND");

  const session = await createChapterPracticeSession({
    userId: user.id,
    coursebookSectionId,
    count,
  });
  if (!session) {
    throw new ApiError(
      409,
      "This section has no reviewed questions yet.",
      "NO_REVIEWED_QUESTIONS"
    );
  }
  res.status(201).json({
    ok: true,
    data: {
      sessionId: session.id,
      createdAt: session.createdAt,
      section: {
        id: section.id,
        sectionCode: section.section_code,
        titleEn: section.title_en,
        titleZh: section.title_zh,
        chapterNo: Number(section.chapter_no),
        chapterTitleEn: section.chapter_title_en,
        chapterTitleZh: section.chapter_title_zh,
      },
      questions: session.questions.map(sanitizeQuestion),
    },
  });
}));

router.post("/sessions/:sessionId/submit", asyncHandler(async (req, res) => {
  const user = await requireUser(req);
  const sessionId = requireString(req.params.sessionId, "sessionId");
  const rawAnswers = requireArray(req.body?.answers, "answers");
  const answers = rawAnswers.map((answer) => {
    const selectedIndex = Number(answer?.selectedIndex);
    if (!Number.isInteger(selectedIndex) || selectedIndex < -1 || selectedIndex > 20) {
      throw new ApiError(400, "Each selectedIndex must be an integer from -1 to 20.", "INVALID_INPUT");
    }
    return {
      selectedIndex,
      elapsedSeconds: toClampedInteger(answer?.elapsedSeconds, 0, 0, 86400),
      hintsUsed: toClampedInteger(answer?.hintsUsed, 0, 0, 20),
    };
  });
  const submitted = await submitChapterPracticeSession({
    userId: user.id,
    sessionId,
    answers,
  });
  if (submitted.status === "not_found") {
    throw new ApiError(404, "Chapter practice session not found.", "PRACTICE_NOT_FOUND");
  }
  if (submitted.status === "already_submitted") {
    throw new ApiError(409, "This chapter practice has already been submitted.", "PRACTICE_ALREADY_SUBMITTED");
  }
  if (submitted.status === "invalid_length") {
    throw new ApiError(400, `Answers length must be ${submitted.expected}.`, "INVALID_ANSWERS_LENGTH");
  }

  await upsertWrongNotebookEntries(
    user.id,
    submitted.questions,
    submitted.result.details,
    { board: "CIE", subject: "IGCSE Biology", paper: "Chapter Practice" }
  );
  res.json({ ok: true, data: submitted.result });
}));

export default router;
