import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleContentRequest, handleQuestionHintRequest } from "../cloudflare/content-api.js";

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
  for (const file of ["../migrations/0001_initial.sql", "../migrations/0002_supabase_auth.sql"]) {
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
        ('missing-question', 'CIE', 'IGCSE Biology', 'MCQ', '2023', 'Missing', '["A","B","C","D"]', 0, '[]', '0610', '0610_s23_qp_22', 3)
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
  const env = { DB: db, CONTENT_BUCKET: bucket, AUTH_SECRET };

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
    assert.equal(missing.payload.error.code, "AI_HINTS_UNAVAILABLE");

    const unknown = await hint("unknown-question");
    assert.equal(unknown.response.status, 404);
    assert.equal(unknown.payload.error.code, "QUESTION_NOT_FOUND");
  }

  console.log("Cloudflare R2 content and D1 hint API smoke checks passed.");
} finally {
  await mf.dispose();
}
