import { AuthError, failure, requireCurrentUser, success } from "./auth-api.js";
import { parseContent } from "../shared/structured-content.js";
import { normalizeStructuredAnswers } from "../shared/structured-practice.js";
import { aiCallCooldownError, reserveAiCallStatement } from "./ai-call-cooldown.js";
import {
  blankStructuredGrade,
  officialAnswerParts,
  prepareStructuredGradingContext,
  requestStructuredGrading,
} from "./structured-grading.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 160 * 1024;

function mapQuestion(row) {
  return {
    id: row.id,
    board: row.board,
    subject: row.subject,
    subjectCode: row.subject_code,
    paper: row.paper,
    paperSlug: row.paper_slug,
    questionNo: Number(row.question_no),
    questionType: row.question_type,
    maxMarks: Number(row.max_marks),
    stem: row.stem,
    content: parseContent(row.structured_content),
    markScheme: parseContent(row.mark_scheme),
    images: parseContent(row.images, []),
    options: [],
    answer: null,
  };
}

function mapPaper(row, questionCount) {
  return {
    slug: row.slug,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    subjectNameZh: row.subject_name_zh || "",
    qualification: row.qualification,
    year: Number(row.year),
    season: row.season,
    paperNumber: Number(row.paper_number),
    variant: Number(row.variant),
    paperType: row.paper_type,
    durationMinutes: Number(row.duration_minutes),
    totalMarks: Number(row.total_marks),
    sourceQuestionCount: Number(row.source_question_count),
    validQuestionCount: questionCount,
    metadata: parseContent(row.metadata),
  };
}

async function hash(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function questionFingerprint(question) {
  return hash({ id: question.id, maxMarks: question.maxMarks, content: question.content, markScheme: question.markScheme, images: question.images });
}

async function publishedPaper(db, slug) {
  const row = await db.prepare(`
    SELECT paper.*, subject.name AS subject_name, subject.name_zh AS subject_name_zh,
      subject.qualification
    FROM exam_papers paper JOIN exam_subjects subject ON subject.code = paper.subject_code
    WHERE paper.slug = ? AND paper.subject_code = '9618'
      AND paper.status = 'published' AND subject.active = 1 LIMIT 1
  `).bind(slug).first();
  if (!row) throw new AuthError(404, "Published paper not found.", "PAPER_NOT_FOUND");
  if (row.paper_number < 1 || row.paper_number > 3 || row.paper_type !== "structured") {
    throw new AuthError(409, "Practice is available for structured Papers 1–3 only.", "UNSUPPORTED_PAPER_TYPE");
  }
  return row;
}

async function readPaper(db, slug, userId) {
  const paper = await publishedPaper(db, slug);
  const rows = await db.prepare(`
    SELECT question.* FROM question_bank question
    WHERE question.paper_slug = ? AND question.subject_code = '9618'
      AND question.question_type = 'structured' AND question.active = 1
    ORDER BY question.question_no, question.id
  `).bind(slug).all();
  const questions = rows.results.map(mapQuestion);
  const fingerprints = new Map(await Promise.all(questions.map(async (question) => [question.id, await questionFingerprint(question)])));
  const attempts = await db.prepare(`
    SELECT result, question_fingerprint FROM (
      SELECT result, question_fingerprint,
        ROW_NUMBER() OVER (PARTITION BY question_id ORDER BY created_at DESC, id DESC) AS position
      FROM structured_practice_attempts
      WHERE user_id = ? AND paper_slug = ? AND status = 'succeeded'
    ) WHERE position = 1
  `).bind(userId, slug).all();
  const latest = attempts.results.flatMap((row) => {
    const result = parseContent(row.result);
    return result?.questionId && fingerprints.get(result.questionId) === row.question_fingerprint ? [result] : [];
  });
  return { paper: mapPaper(paper, questions.length), questions, attempts: latest };
}

async function readQuestion(db, questionId) {
  const row = await db.prepare(`
    SELECT question.*, paper.paper_number AS source_paper_number,
      paper.paper_type AS source_paper_type, paper.metadata AS paper_metadata
    FROM question_bank question
    JOIN exam_papers paper ON paper.slug = question.paper_slug
    JOIN exam_subjects subject ON subject.code = paper.subject_code
    WHERE question.id = ? AND question.active = 1 AND question.subject_code = '9618'
      AND paper.subject_code = '9618' AND paper.status = 'published' AND subject.active = 1
    LIMIT 1
  `).bind(questionId).first();
  if (!row) throw new AuthError(404, "Published question not found.", "QUESTION_NOT_FOUND");
  if (row.question_type !== "structured" || row.source_paper_type !== "structured"
    || row.source_paper_number < 1 || row.source_paper_number > 3) {
    throw new AuthError(409, "AI grading is available for structured Papers 1–3 only.", "UNSUPPORTED_QUESTION_TYPE");
  }
  return { ...mapQuestion(row), paperMetadata: parseContent(row.paper_metadata) };
}

async function readGradeBody(request) {
  const declared = Number(request.headers.get("Content-Length"));
  if (declared > MAX_BODY_BYTES) throw new AuthError(413, "The grading request is too large.", "GRADING_REQUEST_TOO_LARGE");
  const reader = request.body?.getReader();
  const chunks = [];
  let length = 0;
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new AuthError(413, "The grading request is too large.", "GRADING_REQUEST_TOO_LARGE");
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const raw = new TextDecoder().decode(bytes);
  let body;
  try { body = JSON.parse(raw); } catch (_error) {
    throw new AuthError(400, "Request body must be valid JSON.", "INVALID_INPUT");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)
    || typeof body.requestId !== "string" || !UUID.test(body.requestId)
    || !["en", "zh-CN"].includes(body.language)
    || Object.keys(body).some((key) => !["requestId", "answers", "language"].includes(key))) {
    throw new AuthError(400, "A request UUID, supported language and answers are required.", "INVALID_INPUT");
  }
  return body;
}

async function previousAttempt(db, userId, requestId, inputHash) {
  const row = await db.prepare("SELECT * FROM structured_practice_attempts WHERE user_id = ? AND request_id = ? LIMIT 1")
    .bind(userId, requestId).first();
  if (!row) return null;
  if (row.input_hash !== inputHash) throw new AuthError(409, "This request ID was used with different answers.", "GRADING_REQUEST_CONFLICT");
  if (row.status === "succeeded") return parseContent(row.result);
  if (row.status === "pending" && Date.now() - Date.parse(row.created_at) > 300000) {
    await db.prepare(`UPDATE structured_practice_attempts
      SET status = 'failed', error_status = 503, error_code = 'AI_GRADING_INTERRUPTED',
        error_message = 'The previous grading request did not finish. Please try again.',
        updated_at = ?, completed_at = ? WHERE id = ? AND status = 'pending'`)
      .bind(new Date().toISOString(), new Date().toISOString(), row.id).run();
    // A pending reservation is never replayed: the original request may have
    // reached the provider before the connection or worker was interrupted.
    throw new AuthError(503, "The previous grading request did not finish. Please try again.", "AI_GRADING_INTERRUPTED", { retryAllowed: true });
  }
  if (row.status === "pending") throw new AuthError(409, "This answer is still being graded.", "GRADING_IN_PROGRESS", { retryAfterSeconds: 3, retryAllowed: false });
  throw new AuthError(row.error_status || 502, row.error_message || "The previous grading request failed. Please try again.", row.error_code || "AI_GRADING_UNAVAILABLE", { retryAllowed: true });
}

async function gradeQuestion(request, env, userId, questionId) {
  const body = await readGradeBody(request);
  const question = await readQuestion(env.DB, questionId);
  const parts = officialAnswerParts(question);
  let answers;
  try { answers = normalizeStructuredAnswers(question, body.answers); } catch (_error) {
    throw new AuthError(400, "Answers must contain unique known part IDs and text within the allowed length.", "INVALID_STRUCTURED_ANSWERS");
  }
  const requestId = body.requestId.toLowerCase();
  const fingerprint = await questionFingerprint(question);
  const inputHash = await hash({ questionId, language: body.language, answers, fingerprint });
  const previous = await previousAttempt(env.DB, userId, requestId, inputHash);
  if (previous) return previous;
  const hasAnswer = answers.some((answer) => answer.text.trim());
  // Resolve every official image before reserving a charged attempt. Missing
  // content cannot leave a phantom pending record or consume the AI quota.
  const context = hasAnswer ? await prepareStructuredGradingContext(env, question, parts, answers) : null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const insertAttempt = env.DB.prepare(`
    INSERT INTO structured_practice_attempts
      (id, user_id, request_id, question_id, paper_slug, input_hash, question_fingerprint,
        language, answers, status, ai_called, created_at, updated_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?
    WHERE ? = 0 OR EXISTS (
      SELECT 1 FROM ai_call_cooldowns WHERE user_id = ? AND reservation_id = ?
    )
    ON CONFLICT(user_id, request_id) DO NOTHING
  `).bind(id, userId, requestId, questionId, question.paperSlug, inputHash, fingerprint,
    body.language, JSON.stringify(answers), hasAnswer ? 1 : 0, now, now, hasAnswer ? 1 : 0, userId, id);
  const inserted = hasAnswer
    ? (await env.DB.batch([reserveAiCallStatement(env.DB, userId, id, requestId), insertAttempt]))[1]
    : await insertAttempt.run();
  if (!inserted.meta.changes) {
    const concurrent = await previousAttempt(env.DB, userId, requestId, inputHash);
    if (concurrent) return concurrent;
    throw await aiCallCooldownError(env.DB, userId, "AI_GRADING_RATE_LIMITED");
  }
  try {
    const grading = hasAnswer
      ? await requestStructuredGrading(env, context, parts, answers, body.language)
      : blankStructuredGrade(parts, body.language);
    const result = {
      id, requestId, questionId, language: body.language, answers,
      earnedMarks: grading.earnedMarks, maxMarks: question.maxMarks,
      parts: grading.parts, feedback: grading.feedback, model: grading.model, createdAt: now,
    };
    const completed = new Date().toISOString();
    await env.DB.prepare(`UPDATE structured_practice_attempts
      SET status = 'succeeded', result = ?, model = ?, response_id = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'pending'`)
      .bind(JSON.stringify(result), grading.model, grading.responseId, completed, completed, id).run();
    return result;
  } catch (error) {
    const safe = error instanceof AuthError ? error
      : new AuthError(500, "The grading result could not be saved. Please try again.", "AI_GRADING_SAVE_FAILED");
    const completed = new Date().toISOString();
    await env.DB.prepare(`UPDATE structured_practice_attempts
      SET status = 'failed', error_code = ?, error_message = ?, error_status = ?, updated_at = ?, completed_at = ?
      WHERE id = ? AND status = 'pending'`)
      .bind(safe.code, safe.message, safe.status, completed, completed, id).run();
    safe.details = { retryAllowed: true };
    throw safe;
  }
}

export async function handleStructuredPracticeRequest(request, env) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "private, no-store",
  } });
  try {
    const { user } = await requireCurrentUser(request, env);
    const pathname = new URL(request.url).pathname;
    const paper = pathname.match(/^\/api\/structured-practice\/papers\/(9618_[msw]\d{2}_qp_[1-4][1-9])$/);
    const question = pathname.match(/^\/api\/structured-practice\/questions\/([^/]+)\/grade$/);
    let data;
    if (paper && request.method === "GET") data = await readPaper(env.DB, paper[1], user.id);
    else if (question && request.method === "POST") {
      let id;
      try { id = decodeURIComponent(question[1]); } catch (_error) { throw new AuthError(400, "Invalid question ID.", "INVALID_INPUT"); }
      data = await gradeQuestion(request, env, user.id, id);
    } else throw new AuthError(404, "Structured practice route not found.", "NOT_FOUND");
    const response = success(data, request.method);
    response.headers.set("Cache-Control", "private, no-store");
    return response;
  } catch (error) {
    const response = error instanceof AuthError
      ? failure(error.status, error.code, error.message, request.method, error.details)
      : failure(500, "INTERNAL_SERVER_ERROR", "Unexpected structured practice error.", request.method);
    response.headers.set("Cache-Control", "private, no-store");
    if (error instanceof AuthError && error.status === 429 && error.details?.retryAfterSeconds) {
      response.headers.set("Retry-After", String(error.details.retryAfterSeconds));
    }
    return response;
  }
}
