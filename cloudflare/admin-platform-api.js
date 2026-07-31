import { AuthError, mapUser, readJsonBody, success } from "./auth-api.js";
import { dispatchImportWorkflow, writeAudit } from "./admin-support.js";

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function integer(value, fallback, min, max, field = "value") {
  const number = value === null || value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AuthError(400, `${field} must be an integer from ${min} to ${max}.`, "INVALID_INPUT");
  }
  return number;
}

function csvCell(value) {
  const text = value === null || value === undefined
    ? ""
    : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function rowsToCsv(rows) {
  if (!rows.length) return "";
  const columns = Object.keys(rows[0]);
  return [columns.map(csvCell).join(","), ...rows.map((row) => (
    columns.map((column) => csvCell(row[column])).join(",")
  ))].join("\r\n");
}

async function deleteR2Prefix(bucket, prefix) {
  let cursor;
  do {
    const page = await bucket.list({ prefix, cursor });
    const keys = page.objects.map((object) => object.key);
    if (keys.length) await bucket.delete(keys);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

async function deleteSupabaseUser(env, supabaseUserId) {
  if (!supabaseUserId) return;
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const serviceRoleKey = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (!supabaseUrl || !serviceRoleKey) {
    throw new AuthError(503, "Supabase user deletion is not configured.", "SUPABASE_ADMIN_NOT_CONFIGURED");
  }
  let response;
  try {
    response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(supabaseUserId)}`, {
      method: "DELETE",
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
    });
  } catch (_error) {
    throw new AuthError(502, "Supabase user deletion could not be reached.", "SUPABASE_ADMIN_UNAVAILABLE");
  }
  if (!response.ok && response.status !== 404) {
    throw new AuthError(502, "Supabase rejected the user deletion.", "SUPABASE_ADMIN_REJECTED", {
      upstreamStatus: response.status,
    });
  }
}

async function userHistory(db, userId) {
  const user = await db.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(userId).first();
  if (!user) throw new AuthError(404, "User not found.", "USER_NOT_FOUND");
  const [summary, practices, attempts, notebook, threads, posts, mute] = await Promise.all([
    db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM practice_sessions WHERE user_id = ?) AS practice_count,
        (SELECT COUNT(*) FROM question_attempts WHERE user_id = ?) AS attempt_count,
        (SELECT COUNT(*) FROM question_attempts WHERE user_id = ? AND correct = 1) AS correct_count,
        (SELECT COUNT(*) FROM wrong_notebook_entries WHERE user_id = ?) AS notebook_count,
        (SELECT MAX(attempted_at) FROM question_attempts WHERE user_id = ?) AS last_attempted_at
    `).bind(userId, userId, userId, userId, userId).first(),
    db.prepare("SELECT * FROM practice_sessions WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all(),
    db.prepare(`
      SELECT a.*, q.paper_slug, q.question_no, q.stem, q.topic
      FROM question_attempts a JOIN question_bank q ON q.id = a.question_id
      WHERE a.user_id = ? ORDER BY a.attempted_at DESC
    `).bind(userId).all(),
    db.prepare("SELECT * FROM wrong_notebook_entries WHERE user_id = ? ORDER BY last_wrong_at DESC").bind(userId).all(),
    db.prepare("SELECT * FROM discussion_threads WHERE author_id = ? ORDER BY created_at DESC").bind(userId).all(),
    db.prepare("SELECT * FROM discussion_posts WHERE author_id = ? ORDER BY created_at DESC").bind(userId).all(),
    db.prepare("SELECT * FROM community_mutes WHERE user_id = ? LIMIT 1").bind(userId).first(),
  ]);
  return {
    user: mapUser(user),
    summary: {
      practiceCount: Number(summary.practice_count || 0),
      attemptCount: Number(summary.attempt_count || 0),
      correctCount: Number(summary.correct_count || 0),
      notebookCount: Number(summary.notebook_count || 0),
      lastAttemptedAt: summary.last_attempted_at || null,
    },
    practices: practices.results.map((row) => ({
      ...row,
      topics: parseJson(row.topics, []),
      generated_questions: parseJson(row.generated_questions, []),
      answers: parseJson(row.answers, null),
      result: parseJson(row.result, null),
      wrong_log: parseJson(row.wrong_log, null),
    })),
    attempts: attempts.results,
    notebook: notebook.results,
    discussions: { threads: threads.results, posts: posts.results },
    mute: mute ? { ...mute, active: new Date(mute.muted_until).getTime() > Date.now() } : null,
  };
}

async function aiSettings(request, env, admin) {
  if (request.method === "GET") {
    const setting = await env.DB.prepare("SELECT value, updated_by, updated_at FROM app_settings WHERE key = 'ai_hint_live_generation'").first();
    return success({
      enabled: parseJson(setting?.value, false) === true,
      configured: Boolean(env.OPENAI_API_KEY && env.OPENAI_HINT_MODEL),
      modelConfigured: Boolean(env.OPENAI_HINT_MODEL),
      updatedBy: setting?.updated_by || null,
      updatedAt: setting?.updated_at || null,
    }, request.method);
  }
  const body = await readJsonBody(request);
  if (typeof body.enabled !== "boolean") throw new AuthError(400, "Enabled must be a boolean.", "INVALID_INPUT");
  if (body.enabled) {
    if (!env.OPENAI_API_KEY || !env.OPENAI_HINT_MODEL) {
      throw new AuthError(409, "Configure the OpenAI key and hint model before enabling live generation.", "AI_HINTS_NOT_CONFIGURED");
    }
    const sample = await env.DB.prepare(`
      SELECT COUNT(DISTINCT question_id || ':' || language) AS approved FROM question_hint_sets
      WHERE status = 'approved' AND prompt_version = 'igcse-progressive-v1'
        AND question_id IN (
          'CIE-IGCSE-0610-0610_m21_qp_22-01', 'CIE-IGCSE-0610-0610_m22_qp_22-02',
          'CIE-IGCSE-0610-0610_w19_qp_21-03', 'CIE-IGCSE-0610-0610_w23_qp_22-03',
          'CIE-IGCSE-0610-0610_s20_qp_21-03', 'CIE-IGCSE-0610-0610_m21_qp_22-38',
          'CIE-IGCSE-0610-0610_m21_qp_22-05', 'CIE-IGCSE-0610-0610_s23_qp_21-04',
          'CIE-IGCSE-0610-0610_w21_qp_22-06', 'CIE-IGCSE-0610-0610_w20_qp_21-06',
          'CIE-IGCSE-0610-0610_w22_qp_21-06', 'CIE-IGCSE-0610-0610_m20_qp_22-08'
        ) AND language IN ('zh-CN', 'en')
    `).first();
    if (Number(sample?.approved || 0) !== 24) {
      throw new AuthError(409, "Approve all 24 sample hint sets before enabling live generation.", "AI_HINT_SAMPLE_NOT_APPROVED");
    }
  }
  const now = new Date().toISOString();
  await env.DB.prepare(`
    INSERT INTO app_settings (key, value, updated_by, updated_at)
    VALUES ('ai_hint_live_generation', ?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at
  `).bind(JSON.stringify(body.enabled), admin.id, now).run();
  await writeAudit(env.DB, admin.id, body.enabled ? "ai_hints.enable" : "ai_hints.disable", "app_setting", "ai_hint_live_generation");
  return success({ enabled: body.enabled, configured: true, modelConfigured: true, updatedBy: admin.id, updatedAt: now }, request.method);
}

async function exportRows(db, dataset) {
  const queries = {
    users: "SELECT id, email, display_name, role, grade, target_score, language, disabled_at, created_at, updated_at FROM users ORDER BY created_at DESC LIMIT 5000",
    practices: "SELECT * FROM practice_sessions ORDER BY created_at DESC LIMIT 5000",
    attempts: "SELECT * FROM question_attempts ORDER BY attempted_at DESC LIMIT 5000",
    notebook: "SELECT * FROM wrong_notebook_entries ORDER BY last_wrong_at DESC LIMIT 5000",
    community: `SELECT t.id AS thread_id, t.title, t.status AS thread_status, t.sticky,
      p.id AS post_id, p.author_id, p.body, p.hidden, p.approved, p.created_at
      FROM discussion_threads t LEFT JOIN discussion_posts p ON p.thread_id = t.id
      ORDER BY t.created_at DESC, p.created_at LIMIT 5000`,
    imports: "SELECT * FROM exam_import_jobs ORDER BY created_at DESC LIMIT 5000",
    audit: "SELECT * FROM admin_audit_events ORDER BY created_at DESC LIMIT 5000",
  };
  if (!queries[dataset]) throw new AuthError(400, "Unsupported export dataset.", "INVALID_INPUT");
  return (await db.prepare(queries[dataset]).all()).results;
}

export async function handleAdminPlatformRoute(request, env, admin) {
  const url = new URL(request.url);

  if (url.pathname === "/api/admin/settings/ai-hints" && new Set(["GET", "PATCH"]).has(request.method)) {
    return aiSettings(request, env, admin);
  }

  const history = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/history$/);
  if (history && request.method === "GET") {
    return success(await userHistory(env.DB, decodeURIComponent(history[1])), request.method);
  }

  const deleteUser = url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (deleteUser && request.method === "DELETE") {
    const userId = decodeURIComponent(deleteUser[1]);
    if (userId === admin.id) throw new AuthError(409, "Administrators cannot delete their own account.", "ADMIN_SELF_DELETE");
    const target = await env.DB.prepare("SELECT * FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    if (!target) throw new AuthError(404, "User not found.", "USER_NOT_FOUND");
    if (target.role === "admin") throw new AuthError(403, "Administrator accounts cannot be deleted here.", "FORBIDDEN");
    await deleteSupabaseUser(env, target.supabase_user_id);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM question_attempts WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM wrong_notebook_entries WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM practice_sessions WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM discussion_post_likes WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM discussion_thread_follows WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM discussion_flags WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM community_mutes WHERE user_id = ?").bind(userId),
      env.DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    ]);
    await writeAudit(env.DB, admin.id, "user.delete", "user", userId, { role: target.role });
    return success({ id: userId, deleted: true }, request.method);
  }

  const subjectQuestions = url.pathname.match(/^\/api\/admin\/subjects\/(\d{4})\/questions$/);
  if (subjectQuestions && request.method === "GET") {
    const limit = integer(url.searchParams.get("limit"), 100, 1, 300, "limit");
    const offset = integer(url.searchParams.get("offset"), 0, 0, 100000, "offset");
    const [rows, count] = await Promise.all([
      env.DB.prepare(`
        SELECT id, paper_slug, question_no, year, topic, stem, active
        FROM question_bank WHERE subject_code = ?
        ORDER BY year DESC, paper_slug, question_no LIMIT ? OFFSET ?
      `).bind(subjectQuestions[1], limit, offset).all(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM question_bank WHERE subject_code = ?").bind(subjectQuestions[1]).first(),
    ]);
    return success({ questions: rows.results.map((row) => ({ ...row, active: Boolean(row.active) })), total: Number(count.count), limit, offset }, request.method);
  }

  const subjectStatus = url.pathname.match(/^\/api\/admin\/subjects\/(\d{4})\/status$/);
  if (subjectStatus && request.method === "PATCH") {
    const body = await readJsonBody(request);
    if (typeof body.active !== "boolean") throw new AuthError(400, "Active must be a boolean.", "INVALID_INPUT");
    const now = new Date().toISOString();
    const result = await env.DB.prepare("UPDATE exam_subjects SET active = ?, updated_at = ? WHERE code = ?")
      .bind(body.active ? 1 : 0, now, subjectStatus[1]).run();
    if (!result.meta.changes) throw new AuthError(404, "Subject not found.", "SUBJECT_NOT_FOUND");
    await writeAudit(env.DB, admin.id, body.active ? "subject.enable" : "subject.disable", "subject", subjectStatus[1]);
    return success({ code: subjectStatus[1], active: body.active, updatedAt: now }, request.method);
  }

  const deleteSubject = url.pathname.match(/^\/api\/admin\/subjects\/(\d{4})$/);
  if (deleteSubject && request.method === "DELETE") {
    const code = deleteSubject[1];
    const dependencies = await env.DB.prepare(`
      SELECT
        (SELECT COUNT(*) FROM exam_papers WHERE subject_code = ?) AS papers,
        (SELECT COUNT(*) FROM question_bank WHERE subject_code = ?) AS questions,
        (SELECT COUNT(*) FROM curriculum_versions WHERE subject_code = ?) AS curricula,
        (SELECT COUNT(*) FROM exam_import_jobs WHERE subject_code = ?) AS imports
    `).bind(code, code, code, code).first();
    const counts = Object.fromEntries(Object.entries(dependencies).map(([key, value]) => [key, Number(value)]));
    if (Object.values(counts).some(Boolean)) {
      throw new AuthError(409, "Delete dependent papers, questions, curricula, and import jobs first.", "SUBJECT_HAS_DEPENDENCIES", counts);
    }
    const result = await env.DB.prepare("DELETE FROM exam_subjects WHERE code = ?").bind(code).run();
    if (!result.meta.changes) throw new AuthError(404, "Subject not found.", "SUBJECT_NOT_FOUND");
    await writeAudit(env.DB, admin.id, "subject.delete", "subject", code);
    return success({ code, deleted: true }, request.method);
  }

  if (url.pathname === "/api/admin/imports/dispatch" && request.method === "POST") {
    const body = await readJsonBody(request);
    const result = await dispatchImportWorkflow(env, { action: "auto", jobId: body.jobId || "" });
    await writeAudit(env.DB, admin.id, "import.dispatch", "workflow", result.workflow, { jobId: body.jobId || null });
    return success({ dispatched: true, ...result }, request.method, 202);
  }

  const importCancel = url.pathname.match(/^\/api\/admin\/imports\/([^/]+)\/cancel$/);
  if (importCancel && request.method === "POST") {
    const jobId = decodeURIComponent(importCancel[1]);
    const job = await env.DB.prepare("SELECT * FROM exam_import_jobs WHERE id = ? LIMIT 1").bind(jobId).first();
    if (!job) throw new AuthError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
    if (job.status === "published") throw new AuthError(409, "Published import jobs cannot be cancelled.", "INVALID_IMPORT_STATE");
    const now = new Date().toISOString();
    const result = await env.DB.prepare(`
      UPDATE exam_import_jobs SET cancelled_at = ?,
        summary = json_set(summary, '$.requestedAction', NULL, '$.cancelledAt', ?)
      WHERE id = ? AND status <> 'published' AND cancelled_at IS NULL
    `).bind(now, now, jobId).run();
    if (!result.meta.changes) {
      const current = await env.DB.prepare("SELECT status, cancelled_at FROM exam_import_jobs WHERE id = ? LIMIT 1").bind(jobId).first();
      if (current?.status === "published") throw new AuthError(409, "Published import jobs cannot be cancelled.", "INVALID_IMPORT_STATE");
      return success({ id: jobId, status: "cancelled", cancelledAt: current?.cancelled_at || job.cancelled_at }, request.method);
    }
    await writeAudit(env.DB, admin.id, "import.cancel", "import_job", jobId);
    return success({ id: jobId, status: "cancelled", cancelledAt: now }, request.method);
  }

  const importVisibility = url.pathname.match(/^\/api\/admin\/imports\/([^/]+)\/visibility$/);
  if (importVisibility && request.method === "PATCH") {
    const jobId = decodeURIComponent(importVisibility[1]);
    const body = await readJsonBody(request);
    if (typeof body.hidden !== "boolean") throw new AuthError(400, "Hidden must be a boolean.", "INVALID_INPUT");
    const now = new Date().toISOString();
    const result = await env.DB.prepare("UPDATE exam_import_jobs SET hidden_at = ? WHERE id = ?")
      .bind(body.hidden ? now : null, jobId).run();
    if (!result.meta.changes) throw new AuthError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
    await writeAudit(env.DB, admin.id, body.hidden ? "import.hide" : "import.restore", "import_job", jobId);
    return success({ id: jobId, hidden: body.hidden, hiddenAt: body.hidden ? now : null }, request.method);
  }

  const deleteImport = url.pathname.match(/^\/api\/admin\/imports\/([^/]+)$/);
  if (deleteImport && request.method === "DELETE") {
    const jobId = decodeURIComponent(deleteImport[1]);
    const job = await env.DB.prepare("SELECT * FROM exam_import_jobs WHERE id = ? LIMIT 1").bind(jobId).first();
    if (!job) throw new AuthError(404, "Import job not found.", "IMPORT_JOB_NOT_FOUND");
    const requestedAction = parseJson(job.summary, {}).requestedAction;
    const deletable = job.cancelled_at || job.status === "failed" || (job.status === "uploading" && !requestedAction);
    if (!deletable) throw new AuthError(409, "Cancel the job before deleting it.", "INVALID_IMPORT_STATE");
    await deleteR2Prefix(env.PRIVATE_IMPORTS_BUCKET, `imports/${jobId}/`);
    await deleteR2Prefix(env.CONTENT_BUCKET, `releases/${jobId}/`);
    await env.DB.prepare("DELETE FROM exam_import_jobs WHERE id = ?").bind(jobId).run();
    await writeAudit(env.DB, admin.id, "import.delete", "import_job", jobId, { subjectCode: job.subject_code });
    return success({ id: jobId, deleted: true }, request.method);
  }

  if (url.pathname === "/api/admin/exports" && request.method === "GET") {
    const dataset = String(url.searchParams.get("dataset") || "users");
    const format = String(url.searchParams.get("format") || "json");
    const rows = await exportRows(env.DB, dataset);
    await writeAudit(env.DB, admin.id, "data.export", "dataset", dataset, { format, rowCount: rows.length });
    if (format === "json") return success({ dataset, exportedAt: new Date().toISOString(), rows }, request.method);
    if (format !== "csv") throw new AuthError(400, "Export format must be json or csv.", "INVALID_INPUT");
    return new Response(rowsToCsv(rows), {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": `attachment; filename="expassway-${dataset}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
      },
    });
  }

  if (url.pathname === "/api/admin/audit-logs" && request.method === "GET") {
    const limit = integer(url.searchParams.get("limit"), 100, 1, 300, "limit");
    const offset = integer(url.searchParams.get("offset"), 0, 0, 100000, "offset");
    const action = String(url.searchParams.get("action") || "").trim();
    const targetType = String(url.searchParams.get("targetType") || "").trim();
    const rows = await env.DB.prepare(`
      SELECT event.*, user.display_name AS actor_name, user.email AS actor_email
      FROM admin_audit_events event LEFT JOIN users user ON user.id = event.actor_user_id
      WHERE (? = '' OR event.action = ?) AND (? = '' OR event.target_type = ?)
      ORDER BY event.created_at DESC LIMIT ? OFFSET ?
    `).bind(action, action, targetType, targetType, limit, offset).all();
    return success(rows.results.map((row) => ({ ...row, details: parseJson(row.details, {}) })), request.method);
  }

  if (url.pathname === "/api/admin/community/reports" && request.method === "GET") {
    const status = String(url.searchParams.get("status") || "pending");
    if (!new Set(["pending", "resolved", "dismissed", "all"]).has(status)) throw new AuthError(400, "Invalid report status.", "INVALID_INPUT");
    const rows = await env.DB.prepare(`
      SELECT flag.*, reporter.display_name AS reporter_name,
        post.body, post.author_id, post.hidden AS post_hidden, author.display_name AS author_name,
        author_mute.muted_until,
        thread.id AS thread_id, thread.title AS thread_title,
        thread.status AS thread_status, thread.sticky AS thread_sticky
      FROM discussion_flags flag
      JOIN discussion_posts post ON post.id = flag.post_id
      JOIN discussion_threads thread ON thread.id = post.thread_id
      LEFT JOIN users reporter ON reporter.id = flag.user_id
      LEFT JOIN users author ON author.id = post.author_id
      LEFT JOIN community_mutes author_mute ON author_mute.user_id = post.author_id
      WHERE (? = 'all' OR flag.status = ?)
      ORDER BY flag.created_at DESC LIMIT 200
    `).bind(status, status).all();
    return success(rows.results, request.method);
  }

  if (url.pathname === "/api/admin/community/threads" && request.method === "GET") {
    const status = String(url.searchParams.get("status") || "all");
    if (!new Set(["all", "open", "solved", "locked", "hidden"]).has(status)) {
      throw new AuthError(400, "Invalid discussion status.", "INVALID_INPUT");
    }
    const limit = integer(url.searchParams.get("limit"), 100, 1, 200, "limit");
    const offset = integer(url.searchParams.get("offset"), 0, 0, 100000, "offset");
    const [rows, count] = await Promise.all([
      env.DB.prepare(`
        SELECT thread.*, author.display_name AS author_name, author.email AS author_email,
          mute.muted_until,
          (SELECT COUNT(*) FROM discussion_posts post WHERE post.thread_id = thread.id) AS post_count,
          (SELECT COUNT(*) FROM discussion_flags flag
            JOIN discussion_posts post ON post.id = flag.post_id
            WHERE post.thread_id = thread.id AND flag.status = 'pending') AS pending_report_count
        FROM discussion_threads thread
        LEFT JOIN users author ON author.id = thread.author_id
        LEFT JOIN community_mutes mute ON mute.user_id = thread.author_id
        WHERE (? = 'all' OR thread.status = ?)
        ORDER BY thread.sticky DESC, thread.last_post_at DESC
        LIMIT ? OFFSET ?
      `).bind(status, status, limit, offset).all(),
      env.DB.prepare("SELECT COUNT(*) AS count FROM discussion_threads WHERE (? = 'all' OR status = ?)")
        .bind(status, status).first(),
    ]);
    return success({ threads: rows.results, total: Number(count.count), limit, offset }, request.method);
  }

  const threadPosts = url.pathname.match(/^\/api\/admin\/community\/threads\/([^/]+)\/posts$/);
  if (threadPosts && request.method === "GET") {
    const id = decodeURIComponent(threadPosts[1]);
    const thread = await env.DB.prepare("SELECT * FROM discussion_threads WHERE id = ? LIMIT 1").bind(id).first();
    if (!thread) throw new AuthError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
    const posts = await env.DB.prepare(`
      SELECT post.*, author.display_name AS author_name, author.email AS author_email,
        mute.muted_until,
        (SELECT COUNT(*) FROM discussion_flags flag WHERE flag.post_id = post.id AND flag.status = 'pending') AS pending_report_count
      FROM discussion_posts post
      LEFT JOIN users author ON author.id = post.author_id
      LEFT JOIN community_mutes mute ON mute.user_id = post.author_id
      WHERE post.thread_id = ? ORDER BY post.created_at, post.id
    `).bind(id).all();
    return success({ thread, posts: posts.results }, request.method);
  }

  const reportStatus = url.pathname.match(/^\/api\/admin\/community\/reports\/([^/]+)$/);
  if (reportStatus && request.method === "PATCH") {
    const body = await readJsonBody(request);
    if (!new Set(["resolved", "dismissed"]).has(body.status)) throw new AuthError(400, "Report status must be resolved or dismissed.", "INVALID_INPUT");
    const id = decodeURIComponent(reportStatus[1]);
    const now = new Date().toISOString();
    const result = await env.DB.prepare("UPDATE discussion_flags SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?")
      .bind(body.status, now, admin.id, id).run();
    if (!result.meta.changes) throw new AuthError(404, "Report not found.", "REPORT_NOT_FOUND");
    await writeAudit(env.DB, admin.id, `community.report.${body.status}`, "discussion_flag", id);
    return success({ id, status: body.status, resolvedAt: now, resolvedBy: admin.id }, request.method);
  }

  const postVisibility = url.pathname.match(/^\/api\/admin\/community\/posts\/([^/]+)\/visibility$/);
  if (postVisibility && request.method === "PATCH") {
    const body = await readJsonBody(request);
    if (typeof body.hidden !== "boolean") throw new AuthError(400, "Hidden must be a boolean.", "INVALID_INPUT");
    const id = decodeURIComponent(postVisibility[1]);
    const result = await env.DB.prepare("UPDATE discussion_posts SET hidden = ?, updated_at = ? WHERE id = ?")
      .bind(body.hidden ? 1 : 0, new Date().toISOString(), id).run();
    if (!result.meta.changes) throw new AuthError(404, "Discussion post not found.", "DISCUSSION_POST_NOT_FOUND");
    await writeAudit(env.DB, admin.id, body.hidden ? "community.post.hide" : "community.post.restore", "discussion_post", id);
    return success({ id, hidden: body.hidden }, request.method);
  }

  const threadModeration = url.pathname.match(/^\/api\/admin\/community\/threads\/([^/]+)$/);
  if (threadModeration && request.method === "PATCH") {
    const id = decodeURIComponent(threadModeration[1]);
    const current = await env.DB.prepare("SELECT * FROM discussion_threads WHERE id = ? LIMIT 1").bind(id).first();
    if (!current) throw new AuthError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
    const body = await readJsonBody(request);
    const status = Object.prototype.hasOwnProperty.call(body, "status") ? String(body.status) : current.status;
    if (!new Set(["open", "solved", "locked", "hidden"]).has(status)) throw new AuthError(400, "Invalid discussion status.", "INVALID_INPUT");
    const sticky = Object.prototype.hasOwnProperty.call(body, "sticky") ? Boolean(body.sticky) : Boolean(current.sticky);
    await env.DB.prepare("UPDATE discussion_threads SET status = ?, sticky = ?, updated_at = ? WHERE id = ?")
      .bind(status, sticky ? 1 : 0, new Date().toISOString(), id).run();
    await writeAudit(env.DB, admin.id, "community.thread.update", "discussion_thread", id, { status, sticky });
    return success({ id, status, sticky }, request.method);
  }
  if (threadModeration && request.method === "DELETE") {
    const id = decodeURIComponent(threadModeration[1]);
    const result = await env.DB.prepare("DELETE FROM discussion_threads WHERE id = ?").bind(id).run();
    if (!result.meta.changes) throw new AuthError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
    await writeAudit(env.DB, admin.id, "community.thread.delete", "discussion_thread", id);
    return success({ id, deleted: true }, request.method);
  }

  const mute = url.pathname.match(/^\/api\/admin\/community\/mutes\/([^/]+)$/);
  if (mute && request.method === "PATCH") {
    const userId = decodeURIComponent(mute[1]);
    const target = await env.DB.prepare("SELECT id, role FROM users WHERE id = ? LIMIT 1").bind(userId).first();
    if (!target) throw new AuthError(404, "User not found.", "USER_NOT_FOUND");
    if (target.role === "admin") throw new AuthError(403, "Administrator accounts cannot be muted.", "FORBIDDEN");
    const body = await readJsonBody(request);
    if (body.active === false) {
      await env.DB.prepare("DELETE FROM community_mutes WHERE user_id = ?").bind(userId).run();
      await writeAudit(env.DB, admin.id, "community.user.unmute", "user", userId);
      return success({ userId, muted: false }, request.method);
    }
    const days = integer(body.days, null, 1, 365, "days");
    const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
    const mutedUntil = new Date(Date.now() + days * 86400000).toISOString();
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO community_mutes (user_id, muted_until, reason, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET muted_until = excluded.muted_until,
        reason = excluded.reason, created_by = excluded.created_by, updated_at = excluded.updated_at
    `).bind(userId, mutedUntil, reason, admin.id, now, now).run();
    await writeAudit(env.DB, admin.id, "community.user.mute", "user", userId, { days, mutedUntil, reason });
    return success({ userId, muted: true, mutedUntil, reason }, request.method);
  }

  return null;
}
