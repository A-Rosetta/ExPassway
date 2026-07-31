import {
  AuthError,
  failure,
  readJsonBody,
  requireCurrentUser,
  requireString,
  routeNotFound,
  success,
} from "./auth-api.js";

const CORS_PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};
const STATUSES = new Set(["open", "solved", "locked", "hidden"]);
const ALLOWED_TAGS = new Set(["paper", "topic", "question", "solved", "teacher-note"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", matches: (bytes) => (
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  ) }],
  ["image/png", { extension: "png", matches: (bytes) => (
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value)
  ) }],
  ["image/gif", { extension: "gif", matches: (bytes) => {
    const signature = String.fromCharCode(...bytes.slice(0, 6));
    return signature === "GIF87a" || signature === "GIF89a";
  } }],
  ["image/webp", { extension: "webp", matches: (bytes) => (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) }],
]);

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function limitedText(value, maxLength, field = "value", required = false) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new AuthError(400, `Field "${field}" is required.`, "INVALID_INPUT");
  if (text.length > maxLength) {
    throw new AuthError(400, `Field "${field}" must be at most ${maxLength} characters.`, "INVALID_INPUT");
  }
  return text || null;
}

function toLimit(value, fallback = 30) {
  const number = value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 100) {
    throw new AuthError(400, "Limit must be an integer from 1 to 100.", "INVALID_INPUT");
  }
  return number;
}

function normalizeStatus(value, optional = true) {
  if ((value === null || value === undefined || value === "") && optional) return null;
  const status = String(value || "").trim();
  if (!STATUSES.has(status)) {
    throw new AuthError(400, "Status must be open, solved, locked, or hidden.", "INVALID_INPUT");
  }
  return status;
}

function normalizeTags(value, questionKey, topic) {
  const tags = Array.isArray(value)
    ? value.filter((tag) => typeof tag === "string").map((tag) => tag.trim())
    : [];
  const allowed = tags.filter((tag) => ALLOWED_TAGS.has(tag));
  if (questionKey) allowed.push("question");
  if (topic) allowed.push("topic");
  return [...new Set(allowed)];
}

async function requireCommunityWrite(db, user) {
  if (user.role === "admin") return;
  const mute = await db.prepare(`
    SELECT muted_until, reason FROM community_mutes
    WHERE user_id = ? AND muted_until > ? LIMIT 1
  `).bind(user.id, new Date().toISOString()).first();
  if (mute) {
    throw new AuthError(403, "Community interactions are disabled for this account.", "COMMUNITY_MUTED", {
      mutedUntil: mute.muted_until,
      reason: mute.reason || null,
    });
  }
}

function mapThread(row) {
  return {
    id: row.id,
    questionKey: row.question_key,
    title: row.title,
    board: row.board,
    subject: row.subject,
    subjectCode: row.subject_code || "",
    paper: row.paper,
    paperSlug: row.paper_slug || "",
    questionNo: row.question_no == null ? null : Number(row.question_no),
    topic: row.topic,
    tags: parseJson(row.tags, []),
    status: row.status,
    sticky: Boolean(row.sticky),
    approved: Boolean(row.approved),
    authorId: row.author_id,
    authorName: row.author_name || "Unknown",
    postCount: Number(row.post_count || 0),
    likeCount: Number(row.like_count || 0),
    followerCount: Number(row.follower_count || 0),
    followed: Boolean(row.followed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastPostAt: row.last_post_at,
  };
}

function mapPost(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    authorId: row.author_id,
    authorName: row.author_name || "Unknown",
    body: row.body,
    approved: Boolean(row.approved),
    hidden: Boolean(row.hidden),
    likeCount: Number(row.like_count || 0),
    liked: Boolean(row.liked),
    flagCount: Number(row.flag_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function threadSelect() {
  return `
    SELECT t.*, u.display_name AS author_name,
      (SELECT COUNT(*) FROM discussion_posts p
        WHERE p.thread_id = t.id AND p.hidden = 0 AND p.approved = 1) AS post_count,
      (SELECT COUNT(*) FROM discussion_posts p
        JOIN discussion_post_likes l ON l.post_id = p.id
        WHERE p.thread_id = t.id) AS like_count,
      (SELECT COUNT(*) FROM discussion_thread_follows f WHERE f.thread_id = t.id) AS follower_count,
      EXISTS(SELECT 1 FROM discussion_thread_follows f
        WHERE f.thread_id = t.id AND f.user_id = ?) AS followed
    FROM discussion_threads t
    LEFT JOIN users u ON u.id = t.author_id
  `;
}

async function getThread(db, threadId, viewer) {
  const moderator = viewer.role === "admin" || viewer.role === "teacher";
  return db.prepare(`
    ${threadSelect()}
    WHERE t.id = ?
      AND (? = 1 OR t.status <> 'hidden')
      AND (? = 1 OR t.approved = 1)
    LIMIT 1
  `).bind(viewer.id, threadId, moderator ? 1 : 0, moderator ? 1 : 0).first();
}

async function listThreads(db, viewer, url) {
  const moderator = viewer.role === "admin" || viewer.role === "teacher";
  const clauses = [];
  const values = [viewer.id];
  const add = (sql, value) => {
    clauses.push(sql);
    values.push(value);
  };
  if (!moderator) clauses.push("t.status <> 'hidden'", "t.approved = 1");
  const questionKey = limitedText(url.searchParams.get("questionKey"), 200);
  const subjectCode = limitedText(url.searchParams.get("syllabus"), 4);
  const subject = limitedText(url.searchParams.get("subject"), 120);
  const paper = limitedText(url.searchParams.get("paper"), 80);
  const topic = limitedText(url.searchParams.get("topic"), 120);
  const tag = limitedText(url.searchParams.get("tag"), 40);
  const status = normalizeStatus(url.searchParams.get("status"));
  if (questionKey) add("t.question_key = ?", questionKey);
  if (subjectCode) add("t.subject_code = ?", subjectCode);
  else if (subject) add("t.subject = ?", subject);
  if (paper) add("t.paper = ?", paper);
  if (topic) add("t.topic = ?", topic);
  if (tag) add("EXISTS(SELECT 1 FROM json_each(t.tags) WHERE value = ?)", tag);
  if (status) add("t.status = ?", status);
  if (["1", "true"].includes(url.searchParams.get("followedOnly"))) {
    clauses.push("EXISTS(SELECT 1 FROM discussion_thread_follows f WHERE f.thread_id = t.id AND f.user_id = ?)");
    values.push(viewer.id);
  }

  const season = limitedText(url.searchParams.get("examSeason"), 1);
  const shortYear = limitedText(url.searchParams.get("examYear"), 2);
  const paperNumber = limitedText(url.searchParams.get("paperNumber"), 1);
  const variant = limitedText(url.searchParams.get("variant"), 1);
  const questionPaper = limitedText(url.searchParams.get("questionPaper"), 80)?.toLowerCase();
  if (questionPaper) {
    if (!/^\d{4}_[msw]\d{2}_qp_\d{2}$/.test(questionPaper)) {
      throw new AuthError(400, "Question paper must use a format such as 0620_s23_qp_22.", "INVALID_INPUT");
    }
    add("t.paper_slug = ?", questionPaper);
  } else if (season || shortYear || paperNumber || variant) {
    if (season && !/^[msw]$/i.test(season)) throw new AuthError(400, "Exam season must be m, s, or w.", "INVALID_INPUT");
    if (shortYear && !/^\d{2}$/.test(shortYear)) throw new AuthError(400, "Exam year must contain two digits.", "INVALID_INPUT");
    if (paperNumber && !/^\d$/.test(paperNumber)) throw new AuthError(400, "Paper number must contain one digit.", "INVALID_INPUT");
    if (variant && !/^\d$/.test(variant)) throw new AuthError(400, "Variant must contain one digit.", "INVALID_INPUT");
    const paperClauses = ["p.status = 'published'"];
    const paperValues = [];
    if (subjectCode) { paperClauses.push("p.subject_code = ?"); paperValues.push(subjectCode); }
    if (season) { paperClauses.push("p.season = ?"); paperValues.push(season.toLowerCase()); }
    if (shortYear) { paperClauses.push("p.year = ?"); paperValues.push(Number(`20${shortYear}`)); }
    if (paperNumber) { paperClauses.push("p.paper_number = ?"); paperValues.push(Number(paperNumber)); }
    if (variant) { paperClauses.push("p.variant = ?"); paperValues.push(Number(variant)); }
    clauses.push(`t.paper_slug IN (SELECT p.slug FROM exam_papers p WHERE ${paperClauses.join(" AND ")})`);
    values.push(...paperValues);
  }
  values.push(toLimit(url.searchParams.get("limit")));
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = await db.prepare(`
    ${threadSelect()}
    ${where}
    ORDER BY t.sticky DESC, t.last_post_at DESC
    LIMIT ?
  `).bind(...values).all();
  return rows.results.map(mapThread);
}

async function listPosts(db, threadId, viewer) {
  const moderator = viewer.role === "admin" || viewer.role === "teacher";
  const rows = await db.prepare(`
    SELECT p.*, u.display_name AS author_name,
      (SELECT COUNT(*) FROM discussion_post_likes l WHERE l.post_id = p.id) AS like_count,
      EXISTS(SELECT 1 FROM discussion_post_likes l WHERE l.post_id = p.id AND l.user_id = ?) AS liked,
      (SELECT COUNT(*) FROM discussion_flags f WHERE f.post_id = p.id) AS flag_count
    FROM discussion_posts p
    LEFT JOIN users u ON u.id = p.author_id
    WHERE p.thread_id = ?
      AND (? = 1 OR p.hidden = 0)
      AND (? = 1 OR p.approved = 1)
    ORDER BY p.created_at, p.id
  `).bind(viewer.id, threadId, moderator ? 1 : 0, moderator ? 1 : 0).all();
  return rows.results.map(mapPost);
}

async function createThread(request, env, viewer) {
  const body = await readJsonBody(request);
  const questionKey = limitedText(body.questionKey, 200);
  const topic = limitedText(body.topic, 120);
  const title = limitedText(body.title, 140, "title", true);
  const postBody = limitedText(body.body, 4000, "body", true);
  const question = questionKey
    ? await env.DB.prepare("SELECT * FROM question_bank WHERE id = ? LIMIT 1").bind(questionKey).first()
    : null;
  const now = new Date().toISOString();
  const threadId = crypto.randomUUID();
  const postId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO discussion_threads (
        id, question_key, title, board, subject, paper, topic, tags,
        author_id, created_at, updated_at, last_post_at,
        subject_code, paper_slug, question_no
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      threadId,
      questionKey,
      title,
      limitedText(body.board, 80),
      limitedText(body.subject, 120),
      limitedText(body.paper, 80),
      topic,
      JSON.stringify(normalizeTags(body.tags, questionKey, topic)),
      viewer.id,
      now,
      now,
      now,
      question?.subject_code || limitedText(body.subjectCode, 4),
      question?.paper_slug || limitedText(body.paperSlug, 80),
      question?.question_no == null ? null : Number(question.question_no)
    ),
    env.DB.prepare(`
      INSERT INTO discussion_posts (id, thread_id, author_id, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(postId, threadId, viewer.id, postBody, now, now),
  ]);
  return mapThread(await getThread(env.DB, threadId, viewer));
}

async function createPost(request, env, viewer, thread) {
  const body = await readJsonBody(request);
  const content = limitedText(body.body, 4000, "body", true);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO discussion_posts (id, thread_id, author_id, body, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(id, thread.id, viewer.id, content, now, now),
    env.DB.prepare(`
      UPDATE discussion_threads SET last_post_at = ?, updated_at = ? WHERE id = ?
    `).bind(now, now, thread.id),
  ]);
  const row = await env.DB.prepare(`
    SELECT p.*, u.display_name AS author_name, 0 AS like_count, 0 AS liked, 0 AS flag_count
    FROM discussion_posts p LEFT JOIN users u ON u.id = p.author_id WHERE p.id = ?
  `).bind(id).first();
  return mapPost(row);
}

function decodeImageDataUrl(value) {
  const dataUrl = String(value || "");
  if (dataUrl.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64) {
    throw new AuthError(400, "Image must not exceed 5 MB.", "INVALID_IMAGE_SIZE");
  }
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new AuthError(400, "Only JPEG, PNG, GIF, and WebP images are supported.", "INVALID_IMAGE");
  }
  let binary;
  try {
    binary = atob(match[2]);
  } catch (_error) {
    throw new AuthError(400, "Image data is not valid base64.", "INVALID_IMAGE");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) {
    throw new AuthError(400, "Image size must be between 1 byte and 5 MB.", "INVALID_IMAGE_SIZE");
  }
  const type = IMAGE_TYPES.get(match[1]);
  if (!type.matches(bytes)) {
    throw new AuthError(400, "Image content does not match its file type.", "INVALID_IMAGE");
  }
  return { bytes, contentType: match[1], extension: type.extension };
}

async function uploadImage(request, env) {
  const { user } = await requireCurrentUser(request, env);
  await requireCommunityWrite(env.DB, user);
  const body = await readJsonBody(request);
  const image = decodeImageDataUrl(body.dataUrl);
  const name = `${crypto.randomUUID()}.${image.extension}`;
  const key = `community/${name}`;
  await env.CONTENT_BUCKET.put(key, image.bytes, {
    httpMetadata: { contentType: image.contentType, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { source: "community" },
  });
  return { url: `/api/community-images/${name}` };
}

export async function handleCommunityImageRequest(request, env) {
  const url = new URL(request.url);
  if (!/^\/api\/community-images\/[0-9a-f-]{36}\.(?:jpg|png|gif|webp)$/.test(url.pathname)) {
    return failure(404, "NOT_FOUND", "Community image not found.", request.method);
  }
  const object = await env.CONTENT_BUCKET.get(`community/${url.pathname.split("/").pop()}`);
  if (!object) return failure(404, "NOT_FOUND", "Community image not found.", request.method);
  const headers = new Headers({
    "Cache-Control": object.httpMetadata?.cacheControl || "public, max-age=31536000, immutable",
    "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
  });
  headers.set("ETag", object.httpEtag);
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(request.method === "HEAD" ? null : object.body, { headers });
}

async function requireExistingPost(db, postId) {
  const post = await db.prepare(`
    SELECT p.*,
      p.id = (SELECT first.id FROM discussion_posts first
        WHERE first.thread_id = p.thread_id ORDER BY first.created_at, first.id LIMIT 1) AS is_thread_post
    FROM discussion_posts p WHERE p.id = ? LIMIT 1
  `).bind(postId).first();
  if (!post) throw new AuthError(404, "Discussion post not found.", "DISCUSSION_POST_NOT_FOUND");
  return post;
}

export async function handleCommunityApiRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
  }
  try {
    if (request.method === "POST" && url.pathname === "/api/discussions/images") {
      return success(await uploadImage(request, env), request.method, 201);
    }
    const anonymousRead = request.method === "GET" && !request.headers.get("Authorization");
    const user = anonymousRead
      ? { id: "", role: "visitor" }
      : (await requireCurrentUser(request, env)).user;
    if (url.pathname === "/api/discussions" && request.method === "GET") {
      return success(await listThreads(env.DB, user, url), request.method);
    }
    if (url.pathname === "/api/discussions" && request.method === "POST") {
      await requireCommunityWrite(env.DB, user);
      return success(await createThread(request, env, user), request.method, 201);
    }

    const postAction = url.pathname.match(/^\/api\/discussions\/posts\/([^/]+)\/(like|flag)$/);
    if (postAction) {
      const postId = decodeURIComponent(postAction[1]);
      await requireExistingPost(env.DB, postId);
      await requireCommunityWrite(env.DB, user);
      if (postAction[2] === "like" && request.method === "POST") {
        await env.DB.prepare(`
          INSERT INTO discussion_post_likes (post_id, user_id) VALUES (?, ?)
          ON CONFLICT (post_id, user_id) DO NOTHING
        `).bind(postId, user.id).run();
        return success({ liked: true }, request.method);
      }
      if (postAction[2] === "like" && request.method === "DELETE") {
        await env.DB.prepare("DELETE FROM discussion_post_likes WHERE post_id = ? AND user_id = ?")
          .bind(postId, user.id).run();
        return success({ liked: false }, request.method);
      }
      if (postAction[2] === "flag" && request.method === "POST") {
        const body = await readJsonBody(request);
        const reason = limitedText(body.reason, 500);
        await env.DB.prepare(`
          INSERT INTO discussion_flags (id, post_id, user_id, reason)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (post_id, user_id) DO UPDATE SET
            reason = excluded.reason, status = 'pending', resolved_at = NULL,
            resolved_by = NULL, created_at = excluded.created_at
        `).bind(crypto.randomUUID(), postId, user.id, reason).run();
        return success({ flagged: true }, request.method, 201);
      }
    }

    const deletePost = url.pathname.match(/^\/api\/discussions\/posts\/([^/]+)$/);
    if (deletePost && request.method === "DELETE") {
      await requireCommunityWrite(env.DB, user);
      const post = await requireExistingPost(env.DB, decodeURIComponent(deletePost[1]));
      if (post.is_thread_post) {
        throw new AuthError(409, "The opening post cannot be deleted as a reply.", "DISCUSSION_THREAD_POST");
      }
      if (user.role !== "admin" && post.author_id !== user.id) {
        throw new AuthError(403, "You can only delete your own replies.", "FORBIDDEN");
      }
      await env.DB.prepare("DELETE FROM discussion_posts WHERE id = ?").bind(post.id).run();
      const latest = await env.DB.prepare(`
        SELECT MAX(created_at) AS last_post_at FROM discussion_posts WHERE thread_id = ?
      `).bind(post.thread_id).first();
      await env.DB.prepare(`
        UPDATE discussion_threads SET last_post_at = COALESCE(?, created_at), updated_at = ? WHERE id = ?
      `).bind(latest?.last_post_at || null, new Date().toISOString(), post.thread_id).run();
      return success({ id: post.id, threadId: post.thread_id }, request.method);
    }

    const threadAction = url.pathname.match(/^\/api\/discussions\/([^/]+)\/(posts|follow|moderation)$/);
    if (threadAction) {
      const threadId = decodeURIComponent(threadAction[1]);
      const threadRow = await getThread(env.DB, threadId, user);
      if (!threadRow) throw new AuthError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
      const thread = mapThread(threadRow);
      if (threadAction[2] === "posts" && request.method === "POST") {
        await requireCommunityWrite(env.DB, user);
        if (thread.status === "locked" || thread.status === "hidden") {
          throw new AuthError(409, "This discussion is not accepting replies.", "DISCUSSION_LOCKED");
        }
        return success(await createPost(request, env, user, thread), request.method, 201);
      }
      if (threadAction[2] === "follow" && request.method === "POST") {
        await requireCommunityWrite(env.DB, user);
        const now = new Date().toISOString();
        await env.DB.prepare(`
          INSERT INTO discussion_thread_follows (thread_id, user_id, last_read_at, created_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT (thread_id, user_id) DO UPDATE SET last_read_at = excluded.last_read_at
        `).bind(threadId, user.id, now, now).run();
        return success({ followed: true }, request.method);
      }
      if (threadAction[2] === "follow" && request.method === "DELETE") {
        await requireCommunityWrite(env.DB, user);
        await env.DB.prepare("DELETE FROM discussion_thread_follows WHERE thread_id = ? AND user_id = ?")
          .bind(threadId, user.id).run();
        return success({ followed: false }, request.method);
      }
      if (threadAction[2] === "moderation" && request.method === "PATCH") {
        await requireCommunityWrite(env.DB, user);
        if (user.role !== "admin" && user.role !== "teacher") {
          throw new AuthError(403, "Moderator role is required.", "FORBIDDEN");
        }
        const body = await readJsonBody(request);
        const status = Object.prototype.hasOwnProperty.call(body, "status")
          ? normalizeStatus(body.status, false)
          : thread.status;
        const sticky = Object.prototype.hasOwnProperty.call(body, "sticky") ? Boolean(body.sticky) : thread.sticky;
        const approved = Object.prototype.hasOwnProperty.call(body, "approved") ? Boolean(body.approved) : thread.approved;
        await env.DB.prepare(`
          UPDATE discussion_threads SET status = ?, sticky = ?, approved = ?, updated_at = ? WHERE id = ?
        `).bind(status, sticky ? 1 : 0, approved ? 1 : 0, new Date().toISOString(), threadId).run();
        return success(mapThread(await getThread(env.DB, threadId, user)), request.method);
      }
    }

    const threadDetail = url.pathname.match(/^\/api\/discussions\/([^/]+)$/);
    if (threadDetail && request.method === "GET") {
      const threadId = decodeURIComponent(threadDetail[1]);
      const row = await getThread(env.DB, threadId, user);
      if (!row) throw new AuthError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
      return success({
        thread: mapThread(row),
        posts: await listPosts(env.DB, threadId, user),
      }, request.method);
    }
    return routeNotFound(request, url);
  } catch (error) {
    if (error instanceof AuthError) {
      return failure(error.status, error.code, error.message, request.method, error.details);
    }
    console.error("D1 community API failed", error);
    return failure(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.", request.method);
  }
}
