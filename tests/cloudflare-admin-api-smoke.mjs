import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleAdminApiRequest } from "../cloudflare/admin-api.js";

const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";

async function issueToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: user.role,
    iat: now,
    exp: now + 3600,
  })).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = Buffer.from(await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  )).toString("base64url");
  return `${payload}.${signature}`;
}

async function api(env, token, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await handleAdminApiRequest(new Request(`https://expassway.test${path}`, {
    ...options,
    headers,
  }), env);
  return { response, payload: await response.json().catch(() => null) };
}

const mf = new Miniflare({
  compatibilityDate: "2026-07-29",
  d1Databases: { DB: "admin-api-test" },
  r2Buckets: {
    PRIVATE_IMPORTS_BUCKET: "private-imports-test",
    CONTENT_BUCKET: "content-test",
  },
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});

try {
  const db = await mf.getD1Database("DB");
  const bucket = await mf.getR2Bucket("PRIVATE_IMPORTS_BUCKET");
  const contentBucket = await mf.getR2Bucket("CONTENT_BUCKET");
  for (const file of [
    "../migrations/0001_initial.sql",
    "../migrations/0002_supabase_auth.sql",
    "../migrations/0003_admin_platform.sql",
  ]) {
    const sql = await readFile(new URL(file, import.meta.url), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
  }
  const admin = { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.com", role: "admin" };
  const student = { id: "22222222-2222-4222-8222-222222222222", email: "student@example.com", role: "student" };
  await db.batch([
    db.prepare(`
      INSERT INTO users (id, email, display_name, role, supabase_user_id)
      VALUES (?, ?, 'Admin', 'admin', 'supabase-admin')
    `).bind(admin.id, admin.email),
    db.prepare(`
      INSERT INTO users (id, email, display_name, role, supabase_user_id)
      VALUES (?, ?, 'Student', 'student', 'supabase-student')
    `).bind(student.id, student.email),
    db.prepare(`
      INSERT INTO exam_subjects (code, name, asset_key) VALUES ('0610', 'Biology', 'biology')
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, year, stem, options, answer,
        subject_code, paper_slug, question_no
      ) VALUES (
        'question-1', 'CIE', 'IGCSE Biology', 'MCQ', '2023', 'A cell question',
        '["A","B","C","D"]', 1, '0610', '0610_s23_qp_22', 1
      )
    `),
    db.prepare(`
      INSERT INTO practice_sessions (
        id, user_id, board, subject, paper, requested_count,
        generated_questions, answers, result, status, submitted_at
      ) VALUES (
        'practice-1', ?, 'CIE', 'IGCSE Biology', 'MCQ', 1,
        '[]', '[1]', '{"accuracy":100}', 'submitted', '2026-07-31T00:00:00.000Z'
      )
    `).bind(student.id),
  ]);
  const originalFetch = globalThis.fetch;
  const dispatched = [];
  const supabaseDeletes = [];
  let githubStatus = 204;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/")) {
      dispatched.push({ url, options });
      return new Response(null, { status: githubStatus });
    }
    if (url.startsWith("https://supabase.test/auth/v1/admin/users/")) {
      supabaseDeletes.push({ url, options });
      return new Response(null, { status: 204 });
    }
    return originalFetch(input, options);
  };
  const env = {
    DB: db,
    PRIVATE_IMPORTS_BUCKET: bucket,
    CONTENT_BUCKET: contentBucket,
    AUTH_SECRET,
    GITHUB_ACTIONS_TOKEN: "test-github-token",
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  };
  const adminToken = await issueToken(admin);
  const studentToken = await issueToken(student);

  {
    const forbidden = await api(env, studentToken, "/api/admin/records");
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.payload.error.code, "FORBIDDEN");

    const records = await api(env, adminToken, "/api/admin/records?usersLimit=10&practicesLimit=10");
    assert.equal(records.response.status, 200);
    assert.deepEqual(records.payload.data.summary, {
      usersCount: 2,
      practiceCount: 1,
      submittedCount: 1,
    });
    assert.equal(records.payload.data.latestPractices[0].accuracy, 100);

    const selfDisable = await api(env, adminToken, `/api/admin/users/${admin.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(selfDisable.response.status, 409);

    const disabled = await api(env, adminToken, `/api/admin/users/${student.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ disabled: true }),
    });
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.payload.data.isDisabled, true);
  }

  {
    const subject = await api(env, adminToken, "/api/admin/subjects", {
      method: "POST",
      body: JSON.stringify({
        code: "0654",
        name: "Co-ordinated Sciences",
        nameZh: "协调科学",
        assetKey: "coordinated-sciences-0654",
      }),
    });
    assert.equal(subject.response.status, 201);
    assert.equal(subject.payload.data.code, "0654");
    const subjects = await api(env, adminToken, "/api/admin/subjects");
    assert.equal(subjects.payload.data.length, 2);
  }

  let jobId;
  {
    const created = await api(env, adminToken, "/api/admin/imports", {
      method: "POST",
      body: JSON.stringify({ subjectCode: "0610" }),
    });
    assert.equal(created.response.status, 201);
    jobId = created.payload.data.id;
    assert.match(created.payload.data.inputDir, /^r2:\/\/private-imports\/imports\//);

    const invalid = await api(env, adminToken, `/api/admin/imports/${jobId}/files`, {
      method: "POST",
      body: JSON.stringify({
        fileName: "0610_s23_qp_22.pdf",
        dataUrl: `data:application/pdf;base64,${Buffer.from("not pdf").toString("base64")}`,
      }),
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.payload.error.code, "INVALID_PDF");

    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    for (const fileName of ["0610_s23_qp_22.pdf", "0610_s23_ms_22.pdf"]) {
      const uploaded = await api(env, adminToken, `/api/admin/imports/${jobId}/files`, {
        method: "POST",
        body: JSON.stringify({
          fileName,
          dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}`,
        }),
      });
      assert.equal(uploaded.response.status, 201);
      assert.equal(uploaded.payload.data.paperSlug, "0610_s23_qp_22");
      assert.equal(uploaded.payload.data.byteSize, pdf.length);
    }
    const storedPdf = await bucket.get(`imports/${jobId}/input/0610_s23_qp_22.pdf`);
    assert.ok(storedPdf);
    assert.equal(storedPdf.size, pdf.length);
    assert.deepEqual(Buffer.from(await storedPdf.arrayBuffer()), pdf);

    const queued = await api(env, adminToken, `/api/admin/imports/${jobId}/process`, { method: "POST" });
    assert.equal(queued.response.status, 200);
    assert.equal(queued.payload.data.status, "processing");
    assert.equal(queued.payload.data.summary.requestedAction, "process");
    assert.equal(dispatched.length, 1);
    assert.match(dispatched[0].url, /cloudflare-pdf-import\.yml\/dispatches$/);

    const listed = await api(env, adminToken, "/api/admin/imports");
    assert.equal(listed.payload.data[0].fileCount, 2);
  }

  {
    const rollbackJob = await api(env, adminToken, "/api/admin/imports", {
      method: "POST",
      body: JSON.stringify({ subjectCode: "0610" }),
    });
    const rollbackJobId = rollbackJob.payload.data.id;
    const pdf = Buffer.from("%PDF-1.4\n%%EOF\n");
    for (const fileName of ["0610_w23_qp_22.pdf", "0610_w23_ms_22.pdf"]) {
      await api(env, adminToken, `/api/admin/imports/${rollbackJobId}/files`, {
        method: "POST",
        body: JSON.stringify({ fileName, dataUrl: `data:application/pdf;base64,${pdf.toString("base64")}` }),
      });
    }
    githubStatus = 500;
    const rejected = await api(env, adminToken, `/api/admin/imports/${rollbackJobId}/process`, { method: "POST" });
    assert.equal(rejected.response.status, 502);
    assert.equal(rejected.payload.error.code, "GITHUB_ACTIONS_REJECTED");
    const rolledBack = await api(env, adminToken, `/api/admin/imports/${rollbackJobId}`);
    assert.equal(rolledBack.payload.data.status, "uploading");
    assert.equal(rolledBack.payload.data.summary.requestedAction, undefined);
    githubStatus = 204;
    await api(env, adminToken, `/api/admin/imports/${rollbackJobId}/cancel`, { method: "POST" });
    await api(env, adminToken, `/api/admin/imports/${rollbackJobId}`, { method: "DELETE" });
  }

  await db.batch([
    db.prepare(`
      INSERT INTO curriculum_versions (
        id, subject_code, qualification, exam_year_start, exam_year_end, version, active
      ) VALUES ('0610-2026-2028-v2', '0610', 'IGCSE', 2026, 2028, '2026-2028', 1)
    `),
    db.prepare(`
      INSERT INTO curriculum_sections (
        id, curriculum_version_id, syllabus_code, title_en, level, sort_order
      ) VALUES ('curriculum-section', '0610-2026-2028-v2', '1.1.1', 'Cells', 'statement', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_chapters (
        id, book_key, chapter_no, title_en, sort_order
      ) VALUES ('chapter-1', 'biology-igcse-coursebook-4e', 1, 'Cells', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_sections (
        id, coursebook_chapter_id, section_code, title_en, sort_order
      ) VALUES ('book-section', 'chapter-1', '1.1', 'Cells', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_section_mappings (coursebook_section_id, curriculum_section_id)
      VALUES ('book-section', 'curriculum-section')
    `),
  ]);

  {
    const suggested = await api(env, adminToken, "/api/admin/curriculum/mappings/suggest", {
      method: "POST",
      body: JSON.stringify({ limit: 20 }),
    });
    assert.equal(suggested.response.status, 201);
    assert.equal(suggested.payload.data.created, 1);

    const page = await api(env, adminToken, "/api/admin/curriculum/mappings?status=suggested");
    assert.equal(page.response.status, 200);
    assert.equal(page.payload.data.mappings.length, 1);
    assert.equal(page.payload.data.mappings[0].confidence, 0.35);

    const reviewed = await api(
      env,
      adminToken,
      "/api/admin/curriculum/mappings/question-1/curriculum-section",
      {
        method: "PATCH",
        body: JSON.stringify({
          curriculumSectionId: "curriculum-section",
          coursebookSectionId: "book-section",
          status: "reviewed",
          isPrimary: true,
        }),
      }
    );
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.payload.data.status, "reviewed");
    assert.equal(reviewed.payload.data.reviewed_by, admin.id);
  }

  {
    const settings = await api(env, adminToken, "/api/admin/settings/ai-hints");
    assert.equal(settings.response.status, 200);
    assert.equal(settings.payload.data.enabled, false);
    assert.equal(settings.payload.data.configured, false);

    const history = await api(env, adminToken, `/api/admin/users/${student.id}/history`);
    assert.equal(history.response.status, 200);
    assert.equal(history.payload.data.summary.practiceCount, 1);

    const questions = await api(env, adminToken, "/api/admin/subjects/0610/questions");
    assert.equal(questions.response.status, 200);
    assert.equal(questions.payload.data.total, 1);

    const disabledSubject = await api(env, adminToken, "/api/admin/subjects/0610/status", {
      method: "PATCH",
      body: JSON.stringify({ active: false }),
    });
    assert.equal(disabledSubject.payload.data.active, false);
    await api(env, adminToken, "/api/admin/subjects/0610/status", {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });

    const exported = await api(env, adminToken, "/api/admin/exports?dataset=users&format=json");
    assert.equal(exported.response.status, 200);
    assert.equal(exported.payload.data.rows.length, 2);
    const audit = await api(env, adminToken, "/api/admin/audit-logs");
    assert.equal(audit.response.status, 200);
    assert.ok(audit.payload.data.some((event) => event.action === "data.export"));
  }

  {
    await db.batch([
      db.prepare(`
        INSERT INTO discussion_threads (id, title, status, author_id)
        VALUES ('thread-admin-test', 'Moderate this discussion', 'open', ?)
      `).bind(student.id),
      db.prepare(`
        INSERT INTO discussion_posts (id, thread_id, author_id, body)
        VALUES ('post-admin-test', 'thread-admin-test', ?, 'Opening post')
      `).bind(student.id),
      db.prepare(`
        INSERT INTO discussion_flags (id, post_id, user_id, reason)
        VALUES ('flag-admin-test', 'post-admin-test', ?, 'Needs review')
      `).bind(admin.id),
    ]);
    const discussions = await api(env, adminToken, "/api/admin/community/threads?status=all");
    assert.equal(discussions.response.status, 200);
    assert.equal(discussions.payload.data.total, 1);
    assert.equal(discussions.payload.data.threads[0].pending_report_count, 1);
    const posts = await api(env, adminToken, "/api/admin/community/threads/thread-admin-test/posts");
    assert.equal(posts.response.status, 200);
    assert.equal(posts.payload.data.posts.length, 1);

    const hiddenPost = await api(env, adminToken, "/api/admin/community/posts/post-admin-test/visibility", {
      method: "PATCH", body: JSON.stringify({ hidden: true }),
    });
    assert.equal(hiddenPost.payload.data.hidden, true);
    const restoredPost = await api(env, adminToken, "/api/admin/community/posts/post-admin-test/visibility", {
      method: "PATCH", body: JSON.stringify({ hidden: false }),
    });
    assert.equal(restoredPost.payload.data.hidden, false);

    const locked = await api(env, adminToken, "/api/admin/community/threads/thread-admin-test", {
      method: "PATCH", body: JSON.stringify({ status: "locked", sticky: true }),
    });
    assert.equal(locked.payload.data.status, "locked");
    assert.equal(locked.payload.data.sticky, true);
    const muted = await api(env, adminToken, `/api/admin/community/mutes/${student.id}`, {
      method: "PATCH", body: JSON.stringify({ days: 7 }),
    });
    assert.equal(muted.payload.data.muted, true);
    const unmuted = await api(env, adminToken, `/api/admin/community/mutes/${student.id}`, {
      method: "PATCH", body: JSON.stringify({ active: false }),
    });
    assert.equal(unmuted.payload.data.muted, false);
    const resolved = await api(env, adminToken, "/api/admin/community/reports/flag-admin-test", {
      method: "PATCH", body: JSON.stringify({ status: "resolved" }),
    });
    assert.equal(resolved.payload.data.status, "resolved");
    const deleted = await api(env, adminToken, "/api/admin/community/threads/thread-admin-test", { method: "DELETE" });
    assert.equal(deleted.payload.data.deleted, true);
  }

  {
    await db.prepare(`
      INSERT INTO question_hint_sets (
        id, question_id, language, prompt_version, question_fingerprint,
        hints, status, model
      ) VALUES (
        'hint-1', 'question-1', 'en', 'igcse-progressive-v1', 'fingerprint',
        '["One","Two","Three"]', 'pending_review', 'test-model'
      )
    `).run();
    const hints = await api(env, adminToken, "/api/admin/question-hints?status=pending_review&subjectCode=0610");
    assert.equal(hints.response.status, 200);
    assert.equal(hints.payload.data[0].hints.length, 3);

    const reviewed = await api(env, adminToken, "/api/admin/question-hints/hint-1", {
      method: "PATCH",
      body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.payload.data.status, "approved");

    const sample = await api(env, adminToken, "/api/admin/question-hints/sample-status");
    assert.equal(sample.response.status, 200);
    assert.equal(sample.payload.data.expected, 24);
    assert.equal(sample.payload.data.ready, false);

    const enableWithoutSamples = await api(env, adminToken, "/api/admin/settings/ai-hints", {
      method: "PATCH",
      body: JSON.stringify({ enabled: true }),
    });
    assert.equal(enableWithoutSamples.response.status, 409);
    assert.equal(enableWithoutSamples.payload.error.code, "AI_HINTS_NOT_CONFIGURED");
  }

  {
    const otherAdminId = "33333333-3333-4333-8333-333333333333";
    const deleteUserId = "44444444-4444-4444-8444-444444444444";
    await db.batch([
      db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, 'other-admin@example.com', 'Other Admin', 'admin', 'supabase-other-admin')").bind(otherAdminId),
      db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, 'delete@example.com', 'Delete Me', 'student', 'supabase-delete')").bind(deleteUserId),
    ]);
    const selfDelete = await api(env, adminToken, `/api/admin/users/${admin.id}`, { method: "DELETE" });
    assert.equal(selfDelete.response.status, 409);
    const adminDelete = await api(env, adminToken, `/api/admin/users/${otherAdminId}`, { method: "DELETE" });
    assert.equal(adminDelete.response.status, 403);
    const deleted = await api(env, adminToken, `/api/admin/users/${deleteUserId}`, { method: "DELETE" });
    assert.equal(deleted.response.status, 200);
    assert.equal(supabaseDeletes.length, 1);
    assert.match(supabaseDeletes[0].url, /supabase-delete$/);
  }

  {
    const hidden = await api(env, adminToken, `/api/admin/imports/${jobId}/visibility`, {
      method: "PATCH", body: JSON.stringify({ hidden: true }),
    });
    assert.equal(hidden.payload.data.hidden, true);
    const visibleJobs = await api(env, adminToken, "/api/admin/imports");
    assert.ok(!visibleJobs.payload.data.some((job) => job.id === jobId));
    const hiddenJobs = await api(env, adminToken, "/api/admin/imports?includeHidden=1");
    assert.ok(hiddenJobs.payload.data.some((job) => job.id === jobId));
    const restored = await api(env, adminToken, `/api/admin/imports/${jobId}/visibility`, {
      method: "PATCH", body: JSON.stringify({ hidden: false }),
    });
    assert.equal(restored.payload.data.hidden, false);

    const cancelled = await api(env, adminToken, `/api/admin/imports/${jobId}/cancel`, { method: "POST" });
    assert.equal(cancelled.payload.data.status, "cancelled");
    const processCancelled = await api(env, adminToken, `/api/admin/imports/${jobId}/process`, { method: "POST" });
    assert.equal(processCancelled.response.status, 409);
    const publishCancelled = await api(env, adminToken, `/api/admin/imports/${jobId}/publish`, { method: "POST" });
    assert.equal(publishCancelled.response.status, 409);
    await contentBucket.put(`releases/${jobId}/orphan.txt`, "orphan");
    const deleted = await api(env, adminToken, `/api/admin/imports/${jobId}`, { method: "DELETE" });
    assert.equal(deleted.payload.data.deleted, true);
    assert.equal(await bucket.get(`imports/${jobId}/input/0610_s23_qp_22.pdf`), null);
    assert.equal(await contentBucket.get(`releases/${jobId}/orphan.txt`), null);
  }

  const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(foreignKeys.results, []);
  console.log("Cloudflare D1 admin and private R2 import API smoke checks passed.");
} finally {
  await mf.dispose();
}
