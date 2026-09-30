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
    "../migrations/0011_saved_papers.sql",
  ]) {
    const sql = await readFile(new URL(file, import.meta.url), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) {
      await db.prepare(statement).run();
    }
  }

  const savedPaperColumns = await db.prepare("PRAGMA table_info(saved_papers)").all();
  assert.deepEqual(
    savedPaperColumns.results.map((column) => column.name),
    [
      "id", "user_id", "paper_code", "title", "subject_code",
      "curriculum_version_id", "build_mode", "build_seed", "status",
      "question_count", "total_marks", "settings", "blueprint",
      "parent_paper_id", "created_at", "updated_at",
    ],
  );
  const savedItemColumns = await db.prepare("PRAGMA table_info(saved_paper_items)").all();
  assert.deepEqual(
    savedItemColumns.results.map((column) => column.name),
    ["paper_id", "question_id", "position", "marks", "section_id", "source_group", "created_at"],
  );

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
      INSERT INTO exam_papers (
        slug, subject_code, year, season, paper_number, variant,
        duration_minutes, source_question_count, valid_question_count,
        qp_file_name, ms_file_name, status
      ) VALUES (
        '0610_s19_qp_21', '0610', 2019, 's', 2, 1,
        45, 40, 40, '0610_s19_qp_21.pdf', '0610_s19_ms_21.pdf', 'published'
      )
    `),
    db.prepare(`
      INSERT INTO exam_papers (
        slug, subject_code, year, season, paper_number, variant,
        duration_minutes, source_question_count, valid_question_count,
        qp_file_name, ms_file_name, status
      ) VALUES (
        '0610_s23_qp_21', '0610', 2023, 's', 2, 1,
        45, 40, 40, '0610_s23_qp_21.pdf', '0610_s23_ms_21.pdf', 'published'
      )
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, skills, hints, images, subject_code, paper_slug,
        question_no, active
      ) VALUES (
        'question-2019', 'CIE', 'IGCSE Biology', 'MCQ', '基础', 'Cells', '2019',
        'Which structure controls the cell?', '["Cell membrane","Nucleus","Cytoplasm","Vacuole"]',
        1, 'concept', '["recall"]', '["Recall the control centre."]', '[{"url":"/assets/test/q01.png"}]',
        '0610', '0610_s19_qp_21', 1, 1
      )
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, skills, hints, images, subject_code, paper_slug,
        question_no, active
      ) VALUES (
        'question-2023', 'CIE', 'IGCSE Biology', 'MCQ', '基础', 'Cells', '2023',
        'Which structure contains genetic material?', '["Cell wall","Nucleus","Cytoplasm","Vacuole"]',
        1, 'concept', '["recall"]', '[]', '[{"url":"/assets/test/q02.png"}]',
        '0610', '0610_s23_qp_21', 2, 1
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
        0, 'concept', '[]', '[]', '[]', '0610', '0610_s24_qp_21', 1, 0
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
      INSERT INTO curriculum_sections (
        id, curriculum_version_id, syllabus_code, title_en, title_zh,
        level, core_level, sort_order
      ) VALUES (
        'syllabus-section-2', 'bio-version', 'B1.2', 'Cell division', '细胞分裂',
        'statement', 'core', 2
      )
    `),
    db.prepare(`
      INSERT INTO coursebook_sections (
        id, coursebook_chapter_id, section_code, title_en, title_zh, sort_order
      ) VALUES ('book-section-2', 'chapter-1', '1.2', 'Cell division', '细胞分裂', 2)
    `),
    db.prepare(`
      INSERT INTO coursebook_section_mappings (coursebook_section_id, curriculum_section_id)
      VALUES ('book-section-2', 'syllabus-section-2')
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
    db.prepare(`
      INSERT INTO question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, source
      ) VALUES ('question-2023', 'syllabus-section-2', 'book-section-2', 1, 1, 'reviewed', 'manual')
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, skills, hints, images, subject_code, paper_slug,
        question_no, active
      ) VALUES (
        'question-pending', 'CIE', 'IGCSE Biology', 'MCQ', 'foundation', 'Cells', '2023',
        'This mapping has not been reviewed.', '["A","B","C","D"]',
        0, 'concept', '[]', '[]', '[{"url":"/assets/test/pending.png"}]',
        '0610', '0610_s23_qp_21', 3, 1
      )
    `),
    db.prepare(`
      INSERT INTO question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, source
      ) VALUES ('question-pending', 'syllabus-section', 'book-section', 1, 0.6, 'suggested', 'rule')
    `),
  ]);

  {
    const search = await api(
      handleLearningApiRequest,
      db,
      token,
      "/api/paper-builder/questions?subjectCode=0610&page=1&pageSize=20"
    );
    assert.equal(search.response.status, 200);
    assert.ok(search.payload.data.items.some((item) => item.id === "question-2019"));
    assert.ok(search.payload.data.items.some((item) => item.id === "question-pending"));
    assert.ok(search.payload.data.items.every((item) => item.id !== "question-2024"));
    assert.equal(search.payload.data.page, 1);
    assert.equal(search.payload.data.pageSize, 20);

    const reviewedSection = await api(
      handleLearningApiRequest,
      db,
      token,
      "/api/paper-builder/questions?subjectCode=0610&sectionId=book-section"
    );
    assert.equal(reviewedSection.response.status, 200);
    assert.deepEqual(reviewedSection.payload.data.items.map((item) => item.id), ["question-2019"]);
    assert.equal(reviewedSection.payload.data.items[0].estimatedSeconds, 67.5);
    assert.equal(reviewedSection.payload.data.items[0].mappingStatus, "reviewed");

    const filtered = await api(
      handleLearningApiRequest,
      db,
      token,
      "/api/paper-builder/questions?subjectCode=0610&year=2023&season=s&paperNumber=2&variant=1&questionNo=2"
    );
    assert.deepEqual(filtered.payload.data.items.map((item) => item.id), ["question-2023"]);

    const badPageSize = await api(
      handleLearningApiRequest,
      db,
      token,
      "/api/paper-builder/questions?subjectCode=0610&pageSize=101"
    );
    assert.equal(badPageSize.response.status, 400);
    assert.equal(badPageSize.payload.error.code, "INVALID_INPUT");

    const unauthorizedSearch = await api(
      handleLearningApiRequest,
      db,
      "",
      "/api/paper-builder/questions?subjectCode=0610"
    );
    assert.equal(unauthorizedSearch.response.status, 401);
  }

  {
    const subjects = await api(handleLearningApiRequest, db, token, "/api/curriculum/subjects");
    assert.equal(subjects.response.status, 200);
    assert.deepEqual(subjects.payload.data.map((subject) => subject.code), ["0610"]);

    const generated = await api(handleLearningApiRequest, db, token, "/api/paper-builder/generate", {
      method: "POST",
      body: JSON.stringify({
        curriculumVersion: "bio-version",
        sections: [
          { coursebookSectionId: "book-section", count: 1 },
          { coursebookSectionId: "book-section-2", count: 1 },
        ],
      }),
    });
    assert.equal(generated.response.status, 201);
    assert.deepEqual(generated.payload.data.groups.map((group) => group.questions[0].id), [
      "question-2019",
      "question-2023",
    ]);
    assert.deepEqual(generated.payload.data.groups.map((group) => group.questions[0].answer), [1, 1]);
    assert.equal(generated.payload.data.groups[0].questions[0].images[0].url, "/assets/test/q01.png");

    const shortage = await api(handleLearningApiRequest, db, token, "/api/paper-builder/generate", {
      method: "POST",
      body: JSON.stringify({
        curriculumVersion: "bio-version",
        sections: [{ coursebookSectionId: "book-section-2", count: 2 }],
      }),
    });
    assert.equal(shortage.response.status, 409);
    assert.equal(shortage.payload.error.code, "INSUFFICIENT_QUESTIONS");

    const unauthorized = await api(handleLearningApiRequest, db, "", "/api/paper-builder/generate", {
      method: "POST",
      body: JSON.stringify({ curriculumVersion: "bio-version", sections: [] }),
    });
    assert.equal(unauthorized.response.status, 401);
  }

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

  await db.batch([
    db.prepare(`
      INSERT INTO exam_subjects (code, name, name_zh, asset_key)
      VALUES ('0620', 'Chemistry', '化学', 'chemistry')
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, skills, hints, images, subject_code, paper_slug,
        question_no, active
      ) VALUES (
        'chemistry-question', 'CIE', 'IGCSE Chemistry', 'MCQ', 'foundation', 'Atoms', '2023',
        'Which particle is in the nucleus?', '["Electron","Proton","Ion","Molecule"]',
        1, 'concept', '[]', '[]', '[]', '0620', '0620_s23_qp_21', 1, 1
      )
    `),
    db.prepare(`
      INSERT INTO curriculum_versions (
        id, subject_code, qualification, exam_year_start, exam_year_end, version, active
      ) VALUES ('chem-version', '0620', 'IGCSE', 2023, 2025, '2023-2025', 1)
    `),
    db.prepare(`
      INSERT INTO curriculum_sections (
        id, curriculum_version_id, syllabus_code, title_en, title_zh,
        level, core_level, sort_order
      ) VALUES ('chem-syllabus', 'chem-version', '2', 'Atoms', '原子', 'topic', 'core', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_chapters (
        id, book_key, chapter_no, title_en, title_zh, sort_order
      ) VALUES ('chem-chapter', 'chemistry', 1, 'Atoms', '原子', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_sections (
        id, coursebook_chapter_id, section_code, title_en, title_zh, sort_order
      ) VALUES ('chem-section', 'chem-chapter', '2', 'Atoms', '原子', 1)
    `),
    db.prepare(`
      INSERT INTO coursebook_section_mappings (coursebook_section_id, curriculum_section_id)
      VALUES ('chem-section', 'chem-syllabus')
    `),
    db.prepare(`
      INSERT INTO question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, source
      ) VALUES ('chemistry-question', 'chem-syllabus', 'chem-section', 1, 1, 'reviewed', 'manual')
    `),
  ]);

  {
    const catalog = await api(handleLearningApiRequest, db, token, "/api/curriculum/0620/chapters");
    assert.equal(catalog.response.status, 200);
    assert.equal(catalog.payload.data.chapters[0].sections[0].progress.availableQuestions, 1);

    const created = await api(handleLearningApiRequest, db, token, "/api/chapter-practice/sessions", {
      method: "POST",
      body: JSON.stringify({ curriculumVersion: "chem-version", coursebookSectionId: "chem-section", count: 10 }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.questions[0].id, "chemistry-question");
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
    assert.equal(cleared.payload.data.deleted, 4);
    assert.equal(cleared.payload.data.deletedNotebook, 1);
    const counts = await db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM practice_sessions WHERE user_id = ?) AS practices,
        (SELECT COUNT(*) FROM wrong_notebook_entries WHERE user_id = ?) AS notebook,
        (SELECT COUNT(*) FROM question_attempts WHERE user_id = ?) AS attempts
    `).bind(userId, userId, userId).first();
    assert.deepEqual(counts, { practices: 0, notebook: 0, attempts: 0 });
  }

  const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(foreignKeys.results, []);
  console.log("Cloudflare D1 learning API smoke checks passed.");
} finally {
  await mf.dispose();
}
