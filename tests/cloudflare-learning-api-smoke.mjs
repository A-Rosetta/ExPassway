import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleAuthApiRequest } from "../cloudflare/auth-api.js";
import { handleLearningApiRequest } from "../cloudflare/learning-api.js";

const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";

async function issueToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    sub: userId,
    email: "admin@example.com",
    role: "admin",
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

async function api(handler, db, token, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body) headers.set("Content-Type", "application/json");
  const response = await handler(new Request(`https://expassway.test${path}`, {
    ...options,
    headers,
  }), { DB: db, AUTH_SECRET });
  return {
    response,
    payload: await response.json().catch(() => null),
  };
}

const mf = new Miniflare({
  compatibilityDate: "2026-07-29",
  d1Databases: { DB: "learning-api-test" },
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});

try {
  const db = await mf.getD1Database("DB");
  for (const file of [
    "../migrations/0001_initial.sql",
    "../migrations/0002_supabase_auth.sql",
    "../migrations/0003_admin_platform.sql",
  ]) {
    const sql = await readFile(new URL(file, import.meta.url), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) {
      await db.prepare(statement).run();
    }
  }

  const userId = "11111111-1111-4111-8111-111111111111";
  const otherUserId = "22222222-2222-4222-8222-222222222222";
  await db.batch([
    db.prepare(`
      INSERT INTO users (id, email, display_name, role, supabase_user_id)
      VALUES (?, 'admin@example.com', 'Admin', 'admin', 'supabase-admin')
    `).bind(userId),
    db.prepare(`
      INSERT INTO users (id, email, display_name, role, supabase_user_id)
      VALUES (?, 'other@example.com', 'Other', 'student', 'supabase-other')
    `).bind(otherUserId),
    db.prepare(`
      INSERT INTO exam_subjects (code, name, name_zh, asset_key)
      VALUES ('0610', 'Biology', '生物', 'biology')
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, skills, hints, images, subject_code, paper_slug,
        question_no, active
      ) VALUES (
        'question-2019', 'CIE', 'IGCSE Biology', 'MCQ', '基础', 'Cells', '2019',
        'Which structure controls the cell?', '["Cell membrane","Nucleus","Cytoplasm","Vacuole"]',
        1, 'concept', '["recall"]', '["Recall the control centre."]', '[]',
        '0610', '0610_s19_qp_21', 1, 1
      )
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, skills, hints, images, subject_code, paper_slug,
        question_no, active
      ) VALUES (
        'question-2024', 'CIE', 'IGCSE Biology', 'MCQ', '基础', 'Cells', '2024',
        'This question must not enter the chapter pool.', '["A","B","C","D"]',
        0, 'concept', '[]', '[]', '[]', '0610', '0610_s24_qp_21', 1, 1
      )
    `),
  ]);
  const token = await issueToken(userId);

  {
    const missing = await api(
      handleLearningApiRequest,
      db,
      "",
      `/api/users/${userId}/practices`
    );
    assert.equal(missing.response.status, 401);
    assert.equal(missing.payload.error.code, "UNAUTHORIZED");

    const forbidden = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/users/${otherUserId}/practices`
    );
    assert.equal(forbidden.response.status, 403);
    assert.equal(forbidden.payload.error.code, "FORBIDDEN");
  }

  {
    const updated = await api(handleAuthApiRequest, db, token, "/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({
        displayName: "Agent R",
        grade: "IGCSE",
        targetScore: 90,
        language: "en",
      }),
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.payload.data.displayName, "Agent R");
    assert.equal(updated.payload.data.targetScore, 90);

    const pet = await api(handleAuthApiRequest, db, token, "/api/auth/me/pet", {
      method: "PATCH",
      body: JSON.stringify({
        enabled: false,
        skin: "codex-glass",
        position: { x: 0.1, y: 0.2 },
      }),
    });
    assert.equal(pet.response.status, 200);
    assert.deepEqual(pet.payload.data, {
      enabled: false,
      skin: "codex-glass",
      position: { x: 0.1, y: 0.2 },
    });
  }

  let notebookEntryId;
  {
    const submitted = await api(handleLearningApiRequest, db, token, "/api/papers/submit-local", {
      method: "POST",
      body: JSON.stringify({
        userId,
        selection: {
          grade: "IGCSE",
          board: "CIE",
          subject: "IGCSE Biology",
          paper: "MCQ",
        },
        questions: [{ id: "question-2019" }],
        answers: [{ selectedIndex: 0, hintsUsed: 1 }],
        language: "en",
      }),
    });
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.payload.data.result.wrong, 1);
    assert.equal(submitted.payload.data.result.hintUsedQuestions, 1);
    assert.equal(submitted.payload.data.analysis.hintRate, 100);

    const history = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/users/${userId}/practices?limit=20`
    );
    assert.equal(history.response.status, 200);
    assert.equal(history.payload.data.length, 1);
    assert.equal(history.payload.data[0].status, "submitted");

    const notebook = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/users/${userId}/notebook`
    );
    assert.equal(notebook.response.status, 200);
    assert.equal(notebook.payload.data.length, 1);
    assert.equal(notebook.payload.data[0].wrongCount, 1);
    // No syllabus mapping exists yet at this point, so the entry must come back
    // with syllabus = null rather than a partly-filled object - the front end
    // switches to its paper/difficulty fallback on exactly this.
    assert.equal(notebook.payload.data[0].syllabus, null);
    assert.equal(notebook.payload.data[0].questionNo, 1);
    notebookEntryId = notebook.payload.data[0].id;

    const mastered = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/users/${userId}/notebook/${notebookEntryId}`,
      { method: "PATCH", body: JSON.stringify({ mastered: true }) }
    );
    assert.equal(mastered.response.status, 200);
    assert.equal(mastered.payload.data.mastered, true);
  }

  await db.batch([
    db.prepare(`
      INSERT INTO curriculum_versions (
        id, subject_code, qualification, exam_year_start, exam_year_end, version, active
      ) VALUES ('bio-version', '0610', 'IGCSE', 2026, 2028, '2026-2028', 1)
    `),
    db.prepare(`
      INSERT INTO curriculum_sections (
        id, curriculum_version_id, syllabus_code, title_en, title_zh,
        level, core_level, sort_order
      ) VALUES (
        'syllabus-section', 'bio-version', 'B1.1', 'Cells', '细胞',
        'statement', 'core', 1
      )
    `),
    db.prepare(`
      INSERT INTO coursebook_chapters (
        id, book_key, chapter_no, title_en, title_zh, sort_order
      ) VALUES ('chapter-1', 'biology-4e', 1, 'Cells', '细胞', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_sections (
        id, coursebook_chapter_id, section_code, title_en, title_zh, sort_order
      ) VALUES ('book-section', 'chapter-1', '1.1', 'Cell structure', '细胞结构', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_section_mappings (coursebook_section_id, curriculum_section_id)
      VALUES ('book-section', 'syllabus-section')
    `),
    db.prepare(`
      INSERT INTO question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, source
      ) VALUES ('question-2019', 'syllabus-section', 'book-section', 1, 1, 'reviewed', 'manual')
    `),
    db.prepare(`
      INSERT INTO question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, source
      ) VALUES ('question-2024', 'syllabus-section', 'book-section', 1, 1, 'reviewed', 'manual')
    `),
  ]);

  async function createChapterSession() {
    return api(handleLearningApiRequest, db, token, "/api/chapter-practice/sessions", {
      method: "POST",
      body: JSON.stringify({
        curriculumVersion: "bio-version",
        coursebookSectionId: "book-section",
        count: 10,
      }),
    });
  }

  {
    const created = await createChapterSession();
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.questions.length, 1);
    assert.equal(created.payload.data.questions[0].id, "question-2019");
    assert.equal("answer" in created.payload.data.questions[0], false);

    const submitted = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/chapter-practice/sessions/${created.payload.data.sessionId}/submit`,
      {
        method: "POST",
        body: JSON.stringify({
          answers: [{ selectedIndex: 0, elapsedSeconds: 12, hintsUsed: 0 }],
        }),
      }
    );
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.payload.data.details[0].firstExposure, true);
    assert.equal(submitted.payload.data.details[0].correct, false);

    const replay = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/chapter-practice/sessions/${created.payload.data.sessionId}/submit`,
      {
        method: "POST",
        body: JSON.stringify({ answers: [{ selectedIndex: 1 }] }),
      }
    );
    assert.equal(replay.response.status, 409);
    assert.equal(replay.payload.error.code, "PRACTICE_ALREADY_SUBMITTED");
  }

  {
    const created = await createChapterSession();
    const submitted = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/chapter-practice/sessions/${created.payload.data.sessionId}/submit`,
      {
        method: "POST",
        body: JSON.stringify({
          answers: [{ selectedIndex: 1, elapsedSeconds: 8, hintsUsed: 0 }],
        }),
      }
    );
    assert.equal(submitted.response.status, 200);
    assert.equal(submitted.payload.data.details[0].firstExposure, false);
    assert.equal(submitted.payload.data.details[0].correct, true);

    const catalog = await api(
      handleLearningApiRequest,
      db,
      token,
      "/api/curriculum/0610/chapters"
    );
    assert.equal(catalog.response.status, 200);
    const progress = catalog.payload.data.chapters[0].sections[0].progress;
    assert.equal(progress.availableQuestions, 1);
    assert.equal(progress.unseenQuestions, 0);
    assert.equal(progress.firstAttempts, 1);
    assert.equal(progress.firstAccuracy, 0);
    assert.equal(progress.reviewAttempts, 1);
    assert.equal(progress.reviewAccuracy, 100);
    assert.equal(progress.needsReview, 0);
  }

  {
    const cleared = await api(
      handleLearningApiRequest,
      db,
      token,
      `/api/users/${userId}/practices`,
      { method: "DELETE" }
    );
    assert.equal(cleared.response.status, 200);
    assert.equal(cleared.payload.data.deleted, 3);
    assert.equal(cleared.payload.data.deletedNotebook, 1);
    const counts = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM practice_sessions WHERE user_id = ?) AS practices,
        (SELECT COUNT(*) FROM wrong_notebook_entries WHERE user_id = ?) AS notebook,
        (SELECT COUNT(*) FROM question_attempts WHERE user_id = ?) AS attempts
    `).bind(userId, userId, userId).first();
    assert.deepEqual(counts, { practices: 0, notebook: 0, attempts: 0 });
  }

  // The notebook select resolves a real syllabus topic and rolls statement-level
  // mappings up to the topic level. Nothing above covers the walk itself: the
  // questions mapped earlier point at a parentless statement, which only
  // exercises the rollup's fallback branch.
  {
    await db.batch([
      db.prepare(`
        INSERT INTO curriculum_sections (
          id, curriculum_version_id, syllabus_code, title_en, title_zh, level, sort_order
        ) VALUES ('sec-topic', 'bio-version', 'B4', 'Respiration', '呼吸作用', 'topic', 10)
      `),
      db.prepare(`
        INSERT INTO curriculum_sections (
          id, curriculum_version_id, syllabus_code, title_en, title_zh, level, parent_id, sort_order
        ) VALUES ('sec-section', 'bio-version', 'B4.1', 'Aerobic respiration', '有氧呼吸', 'section', 'sec-topic', 11)
      `),
      db.prepare(`
        INSERT INTO curriculum_sections (
          id, curriculum_version_id, syllabus_code, title_en, title_zh, level, parent_id, sort_order
        ) VALUES ('sec-statement', 'bio-version', 'B4.1.2', 'State the equation', '写出方程式', 'statement', 'sec-section', 12)
      `),
      db.prepare(`
        INSERT INTO question_bank (
          id, board, subject, paper, topic, year, stem, options, answer,
          mistake_type, skills, hints, images, subject_code, paper_slug, question_no, active
        ) VALUES (
          'question-mapped', 'CIE', 'IGCSE Biology', 'MCQ', 'Past Paper Summer', '2023',
          'Respiration question.', '["A","B","C","D"]', 0, 'concept', '[]', '[]', '[]',
          '0610', '0610_s23_qp_21', 20, 1
        )
      `),
      db.prepare(`
        INSERT INTO question_bank (
          id, board, subject, paper, topic, year, stem, options, answer,
          mistake_type, skills, hints, images, subject_code, paper_slug, question_no, active
        ) VALUES (
          'question-suggested', 'CIE', 'IGCSE Chemistry', 'MCQ', 'Past Paper March', '2023',
          'Unreviewed mapping question.', '["A","B","C","D"]', 0, 'concept', '[]', '[]', '[]',
          '0620', '0620_m23_qp_21', 7, 1
        )
      `),
      db.prepare(`
        INSERT INTO question_section_mappings (
          question_id, curriculum_section_id, is_primary, confidence, status, source
        ) VALUES ('question-mapped', 'sec-statement', 1, 1, 'reviewed', 'manual')
      `),
      // 'suggested' is the unreviewed model/rule queue behind the admin review
      // page. Surfacing it would label questions with topics nobody checked.
      db.prepare(`
        INSERT INTO question_section_mappings (
          question_id, curriculum_section_id, is_primary, confidence, status, source
        ) VALUES ('question-suggested', 'sec-statement', 1, 0.9, 'suggested', 'model')
      `),
      db.prepare(`
        INSERT INTO wrong_notebook_entries (id, user_id, question_key, paper, topic)
        VALUES ('entry-mapped', ?, 'question-mapped', 'MCQ', 'Past Paper Summer')
      `).bind(userId),
      db.prepare(`
        INSERT INTO wrong_notebook_entries (id, user_id, question_key, paper, topic)
        VALUES ('entry-suggested', ?, 'question-suggested', 'MCQ', 'Past Paper March')
      `).bind(userId),
    ]);

    const notebook = await api(handleLearningApiRequest, db, token, `/api/users/${userId}/notebook`);
    assert.equal(notebook.response.status, 200);
    const entries = Object.fromEntries(notebook.payload.data.map((row) => [row.id, row]));

    // Walked up two parents: the answer is the topic B4, not the statement
    // B4.1.2 the mapping actually points at. One statement per question would
    // put every question in its own group and break the plan just as badly as
    // the exam season did.
    assert.deepEqual(entries["entry-mapped"].syllabus, {
      code: "B4",
      titleEn: "Respiration",
      titleZh: "呼吸作用",
    });
    assert.equal(entries["entry-mapped"].questionNo, 20);

    // Same statement, but an unreviewed mapping, so it must not resolve.
    assert.equal(entries["entry-suggested"].syllabus, null);
    assert.equal(entries["entry-suggested"].questionNo, 7);
  }

  const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(foreignKeys.results, []);
  console.log("Cloudflare D1 learning API smoke checks passed.");
} finally {
  await mf.dispose();
}
