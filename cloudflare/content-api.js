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

function registeredAsset(value, key, pathname) {
  if (Array.isArray(value)) return value.some((item) => registeredAsset(item, key, pathname));
  if (!value || typeof value !== "object") return false;
  if (value.storageKey === key) return true;
  if (typeof value.url === "string") {
    try {
      if (new URL(value.url, "https://content.local").pathname === pathname) return true;
    } catch (_error) {
    }
  }
  return Object.values(value).some((item) => registeredAsset(item, key, pathname));
}

export async function handleContentRequest(request, env) {
  const url = new URL(request.url);
  const resource = url.pathname.match(
    /^\/api\/(?:catalog\/subjects\/([0-9]{4})\/resources\/([^/]+)|catalog\/resources\/([^/]+)|content\/resources\/([^/]+))$/
  );
  if (resource && (request.method === "GET" || request.method === "HEAD")) {
    // Subject resources may contain paid or unpublished material. Keep the
    // metadata and object lookup behind the same session boundary.
    try {
      await requireCurrentUser(request, env);
    } catch (error) {
      if (error instanceof AuthError) {
        return failure(error.status, error.code, error.message, request.method, error.details);
      }
      throw error;
    }
    const subjectCode = resource[1] || null;
    const resourceId = decodeURIComponent(resource[2] || resource[3] || resource[4]);
    const row = await env.DB.prepare(`
      SELECT resource.id, resource.subject_code, resource.storage_key, resource.content_type, resource.status
      FROM subject_resources resource
      JOIN exam_subjects subject ON subject.code = resource.subject_code
      WHERE resource.id = ? AND resource.status = 'published' AND subject.active = 1
        AND (? IS NULL OR resource.subject_code = ?)
      LIMIT 1
    `).bind(resourceId, subjectCode, subjectCode).first();
    if (!row) return failure(404, "RESOURCE_NOT_FOUND", "Resource not found.", request.method);
    const object = await env.CONTENT_BUCKET.get(row.storage_key);
    if (!object) return failure(404, "RESOURCE_NOT_FOUND", "Resource not found.", request.method);
    return objectResponse(request, object, {
      "Cache-Control": "private, no-store",
      "Content-Type": row.content_type || "application/octet-stream",
      "Content-Disposition": "inline",
    });
  }
  const paper = url.pathname.match(/^\/api\/catalog\/papers\/([0-9]{4}_[msw][0-9]{2}_qp_[1-4][1-9])\/download\/(qp|ms)$/);
  if (paper && (request.method === "GET" || request.method === "HEAD")) {
    const slug = paper[1];
    const documentType = paper[2];
    const published = await env.DB.prepare(`
      SELECT paper.metadata FROM exam_papers paper
      JOIN exam_subjects subject ON subject.code = paper.subject_code
      WHERE paper.slug = ? AND paper.status = 'published' AND subject.active = 1 LIMIT 1
    `).bind(slug).first();
    if (!published) return failure(404, "PAPER_NOT_FOUND", "Published paper not found.", request.method);
    const metadata = parseJson(published.metadata);
    const explicitKey = metadata[`${documentType}StorageKey`];
    const objectKey = typeof explicitKey === "string" && explicitKey && !explicitKey.startsWith("/") && !explicitKey.split("/").includes("..")
      ? explicitKey
      : `${contentPrefix(published.metadata)}papers/${slug}/${documentType}.pdf`;
    const object = await env.CONTENT_BUCKET.get(objectKey);
    if (!object) return failure(404, "PDF_NOT_FOUND", "PDF source file not found.", request.method);
    return objectResponse(request, object, {
      "Cache-Control": "public, max-age=86400",
      "Content-Disposition": `${url.searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${slug.replace("_qp_", `_${documentType}_`)}.pdf"`,
      "Content-Type": "application/pdf",
    });
  }

  const publicAsset = url.pathname.match(/^\/api\/content\/(question-images|question-data)\/(cie-(?:igcse|as-a-level)-[a-z0-9-]+)\/(.+)$/);
  if (publicAsset && (request.method === "GET" || request.method === "HEAD")) {
    const suffix = publicAsset[3];
    const release = "(?:releases/[0-9a-f-]{36}/)?";
    const valid = publicAsset[1] === "question-images"
      ? new RegExp(`^${release}[0-9]{4}_[msw][0-9]{2}_qp_[1-4][1-9]/(?:q|ms-q)[0-9]{2,3}(?:-(?:ms-)?[0-9]{2,3})?\\.png$`, "i").test(suffix)
      : new RegExp(`^${release}data/[0-9]{4}_[msw][0-9]{2}_qp_[1-4][1-9]\\.json$`, "i").test(suffix);
    if (!valid) return failure(404, "NOT_FOUND", "Content not found.", request.method);
    const parts = suffix.split("/");
    const versioned = parts[0] === "releases";
    const relativeParts = versioned ? parts.slice(2) : parts;
    const paperSlug = publicAsset[1] === "question-images"
      ? relativeParts[0]
      : String(relativeParts[1] || "").replace(/\.json$/i, "");
    const requestedPrefix = versioned ? `${parts.slice(0, 2).join("/")}/` : "";
    const published = await env.DB.prepare(`
      SELECT paper.metadata, subject.asset_key, subject.qualification, subject.code
      FROM exam_papers paper JOIN exam_subjects subject ON subject.code = paper.subject_code
      WHERE paper.slug = ? AND paper.status = 'published' AND subject.active = 1 LIMIT 1
    `).bind(paperSlug).first();
    if (!published
      || publicAsset[2] !== `cie-${published.qualification === "AS & A Level" ? "as-a-level" : "igcse"}-${published.asset_key}`
      || requestedPrefix !== contentPrefix(published.metadata)) {
      return failure(404, "NOT_FOUND", "Content not found.", request.method);
    }
    const key = versioned
      ? `${parts.slice(0, 2).join("/")}/${publicAsset[1]}/${publicAsset[2]}/${parts.slice(2).join("/")}`
      : `${publicAsset[1]}/${publicAsset[2]}/${suffix}`;
    if (published.code === "9618" && publicAsset[1] === "question-images") {
      const questionNo = Number(relativeParts[1].match(/^(?:ms-)?q(\d+)/)?.[1]);
      const question = await env.DB.prepare(`
        SELECT images, structured_content, mark_scheme FROM question_bank
        WHERE paper_slug = ? AND question_no = ? AND active = 1 LIMIT 1
      `).bind(paperSlug, questionNo).first();
      if (!question || !registeredAsset([
        parseJson(question.images, []), parseJson(question.structured_content), parseJson(question.mark_scheme),
      ], key, url.pathname)) {
        return failure(404, "NOT_FOUND", "Content not found.", request.method);
      }
    }
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
      SELECT question.*
      FROM question_bank question
      JOIN exam_papers paper ON paper.slug = question.paper_slug
      JOIN exam_subjects subject ON subject.code = paper.subject_code
      WHERE question.id = ? AND question.active = 1
        AND paper.status = 'published' AND subject.active = 1 LIMIT 1
    `).bind(questionKey).first();
    if (!question) throw new AuthError(404, "Question not found.", "QUESTION_NOT_FOUND");
    if (question.question_type && question.question_type !== "mcq") {
      throw new AuthError(409, "AI hints are available for multiple-choice questions only.", "UNSUPPORTED_QUESTION_TYPE");
    }
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
      const response = failure(error.status, error.code, error.message, request.method, error.details);
      if (error.status === 429 && error.details?.retryAfterSeconds) response.headers.set("Retry-After", String(error.details.retryAfterSeconds));
      return response;
    }
    console.error("D1 question hint API failed", error);
    return failure(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.", request.method);
  }
}
