import { Router } from "express";
import { isDbEnabled } from "../db/client.js";
import { getUserById } from "../db/repositories/users.repository.js";
import {
  createDiscussionPost,
  createDiscussionThread,
  flagDiscussionPost,
  followDiscussionThread,
  getDiscussionThreadById,
  likeDiscussionPost,
  listDiscussionPosts,
  listDiscussionThreads,
  unfollowDiscussionThread,
  unlikeDiscussionPost,
  updateDiscussionThreadModeration,
} from "../db/repositories/discussions.repository.js";
import { readAuthToken, verifyToken } from "../services/auth.service.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/http.js";
import { requireString, toClampedInteger, toStringArray } from "../utils/validate.js";

const router = Router();
const STATUSES = new Set(["open", "solved", "locked", "hidden"]);
const ALLOWED_TAGS = new Set(["paper", "topic", "question", "solved", "teacher-note"]);

function assertDiscussionsEnabled() {
  if (!isDbEnabled()) {
    throw new ApiError(
      503,
      "Discussion API requires PostgreSQL. Set DATABASE_URL and run DB schema first.",
      "DB_DISABLED"
    );
  }
}

async function requireAuth(req) {
  assertDiscussionsEnabled();
  const payload = verifyToken(readAuthToken(req));
  const user = await getUserById(payload.sub);
  if (!user) {
    throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  }
  return user;
}

function requireTeacher(user) {
  if (user?.role !== "teacher") {
    throw new ApiError(403, "Teacher role is required for moderation.", "FORBIDDEN");
  }
}

function optionalText(value, maxLength) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function requiredLimitedString(value, fieldName, maxLength) {
  const text = requireString(value, fieldName);
  if (text.length > maxLength) {
    throw new ApiError(400, `Field "${fieldName}" must be at most ${maxLength} characters.`, "INVALID_INPUT");
  }
  return text;
}

function normalizeTags(value, questionKey, topic) {
  const tags = toStringArray(value).filter((tag) => ALLOWED_TAGS.has(tag));
  if (questionKey && !tags.includes("question")) tags.push("question");
  if (topic && !tags.includes("topic")) tags.push("topic");
  return Array.from(new Set(tags));
}

function normalizeStatus(value, fieldName = "status") {
  if (value == null || value === "") return null;
  const status = String(value).trim();
  if (!STATUSES.has(status)) {
    throw new ApiError(400, `Field "${fieldName}" must be one of: open, solved, locked, hidden.`, "INVALID_INPUT");
  }
  return status;
}

function visibilityFor(user) {
  const isTeacher = user?.role === "teacher";
  return {
    includeHidden: isTeacher,
    includeUnapproved: isTeacher,
  };
}

router.get("/", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const status = normalizeStatus(req.query.status);
  const followedOnly = req.query.followedOnly === "1" || req.query.followedOnly === "true";
  const threads = await listDiscussionThreads({
    viewerUserId: user.id,
    ...visibilityFor(user),
    questionKey: optionalText(req.query.questionKey, 200),
    subject: optionalText(req.query.subject, 120),
    paper: optionalText(req.query.paper, 80),
    topic: optionalText(req.query.topic, 120),
    tag: optionalText(req.query.tag, 40),
    status,
    followedOnly,
    limit: toClampedInteger(req.query.limit, 30, 1, 100),
  });
  res.json({ ok: true, data: threads });
}));

router.post("/", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const body = req.body || {};
  const questionKey = optionalText(body.questionKey, 200);
  const topic = optionalText(body.topic, 120);
  const thread = await createDiscussionThread({
    authorId: user.id,
    questionKey,
    title: requiredLimitedString(body.title, "title", 140),
    body: requiredLimitedString(body.body, "body", 4000),
    board: optionalText(body.board, 80),
    subject: optionalText(body.subject, 120),
    paper: optionalText(body.paper, 80),
    topic,
    tags: normalizeTags(body.tags, questionKey, topic),
  });
  res.status(201).json({ ok: true, data: thread });
}));

router.post("/posts/:postId/like", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const result = await likeDiscussionPost(requireString(req.params.postId, "postId"), user.id);
  res.json({ ok: true, data: result });
}));

router.delete("/posts/:postId/like", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const result = await unlikeDiscussionPost(requireString(req.params.postId, "postId"), user.id);
  res.json({ ok: true, data: result });
}));

router.post("/posts/:postId/flag", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const result = await flagDiscussionPost(
    requireString(req.params.postId, "postId"),
    user.id,
    optionalText(req.body?.reason, 500)
  );
  res.status(201).json({ ok: true, data: result });
}));

router.get("/:threadId", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const thread = await getDiscussionThreadById(requireString(req.params.threadId, "threadId"), {
    viewerUserId: user.id,
    ...visibilityFor(user),
  });
  if (!thread) {
    throw new ApiError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
  }
  const posts = await listDiscussionPosts(thread.id, {
    viewerUserId: user.id,
    ...visibilityFor(user),
  });
  res.json({ ok: true, data: { thread, posts } });
}));

router.post("/:threadId/posts", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const thread = await getDiscussionThreadById(requireString(req.params.threadId, "threadId"), {
    viewerUserId: user.id,
    ...visibilityFor(user),
  });
  if (!thread) {
    throw new ApiError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
  }
  if (thread.status === "locked" || thread.status === "hidden") {
    throw new ApiError(409, "This discussion is not accepting replies.", "DISCUSSION_LOCKED");
  }
  const post = await createDiscussionPost({
    threadId: thread.id,
    authorId: user.id,
    body: requiredLimitedString(req.body?.body, "body", 4000),
  });
  res.status(201).json({ ok: true, data: post });
}));

router.post("/:threadId/follow", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const result = await followDiscussionThread(requireString(req.params.threadId, "threadId"), user.id);
  res.json({ ok: true, data: result });
}));

router.delete("/:threadId/follow", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const result = await unfollowDiscussionThread(requireString(req.params.threadId, "threadId"), user.id);
  res.json({ ok: true, data: result });
}));

router.patch("/:threadId/moderation", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  requireTeacher(user);
  const input = {};
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "status")) {
    input.status = normalizeStatus(req.body.status);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "sticky")) {
    input.sticky = Boolean(req.body.sticky);
  }
  if (Object.prototype.hasOwnProperty.call(req.body || {}, "approved")) {
    input.approved = Boolean(req.body.approved);
  }
  const thread = await updateDiscussionThreadModeration(requireString(req.params.threadId, "threadId"), input);
  if (!thread) {
    throw new ApiError(404, "Discussion thread not found.", "DISCUSSION_NOT_FOUND");
  }
  res.json({ ok: true, data: thread });
}));

export default router;
