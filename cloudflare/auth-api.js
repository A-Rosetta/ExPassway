const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

const CORS_PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class AuthError extends Error {
  constructor(status, message, code, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function jsonResponse(status, payload, requestMethod = "GET") {
  const body = requestMethod === "HEAD" ? null : JSON.stringify(payload);
  return new Response(body, { status, headers: JSON_HEADERS });
}

function success(data, requestMethod) {
  return jsonResponse(200, { ok: true, data }, requestMethod);
}

function failure(status, code, message, requestMethod, details = null) {
  return jsonResponse(status, {
    ok: false,
    error: { code, message, details },
  }, requestMethod);
}

function routeNotFound(request, url) {
  return failure(
    404,
    "NOT_FOUND",
    `Route not found: ${request.method} ${url.pathname}${url.search}`,
    request.method
  );
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new AuthError(400, `Field "${field}" is required.`, "INVALID_INPUT");
  }
  return value.trim();
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
  const email = requireString(value, "email").toLowerCase();
  if (!isValidEmail(email)) {
    throw new AuthError(400, "Enter a valid email address.", "INVALID_EMAIL");
  }
  return email;
}

function normalizeLanguage(value) {
  return value === "zh-CN" ? "zh-CN" : "en";
}

function getConfig(env) {
  const supabaseUrl = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  const supabaseAnonKey = String(env.SUPABASE_ANON_KEY || "");
  const redirectUrl = String(env.SUPABASE_AUTH_REDIRECT_URL || "");
  const authSecret = String(env.AUTH_SECRET || "");
  let validSupabaseUrl = false;
  let validRedirectUrl = false;
  try {
    validSupabaseUrl = ["http:", "https:"].includes(new URL(supabaseUrl).protocol);
    validRedirectUrl = ["http:", "https:"].includes(new URL(redirectUrl).protocol);
  } catch (_error) {
  }
  if (
    !validSupabaseUrl
    || !validRedirectUrl
    || !supabaseAnonKey
    || encoder.encode(authSecret).length < 32
  ) {
    throw new AuthError(
      503,
      "Google login is not configured yet.",
      "GOOGLE_AUTH_NOT_CONFIGURED"
    );
  }
  return { supabaseUrl, supabaseAnonKey, redirectUrl, authSecret };
}

function getSessionSecret(env) {
  const authSecret = String(env.AUTH_SECRET || "");
  if (encoder.encode(authSecret).length < 32) {
    throw new AuthError(503, "Authentication is not configured yet.", "AUTH_NOT_CONFIGURED");
  }
  return authSecret;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function textToBase64Url(value) {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sign(value, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

function equalBytes(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function issueToken(user, secret) {
  const now = Math.floor(Date.now() / 1000);
  const payloadPart = textToBase64Url(JSON.stringify({
    sub: user.id,
    email: user.email || null,
    role: user.role || "student",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  }));
  const signaturePart = bytesToBase64Url(await sign(payloadPart, secret));
  return `${payloadPart}.${signaturePart}`;
}

async function verifyToken(token, secret) {
  const [payloadPart, signaturePart, extra] = String(token || "").split(".");
  if (!payloadPart || !signaturePart || extra) {
    throw new AuthError(401, "Invalid token format.", "UNAUTHORIZED");
  }

  let receivedSignature;
  try {
    receivedSignature = base64UrlToBytes(signaturePart);
  } catch (_error) {
    throw new AuthError(401, "Invalid token signature.", "UNAUTHORIZED");
  }
  const expectedSignature = await sign(payloadPart, secret);
  if (!equalBytes(receivedSignature, expectedSignature)) {
    throw new AuthError(401, "Invalid token signature.", "UNAUTHORIZED");
  }

  let payload;
  try {
    payload = JSON.parse(decoder.decode(base64UrlToBytes(payloadPart)));
  } catch (_error) {
    throw new AuthError(401, "Invalid token payload.", "UNAUTHORIZED");
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload?.sub !== "string" || !payload.sub || !Number.isFinite(payload?.exp) || payload.exp <= now) {
    throw new AuthError(401, "Token expired or invalid.", "UNAUTHORIZED");
  }
  return payload;
}

function readBearerToken(request) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) {
    throw new AuthError(401, "Missing bearer token.", "UNAUTHORIZED");
  }
  return authorization.slice("Bearer ".length).trim();
}

function mapUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    role: row.role,
    grade: row.grade,
    targetScore: row.target_score,
    language: row.language || "en",
    hasPassword: Boolean(row.password_hash),
    pet: {
      enabled: row.pet_enabled !== 0,
      skin: row.pet_skin || "codex-glass",
      position: {
        x: Number(row.pet_position_x ?? 0.92),
        y: Number(row.pet_position_y ?? 0.84),
      },
    },
    isDisabled: Boolean(row.disabled_at),
    disabledAt: row.disabled_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findUserBySupabaseId(db, supabaseUserId) {
  return db.prepare(`
    SELECT *
    FROM users
    WHERE supabase_user_id = ?
    LIMIT 1
  `).bind(supabaseUserId).first();
}

async function findUserByEmail(db, email) {
  return db.prepare(`
    SELECT *
    FROM users
    WHERE lower(email) = lower(?)
    LIMIT 1
  `).bind(email).first();
}

async function getUserById(db, userId) {
  return db.prepare(`
    SELECT *
    FROM users
    WHERE id = ?
    LIMIT 1
  `).bind(userId).first();
}

async function linkExistingUser(db, user, supabaseUserId) {
  if (user.supabase_user_id && user.supabase_user_id !== supabaseUserId) {
    throw new AuthError(409, "Email is linked to another identity.", "IDENTITY_CONFLICT");
  }
  if (user.supabase_user_id === supabaseUserId) return user;

  try {
    await db.prepare(`
      UPDATE users
      SET supabase_user_id = ?, updated_at = ?
      WHERE id = ? AND supabase_user_id IS NULL
    `).bind(supabaseUserId, new Date().toISOString(), user.id).run();
  } catch (_error) {
  }
  const linkedUser = await findUserBySupabaseId(db, supabaseUserId);
  if (!linkedUser) {
    throw new AuthError(409, "Google identity could not be linked.", "IDENTITY_CONFLICT");
  }
  return linkedUser;
}

async function resolveUser(db, identity, language) {
  const supabaseUserId = requireString(identity.id, "id");
  const email = normalizeEmail(identity.email);
  const linkedUser = await findUserBySupabaseId(db, supabaseUserId);
  if (linkedUser) return linkedUser;

  const existingUser = await findUserByEmail(db, email);
  if (existingUser) return linkExistingUser(db, existingUser, supabaseUserId);

  const metadata = identity.user_metadata || {};
  const displayName = String(
    metadata.full_name || metadata.name || email.split("@")[0]
  ).trim() || email.split("@")[0];
  const now = new Date().toISOString();
  try {
    await db.prepare(`
      INSERT INTO users (
        id, email, display_name, role, grade, target_score, language,
        supabase_user_id, created_at, updated_at
      )
      VALUES (?, ?, ?, 'student', NULL, NULL, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(),
      email,
      displayName,
      normalizeLanguage(language),
      supabaseUserId,
      now,
      now
    ).run();
  } catch (_error) {
    const concurrentUser = await findUserBySupabaseId(db, supabaseUserId)
      || await findUserByEmail(db, email);
    if (concurrentUser) return linkExistingUser(db, concurrentUser, supabaseUserId);
    throw _error;
  }
  return findUserBySupabaseId(db, supabaseUserId);
}

async function verifyGoogleIdentity(accessToken, config) {
  let authResponse;
  try {
    authResponse = await fetch(`${config.supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${accessToken}`,
      },
    });
  } catch (_error) {
    throw new AuthError(502, "Google login provider is unavailable.", "AUTH_PROVIDER_UNAVAILABLE");
  }
  if (!authResponse.ok) {
    throw new AuthError(401, "Google login could not be verified.", "UNAUTHORIZED");
  }

  const identity = await authResponse.json();
  const providers = new Set([
    ...(Array.isArray(identity?.app_metadata?.providers) ? identity.app_metadata.providers : []),
    identity?.app_metadata?.provider,
    ...(Array.isArray(identity?.identities)
      ? identity.identities.map((item) => item?.provider)
      : []),
  ].filter(Boolean));
  if (!providers.has("google")) {
    throw new AuthError(401, "A Google identity is required.", "UNAUTHORIZED");
  }
  if (!identity?.email_confirmed_at && !identity?.confirmed_at) {
    throw new AuthError(401, "Google email is not verified.", "UNVERIFIED_EMAIL");
  }
  return identity;
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch (_error) {
    throw new AuthError(400, "Request body must be valid JSON.", "INVALID_INPUT");
  }
}

export async function handleAuthApiRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
  }

  try {
    if (request.method === "GET" && url.pathname === "/api/auth/google/start") {
      const config = getConfig(env);
      const authorizeUrl = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
      authorizeUrl.searchParams.set("provider", "google");
      authorizeUrl.searchParams.set("redirect_to", config.redirectUrl);
      return success({ url: authorizeUrl.toString() }, request.method);
    }

    if (request.method === "POST" && url.pathname === "/api/auth/google") {
      const config = getConfig(env);
      const body = await readJsonBody(request);
      const accessToken = requireString(body.accessToken, "accessToken");
      const identity = await verifyGoogleIdentity(accessToken, config);
      const row = await resolveUser(env.DB, identity, body.language);
      if (!row) {
        throw new AuthError(500, "User account could not be created.", "INTERNAL_SERVER_ERROR");
      }
      const user = mapUser(row);
      if (user.isDisabled) {
        throw new AuthError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
      }
      return success({ user, token: await issueToken(user, config.authSecret) }, request.method);
    }

    if (request.method === "GET" && url.pathname === "/api/auth/me") {
      const payload = await verifyToken(readBearerToken(request), getSessionSecret(env));
      const row = await getUserById(env.DB, payload.sub);
      if (!row) {
        throw new AuthError(401, "User no longer exists.", "UNAUTHORIZED");
      }
      const user = mapUser(row);
      if (user.isDisabled) {
        throw new AuthError(403, "This account has been disabled.", "ACCOUNT_DISABLED");
      }
      return success(user, request.method);
    }

    return routeNotFound(request, url);
  } catch (error) {
    if (error instanceof AuthError) {
      return failure(error.status, error.code, error.message, request.method, error.details);
    }
    console.error("D1 auth API failed", error);
    return failure(
      500,
      "INTERNAL_SERVER_ERROR",
      "Unexpected server error.",
      request.method
    );
  }
}
