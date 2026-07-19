import { Router } from "express";
import crypto from "crypto";
import { mkdir, writeFile } from "fs/promises";
import { fileURLToPath } from "url";
import { isDbEnabled } from "../db/client.js";
import { getUserById } from "../db/repositories/users.repository.js";
import {
  createDiscussionPost,
  createDiscussionThread,
  deleteDiscussionPost,
  flagDiscussionPost,
  followDiscussionThread,
  getDiscussionPostById,
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
import { getPublishedPaper, listPaperSlugsByFilter } from "../db/repositories/examCatalog.repository.js";
import { getQuestionBankById } from "../db/repositories/questionBank.repository.js";

const router = Router();
const STATUSES = new Set(["open", "solved", "locked", "hidden"]);
const ALLOWED_TAGS = new Set(["paper", "topic", "question", "solved", "teacher-note"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const COMMUNITY_UPLOAD_DIR = fileURLToPath(
  new URL("../../../assets/uploads/community/", import.meta.url)
);
const IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", matches: (buffer) => (
    buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  ) }],
  ["image/png", { extension: "png", matches: (buffer) => (
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) }],
  ["image/gif", { extension: "gif", matches: (buffer) => {
    const signature = buffer.subarray(0, 6).toString("ascii");
    return signature === "GIF87a" || signature === "GIF89a";
  } }],
  ["image/webp", { extension: "webp", matches: (buffer) => (
    buffer.subarray(0, 4).toString("ascii") === "RIFF"
    && buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) }],
]);

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
  if (user.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }
  return user;
}

function requireModerator(user) {
  if (user?.role !== "teacher" && user?.role !== "admin") {
    throw new ApiError(403, "Moderator role is required.", "FORBIDDEN");
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

function decodeImageDataUrl(value) {
  const dataUrl = String(value || "");
  if (dataUrl.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 64) {
    throw new ApiError(400, "Image must not exceed 5 MB.", "INVALID_IMAGE_SIZE");
  }
  const match = dataUrl.match(/^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) {
    throw new ApiError(400, "Only JPEG, PNG, GIF, and WebP images are supported.", "INVALID_IMAGE");
  }
  const imageType = IMAGE_TYPES.get(match[1]);
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    throw new ApiError(400, "Image size must be between 1 byte and 5 MB.", "INVALID_IMAGE_SIZE");
  }
  if (!imageType.matches(buffer)) {
    throw new ApiError(400, "Image content does not match its file type.", "INVALID_IMAGE");
  }
  return { buffer, extension: imageType.extension };
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

function optionalPatternPart(value, fieldName, pattern, example) {
  if (value == null || value === "") return "";
  const text = String(value).trim();
  if (!pattern.test(text)) {
    throw new ApiError(400, `Field "${fieldName}" must use ${example}.`, "INVALID_INPUT");
  }
  return text;
}

function questionKeyPatternsForPaper(query) {
  let syllabus = optionalPatternPart(query.syllabus, "syllabus", /^\d{4}$/, "a four-digit subject code");
  let season = optionalPatternPart(query.examSeason, "examSeason", /^[msw]$/i, "m, s or w").toLowerCase();
  let year = optionalPatternPart(query.examYear, "examYear", /^\d{2}$/, "a two-digit year");
  let paperNumber = optionalPatternPart(query.paperNumber, "paperNumber", /^\d$/, "one digit");
  let variant = optionalPatternPart(query.variant, "variant", /^\d$/, "one digit");

  if (query.questionPaper != null && query.questionPaper !== "") {
    const reference = String(query.questionPaper).trim();
    const match = reference.match(/^(\d{4})_([msw])(\d{2})_qp_(\d)(\d)$/i);
    if (!match) {
      throw new ApiError(
        400,
        'Field "questionPaper" must use a format such as 0620_s23_qp_22.',
        "INVALID_INPUT"
      );
    }
    [, syllabus, season, year, paperNumber, variant] = match;
    season = season.toLowerCase();
  }

  if (!syllabus || (!season && !year && !paperNumber && !variant)) return [];

  const seasonPattern = season || "[msw]";
  const yearPattern = year || "[0-9]{2}";
  const paperPattern = paperNumber || "[0-9]";
  const variantPattern = variant || "[0-9]";
  const patterns = [
    `^CIE-.*-${syllabus}_${seasonPattern}${yearPattern}_qp_${paperPattern}${variantPattern}(1)?-`,
    `${syllabus}_${seasonPattern}${yearPattern}_qp_${paperPattern}${variantPattern}`,
  ];
  if (syllabus === "0620") {
    patterns.push(`^CIE-IGCHEM-20${yearPattern}-${seasonPattern.toUpperCase()}-${paperPattern}${variantPattern}-`);
  }
  return patterns;
}

function visibilityFor(user) {
  const isTeacher = user?.role === "teacher" || user?.role === "admin";
  return {
    includeHidden: isTeacher,
    includeUnapproved: isTeacher,
  };
}

router.get("/", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const status = normalizeStatus(req.query.status);
  const followedOnly = req.query.followedOnly === "1" || req.query.followedOnly === "true";
  const paperFilterUsed = [
    req.query.examSeason,
    req.query.examYear,
    req.query.paperNumber,
    req.query.variant,
    req.query.questionPaper,
  ].some((value) => value != null && value !== "");
  const questionPaper = optionalText(req.query.questionPaper, 80)?.toLowerCase() || "";
  let paperSlugs = null;
  if (questionPaper) {
    questionKeyPatternsForPaper(req.query);
    paperSlugs = await getPublishedPaper(questionPaper) ? [questionPaper] : [];
  } else if (paperFilterUsed) {
    paperSlugs = await listPaperSlugsByFilter({
      subjectCode: optionalText(req.query.syllabus, 4),
      season: optionalText(req.query.examSeason, 1),
      year: optionalText(req.query.examYear, 2) ? `20${req.query.examYear}` : "",
      paperNumber: optionalText(req.query.paperNumber, 1),
      variant: optionalText(req.query.variant, 1),
    });
  }
  const threads = await listDiscussionThreads({
    viewerUserId: user.id,
    ...visibilityFor(user),
    questionKey: optionalText(req.query.questionKey, 200),
    questionKeyPatterns: questionKeyPatternsForPaper(req.query),
    paperSlugs,
    subjectCode: optionalText(req.query.syllabus, 4),
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
  const question = questionKey ? await getQuestionBankById(questionKey) : null;
  const thread = await createDiscussionThread({
    authorId: user.id,
    questionKey,
    subjectCode: question?.subjectCode || optionalText(body.subjectCode, 4),
    paperSlug: question?.paperSlug || optionalText(body.paperSlug, 80),
    questionNo: question?.questionNo || null,
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

router.post("/images", asyncHandler(async (req, res) => {
  await requireAuth(req);
  const image = decodeImageDataUrl(req.body?.dataUrl);
  const filename = `${crypto.randomUUID()}.${image.extension}`;
  await mkdir(COMMUNITY_UPLOAD_DIR, { recursive: true });
  await writeFile(`${COMMUNITY_UPLOAD_DIR}${filename}`, image.buffer, { flag: "wx" });
  res.status(201).json({
    ok: true,
    data: { url: `../assets/uploads/community/${filename}` },
  });
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

router.delete("/posts/:postId", asyncHandler(async (req, res) => {
  const user = await requireAuth(req);
  const postId = requireString(req.params.postId, "postId");
  const post = await getDiscussionPostById(postId);
  if (!post) {
    throw new ApiError(404, "Discussion post not found.", "DISCUSSION_POST_NOT_FOUND");
  }
  const canDeleteAnyReply = user.role === "admin";
  if (!canDeleteAnyReply && String(post.authorId) !== String(user.id)) {
    throw new ApiError(403, "You can only delete your own replies.", "FORBIDDEN");
  }
  if (post.isThreadPost) {
    throw new ApiError(409, "The opening post cannot be deleted as a reply.", "DISCUSSION_THREAD_POST");
  }

  const deleted = await deleteDiscussionPost(postId, user.id, canDeleteAnyReply);
  if (!deleted) {
    throw new ApiError(404, "Discussion post not found.", "DISCUSSION_POST_NOT_FOUND");
  }
  res.json({ ok: true, data: deleted });
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
  requireModerator(user);
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
