import { normalizeStructuredDocument } from "./structured-content.js";

export const STRUCTURED_ANSWER_MAX_LENGTH = 10000;
export const STRUCTURED_ANSWER_TOTAL_MAX_LENGTH = 30000;
export const STRUCTURED_ANSWER_IMAGE_MAX_BYTES = 128 * 1024;
export const STRUCTURED_ANSWER_IMAGE_MAX_COUNT = 3;

function validAnswerImage(value) {
  if (typeof value !== "string") return false;
  const match = value.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length > Math.ceil(STRUCTURED_ANSWER_IMAGE_MAX_BYTES / 3) * 4) return false;
  let bytes;
  try { bytes = atob(match[2]); } catch { return false; }
  if (!bytes.length || bytes.length > STRUCTURED_ANSWER_IMAGE_MAX_BYTES) return false;
  return match[1] === "png"
    ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes.charCodeAt(index) === byte)
    : bytes.charCodeAt(0) === 255 && bytes.charCodeAt(1) === 216 && bytes.charCodeAt(2) === 255;
}

export function structuredAnswerParts(question) {
  const targets = [];
  function visit(parts, labels = [], context = [], depth = 0) {
    if (depth > 64) throw new Error("Structured question parts exceed the supported depth.");
    for (const part of parts) {
      const path = [...labels, String(part.label || "")];
      const prompt = [...context, ...(Array.isArray(part.prompt) ? part.prompt : [])];
      if (Array.isArray(part.children) && part.children.length) visit(part.children, path, prompt, depth + 1);
      else targets.push({ partId: part.id, label: path.join(""), maxMarks: part.maxMarks, prompt,
        ...(part.answerFormat === "choice" ? { answerFormat: "choice", choices: part.choices } : {}) });
    }
  }
  const document = normalizeStructuredDocument(question?.content);
  visit(document.parts);
  if (!targets.length) targets.push({ partId: question?.id, label: "", maxMarks: question?.maxMarks, prompt: [...document.sharedMaterials, ...document.blocks] });
  return targets;
}

function invalidAnswer(message) {
  const error = new Error(message);
  error.code = "INVALID_STRUCTURED_ANSWERS";
  throw error;
}

export function normalizeStructuredAnswers(question, answers) {
  if (!Array.isArray(answers)) invalidAnswer("Answers must be an array.");
  const targets = structuredAnswerParts(question);
  const ids = new Set(targets.map((part) => part.partId));
  const submitted = new Map();
  const submittedImages = new Map();
  let length = 0;
  for (const answer of answers) {
    if (!answer || !ids.has(answer.partId)) invalidAnswer("An answer refers to an unknown question part.");
    if (submitted.has(answer.partId)) invalidAnswer("A question part has more than one answer.");
    if (typeof answer.text !== "string") invalidAnswer("Answer text must be a string.");
    if (Object.keys(answer).some((key) => !["partId", "text", "imageDataUrl"].includes(key))) invalidAnswer("Unsupported answer field.");
    if (answer.imageDataUrl !== undefined) {
      if (!validAnswerImage(answer.imageDataUrl)) invalidAnswer("Answer images must be a supported PNG or JPEG within the size limit.");
      if (targets.find((part) => part.partId === answer.partId)?.answerFormat === "choice") invalidAnswer("Choice answers cannot include drawings.");
      submittedImages.set(answer.partId, answer.imageDataUrl);
      if (submittedImages.size > STRUCTURED_ANSWER_IMAGE_MAX_COUNT) invalidAnswer("Too many answer images.");
    }
    if (answer.text.length > STRUCTURED_ANSWER_MAX_LENGTH) invalidAnswer("An answer is too long.");
    length += answer.text.length;
    if (length > STRUCTURED_ANSWER_TOTAL_MAX_LENGTH) invalidAnswer("The combined answers are too long.");
    submitted.set(answer.partId, answer.text);
  }
  return targets.map(({ partId, answerFormat }) => {
    let text = submitted.get(partId) || "";
    if (answerFormat === "choice") {
      text = text.trim().toUpperCase();
      if (text && !["A", "B", "C", "D"].includes(text)) invalidAnswer("Select one of the official A–D options.");
    }
    return { partId, text, ...(submittedImages.has(partId) ? { imageDataUrl: submittedImages.get(partId) } : {}) };
  });
}
