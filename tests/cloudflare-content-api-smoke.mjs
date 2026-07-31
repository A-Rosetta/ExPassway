import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleContentRequest, handleQuestionHintRequest } from "../cloudflare/content-api.js";
import { handleReadApiRequest } from "../cloudflare/read-api.js";

const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";
const RELEASE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

async function json(response) {
  return response.json().catch(() => null);
}

const mf = new Miniflare({
  compatibilityDate: "2026-07-29",
  d1Databases: { DB: "content-api-test" },
  r2Buckets: { CONTENT_BUCKET: "content-test" },
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});

try {
  const db = await mf.getD1Database("DB");
  const bucket = await mf.getR2Bucket("CONTENT_BUCKET");
  for (const file of [
    "../migrations/0001_initial.sql",
    "../migrations/0002_supabase_auth.sql",
    "../migrations/0003_admin_platform.sql",
  ]) {
    const sql = await readFile(new URL(file, import.meta.url), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
  }
  const user = { id: "11111111-1111-4111-8111-111111111111", email: "student@example.com", role: "student" };
  await db.batch([
    db.prepare(`
      INSERT INTO users (id, email, display_name, role, supabase_user_id)
      VALUES (?, ?, 'Student', 'student', 'supabase-student')
    `).bind(user.id, user.email),
    db.prepare("INSERT INTO exam_subjects (code, name, asset_key) VALUES ('0610', 'Biology', 'biology-0610')"),
    db.prepare(`
      INSERT INTO exam_papers (
        slug, subject_code, year, season, paper_number, variant,
        qp_file_name, ms_file_name, status
      ) VALUES
        ('0610_s23_qp_22', '0610', 2023, 's', 2, 2, '0610_s23_qp_22.pdf', '0610_s23_ms_22.pdf', 'published'),
        ('0610_w23_qp_22', '0610', 2023, 'w', 2, 2, '0610_w23_qp_22.pdf', '0610_w23_ms_22.pdf', 'draft')
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, year, stem, options, answer,
        hints, subject_code, paper_slug, question_no
      ) VALUES
        ('approved-question', 'CIE', 'IGCSE Biology', 'MCQ', '2023', 'Approved', '["A","B","C","D"]', 0, '["Fallback"]', '0610', '0610_s23_qp_22', 1),
        ('fallback-question', 'CIE', 'IGCSE Biology', 'MCQ', '2023', 'Fallback', '["A","B","C","D"]', 0, '["First","Second"]', '0610', '0610_s23_qp_22', 2),
        ('missing-question', 'CIE', 'IGCSE Biology', 'MCQ', '2023', 'Missing', '["A","B","C","D"]', 0, '[]', '0610', '0610_s23_qp_22', 3),
        ('versioned-question', 'CIE', 'IGCSE Biology', 'MCQ', '2023', 'Versioned image', '["A","B","C","D"]', 0, '[]', '0610', '0610_s23_qp_22', 4)
    `),
    db.prepare(`
      INSERT INTO question_hint_sets (
        id, question_id, language, prompt_version, question_fingerprint,
        hints, status, model
      ) VALUES (
        'approved-hints', 'approved-question', 'en', 'igcse-progressive-v1',
        'fingerprint', '["Approved one","Approved two"]', 'approved', 'test-model'
      )
    `),
  ]);
  await bucket.put("papers/0610_s23_qp_22/qp.pdf", Buffer.from("%PDF-1.4\n%%EOF\n"), {
    httpMetadata: { contentType: "application/pdf" },
  });
  await bucket.put("question-images/cie-igcse-biology-0610/0610_s23_qp_22/q01.png", Buffer.from("image"), {
    httpMetadata: { contentType: "image/png" },
  });
  await bucket.put("question-data/cie-igcse-biology-0610/data/0610_s23_qp_22.json", "{}", {
    httpMetadata: { contentType: "application/json" },
  });
  const releaseImagePath = `releases/${RELEASE_ID}/question-images/cie-igcse-biology-0610/0610_s23_qp_22/q04.png`;
  await bucket.put(releaseImagePath, Buffer.from("versioned-image"), {
    httpMetadata: { contentType: "image/png" },
  });
  await db.prepare("UPDATE question_bank SET images = ? WHERE id = 'versioned-question'")
    .bind(JSON.stringify([{ url: `/api/content/question-images/cie-igcse-biology-0610/releases/${RELEASE_ID}/0610_s23_qp_22/q04.png` }])).run();
  const env = {
    DB: db,
    CONTENT_BUCKET: bucket,
    AUTH_SECRET,
    OPENAI_API_KEY: "test-openai-key",
    OPENAI_HINT_MODEL: "test-hint-model",
  };

  {
    const response = await handleContentRequest(new Request(
      "https://expassway.test/api/catalog/papers/0610_s23_qp_22/download/qp"
    ), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/pdf");
    assert.match(response.headers.get("content-disposition"), /0610_s23_qp_22\.pdf/);
    assert.equal(Buffer.from(await response.arrayBuffer()).subarray(0, 5).toString(), "%PDF-");

    const head = await handleContentRequest(new Request(
      "https://expassway.test/api/catalog/papers/0610_s23_qp_22/download/qp",
      { method: "HEAD" }
    ), env);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");

    const missing = await handleContentRequest(new Request(
      "https://expassway.test/api/catalog/papers/0610_s23_qp_22/download/ms"
    ), env);
    assert.equal(missing.status, 404);
    assert.equal((await json(missing)).error.code, "PDF_NOT_FOUND");

    const draft = await handleContentRequest(new Request(
      "https://expassway.test/api/catalog/papers/0610_w23_qp_22/download/qp"
    ), env);
    assert.equal(draft.status, 404);
    assert.equal((await json(draft)).error.code, "PAPER_NOT_FOUND");

    const invalid = await handleContentRequest(new Request(
      "https://expassway.test/api/content/question-images/cie-igcse-biology-0610/not-valid.png"
    ), env);
    assert.equal(invalid.status, 404);

    for (const path of [
      "/api/content/question-images/cie-igcse-biology-0610/0610_s23_qp_22/q01.png",
      "/api/content/question-data/cie-igcse-biology-0610/data/0610_s23_qp_22.json",
    ]) {
      const asset = await handleContentRequest(new Request(`https://expassway.test${path}`), env);
      assert.equal(asset.status, 200);
    }

    await bucket.put(`releases/${RELEASE_ID}/papers/0610_s23_qp_22/qp.pdf`, Buffer.from("%PDF-release\n"), {
      httpMetadata: { contentType: "application/pdf" },
    });
    await db.prepare("UPDATE exam_papers SET metadata = ? WHERE slug = '0610_s23_qp_22'")
      .bind(JSON.stringify({ contentPrefix: `releases/${RELEASE_ID}` })).run();
    const versionedPaper = await handleContentRequest(new Request(
      "https://expassway.test/api/catalog/papers/0610_s23_qp_22/download/qp"
    ), env);
    assert.equal(versionedPaper.status, 200);
    assert.equal(await versionedPaper.text(), "%PDF-release\n");

    const versionedAsset = await handleContentRequest(new Request(
      `https://expassway.test/api/content/question-images/cie-igcse-biology-0610/releases/${RELEASE_ID}/0610_s23_qp_22/q04.png`
    ), env);
    assert.equal(versionedAsset.status, 200);
    assert.equal(await versionedAsset.text(), "versioned-image");

    const staleReleaseId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await bucket.put(`releases/${staleReleaseId}/question-images/cie-igcse-biology-0610/0610_s23_qp_22/q04.png`, "stale");
    const staleRelease = await handleContentRequest(new Request(
      `https://expassway.test/api/content/question-images/cie-igcse-biology-0610/releases/${staleReleaseId}/0610_s23_qp_22/q04.png`
    ), env);
    assert.equal(staleRelease.status, 404);
  }

  const token = await issueToken(user);
  async function hint(questionId, language = "en") {
    const response = await handleQuestionHintRequest(new Request(
      `https://expassway.test/api/question-hints/${questionId}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      }
    ), env);
    return { response, payload: await json(response) };
  }

  {
    const unauthenticated = await handleQuestionHintRequest(new Request(
      "https://expassway.test/api/question-hints/approved-question",
      { method: "POST", body: "{}" }
    ), env);
    assert.equal(unauthenticated.status, 401);

    const approved = await hint("approved-question");
    assert.equal(approved.response.status, 200);
    assert.deepEqual(approved.payload.data.hints, ["Approved one", "Approved two"]);
    assert.equal(approved.payload.data.source, "cache");

    const fallback = await hint("fallback-question");
    assert.equal(fallback.response.status, 200);
    assert.deepEqual(fallback.payload.data.hints, ["First", "Second"]);
    assert.equal(fallback.payload.data.source, "question-bank");

    const missing = await hint("missing-question");
    assert.equal(missing.response.status, 503);
    assert.equal(missing.payload.error.code, "AI_HINTS_DISABLED");

    const unknown = await hint("unknown-question");
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.payload.error.code, "QUESTION_NOT_FOUND");

    await db.prepare("UPDATE app_settings SET value = 'true' WHERE key = 'ai_hint_live_generation'").run();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "https://api.openai.com/v1/responses");
      return Response.json({
        id: "response-test",
        output_text: JSON.stringify({ hints: [
          "Inspect the information shown in the diagram.",
          "Compare each choice with the relevant biological concept.",
          "Use the remaining evidence to decide which choice fits best.",
        ] }),
      });
    };
    try {
      const generated = await hint("versioned-question");
      assert.equal(generated.response.status, 200);
      assert.equal(generated.payload.data.source, "generated");
      assert.equal(generated.payload.data.hints.length, 3);
    } finally {
      globalThis.fetch = originalFetch;
    }

    await db.prepare("DELETE FROM ai_hint_generation_events WHERE user_id = ?").bind(user.id).run();
    for (let index = 0; index < 9; index += 1) {
      await db.prepare(`
        INSERT INTO ai_hint_generation_events (id, user_id, question_id, language)
        VALUES (?, ?, 'missing-question', 'en')
      `).bind(`rate-event-${index}`, user.id).run();
    }
    const tenthAttempt = await hint("missing-question");
    assert.equal(tenthAttempt.response.status, 422);
    assert.equal(tenthAttempt.payload.error.code, "QUESTION_IMAGE_UNAVAILABLE");
    const eventsAfterFailure = await db.prepare("SELECT COUNT(*) AS count FROM ai_hint_generation_events WHERE user_id = ?")
      .bind(user.id).first();
    assert.equal(eventsAfterFailure.count, 9);
    await db.prepare(`
      INSERT INTO ai_hint_generation_events (id, user_id, question_id, language)
      VALUES ('rate-event-9', ?, 'missing-question', 'en')
    `).bind(user.id).run();
    const eleventhAttempt = await hint("missing-question");
    assert.equal(eleventhAttempt.response.status, 429);
    assert.equal(eleventhAttempt.payload.error.code, "AI_HINT_RATE_LIMITED");

    await db.prepare("UPDATE exam_subjects SET active = 0 WHERE code = '0610'").run();
    const disabledSubjects = await handleReadApiRequest(new Request(
      "https://expassway.test/api/catalog/subjects"
    ), env);
    assert.deepEqual((await json(disabledSubjects)).data, []);
    const disabledQuestion = await handleReadApiRequest(new Request(
      "https://expassway.test/api/questions/versioned-question"
    ), env);
    assert.equal(disabledQuestion.status, 404);
    const disabledPaper = await handleContentRequest(new Request(
      "https://expassway.test/api/catalog/papers/0610_s23_qp_22/download/qp"
    ), env);
    assert.equal(disabledPaper.status, 404);
    const disabledAsset = await handleContentRequest(new Request(
      `https://expassway.test/api/content/question-images/cie-igcse-biology-0610/releases/${RELEASE_ID}/0610_s23_qp_22/q04.png`
    ), env);
    assert.equal(disabledAsset.status, 404);
    const disabledHint = await hint("versioned-question");
    assert.equal(disabledHint.response.status, 404);
    assert.equal(disabledHint.payload.error.code, "QUESTION_NOT_FOUND");
  }

  console.log("Cloudflare R2 content and D1 hint API smoke checks passed.");
} finally {
  await mf.dispose();
}
