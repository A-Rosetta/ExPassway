import { Router } from "express";
import { query, isDbEnabled } from "../db/client.js";
import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/http.js";
import { requireString, toOptionalInteger } from "../utils/validate.js";
import {
  createUser,
  createUserWithPassword,
  findUserByEmail,
  getUserById,
  updateUserPasswordHash,
  updateUserPetPreferences,
  updateUserProfile,
} from "../db/repositories/users.repository.js";
import {
  hashPassword,
  issueToken,
  readAuthToken,
  verifyPassword,
  verifyToken,
} from "../services/auth.service.js";
import { env } from "../config/env.js";

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
    add column if not exists language text not null default 'en'
  `);
  await query(`
    alter table users
    add column if not exists disabled_at timestamptz
  `);
  await query(`
    alter table users
    add column if not exists pet_enabled boolean not null default true,
    add column if not exists pet_skin text not null default 'codex-glass',
    add column if not exists pet_position_x numeric(6, 5) not null default 0.92,
    add column if not exists pet_position_y numeric(6, 5) not null default 0.84
  `);
  authColumnsReady = true;
}

function normalizeLanguage(value) {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function isValidEmail(email) {
  const parts = email.split("@");
  const [local = "", domain = ""] = parts;
  const labels = domain.split(".");
  return email.length <= 254
    && !/\s/.test(email)
    && parts.length === 2
    && local.length > 0
    && local.length <= 64
    && !local.startsWith(".")
    && !local.endsWith(".")
    && !local.includes("..")
    && labels.length >= 2
    && labels.every((label) => (
      label.length > 0
      && label.length <= 63
      && !label.startsWith("-")
      && !label.endsWith("-")
      && /^[a-z0-9-]+$/i.test(label)
    ));
}

function normalizeEmail(value) {
  const email = requireString(value, "email").trim().toLowerCase();
  if (!isValidEmail(email)) {
    throw new ApiError(400, "Enter a valid email address.", "INVALID_EMAIL");
  }
  return email;
}

function assertGoogleAuthConfigured() {
  if (!env.supabaseUrl || !env.supabaseAnonKey || !env.supabaseAuthRedirectUrl) {
    throw new ApiError(503, "Google login is not configured yet.", "GOOGLE_AUTH_NOT_CONFIGURED");
  }
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
  const email = normalizeEmail(body.email);
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

router.get("/google/start", asyncHandler(async (_req, res) => {
  assertGoogleAuthConfigured();
  const url = new URL(`${env.supabaseUrl}/auth/v1/authorize`);
  url.searchParams.set("provider", "google");
  url.searchParams.set("redirect_to", env.supabaseAuthRedirectUrl);
  res.json({ ok: true, data: { url: url.toString() } });
}));

router.post("/google", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  assertGoogleAuthConfigured();
  await ensureAuthColumns();

  const accessToken = requireString(req.body?.accessToken, "accessToken");
  const authResponse = await fetch(`${env.supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: env.supabaseAnonKey,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!authResponse.ok) {
    throw new ApiError(401, "Google login could not be verified.", "UNAUTHORIZED");
  }

  const identity = await authResponse.json();
  const providers = Array.isArray(identity?.app_metadata?.providers)
    ? identity.app_metadata.providers
    : [identity?.app_metadata?.provider];
  if (!providers.includes("google")) {
    throw new ApiError(401, "A Google identity is required.", "UNAUTHORIZED");
  }
  if (!identity?.email_confirmed_at && !identity?.confirmed_at) {
    throw new ApiError(401, "Google email is not verified.", "UNVERIFIED_EMAIL");
  }
  const email = normalizeEmail(identity.email);
  let user = await findUserByEmail(email);
  if (!user) {
    const metadata = identity.user_metadata || {};
    const displayName = String(metadata.full_name || metadata.name || email.split("@")[0]).trim();
    user = await createUser({
      displayName,
      email,
      role: "student",
      grade: null,
      targetScore: null,
      language: normalizeLanguage(req.body?.language),
    });
  }
  if (user.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }

  const token = issueToken(user);
  const { passwordHash: _ignore, ...safeUser } = user;
  res.json({ ok: true, data: { user: safeUser, token } });
}));

router.post("/login", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();

  const body = req.body || {};
  const email = normalizeEmail(body.identifier ?? body.email);
  const password = requireString(body.password, "password");
  const user = await findUserByEmail(email);

  if (!user?.passwordHash || !verifyPassword(password, user.passwordHash)) {
    throw new ApiError(401, "Account or password is incorrect.", "UNAUTHORIZED");
  }
  if (user.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }

  const token = issueToken(user);
  const { passwordHash: _ignore, ...safeUser } = user;
  res.json({ ok: true, data: { user: safeUser, token } });
}));

router.post("/admin/login", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();

  const body = req.body || {};
  const identifier = requireString(body.identifier, "identifier").trim().toLowerCase();
  const password = requireString(body.password, "password");
  const user = await findUserByEmail(identifier);

  if (user?.role !== "admin" || !user.passwordHash || !verifyPassword(password, user.passwordHash)) {
    throw new ApiError(401, "Account or password is incorrect.", "UNAUTHORIZED");
  }
  if (user.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }

  const token = issueToken(user);
  const { passwordHash: _ignore, ...safeUser } = user;
  res.json({ ok: true, data: { user: safeUser, token } });
}));

router.get("/me", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();
  const token = readAuthToken(req);
  const payload = verifyToken(token);
  const user = await getUserById(payload.sub);
  if (!user) {
    throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  }
  if (user.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }
  res.json({ ok: true, data: user });
}));

router.patch("/me", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();
  const token = readAuthToken(req);
  const payload = verifyToken(token);
  const currentUser = await getUserById(payload.sub);
  if (!currentUser) {
    throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  }
  if (currentUser.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }
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

router.patch("/me/pet", asyncHandler(async (req, res) => {
  assertUsersApiEnabled();
  await ensureAuthColumns();
  const payload = verifyToken(readAuthToken(req));
  const currentUser = await getUserById(payload.sub);
  if (!currentUser) throw new ApiError(401, "User no longer exists.", "UNAUTHORIZED");
  if (currentUser.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }

  const body = req.body || {};
  if (typeof body.enabled !== "boolean") {
    throw new ApiError(400, "Pet enabled state must be a boolean.", "INVALID_PET_ENABLED");
  }
  const skin = typeof body.skin === "string" ? body.skin.trim() : "";
  if (skin !== "codex-glass") {
    throw new ApiError(400, "Unknown pet skin.", "INVALID_PET_SKIN");
  }
  const x = Number(body.position?.x);
  const y = Number(body.position?.y);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
    throw new ApiError(400, "Pet position must use x and y values from 0 to 1.", "INVALID_PET_POSITION");
  }

  const updated = await updateUserPetPreferences(payload.sub, {
    enabled: body.enabled,
    skin,
    position: { x, y },
  });
  res.json({ ok: true, data: updated.pet });
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
  if (user.isDisabled) {
    throw new ApiError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
  }
  const userWithAuth = await findUserByEmail(user.email);
  if (!userWithAuth?.passwordHash || !verifyPassword(oldPassword, userWithAuth.passwordHash)) {
    throw new ApiError(401, "Old password is incorrect.", "UNAUTHORIZED");
  }

  await updateUserPasswordHash(payload.sub, hashPassword(newPassword));
  res.json({ ok: true, data: { changed: true } });
}));

export default router;
