import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import {
  handleCommunityApiRequest,
  handleCommunityImageRequest,
} from "../cloudflare/community-api.js";

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
  const response = await handleCommunityApiRequest(new Request(`https://expassway.test${path}`, {
    ...options,
    headers,
  }), env);
  return { response, payload: await response.json().catch(() => null) };
}

const mf = new Miniflare({
  compatibilityDate: "2026-07-29",
  d1Databases: { DB: "community-api-test" },
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
    for (const statement of unstable_splitSqlQuery(sql)) {
      await db.prepare(statement).run();
    }
  }
  const users = {
    admin: { id: "11111111-1111-4111-8111-111111111111", email: "admin@example.com", role: "admin" },
    student: { id: "22222222-2222-4222-8222-222222222222", email: "student@example.com", role: "student" },
    other: { id: "33333333-3333-4333-8333-333333333333", email: "other@example.com", role: "student" },
  };
  await db.batch([
    ...Object.entries(users).map(([name, user]) => db.prepare(`
      INSERT INTO users (id, email, display_name, role, supabase_user_id)
      VALUES (?, ?, ?, ?, ?)
    `).bind(user.id, user.email, name, user.role, `supabase-${name}`)),
    db.prepare(`
      INSERT INTO exam_subjects (code, name, asset_key) VALUES ('0610', 'Biology', 'biology')
    `),
    db.prepare(`
      INSERT INTO exam_papers (
        slug, subject_code, year, season, paper_number, variant, qp_file_name, ms_file_name
      ) VALUES ('0610_s23_qp_22', '0610', 2023, 's', 2, 2, 'qp.pdf', 'ms.pdf')
    `),
    db.prepare(`
      INSERT INTO question_bank (
        id, board, subject, paper, topic, year, stem, options, answer,
        subject_code, paper_slug, question_no
      ) VALUES (
        'CIE-IGCSE-0610-0610_s23_qp_22-01', 'CIE', 'IGCSE Biology', 'MCQ',
        'Cells', '2023', 'What is the control centre?', '["A","B","C","D"]', 1,
        '0610', '0610_s23_qp_22', 1
      )
    `),
  ]);
  const env = { DB: db, CONTENT_BUCKET: bucket, AUTH_SECRET };
  const tokens = Object.fromEntries(await Promise.all(
    Object.entries(users).map(async ([name, user]) => [name, await issueToken(user)])
  ));

  {
    const anonymous = await api(env, "", "/api/discussions");
    assert.equal(anonymous.response.status, 200);
    assert.deepEqual(anonymous.payload.data, []);
    const anonymousWrite = await api(env, "", "/api/discussions", {
      method: "POST",
      body: JSON.stringify({ title: "Blocked", body: "Visitors cannot publish." }),
    });
    assert.equal(anonymousWrite.response.status, 401);
    assert.equal(anonymousWrite.payload.error.code, "UNAUTHORIZED");
  }

  let threadId;
  let openingPostId;
  {
    const created = await api(env, tokens.student, "/api/discussions", {
      method: "POST",
      body: JSON.stringify({
        questionKey: "CIE-IGCSE-0610-0610_s23_qp_22-01",
        title: "Question about CIE-IGCSE-0610-0610_s23_qp_22-01",
        body: "Why is the answer B?",
        board: "CIE",
        subject: "IGCSE Biology",
        paper: "MCQ",
        topic: "Cells",
        tags: ["paper", "not-allowed"],
      }),
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.subjectCode, "0610");
    assert.equal(created.payload.data.paperSlug, "0610_s23_qp_22");
    assert.deepEqual(created.payload.data.tags, ["paper", "question", "topic"]);
    assert.equal(created.payload.data.postCount, 1);
    assert.equal(created.payload.data.preview, "Why is the answer B?");
    threadId = created.payload.data.id;

    const filtered = await api(
      env,
      tokens.student,
      "/api/discussions?syllabus=0610&examSeason=s&examYear=23&paperNumber=2&variant=2"
    );
    assert.equal(filtered.response.status, 200);
    assert.equal(filtered.payload.data.length, 1);

    const searched = await api(env, tokens.student, "/api/discussions?search=answer%20B&sort=likes");
    assert.equal(searched.response.status, 200);
    assert.equal(searched.payload.data.length, 1);
    assert.equal(searched.payload.data[0].preview, "Why is the answer B?");

    const detail = await api(env, tokens.student, `/api/discussions/${threadId}`);
    assert.equal(detail.response.status, 200);
    assert.equal(detail.payload.data.posts.length, 1);
    openingPostId = detail.payload.data.posts[0].id;

    const anonymousDetail = await api(env, "", `/api/discussions/${threadId}`);
    assert.equal(anonymousDetail.response.status, 200);
    assert.equal(anonymousDetail.payload.data.posts.length, 1);
    for (const [path, options] of [
      [`/api/discussions/${threadId}/posts`, { method: "POST", body: JSON.stringify({ body: "Blocked reply" }) }],
      [`/api/discussions/posts/${openingPostId}/like`, { method: "POST" }],
      [`/api/discussions/${threadId}/follow`, { method: "POST" }],
      [`/api/discussions/posts/${openingPostId}/flag`, { method: "POST", body: JSON.stringify({ reason: "Blocked flag" }) }],
      [`/api/discussions/posts/${openingPostId}`, { method: "DELETE" }],
      ["/api/discussions/images", { method: "POST", body: JSON.stringify({ dataUrl: "data:image/png;base64,AA==" }) }],
    ]) {
      const blocked = await api(env, "", path, options);
      assert.equal(blocked.response.status, 401, path);
      assert.equal(blocked.payload.error.code, "UNAUTHORIZED", path);
    }
  }

  let replyId;
  {
    const replied = await api(env, tokens.student, `/api/discussions/${threadId}/posts`, {
      method: "POST",
      body: JSON.stringify({ body: "The nucleus controls cell activities." }),
    });
    assert.equal(replied.response.status, 201);
    replyId = replied.payload.data.id;

    const forbiddenDelete = await api(env, tokens.other, `/api/discussions/posts/${replyId}`, {
      method: "DELETE",
    });
    assert.equal(forbiddenDelete.response.status, 403);

    const openingDelete = await api(env, tokens.student, `/api/discussions/posts/${openingPostId}`, {
      method: "DELETE",
    });
    assert.equal(openingDelete.response.status, 409);
    assert.equal(openingDelete.payload.error.code, "DISCUSSION_THREAD_POST");
  }

  {
    await db.prepare(`
      INSERT INTO community_mutes (user_id, muted_until, reason, created_by)
      VALUES (?, ?, 'Test mute', ?)
    `).bind(users.other.id, new Date(Date.now() + 86400000).toISOString(), users.admin.id).run();
    const mutedLike = await api(env, tokens.other, `/api/discussions/posts/${openingPostId}/like`, {
      method: "POST",
    });
    assert.equal(mutedLike.response.status, 403);
    assert.equal(mutedLike.payload.error.code, "COMMUNITY_MUTED");
    await db.prepare("DELETE FROM community_mutes WHERE user_id = ?").bind(users.other.id).run();
  }

  {
    for (let index = 0; index < 2; index += 1) {
      const liked = await api(env, tokens.other, `/api/discussions/posts/${openingPostId}/like`, {
        method: "POST",
      });
      assert.equal(liked.response.status, 200);
      const followed = await api(env, tokens.other, `/api/discussions/${threadId}/follow`, {
        method: "POST",
      });
      assert.equal(followed.response.status, 200);
      const flagged = await api(env, tokens.other, `/api/discussions/posts/${openingPostId}/flag`, {
        method: "POST",
        body: JSON.stringify({ reason: `Review ${index}` }),
      });
      assert.equal(flagged.response.status, 201);
    }
    const detail = await api(env, tokens.admin, `/api/discussions/${threadId}`);
    assert.equal(detail.payload.data.posts[0].likeCount, 1);
    assert.equal(detail.payload.data.posts[0].flagCount, 1);
    assert.equal(detail.payload.data.thread.followerCount, 1);

    const followed = await api(env, tokens.other, "/api/discussions?followedOnly=1");
    assert.equal(followed.payload.data.length, 1);
    assert.equal(followed.payload.data[0].followed, true);

    await api(env, tokens.other, `/api/discussions/posts/${openingPostId}/like`, { method: "DELETE" });
    await api(env, tokens.other, `/api/discussions/${threadId}/follow`, { method: "DELETE" });
    const after = await api(env, tokens.other, `/api/discussions/${threadId}`);
    assert.equal(after.payload.data.posts[0].likeCount, 0);
    assert.equal(after.payload.data.thread.followed, false);
  }

  {
    const locked = await api(env, tokens.admin, `/api/discussions/${threadId}/moderation`, {
      method: "PATCH",
      body: JSON.stringify({ status: "locked", sticky: true, approved: true }),
    });
    assert.equal(locked.response.status, 200);
    assert.equal(locked.payload.data.status, "locked");
    assert.equal(locked.payload.data.sticky, true);

    const deniedReply = await api(env, tokens.student, `/api/discussions/${threadId}/posts`, {
      method: "POST",
      body: JSON.stringify({ body: "This must be rejected." }),
    });
    assert.equal(deniedReply.response.status, 409);
    assert.equal(deniedReply.payload.error.code, "DISCUSSION_LOCKED");

    await api(env, tokens.admin, `/api/discussions/${threadId}/moderation`, {
      method: "PATCH",
      body: JSON.stringify({ status: "hidden" }),
    });
    const hiddenStudent = await api(env, tokens.student, `/api/discussions/${threadId}`);
    assert.equal(hiddenStudent.response.status, 404);
    const hiddenVisitor = await api(env, "", `/api/discussions/${threadId}`);
    assert.equal(hiddenVisitor.response.status, 404);
    const hiddenAdmin = await api(env, tokens.admin, `/api/discussions/${threadId}`);
    assert.equal(hiddenAdmin.response.status, 200);
  }

  {
    const invalidImage = await api(env, tokens.student, "/api/discussions/images", {
      method: "POST",
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${Buffer.from("not png").toString("base64")}` }),
    });
    assert.equal(invalidImage.response.status, 400);
    assert.equal(invalidImage.payload.error.code, "INVALID_IMAGE");

    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    const uploaded = await api(env, tokens.student, "/api/discussions/images", {
      method: "POST",
      body: JSON.stringify({ dataUrl: `data:image/png;base64,${png.toString("base64")}` }),
    });
    assert.equal(uploaded.response.status, 201);
    assert.match(uploaded.payload.data.url, /^\/api\/community-images\/[0-9a-f-]{36}\.png$/);

    const imageResponse = await handleCommunityImageRequest(
      new Request(`https://expassway.test${uploaded.payload.data.url}`),
      env
    );
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
  }

  {
    const deleted = await api(env, tokens.student, `/api/discussions/posts/${replyId}`, {
      method: "DELETE",
    });
    assert.equal(deleted.response.status, 200);
    const detail = await api(env, tokens.admin, `/api/discussions/${threadId}`);
    assert.equal(detail.payload.data.posts.length, 1);
  }

  const foreignKeys = await db.prepare("PRAGMA foreign_key_check").all();
  assert.deepEqual(foreignKeys.results, []);
  console.log("Cloudflare D1 community and R2 image API smoke checks passed.");
} finally {
  await mf.dispose();
}
