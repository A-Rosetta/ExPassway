import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { handleAuthApiRequest } from "../cloudflare/auth-api.js";

const originalFetch = globalThis.fetch;
const originalDateNow = Date.now;
const originalCrypto = globalThis.crypto;
if (!globalThis.crypto) globalThis.crypto = webcrypto;
const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";
const BASE_ENV = {
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_AUTH_REDIRECT_URL: "https://expassway.test/pages/login.html",
  AUTH_SECRET,
};

function makeUser(overrides = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "student@example.com",
    display_name: "Existing Student",
    role: "student",
    grade: null,
    target_score: null,
    created_at: "2026-07-30T00:00:00.000Z",
    updated_at: "2026-07-30T00:00:00.000Z",
    password_hash: null,
    language: "en",
    disabled_at: null,
    pet_enabled: 1,
    pet_skin: "codex-glass",
    pet_position_x: 0.92,
    pet_position_y: 0.84,
    supabase_user_id: null,
    ...overrides,
  };
}

class FakeDatabase {
  constructor(users = []) {
    this.users = users.map((user) => ({ ...user }));
    this.emailOtpCooldowns = new Map();
  }

  prepare(sql) {
    const statement = sql.replace(/\s+/g, " ").trim();
    return {
      bind: (...values) => ({
        first: async () => {
          if (statement.includes("FROM email_otp_cooldowns")) {
            const availableAt = this.emailOtpCooldowns.get(values[0]);
            return availableAt ? { available_at: availableAt } : null;
          }
          if (statement.includes("WHERE supabase_user_id = ?")) {
            return this.users.find((user) => user.supabase_user_id === values[0]) || null;
          }
          if (statement.includes("WHERE lower(email) = lower(?)")) {
            const email = String(values[0]).toLowerCase();
            return this.users.find((user) => String(user.email).toLowerCase() === email) || null;
          }
          if (statement.includes("WHERE id = ?")) {
            return this.users.find((user) => user.id === values[0]) || null;
          }
          throw new Error(`Unexpected first() SQL: ${statement}`);
        },
        run: async () => {
          if (statement.startsWith("INSERT INTO email_otp_cooldowns")) {
            const [hash, availableAt, _updatedAt, nowSeconds] = values;
            const current = this.emailOtpCooldowns.get(hash);
            if (current && current > nowSeconds) return { meta: { changes: 0 } };
            this.emailOtpCooldowns.set(hash, availableAt);
            return { meta: { changes: 1 } };
          }
          if (statement.startsWith("UPDATE users SET supabase_user_id")) {
            const [supabaseUserId, updatedAt, userId] = values;
            if (this.users.some((user) => user.supabase_user_id === supabaseUserId)) {
              throw new Error("UNIQUE constraint failed: users.supabase_user_id");
            }
            const user = this.users.find((item) => item.id === userId && item.supabase_user_id === null);
            if (user) {
              user.supabase_user_id = supabaseUserId;
              user.updated_at = updatedAt;
            }
            return { success: true };
          }
          if (statement.startsWith("INSERT INTO users")) {
            const [id, email, displayName, language, supabaseUserId, createdAt, updatedAt] = values;
            if (this.users.some((user) => user.email.toLowerCase() === email.toLowerCase())) {
              throw new Error("UNIQUE constraint failed: users.email");
            }
            if (this.users.some((user) => user.supabase_user_id === supabaseUserId)) {
              throw new Error("UNIQUE constraint failed: users.supabase_user_id");
            }
            this.users.push(makeUser({
              id,
              email,
              display_name: displayName,
              language,
              supabase_user_id: supabaseUserId,
              created_at: createdAt,
              updated_at: updatedAt,
            }));
            return { success: true };
          }
          throw new Error(`Unexpected run() SQL: ${statement}`);
        },
      }),
    };
  }
}

function googleIdentity(overrides = {}) {
  return {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    email: "student@example.com",
    email_confirmed_at: "2026-07-30T00:00:00.000Z",
    app_metadata: { provider: "google", providers: ["google"] },
    identities: [{ provider: "google" }],
    user_metadata: { full_name: "Google Student" },
    ...overrides,
  };
}

let identityResponse = googleIdentity();
let identityStatus = 200;
globalThis.fetch = async (url, options = {}) => {
  const requestUrl = String(url);
  assert.equal(options.headers.apikey, BASE_ENV.SUPABASE_ANON_KEY);
  if (requestUrl === "https://supabase.test/auth/v1/user") {
    assert.match(options.headers.Authorization, /^Bearer /);
    return Response.json(identityResponse, { status: identityStatus });
  }
  if (requestUrl === "https://supabase.test/auth/v1/otp") {
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {
      email: "student@example.com",
      create_user: true,
    });
    return Response.json({});
  }
  if (requestUrl === "https://supabase.test/auth/v1/verify") {
    assert.equal(options.method, "POST");
    assert.deepEqual(JSON.parse(options.body), {
      email: "student@example.com",
      token: "123456",
      type: "email",
    });
    return Response.json({ user: identityResponse }, { status: identityStatus });
  }
  throw new Error(`Unexpected Supabase URL: ${requestUrl}`);
};

async function request(path, options = {}, envOverrides = {}, database = new FakeDatabase()) {
  const response = await handleAuthApiRequest(new Request(`https://expassway.test${path}`, options), {
    ...BASE_ENV,
    ...envOverrides,
    DB: database,
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
}

try {
  {
    const { response, payload } = await request("/api/auth/google/start", {}, {
      SUPABASE_URL: "",
      SUPABASE_ANON_KEY: "",
      SUPABASE_AUTH_REDIRECT_URL: "",
      AUTH_SECRET: "",
    });
    assert.equal(response.status, 503);
    assert.equal(payload.error.code, "GOOGLE_AUTH_NOT_CONFIGURED");
  }

  {
    const { response, payload } = await request("/api/auth/google/start");
    assert.equal(response.status, 200);
    const url = new URL(payload.data.url);
    assert.equal(url.origin, "https://supabase.test");
    assert.equal(url.pathname, "/auth/v1/authorize");
    assert.equal(url.searchParams.get("provider"), "google");
    assert.equal(url.searchParams.get("redirect_to"), BASE_ENV.SUPABASE_AUTH_REDIRECT_URL);
    assert.equal(url.searchParams.get("prompt"), "select_account");
  }

  {
    const { response } = await request("/api/auth/google/start", { method: "OPTIONS" });
    assert.equal(response.status, 204);
    assert.match(response.headers.get("access-control-allow-methods") || "", /POST/);
  }

  let sessionToken;
  {
    identityResponse = googleIdentity();
    identityStatus = 200;
    const database = new FakeDatabase([makeUser()]);
    const { response, payload } = await request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "valid-google-token", language: "zh-CN" }),
    }, {}, database);
    assert.equal(response.status, 200);
    assert.equal(payload.data.user.id, "11111111-1111-4111-8111-111111111111");
    assert.equal(payload.data.user.language, "en");
    assert.equal(database.users[0].supabase_user_id, identityResponse.id);
    assert.match(payload.data.token, /^[^.]+\.[^.]+$/);
    sessionToken = payload.data.token;

    const current = await request("/api/auth/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    }, {}, database);
    assert.equal(current.response.status, 200);
    assert.equal(current.payload.data.id, payload.data.user.id);

    const tampered = await request("/api/auth/me", {
      headers: { Authorization: `Bearer ${sessionToken}x` },
    }, {}, database);
    assert.equal(tampered.response.status, 401);
    assert.equal(tampered.payload.error.code, "UNAUTHORIZED");

    Date.now = () => originalDateNow() + (31 * 24 * 60 * 60 * 1000);
    const expired = await request("/api/auth/me", {
      headers: { Authorization: `Bearer ${sessionToken}` },
    }, {}, database);
    assert.equal(expired.response.status, 401);
    assert.equal(expired.payload.error.message, "Token expired or invalid.");
    Date.now = originalDateNow;
  }

  {
    identityResponse = googleIdentity({
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      email: "new.student@example.com",
      user_metadata: { full_name: "New Student" },
    });
    const database = new FakeDatabase();
    const { response, payload } = await request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "new-google-token", language: "zh-CN" }),
    }, {}, database);
    assert.equal(response.status, 200);
    assert.equal(database.users.length, 1);
    assert.equal(payload.data.user.email, "new.student@example.com");
    assert.equal(payload.data.user.displayName, "New Student");
    assert.equal(payload.data.user.language, "zh-CN");
    assert.equal(payload.data.user.role, "student");
  }

  {
    const database = new FakeDatabase();
    const otpRequest = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "Student@Example.com" }),
    };
    const { response, payload } = await request("/api/auth/email/otp", otpRequest, {}, database);
    assert.equal(response.status, 200);
    assert.deepEqual(payload.data, { sent: true, retryAfterSeconds: 60 });

    const limited = await request("/api/auth/email/otp", otpRequest, {}, database);
    assert.equal(limited.response.status, 429);
    assert.equal(limited.payload.error.code, "OTP_RATE_LIMITED");
    assert.equal(limited.payload.error.details.retryAfterSeconds, 60);

    Date.now = () => originalDateNow() + 60_000;
    const allowedAgain = await request("/api/auth/email/otp", otpRequest, {}, database);
    assert.equal(allowedAgain.response.status, 200);
    Date.now = originalDateNow;
  }

  {
    identityResponse = googleIdentity({
      app_metadata: { provider: "email", providers: ["email", "google"] },
      identities: [{ provider: "email" }, { provider: "google" }],
    });
    identityStatus = 200;
    const database = new FakeDatabase([makeUser({
      supabase_user_id: identityResponse.id,
    })]);
    const { response, payload } = await request("/api/auth/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "student@example.com", code: "123456", language: "en" }),
    }, {}, database);
    assert.equal(response.status, 200);
    assert.equal(database.users.length, 1);
    assert.equal(payload.data.user.id, "11111111-1111-4111-8111-111111111111");
    assert.match(payload.data.token, /^[^.]+\.[^.]+$/);
  }

  {
    identityResponse = googleIdentity({
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      email: "student@example.com",
      app_metadata: { provider: "email", providers: ["email"] },
      identities: [{ provider: "email" }],
    });
    identityStatus = 401;
    const database = new FakeDatabase();
    const { response, payload } = await request("/api/auth/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "student@example.com", code: "123456" }),
    }, {}, database);
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "INVALID_OTP");
    assert.equal(database.users.length, 0);
    identityStatus = 200;
  }

  {
    const { response, payload } = await request("/api/auth/email/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "student@example.com", code: "12ab" }),
    });
    assert.equal(response.status, 400);
    assert.equal(payload.error.code, "INVALID_OTP");
  }

  {
    identityResponse = googleIdentity({
      app_metadata: { provider: "email", providers: ["email"] },
      identities: [{ provider: "email" }],
    });
    const { response, payload } = await request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "email-token" }),
    });
    assert.equal(response.status, 401);
    assert.equal(payload.error.message, "A Google identity is required.");
  }

  {
    identityResponse = googleIdentity({ email_confirmed_at: null, confirmed_at: null });
    const { response, payload } = await request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "unverified-token" }),
    });
    assert.equal(response.status, 401);
    assert.equal(payload.error.code, "UNVERIFIED_EMAIL");
  }

  {
    identityResponse = googleIdentity();
    identityStatus = 401;
    const { response, payload } = await request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "invalid-token" }),
    });
    assert.equal(response.status, 401);
    assert.equal(payload.error.message, "Google login could not be verified.");
    identityStatus = 200;
  }

  {
    identityResponse = googleIdentity();
    const database = new FakeDatabase([makeUser({ disabled_at: "2026-07-30T01:00:00.000Z" })]);
    const { response, payload } = await request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "disabled-token" }),
    }, {}, database);
    assert.equal(response.status, 403);
    assert.equal(payload.error.code, "ACCOUNT_DISABLED");
  }

  {
    identityResponse = googleIdentity();
    const database = new FakeDatabase([makeUser({
      supabase_user_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    })]);
    const { response, payload } = await request("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "conflicting-token" }),
    }, {}, database);
    assert.equal(response.status, 409);
    assert.equal(payload.error.code, "IDENTITY_CONFLICT");
  }

  {
    const { response, payload } = await request("/api/auth/me");
    assert.equal(response.status, 401);
    assert.equal(payload.error.message, "Missing bearer token.");
  }

  console.log("Cloudflare Supabase Google Auth smoke checks passed.");
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalDateNow;
  if (!originalCrypto) delete globalThis.crypto;
}
