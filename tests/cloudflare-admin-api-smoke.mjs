import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
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
    CHAT_MEDIA_BUCKET: "chat-media-test",
  },
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});

try {
  const db = await mf.getD1Database("DB");
  const bucket = await mf.getR2Bucket("PRIVATE_IMPORTS_BUCKET");
  const contentBucket = await mf.getR2Bucket("CONTENT_BUCKET");
  const chatMediaBucket = await mf.getR2Bucket("CHAT_MEDIA_BUCKET");
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
  let supabaseStatus = 204;
  globalThis.fetch = async (input, options) => {
    const url = String(input);
    if (url.startsWith("https://api.github.com/")) {
      dispatched.push({ url, options });
      return new Response(null, { status: githubStatus });
    }
    if (url.startsWith("https://supabase.test/auth/v1/admin/users/")) {
      supabaseDeletes.push({ url, options });
      return new Response(null, { status: supabaseStatus });
    }
    return originalFetch(input, options);
  };
  const env = {
    DB: db,
    PRIVATE_IMPORTS_BUCKET: bucket,
    CONTENT_BUCKET: contentBucket,
    CHAT_MEDIA_BUCKET: chatMediaBucket,
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
    await db.batch([
      db.prepare(`INSERT INTO curriculum_versions
        (id, subject_code, qualification, exam_year_start, exam_year_end, version, active)
        VALUES ('0654-test-v1', '0654', 'IGCSE', 2023, 2025, 'test', 1)`),
      db.prepare(`INSERT INTO curriculum_sections
        (id, curriculum_version_id, syllabus_code, title_en, level, sort_order)
        VALUES ('0654-section', '0654-test-v1', 'B1', 'Cells', 'section', 1)`),
      db.prepare(`INSERT INTO coursebook_chapters
        (id, book_key, chapter_no, title_en, sort_order)
        VALUES ('0654-chapter', '0654-test', 1, 'Biology', 1)`),
      db.prepare(`INSERT INTO coursebook_sections
        (id, coursebook_chapter_id, section_code, title_en, sort_order)
        VALUES ('0654-book-section', '0654-chapter', 'B1', 'Cells', 1)`),
      db.prepare(`INSERT INTO coursebook_section_mappings
        (coursebook_section_id, curriculum_section_id)
        VALUES ('0654-book-section', '0654-section')`),
      db.prepare(`INSERT INTO question_bank
        (id, board, subject, paper, year, stem, options, answer, subject_code, paper_slug, question_no)
        VALUES ('question-2', 'CIE', 'IGCSE Sciences', 'MCQ', '2025', 'A cell question',
          '["A","B","C","D"]', 1, '0654', '0654_s25_qp_21', 1)`),
      db.prepare(`INSERT INTO question_section_mappings
        (question_id, curriculum_section_id, coursebook_section_id, is_primary, status, source)
        VALUES ('question-2', '0654-section', '0654-book-section', 1, 'reviewed', 'rule')`),
      db.prepare(`INSERT INTO question_bank
        (id, board, subject, paper, year, stem, options, answer, subject_code, paper_slug, question_no)
        VALUES ('question-3', 'CIE', 'IGCSE Sciences', 'MCQ', '2025', 'Another cell question',
          '["A","B","C","D"]', 2, '0654', '0654_s25_qp_21', 2)`),
      db.prepare(`INSERT INTO question_section_mappings
        (question_id, curriculum_section_id, coursebook_section_id, is_primary, status, source)
        VALUES ('question-3', '0654-section', '0654-book-section', 1, 'reviewed', 'rule')`),
    ]);

    const unverified = await api(env, adminToken,
      "/api/admin/curriculum/mappings?subjectCode=0654&status=unverified&chapter=1&year=2025");
    assert.equal(unverified.response.status, 200);
    assert.deepEqual(unverified.payload.data.mappings.map((mapping) => mapping.questionId).sort(), ["question-2", "question-3"]);
    assert.ok(unverified.payload.data.coursebookSections.some((section) => section.sectionCode === "B1"));

    const body = { subjectCode: "0654", mappings: [
      { questionId: "question-2", curriculumSectionId: "0654-section" },
      { questionId: "question-3", curriculumSectionId: "0654-section" },
    ] };
    const forbidden = await api(env, studentToken, "/api/admin/curriculum/mappings/bulk-review", {
      method: "POST", body: JSON.stringify(body),
    });
    assert.equal(forbidden.response.status, 403);

    const stale = await api(env, adminToken, "/api/admin/curriculum/mappings/bulk-review", {
      method: "POST", body: JSON.stringify({ ...body, mappings: [
        ...body.mappings, { questionId: "missing", curriculumSectionId: "0654-section" },
      ] }),
    });
    assert.equal(stale.response.status, 409);
    assert.deepEqual((await db.prepare("SELECT reviewed_by FROM question_section_mappings WHERE question_id IN ('question-2', 'question-3')").all())
      .results.map((row) => row.reviewed_by), [null, null]);

    const approved = await api(env, adminToken, "/api/admin/curriculum/mappings/bulk-review", {
      method: "POST", body: JSON.stringify(body),
    });
    assert.equal(approved.response.status, 200);
    assert.equal(approved.payload.data.updated, 2);
    const mappings = await db.prepare("SELECT status, source, reviewed_by FROM question_section_mappings WHERE question_id IN ('question-2', 'question-3')").all();
    assert.deepEqual(mappings.results, [
      { status: "reviewed", source: "manual", reviewed_by: admin.id },
      { status: "reviewed", source: "manual", reviewed_by: admin.id },
    ]);
    const remaining = await api(env, adminToken, "/api/admin/curriculum/mappings?subjectCode=0654&status=unverified");
    assert.equal(remaining.payload.data.total, 0);
    const audit = await db.prepare("SELECT details FROM admin_audit_events WHERE action = 'curriculum.mapping.bulk_review'").first();
    assert.deepEqual(JSON.parse(audit.details), { subjectCode: "0654", count: 2 });
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
    // Run deletion against the current schema, including all shared credential and chat FKs.
    for (const file of (await readdir(new URL("../migrations/", import.meta.url))).filter((file) => (
      file.endsWith(".sql") && !/^000[123]_/.test(file)
    )).sort()) {
      const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
      for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
    }
    const otherAdminId = "33333333-3333-4333-8333-333333333333";
    const deleteUserId = "44444444-4444-4444-8444-444444444444";
    await db.batch([
      db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, 'other-admin@example.com', 'Other Admin', 'admin', 'supabase-other-admin')").bind(otherAdminId),
      db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, 'delete@example.com', 'Delete Me', 'student', 'supabase-delete')").bind(deleteUserId),
    ]);
    const timestamp = new Date().toISOString();
    for (const userId of [deleteUserId, student.id]) {
      await db.batch([
        db.prepare("INSERT INTO chat_profiles (user_id, chat_alias, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(userId, userId, timestamp, timestamp),
        db.prepare("INSERT INTO chat_account_keys (user_id, key_version, encryption_public_key, signing_public_key, fingerprint, created_at, updated_at) VALUES (?, 'key-1', 'public-encryption', 'public-signing', 'fingerprint', ?, ?)").bind(userId, timestamp, timestamp),
        db.prepare("INSERT INTO chat_passkeys (id, user_id, credential_id, public_key, prf_salt, created_at) VALUES (?, ?, ?, 'public', 'salt', ?)").bind(`passkey-${userId}`, userId, `credential-${userId}`, timestamp),
        db.prepare("INSERT INTO chat_account_vault_versions (user_id, key_version, credential_id, kdf_version, nonce, ciphertext, updated_at) VALUES (?, 'key-1', ?, 'hkdf-sha256-v1', 'nonce', 'private-ciphertext', ?)").bind(userId, `credential-${userId}`, timestamp),
        db.prepare("INSERT INTO chat_account_identity_heads (user_id, key_version, credential_id) VALUES (?, 'key-1', ?)").bind(userId, `credential-${userId}`),
        db.prepare("INSERT INTO chat_account_vault_wrappers (user_id, key_version, credential_id, nonce, ciphertext, updated_at) VALUES (?, 'key-1', ?, 'nonce', 'private-ciphertext', ?)").bind(userId, `credential-${userId}`, timestamp),
      ]);
    }
    await db.batch([
      db.prepare("INSERT INTO chat_conversations (id, kind, created_by, protocol_version, current_epoch, created_at, updated_at) VALUES ('delete-group', 'group', ?, 'account-v2', 1, ?, ?)").bind(deleteUserId, timestamp, timestamp),
      db.prepare("INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at) VALUES ('delete-group', ?, 'owner', ?)").bind(deleteUserId, timestamp),
      db.prepare("INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at) VALUES ('delete-group', ?, 'member', ?)").bind(student.id, timestamp),
      db.prepare("INSERT INTO chat_conversation_epochs (conversation_id, epoch, created_by, created_at) VALUES ('delete-group', 1, ?, ?)").bind(deleteUserId, timestamp),
      ...[deleteUserId, student.id].map((userId) => db.prepare("INSERT INTO chat_epoch_recipients (conversation_id, epoch, user_id, key_version, ephemeral_public_key, nonce, envelope_ciphertext, created_at) VALUES ('delete-group', 1, ?, 'key-1', 'public', 'nonce', 'encrypted-envelope', ?)").bind(userId, timestamp)),
      db.prepare("INSERT INTO chat_devices (id, user_id, identity_public_key, device_number, registration_id, signed_prekey_id, signed_prekey_public, signed_prekey_signature, created_at, updated_at) VALUES ('delete-device', ?, 'public', 1, 1, 1, 'public', 'signature', ?, ?)").bind(deleteUserId, timestamp, timestamp),
      db.prepare("INSERT INTO chat_messages (id, conversation_id, sender_user_id, client_message_id, protocol_version, content_epoch, ciphertext, attachment_refs, created_at) VALUES ('delete-message', 'delete-group', ?, 'client-delete', 'account-v2', 1, 'target-ciphertext', '[\"target-media\",\"shared-media\"]', ?)").bind(deleteUserId, timestamp),
      db.prepare("INSERT INTO chat_messages (id, conversation_id, sender_user_id, client_message_id, protocol_version, content_epoch, ciphertext, attachment_refs, created_at) VALUES ('peer-message', 'delete-group', ?, 'client-peer', 'account-v2', 1, 'peer-ciphertext', '[\"shared-media\",\"peer-media\"]', ?)").bind(student.id, timestamp),
      db.prepare("INSERT INTO chat_messages (id, conversation_id, sender_device_id, client_message_id, protocol_version, ciphertext, attachment_refs, created_at) VALUES ('delete-legacy-message', 'delete-group', 'delete-device', 'legacy-delete', 'signal-v1', 'legacy-ciphertext', '[\"legacy-media\"]', ?)").bind(timestamp),
      db.prepare("INSERT INTO chat_sync_events (conversation_id, event_type, entity_id, payload_ciphertext, created_at) VALUES ('delete-group', 'message', 'delete-message', 'old-target-ciphertext', ?)").bind(timestamp),
      db.prepare("INSERT INTO auth_passkey_challenges (id, email, challenge, rp_id, origin, expires_at, created_at) VALUES ('email-only-challenge', 'delete@example.com', 'unique-challenge', 'expassway.test', 'https://expassway.test', '2099-01-01T00:00:00Z', ?)").bind(timestamp),
      db.prepare("INSERT INTO email_otp_cooldowns (email_hash, available_at, updated_at) VALUES (?, 9999999999, ?)").bind(Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("delete@example.com"))).toString("hex"), timestamp),
      db.prepare("INSERT INTO ai_call_cooldowns (user_id, reservation_id, called_at) VALUES (?, 'target-ai', ?)").bind(deleteUserId, Date.now()),
    ]);
    for (const [id, owner] of [["target-media", deleteUserId], ["shared-media", deleteUserId], ["peer-media", student.id], ["legacy-media", null], ["pending-media", deleteUserId]]) {
      await db.prepare("INSERT INTO chat_attachments (id, conversation_id, owner_user_id, object_key, size_bytes, size_bucket, status, created_at) VALUES (?, 'delete-group', ?, ?, 20, 'small', 'complete', ?)").bind(id, owner, `chat/${id}`, timestamp).run();
      await chatMediaBucket.put(`chat/${id}`, `encrypted-${id}`);
    }
    const selfDelete = await api(env, adminToken, `/api/admin/users/${admin.id}`, { method: "DELETE" });
    assert.equal(selfDelete.response.status, 409);
    const adminDelete = await api(env, adminToken, `/api/admin/users/${otherAdminId}`, { method: "DELETE" });
    assert.equal(adminDelete.response.status, 403);
    const notConfigured = await api({ ...env, SUPABASE_SERVICE_ROLE_KEY: "" }, adminToken, `/api/admin/users/${deleteUserId}`, { method: "DELETE" });
    assert.equal(notConfigured.response.status, 503);
    assert.equal(supabaseDeletes.length, 0);
    supabaseStatus = 503;
    const rejected = await api(env, adminToken, `/api/admin/users/${deleteUserId}`, { method: "DELETE" });
    assert.equal(rejected.response.status, 502);
    assert.ok(await db.prepare("SELECT id FROM users WHERE id = ?").bind(deleteUserId).first());
    assert.ok(await db.prepare("SELECT id FROM chat_messages WHERE id = 'delete-message'").first());
    assert.ok(await chatMediaBucket.get("chat/target-media"));
    supabaseStatus = 204;
    const deleted = await api(env, adminToken, `/api/admin/users/${deleteUserId}`, { method: "DELETE" });
    assert.equal(deleted.response.status, 200);
    assert.equal(supabaseDeletes.length, 2);
    assert.match(supabaseDeletes[0].url, /supabase-delete$/);
    assert.equal(deleted.payload.data.mediaDeleted, 3);
    assert.equal(deleted.payload.data.mediaCleanupPending, 0);
    assert.equal(await db.prepare("SELECT id FROM users WHERE id = ?").bind(deleteUserId).first(), null);
    assert.equal(await db.prepare("SELECT id FROM chat_messages WHERE id = 'delete-message'").first(), null);
    assert.equal(await db.prepare("SELECT id FROM chat_messages WHERE id = 'delete-legacy-message'").first(), null);
    assert.equal((await db.prepare("SELECT ciphertext FROM chat_messages WHERE id = 'peer-message'").first()).ciphertext, "peer-ciphertext");
    assert.equal(await db.prepare("SELECT id FROM auth_passkey_challenges WHERE id = 'email-only-challenge'").first(), null);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM email_otp_cooldowns").first()).count, 0);
    for (const table of ["chat_passkeys", "chat_account_keys", "chat_account_vault_versions", "chat_account_identity_heads", "chat_account_vault_wrappers", "chat_devices", "ai_call_cooldowns"]) {
      assert.equal((await db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id = ?`).bind(deleteUserId).first()).count, 0);
    }
    assert.ok(await db.prepare("SELECT user_id FROM chat_account_vault_versions WHERE user_id = ?").bind(student.id).first());
    assert.equal((await db.prepare("SELECT role FROM chat_conversation_members WHERE conversation_id = 'delete-group' AND user_id = ?").bind(student.id).first()).role, "owner");
    assert.equal((await db.prepare("SELECT rotation_required FROM chat_conversations WHERE id = 'delete-group'").first()).rotation_required, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_sync_events WHERE event_type = 'deleted'").first()).count, 2);
    assert.equal((await db.prepare("SELECT payload_ciphertext FROM chat_sync_events WHERE entity_id = 'delete-message' AND event_type = 'message'").first()).payload_ciphertext, null);
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_sync_events WHERE event_type = 'remove' AND entity_id = ?").bind(deleteUserId).first()).count, 1);
    for (const id of ["target-media", "legacy-media", "pending-media"]) {
      assert.equal(await chatMediaBucket.get(`chat/${id}`), null);
      assert.equal(await db.prepare("SELECT id FROM chat_attachments WHERE id = ?").bind(id).first(), null);
    }
    assert.ok(await chatMediaBucket.get("chat/shared-media"));
    assert.ok(await chatMediaBucket.get("chat/peer-media"));
    assert.equal((await db.prepare("SELECT owner_user_id FROM chat_attachments WHERE id = 'shared-media'").first()).owner_user_id, null);
    assert.equal((await db.prepare("SELECT owner_user_id FROM chat_attachments WHERE id = 'peer-media'").first()).owner_user_id, student.id);
    const afterDelete = await api(env, adminToken, `/api/admin/users/${deleteUserId}`, { method: "DELETE" });
    assert.equal(afterDelete.response.status, 404);

    // A failed R2 deletion stays queued and cannot prevent the account deletion from completing.
    const retryUserId = "55555555-5555-4555-8555-555555555555";
    await db.prepare("INSERT INTO users (id, email, display_name, role) VALUES (?, 'retry@example.com', 'Retry', 'student')").bind(retryUserId).run();
    await db.prepare("INSERT INTO chat_attachments (id, conversation_id, owner_user_id, object_key, size_bytes, size_bucket, status, created_at) VALUES ('retry-media', 'delete-group', ?, 'chat/retry-media', 20, 'small', 'complete', ?)").bind(retryUserId, timestamp).run();
    await chatMediaBucket.put("chat/retry-media", "encrypted-retry");
    const retryDeleted = await api({ ...env, CHAT_MEDIA_BUCKET: { async delete() { throw new Error("test R2 unavailable"); } } }, adminToken, `/api/admin/users/${retryUserId}`, { method: "DELETE" });
    assert.equal(retryDeleted.response.status, 200);
    assert.equal(retryDeleted.payload.data.mediaCleanupPending, 1);
    assert.equal(await db.prepare("SELECT id FROM users WHERE id = ?").bind(retryUserId).first(), null);
    assert.deepEqual(await db.prepare("SELECT status, owner_user_id FROM chat_attachments WHERE id = 'retry-media'").first(), { status: "deleted", owner_user_id: null });
    assert.ok(await chatMediaBucket.get("chat/retry-media"));
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
