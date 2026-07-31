import {
  AuthError,
  failure,
  readJsonBody,
  requireCurrentUser,
  success,
} from "./auth-api.js";
import { getOrGenerateQuestionHints } from "./question-hints.js";

function objectResponse(request, object, headers = {}) {
  const responseHeaders = new Headers({
    "Cache-Control": object.httpMetadata?.cacheControl || "public, max-age=31536000, immutable",
    "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  responseHeaders.set("ETag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, { headers: responseHeaders });
}

function parseJson(value, fallback = {}) {
  try {
    return JSON.parse(value || "");
  } catch (_error) {
    return fallback;
  }
}

function contentPrefix(metadata) {
  const prefix = String(parseJson(metadata).contentPrefix || "");
  return /^releases\/[0-9a-f-]{36}$/i.test(prefix) ? `${prefix}/` : "";
}

export async function handleContentRequest(request, env) {
  const url = new URL(request.url);
  const paper = url.pathname.match(/^\/api\/catalog\/papers\/([0-9]{4}_[msw][0-9]{2}_qp_[12][1-9])\/download\/(qp|ms)$/);
  if (paper && (request.method === "GET" || request.method === "HEAD")) {
    const slug = paper[1];
    const documentType = paper[2];
    const published = await env.DB.prepare(`
      SELECT paper.metadata FROM exam_papers paper
      JOIN exam_subjects subject ON subject.code = paper.subject_code
      WHERE paper.slug = ? AND paper.status = 'published' AND subject.active = 1 LIMIT 1
    `).bind(slug).first();
    if (!published) return failure(404, "PAPER_NOT_FOUND", "Published paper not found.", request.method);
    const object = await env.CONTENT_BUCKET.get(`${contentPrefix(published.metadata)}papers/${slug}/${documentType}.pdf`);
    if (!object) return failure(404, "PDF_NOT_FOUND", "PDF source file not found.", request.method);
    return objectResponse(request, object, {
      "Cache-Control": "public, max-age=86400",
      "Content-Disposition": `attachment; filename="${slug.replace("_qp_", `_${documentType}_`)}.pdf"`,
      "Content-Type": "application/pdf",
    });
  }

  const publicAsset = url.pathname.match(/^\/api\/content\/(question-images|question-data)\/(cie-igcse-[a-z0-9-]+)\/(.+)$/);
  if (publicAsset && (request.method === "GET" || request.method === "HEAD")) {
    const suffix = publicAsset[3];
    const release = "(?:releases/[0-9a-f-]{36}/)?";
    const valid = publicAsset[1] === "question-images"
      ? new RegExp(`^${release}[0-9]{4}_[msw][0-9]{2}_qp_[12][1-9]/q[0-9]{2}\\.png$`, "i").test(suffix)
      : new RegExp(`^${release}data/[0-9]{4}_[msw][0-9]{2}_qp_[12][1-9]\\.json$`, "i").test(suffix);
    if (!valid) return failure(404, "NOT_FOUND", "Content not found.", request.method);
    const parts = suffix.split("/");
    const versioned = parts[0] === "releases";
    const relativeParts = versioned ? parts.slice(2) : parts;
    const paperSlug = publicAsset[1] === "question-images"
      ? relativeParts[0]
      : String(relativeParts[1] || "").replace(/\.json$/i, "");
    const requestedPrefix = versioned ? `${parts.slice(0, 2).join("/")}/` : "";
    const published = await env.DB.prepare(`
      SELECT paper.metadata, subject.asset_key
      FROM exam_papers paper JOIN exam_subjects subject ON subject.code = paper.subject_code
      WHERE paper.slug = ? AND paper.status = 'published' AND subject.active = 1 LIMIT 1
    `).bind(paperSlug).first();
    if (!published
      || publicAsset[2] !== `cie-igcse-${published.asset_key}`
      || requestedPrefix !== contentPrefix(published.metadata)) {
      return failure(404, "NOT_FOUND", "Content not found.", request.method);
    }
    const key = versioned
      ? `${parts.slice(0, 2).join("/")}/${publicAsset[1]}/${publicAsset[2]}/${parts.slice(2).join("/")}`
      : `${publicAsset[1]}/${publicAsset[2]}/${suffix}`;
    const object = await env.CONTENT_BUCKET.get(key);
    if (!object) return failure(404, "NOT_FOUND", "Content not found.", request.method);
    return objectResponse(request, object);
  }
  return failure(404, "NOT_FOUND", `Route not found: ${request.method} ${url.pathname}`, request.method);
}

export async function handleQuestionHintRequest(request, env) {
  try {
    const { user } = await requireCurrentUser(request, env);
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/api\/question-hints\/([^/]+)$/);
    if (!match || request.method !== "POST") {
      return failure(404, "NOT_FOUND", `Route not found: ${request.method} ${url.pathname}`, request.method);
    }
    const body = await readJsonBody(request);
    const language = body.language === "zh-CN" ? "zh-CN" : "en";
    const questionKey = decodeURIComponent(match[1]);
    const question = await env.DB.prepare(`
      SELECT question.id, question.stem, question.options, question.answer, question.hints, question.images
      FROM question_bank question
      JOIN exam_papers paper ON paper.slug = question.paper_slug
      JOIN exam_subjects subject ON subject.code = paper.subject_code
      WHERE question.id = ? AND question.active = 1
        AND paper.status = 'published' AND subject.active = 1 LIMIT 1
    `).bind(questionKey).first();
    if (!question) throw new AuthError(404, "Question not found.", "QUESTION_NOT_FOUND");
    let approved = await env.DB.prepare(`
      SELECT hints, prompt_version
      FROM question_hint_sets
      WHERE question_id = ? AND language = ? AND status = 'approved'
      ORDER BY reviewed_at DESC, updated_at DESC
      LIMIT 1
    `).bind(questionKey, language).first();
    let hints = [];
    let source = "cache";
    try {
      hints = JSON.parse(approved?.hints || question.hints || "[]");
    } catch (_error) {
    }
    if (!approved) source = "question-bank";
    if (!hints.length) {
      const generated = await getOrGenerateQuestionHints(env, question, user.id, language);
      hints = generated.hints;
      source = generated.source;
      approved = { prompt_version: generated.promptVersion };
    }
    return success({
      questionKey,
      language,
      hints,
      source,
      promptVersion: approved?.prompt_version || "question-bank",
    }, request.method);
  } catch (error) {
    if (error instanceof AuthError) {
      return failure(error.status, error.code, error.message, request.method, error.details);
    }
    console.error("D1 question hint API failed", error);
    return failure(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.", request.method);
  }
}
