import {
  AuthError,
  failure,
  readJsonBody,
  requireCurrentUser,
  success,
} from "./auth-api.js";

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

export async function handleContentRequest(request, env) {
  const url = new URL(request.url);
  const paper = url.pathname.match(/^\/api\/catalog\/papers\/([0-9]{4}_[msw][0-9]{2}_qp_[12][1-9])\/download\/(qp|ms)$/);
  if (paper && (request.method === "GET" || request.method === "HEAD")) {
    const slug = paper[1];
    const documentType = paper[2];
    const published = await env.DB.prepare(`
      SELECT 1 FROM exam_papers WHERE slug = ? AND status = 'published' LIMIT 1
    `).bind(slug).first();
    if (!published) return failure(404, "PAPER_NOT_FOUND", "Published paper not found.", request.method);
    const object = await env.CONTENT_BUCKET.get(`papers/${slug}/${documentType}.pdf`);
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
    const valid = publicAsset[1] === "question-images"
      ? /^[0-9]{4}_[msw][0-9]{2}_qp_[12][1-9]\/q[0-9]{2}\.png$/.test(suffix)
      : /^data\/[0-9]{4}_[msw][0-9]{2}_qp_[12][1-9]\.json$/.test(suffix);
    if (!valid) return failure(404, "NOT_FOUND", "Content not found.", request.method);
    const object = await env.CONTENT_BUCKET.get(`${publicAsset[1]}/${publicAsset[2]}/${suffix}`);
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
      SELECT id, hints FROM question_bank WHERE id = ? AND active = 1 LIMIT 1
    `).bind(questionKey).first();
    if (!question) throw new AuthError(404, "Question not found.", "QUESTION_NOT_FOUND");
    const approved = await env.DB.prepare(`
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
      throw new AuthError(503, "Question hint generation is not available yet.", "AI_HINTS_UNAVAILABLE", {
        userId: user.id,
      });
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
