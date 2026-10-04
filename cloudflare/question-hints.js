import { AuthError } from "./auth-api.js";
import { aiCallCooldownError, reserveAiCallStatement } from "./ai-call-cooldown.js";

export const HINT_PROMPT_VERSION = "igcse-progressive-v1";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function normalizeLanguage(value) {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function parseJson(value, fallback) {
  try {
    return typeof value === "string" ? JSON.parse(value) : value ?? fallback;
  } catch (_error) {
    return fallback;
  }
}

function normalizedText(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function imageKey(imageUrl) {
  const match = String(imageUrl || "").match(/^\/api\/content\/(question-images)\/(cie-igcse-[a-z0-9-]+)\/(.+)$/);
  if (!match) return "";
  const suffix = match[3].split("/");
  if (suffix[0] === "releases" && /^[0-9a-f-]{36}$/i.test(suffix[1] || "")) {
    return `${suffix.slice(0, 2).join("/")}/${match[1]}/${match[2]}/${suffix.slice(2).join("/")}`;
  }
  return `${match[1]}/${match[2]}/${match[3]}`;
}

async function readQuestionImage(env, question) {
  const first = parseJson(question.images, [])[0];
  const url = typeof first === "string" ? first : first?.url;
  const key = imageKey(url);
  let bytes;
  let type;
  if (key) {
    const object = await env.CONTENT_BUCKET.get(key);
    if (!object) throw new AuthError(422, "Question image is unavailable.", "QUESTION_IMAGE_UNAVAILABLE");
    bytes = new Uint8Array(await object.arrayBuffer());
    type = object.httpMetadata?.contentType || "image/png";
  } else if (String(url || "").startsWith("/assets/") && !String(url).includes("..") && env.ASSETS) {
    const response = await env.ASSETS.fetch(new Request(`https://assets.local${url}`));
    if (!response.ok) throw new AuthError(422, "Question image is unavailable.", "QUESTION_IMAGE_UNAVAILABLE");
    bytes = new Uint8Array(await response.arrayBuffer());
    type = response.headers.get("Content-Type") || "image/png";
  } else {
    throw new AuthError(422, "This question does not have a usable image.", "QUESTION_IMAGE_UNAVAILABLE");
  }
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new AuthError(422, "Question image is too large for hint generation.", "QUESTION_IMAGE_TOO_LARGE");
  }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return { bytes, dataUrl: `data:${type};base64,${btoa(binary)}` };
}

async function fingerprintQuestion(question, image) {
  const encoder = new TextEncoder();
  const source = encoder.encode(JSON.stringify({
    id: question.id,
    stem: question.stem,
    options: parseJson(question.options, []),
    answer: question.answer,
    images: parseJson(question.images, []),
  }));
  const combined = new Uint8Array(source.length + image.bytes.length);
  combined.set(source);
  combined.set(image.bytes, source.length);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", combined));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function buildPrompt(question, language, retryFeedback = "") {
  const options = parseJson(question.options, []);
  return [
    "You are a careful Cambridge IGCSE tutor creating progressive hints for one multiple-choice question.",
    `Write exactly three short hints in ${language === "en" ? "English" : "Simplified Chinese"}.`,
    "Hint 1 identifies the relevant concept or evidence to inspect.",
    "Hint 2 explains the method or comparison to perform.",
    "Hint 3 gives the next reasoning step but still leaves the student to choose the answer.",
    "Never state or quote the correct option, its letter, or the final numeric answer.",
    "Never narrow the choices to a single remaining option. Do not mention that you know the answer.",
    "Use the supplied question image as primary evidence; extracted text may omit diagram layout.",
    `Question text: ${question.stem}`,
    `Options: ${JSON.stringify(options)}`,
    `Private answer reference for alignment only; never reveal it: ${JSON.stringify(options[question.answer] || "")}`,
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
  if (!Array.isArray(value?.hints) || value.hints.length !== 3) return "the response must contain exactly three hints";
  const options = parseJson(question.options, []);
  const correctOption = normalizedText(options[question.answer]);
  for (const hint of value.hints) {
    if (typeof hint !== "string" || hint.trim().length < 8 || hint.length > 280) {
      return "each hint must be a concise non-empty string";
    }
    if (/(?:correct answer|answer is|choose|select)\s*(?:option\s*)?[ABCD]\b/i.test(hint)
      || /(?:正确答案|答案是|选择|选项)\s*[ABCDＡＢＣＤ]/u.test(hint)) {
      return "a hint revealed an option letter";
    }
    const numericOption = /^\d+(?:\.\d+)?(?:[a-z%]+)?$/i.test(correctOption);
    if ((correctOption.length >= 12 || numericOption) && normalizedText(hint).includes(correctOption)) {
      return "a hint quoted the correct option";
    }
  }
  return "";
}

export async function generateQuestionHintsForAdmin(env, question, language) {
  const image = await readQuestionImage(env, question);
  const fingerprint = await fingerprintQuestion(question, image);
  const generated = await requestOpenAI(env, question, language, image);
  return { ...generated, fingerprint };
}

async function requestOpenAI(env, question, language, image) {
  const apiKey = String(env.OPENAI_API_KEY || "");
  const model = String(env.OPENAI_HINT_MODEL || "");
  const baseUrl = String(env.OPENAI_API_BASE_URL || "https://api.openai.com").replace(/\/+$/, "");
  if (!apiKey || !model) throw new AuthError(503, "OpenAI hint generation is not configured.", "AI_HINTS_NOT_CONFIGURED");
  let retryFeedback = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await fetch(`${baseUrl}/v1/responses`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: [{ role: "user", content: [
            { type: "input_text", text: buildPrompt(question, language, retryFeedback) },
            { type: "input_image", image_url: image.dataUrl, detail: "high" },
          ] }],
          text: { format: {
            type: "json_schema",
            name: "question_hints",
            strict: true,
            schema: {
              type: "object",
              additionalProperties: false,
              properties: { hints: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } } },
              required: ["hints"],
            },
          } },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new AuthError(504, "OpenAI hint generation timed out.", "AI_HINT_TIMEOUT");
      throw new AuthError(502, "OpenAI hint generation could not be reached.", "AI_HINT_UNAVAILABLE");
    } finally {
      clearTimeout(timeout);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new AuthError(502, "OpenAI hint generation failed.", "AI_HINT_UNAVAILABLE", { upstreamStatus: response.status });
    }
    let parsed;
    try {
      parsed = JSON.parse(extractOutputText(payload));
    } catch (_error) {
      retryFeedback = "the response was not valid JSON";
      continue;
    }
    const validationError = validateHints(parsed, question);
    if (!validationError) return { hints: parsed.hints.map((hint) => hint.trim()), responseId: payload.id || null, model };
    retryFeedback = validationError;
  }
  throw new AuthError(502, "Generated hints did not pass safety validation.", "AI_HINT_VALIDATION_FAILED");
}

export async function getOrGenerateQuestionHints(env, question, userId, requestedLanguage) {
  const language = normalizeLanguage(requestedLanguage);
  const approved = await env.DB.prepare(`
    SELECT hints, prompt_version FROM question_hint_sets
    WHERE question_id = ? AND language = ? AND status = 'approved'
    ORDER BY updated_at DESC LIMIT 1
  `).bind(question.id, language).first();
  if (approved) return { hints: parseJson(approved.hints, []), promptVersion: approved.prompt_version, source: "cache" };

  const setting = await env.DB.prepare("SELECT value FROM app_settings WHERE key = 'ai_hint_live_generation'").first();
  if (parseJson(setting?.value, false) !== true) {
    throw new AuthError(503, "Live AI hint generation is disabled.", "AI_HINTS_DISABLED");
  }
  const image = await readQuestionImage(env, question);
  const fingerprint = await fingerprintQuestion(question, image);
  const cached = await env.DB.prepare(`
    SELECT hints, prompt_version FROM question_hint_sets
    WHERE question_id = ? AND language = ? AND prompt_version = ? AND question_fingerprint = ?
      AND status = 'approved' LIMIT 1
  `).bind(question.id, language, HINT_PROMPT_VERSION, fingerprint).first();
  if (cached) return { hints: parseJson(cached.hints, []), promptVersion: cached.prompt_version, source: "cache" };
  if (!env.OPENAI_API_KEY || !env.OPENAI_HINT_MODEL) {
    throw new AuthError(503, "OpenAI hint generation is not configured.", "AI_HINTS_NOT_CONFIGURED");
  }
  const reservationId = crypto.randomUUID();
  const reservedAt = new Date().toISOString();
  const reservations = await env.DB.batch([
    reserveAiCallStatement(env.DB, userId, reservationId),
    env.DB.prepare(`
    INSERT INTO ai_hint_generation_events (id, user_id, question_id, language, created_at)
    SELECT ?, ?, ?, ?, ?
    WHERE EXISTS (SELECT 1 FROM ai_call_cooldowns WHERE user_id = ? AND reservation_id = ?)
  `).bind(reservationId, userId, question.id, language, reservedAt, userId, reservationId),
  ]);
  if (!reservations[1].meta.changes) {
    throw await aiCallCooldownError(env.DB, userId, "AI_HINT_RATE_LIMITED");
  }

  try {
    const generated = await requestOpenAI(env, question, language, image);
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO question_hint_sets (
        id, question_id, language, prompt_version, question_fingerprint,
        hints, status, model, response_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'approved', ?, ?, ?, ?)
      ON CONFLICT (question_id, language, prompt_version, question_fingerprint) DO UPDATE SET
        hints = excluded.hints, status = 'approved', model = excluded.model,
        response_id = excluded.response_id, updated_at = excluded.updated_at
    `).bind(crypto.randomUUID(), question.id, language, HINT_PROMPT_VERSION, fingerprint,
      JSON.stringify(generated.hints), generated.model, generated.responseId, now, now).run();
    return { hints: generated.hints, promptVersion: HINT_PROMPT_VERSION, source: "generated" };
  } catch (error) {
    await env.DB.prepare("DELETE FROM ai_hint_generation_events WHERE id = ?").bind(reservationId).run();
    throw error;
  }
}
