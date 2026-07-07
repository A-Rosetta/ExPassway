import { Router } from "express";
import { query, isDbEnabled } from "../db/client.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/http.js";
import { requireString, toOptionalInteger } from "../utils/validate.js";
import {
  createUserWithPassword,
  findUserByEmail,
  getUserById,
  updateUserPasswordHash,
  updateUserProfile,
} from "../db/repositories/users.repository.js";
import {
  hashPassword,
  issueToken,
  readAuthToken,
  verifyPassword,
  verifyToken,
} from "../services/auth.service.js";

const router = Router();

let authColumnsReady = false;

async function ensureAuthColumns() {
  if (authColumnsReady) return;
  await query(`
    alter table users
    add column if not exists password_hash text
  `);
  await query(`
    alter table users
    add column if not exists language text not null default 'zh-CN'
  `);
  authColumnsReady = true;
}

function normalizeLanguage(value) {
  return value === "en" ? "en" : "zh-CN";
}

function assertUsersApiEnabled() {
  if (!isDbEnabled()) {
    throw new ApiError(
      503,
      "Authentication requires PostgreSQL. Set DATABASE_URL and run DB schema first.",
      "DB_DISABLED"
    );
  }
}

router.post("/register", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();

  const body = req.body || {};
  const displayName = requireString(body.displayName, "displayName");
  const email = requireString(body.email, "email").toLowerCase();
  const password = requireString(body.password, "password");
  if (password.length < 6) {
    throw new ApiError(400, "Password must be at least 6 characters.", "INVALID_INPUT");
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    throw new ApiError(409, "Email already registered.", "CONFLICT");
  }

  const user = await createUserWithPassword({
    displayName,
    email,
    role: "student",
    grade: typeof body.grade === "string" ? body.grade.trim() : null,
    targetScore: toOptionalInteger(body.targetScore, "targetScore", 0, 100),
    passwordHash: hashPassword(password),
    language: normalizeLanguage(body.language),
  });
  const token = issueToken(user);
  res.status(201).json({ ok: true, data: { user, token } });
}));

router.post("/login", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();

  const body = req.body || {};
  const email = requireString(body.email, "email").toLowerCase();
  const password = requireString(body.password, "password");
  const user = await findUserByEmail(email);

  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
    throw new ApiError(401, "Email or password is incorrect.", "UNAUTHORIZED");
  }

  const token = issueToken(user);
  const { passwordHash: _ignore, ...safeUser } = user;
  res.json({ ok: true, data: { user: safeUser, token } });
}));

router.get("/me", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  const token = readAuthToken(req);
  const payload = verifyToken(token);
  const user = await getUserById(payload.sub);
  if (!user) {
    throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  }
  res.json({ ok: true, data: user });
}));

router.patch("/me", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();
  const token = readAuthToken(req);
  const payload = verifyToken(token);
  const body = req.body || {};

  const displayName = requireString(body.displayName, "displayName");
  const grade = typeof body.grade === "string" ? body.grade.trim() : null;
  const targetScore = toOptionalInteger(body.targetScore, "targetScore", 0, 100);

  const updated = await updateUserProfile(payload.sub, {
    displayName,
    grade,
    targetScore,
    language: normalizeLanguage(body.language),
  });
  if (!updated) {
    throw new ApiError(404, "User not found.", "USER_NOT_FOUND");
  }
  res.json({ ok: true, data: updated });
}));

router.post("/change-password", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();
  const token = readAuthToken(req);
  const payload = verifyToken(token);
  const body = req.body || {};

  const oldPassword = requireString(body.oldPassword, "oldPassword");
  const newPassword = requireString(body.newPassword, "newPassword");
  if (newPassword.length < 6) {
    throw new ApiError(400, "New password must be at least 6 characters.", "INVALID_INPUT");
  }

  const user = await getUserById(payload.sub);
  if (!user?.email) {
    throw new ApiError(404, "User not found.", "USER_NOT_FOUND");
  }
  const userWithAuth = await findUserByEmail(user.email);
  if (!userWithAuth?.passwordHash || !verifyPassword(oldPassword, userWithAuth.passwordHash)) {
    throw new ApiError(401, "Old password is incorrect.", "UNAUTHORIZED");
  }

  await updateUserPasswordHash(payload.sub, hashPassword(newPassword));
  res.json({ ok: true, data: { changed: true } });
}));

export default router;
