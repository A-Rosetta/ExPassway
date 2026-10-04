import { normalizeStructuredDocument } from "./structured-content.js";

export const STRUCTURED_ANSWER_MAX_LENGTH = 10000;
export const STRUCTURED_ANSWER_TOTAL_MAX_LENGTH = 30000;

export function structuredAnswerParts(question) {
  const targets = [];
  function visit(parts, labels = [], context = [], depth = 0) {
    if (depth > 64) throw new Error("Structured question parts exceed the supported depth.");
    for (const part of parts) {
      const path = [...labels, String(part.label || "")];
      const prompt = [...context, ...(Array.isArray(part.prompt) ? part.prompt : [])];
      if (Array.isArray(part.children) && part.children.length) visit(part.children, path, prompt, depth + 1);
      else targets.push({ partId: part.id, label: path.join(""), maxMarks: part.maxMarks, prompt });
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
  let length = 0;
  for (const answer of answers) {
    if (!answer || !ids.has(answer.partId)) invalidAnswer("An answer refers to an unknown question part.");
    if (submitted.has(answer.partId)) invalidAnswer("A question part has more than one answer.");
    if (typeof answer.text !== "string") invalidAnswer("Answer text must be a string.");
    if (answer.text.length > STRUCTURED_ANSWER_MAX_LENGTH) invalidAnswer("An answer is too long.");
    length += answer.text.length;
    if (length > STRUCTURED_ANSWER_TOTAL_MAX_LENGTH) invalidAnswer("The combined answers are too long.");
    submitted.set(answer.partId, answer.text);
  }
  return targets.map(({ partId }) => ({ partId, text: submitted.get(partId) || "" }));
}
