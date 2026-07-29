import fs from "fs/promises";
import { env } from "../src/config/env.js";
import { getQuestionBankById } from "../src/db/repositories/questionBank.repository.js";
import { getOrGenerateQuestionHints } from "../src/services/questionHints.service.js";

if (env.aiHintMode !== "review") {
  throw new Error("Set AI_HINT_MODE=review before generating the Biology hint sample.");
}
if (!env.openaiApiKey || !env.openaiHintModel) {
  throw new Error("OPENAI_API_KEY and OPENAI_HINT_MODEL are required.");
}

const sampleUrl = new URL("../db/data/biology-hint-sample-v1.json", import.meta.url);
const sample = JSON.parse(await fs.readFile(sampleUrl, "utf8"));
const summary = [];

for (const questionId of sample.questionIds) {
  const question = await getQuestionBankById(questionId);
  if (!question?.active || question.subjectCode !== sample.subjectCode) {
    throw new Error(`Sample question is unavailable: ${questionId}`);
  }
  for (const language of sample.languages) {
    // Sequential generation keeps the review script predictable and inexpensive.
    // eslint-disable-next-line no-await-in-loop
    const hintSet = await getOrGenerateQuestionHints(question, {
      language,
      allowGeneration: true,
      status: "pending_review",
      reusePendingReview: true,
    });
    summary.push({ questionId, language, id: hintSet.id, status: hintSet.status });
    process.stdout.write(`${questionId} ${language} ${hintSet.status}\n`);
  }
}

process.stdout.write(`${JSON.stringify({ sample: sample.version, generated: summary.length })}\n`);
