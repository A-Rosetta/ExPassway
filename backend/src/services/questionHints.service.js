import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { env } from "../config/env.js";
import {
  getQuestionHintSet,
  upsertQuestionHintSet,
} from "../db/repositories/questionHints.repository.js";
import { getQuestionBankById } from "../db/repositories/questionBank.repository.js";
import { ApiError } from "../utils/http.js";

export const HINT_PROMPT_VERSION = "igcse-progressive-v1";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const ASSETS_ROOT = path.join(REPO_ROOT, "assets");
const SAMPLE_URL = new URL("../../db/data/biology-hint-sample-v1.json", import.meta.url);
const inFlight = new Map();
let activeGenerations = 0;
let sampleDefinitionPromise;

async function loadSampleDefinition() {
  if (!sampleDefinitionPromise) {
    sampleDefinitionPromise = fs.readFile(SAMPLE_URL, "utf8").then(JSON.parse);
  }
  return sampleDefinitionPromise;
}

function normalizeLanguage(value) {
  return value === "en" ? "en" : "zh-CN";
}

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

async function readQuestionImage(question) {
  const first = Array.isArray(question.images) ? question.images[0] : null;
  const imageUrl = typeof first === "string" ? first : first?.url;
  if (!imageUrl || !imageUrl.startsWith("/assets/") || imageUrl.includes("..")) {
    throw new ApiError(422, "This question does not have a usable image.", "QUESTION_IMAGE_UNAVAILABLE");
  }
  const filePath = path.resolve(REPO_ROOT, imageUrl.slice(1));
  if (!filePath.startsWith(`${ASSETS_ROOT}${path.sep}`)) {
    throw new ApiError(422, "Question image path is invalid.", "QUESTION_IMAGE_UNAVAILABLE");
  }
  let bytes;
  try {
    bytes = await fs.readFile(filePath);
  } catch (_error) {
    throw new ApiError(422, "Question image file is unavailable.", "QUESTION_IMAGE_UNAVAILABLE");
  }
  if (bytes.length > 2 * 1024 * 1024) {
    throw new ApiError(422, "Question image is too large for hint generation.", "QUESTION_IMAGE_TOO_LARGE");
  }
  const extension = path.extname(filePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg"
    ? "image/jpeg"
    : extension === ".webp" ? "image/webp" : "image/png";
  return { bytes, dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

export async function fingerprintQuestion(question) {
  const image = await readQuestionImage(question);
  const hash = crypto.createHash("sha256");
  hash.update(JSON.stringify({
    id: question.id,
    stem: question.stem,
    options: question.options,
    answer: question.answer,
    images: question.images,
  }));
  hash.update(image.bytes);
  return { fingerprint: hash.digest("hex"), image };
}

function buildPrompt(question, language, retryFeedback = "") {
  const outputLanguage = language === "en" ? "English" : "Simplified Chinese";
  const correctOption = question.options?.[question.answer] || "";
  return [
    "You are a careful Cambridge IGCSE tutor creating progressive hints for one multiple-choice question.",
    `Write exactly three short hints in ${outputLanguage}.`,
    "Hint 1 identifies the relevant concept or evidence to inspect.",
    "Hint 2 explains the method or comparison to perform.",
    "Hint 3 gives the next reasoning step but still leaves the student to choose the answer.",
    "Never state or quote the correct option, its letter, or the final numeric answer.",
    "Never narrow the choices to a single remaining option. Do not mention that you know the answer.",
    "Use the supplied question image as primary evidence; the extracted text may omit diagram layout.",
    `Question text: ${question.stem}`,
    `Options: ${JSON.stringify(question.options || [])}`,
    `Private answer reference for alignment only; never reveal it: ${JSON.stringify(correctOption)}`,
    retryFeedback ? `The previous output failed validation: ${retryFeedback}. Correct only that problem.` : "",
  ].filter(Boolean).join("\n");
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") return content.text;
    }
  }
  return "";
}

function validateHints(value, question) {
  if (!Array.isArray(value?.hints) || value.hints.length !== 3) {
    return "the response must contain exactly three hints";
  }
  const correctOption = normalizedText(question.options?.[question.answer]);
  for (const hint of value.hints) {
    if (typeof hint !== "string" || hint.trim().length < 8 || hint.length > 280) {
      return "each hint must be a concise non-empty string";
    }
    if (/(?:correct answer|answer is|choose|select)\s*(?:option\s*)?[ABCD]\b/i.test(hint)
      || /(?:正确答案|答案是|选择|选项)\s*[ABCDＡＢＣＤ]/u.test(hint)) {
      return "a hint revealed an option letter";
    }
    const normalizedHint = normalizedText(hint);
    const numericOption = /^\d+(?:\.\d+)?(?:[a-z%]+)?$/i.test(correctOption);
    if ((correctOption.length >= 12 || numericOption) && normalizedHint.includes(correctOption)) {
      return "a hint quoted the correct option";
    }
  }
  return "";
}

async function requestOpenAI(question, language, image) {
  if (!env.openaiApiKey || !env.openaiHintModel) {
    throw new ApiError(503, "OpenAI hint generation is not configured.", "AI_HINTS_NOT_CONFIGURED");
  }
  let retryFeedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await fetch(`${env.openaiBaseUrl}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.openaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: env.openaiHintModel,
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: buildPrompt(question, language, retryFeedback) },
              { type: "input_image", image_url: image.dataUrl, detail: "high" },
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "question_hints",
              strict: true,
              schema: {
                type: "object",
                additionalProperties: false,
                properties: {
                  hints: {
                    type: "array",
                    minItems: 3,
                    maxItems: 3,
                    items: { type: "string" },
                  },
                },
                required: ["hints"],
              },
            },
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new ApiError(504, "OpenAI hint generation timed out.", "AI_HINT_TIMEOUT");
      }
      throw new ApiError(502, "OpenAI hint generation could not be reached.", "AI_HINT_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(502, "OpenAI hint generation failed.", "AI_HINT_UNAVAILABLE", {
        upstreamStatus: response.status,
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(extractOutputText(payload));
    } catch (_error) {
      retryFeedback = "the response was not valid JSON";
      continue;
    }
    const validationError = validateHints(parsed, question);
    if (!validationError) {
      return { hints: parsed.hints.map((hint) => hint.trim()), responseId: payload.id || null };
    }
    retryFeedback = validationError;
  }
  throw new ApiError(502, "Generated hints did not pass safety validation.", "AI_HINT_VALIDATION_FAILED");
}

export async function getOrGenerateQuestionHints(question, input = {}) {
  const language = normalizeLanguage(input.language);
  const { fingerprint, image } = await fingerprintQuestion(question);
  const cached = await getQuestionHintSet({
    questionId: question.id,
    language,
    promptVersion: HINT_PROMPT_VERSION,
    questionFingerprint: fingerprint,
  });
  if (input.requireSampleApproval && (cached?.status === "approved" || input.allowGeneration)) {
    const sampleStatus = await getBiologyHintSampleReviewStatus();
    if (!sampleStatus.ready) {
      throw new ApiError(
        503,
        "The Biology hint sample has not completed review.",
        "AI_HINT_SAMPLE_NOT_APPROVED",
        sampleStatus
      );
    }
  }
  if (cached?.status === "approved") return { ...cached, source: "cache" };
  if (cached?.status === "pending_review" && input.reusePendingReview) {
    return { ...cached, source: "cache" };
  }
  if (!input.allowGeneration) {
    if (cached?.status === "pending_review") {
      throw new ApiError(409, "Question hints are awaiting review.", "AI_HINT_PENDING_REVIEW");
    }
    throw new ApiError(503, "Question hint generation is not available yet.", "AI_HINTS_UNAVAILABLE");
  }

  const flightKey = `${question.id}:${language}:${fingerprint}`;
  if (inFlight.has(flightKey)) return inFlight.get(flightKey);
  if (activeGenerations >= 2) {
    throw new ApiError(503, "Question hint generation is busy. Try again shortly.", "AI_HINT_BUSY");
  }
  input.beforeGenerate?.();
  const task = (async () => {
    activeGenerations += 1;
    try {
      const generated = await requestOpenAI(question, language, image);
      const saved = await upsertQuestionHintSet({
        questionId: question.id,
        language,
        promptVersion: HINT_PROMPT_VERSION,
        questionFingerprint: fingerprint,
        hints: generated.hints,
        status: input.status || "approved",
        model: env.openaiHintModel,
        responseId: generated.responseId,
      });
      return { ...saved, source: "generated" };
    } finally {
      activeGenerations -= 1;
      inFlight.delete(flightKey);
    }
  })();
  inFlight.set(flightKey, task);
  return task;
}

export async function getBiologyHintSampleReviewStatus() {
  const sample = await loadSampleDefinition();
  const counts = { approved: 0, pendingReview: 0, rejected: 0, missing: 0 };
  const questions = await Promise.all(sample.questionIds.map((questionId) => getQuestionBankById(questionId)));

  await Promise.all(questions.map(async (question, questionIndex) => {
    if (!question?.active || question.subjectCode !== sample.subjectCode) {
      counts.missing += sample.languages.length;
      return;
    }
    let fingerprint;
    try {
      ({ fingerprint } = await fingerprintQuestion(question));
    } catch (_error) {
      counts.missing += sample.languages.length;
      return;
    }
    await Promise.all(sample.languages.map(async (language) => {
      const hintSet = await getQuestionHintSet({
        questionId: sample.questionIds[questionIndex],
        language,
        promptVersion: HINT_PROMPT_VERSION,
        questionFingerprint: fingerprint,
      });
      if (hintSet?.status === "approved") counts.approved += 1;
      else if (hintSet?.status === "pending_review") counts.pendingReview += 1;
      else if (hintSet?.status === "rejected") counts.rejected += 1;
      else counts.missing += 1;
    }));
  }));

  const expected = sample.questionIds.length * sample.languages.length;
  return {
    version: sample.version,
    expected,
    ...counts,
    ready: counts.approved === expected,
  };
}
