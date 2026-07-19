import { Router } from "express";
import { getImportedQuestionReference } from "../data/importedQuestionBank.js";
import { ApiError } from "../utils/http.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { isDbEnabled } from "../db/client.js";
import { getQuestionBankById } from "../db/repositories/questionBank.repository.js";

const router = Router();

router.get("/:questionKey", asyncHandler(async (req, res) => {
  const questionKey = String(req.params.questionKey || "");
  let reference = null;
  if (isDbEnabled()) {
    const question = await getQuestionBankById(questionKey);
    const firstImage = Array.isArray(question?.images) ? question.images[0] : null;
    if (question?.paperSlug && question?.questionNo) {
      reference = {
        id: question.id,
        questionKey,
        paperSlug: question.paperSlug,
        questionNo: question.questionNo,
        imageUrl: typeof firstImage === "string" ? firstImage : firstImage?.url || "",
        board: question.board,
        subject: question.subject,
        subjectCode: question.subjectCode,
        paper: question.paper,
      };
    }
  }
  reference ||= getImportedQuestionReference(questionKey);
  if (!reference) {
    throw new ApiError(404, "Question not found.", "QUESTION_NOT_FOUND");
  }

  res.json({ ok: true, data: reference });
}));

export default router;
