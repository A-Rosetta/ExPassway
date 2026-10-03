import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleChatApiRequest } from "../cloudflare/chat-api.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";
const encoder = new TextEncoder();
const user = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "passkey@example.com",
  role: "student",
};

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function cborHead(major, value) {
  if (value < 24) return Uint8Array.of((major << 5) | value);
  if (value <= 0xff) return Uint8Array.of((major << 5) | 24, value);
  if (value <= 0xffff) return Uint8Array.of((major << 5) | 25, value >>> 8, value & 0xff);
  return Uint8Array.of(
    (major << 5) | 26,
    value >>> 24,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff
  );
}

function concat(...parts) {
  const length = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function cborUnsigned(value) {
  return cborHead(0, value);
}
function cborInteger(value) {
  return value >= 0 ? cborUnsigned(value) : cborHead(1, -1 - value);
}
function cborBytes(value) {
  return concat(cborHead(2, value.length), value);
}
function cborText(value) {
  const bytes = encoder.encode(value);
  return concat(cborHead(3, bytes.length), bytes);
}
function cborMap(entries) {
  return concat(
    cborHead(5, entries.length),
    ...entries.flatMap(([key, value]) => [
      typeof key === "string" ? cborText(key) : cborInteger(key),
      value,
    ])
  );
}

async function sha256(value) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", typeof value === "string" ? encoder.encode(value) : value)
  );
}

async function issueToken() {
  const payload = Buffer.from(
    JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: 1, exp: 4102444800 })
  ).toString("base64url");
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(AUTH_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return `${payload}.${Buffer.from(await crypto.subtle.sign("HMAC", key, encoder.encode(payload))).toString("base64url")}`;
}

const mf = new Miniflare({
  compatibilityDate: "2026-07-29",
  d1Databases: { DB: "chat-passkey-test" },
  modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});
const env = {
  AUTH_SECRET,
  CHAT_ENABLED: "true",
  CHAT_ACCOUNT_V2_ENABLED: "true",
  CHAT_WEBAUTHN_RP_ID: "expassway.test",
  CHAT_WEBAUTHN_ORIGIN: "https://expassway.test",
  DB: await mf.getD1Database("DB"),
};

async function call(path, body) {
  const headers = {
    Authorization: `Bearer ${await issueToken()}`,
    "Content-Type": "application/json",
  };
  const response = await handleChatApiRequest(
    new Request(`https://expassway.test${path}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env
  );
  return { response, payload: await response.json() };
}

function clientData(type, challenge, origin = "https://expassway.test") {
  return base64Url(encoder.encode(JSON.stringify({ type, challenge, origin, crossOrigin: false })));
}

function countBytes(count) {
  return Uint8Array.of(
    (count >>> 24) & 0xff,
    (count >>> 16) & 0xff,
    (count >>> 8) & 0xff,
    count & 0xff
  );
}

try {
  for (const file of [
    "../migrations/0001_initial.sql",
    "../migrations/0002_supabase_auth.sql",
    "../migrations/0003_admin_platform.sql",
    "../migrations/0006_chat_foundation.sql",
    "../migrations/0007_chat_crypto_hardening.sql",
    "../migrations/0008_chat_account_v2.sql",
    "../migrations/0009_chat_webauthn_context.sql",
    "../migrations/0010_chat_account_write_proofs.sql",
    "../migrations/0011_chat_messages_account_sender.sql",
    "../migrations/0012_chat_message_sender_key.sql",
    "../migrations/0013_chat_account_lifecycle.sql",
    "../migrations/0014_chat_passkey_hardening.sql",
    "../migrations/0015_chat_conversation_protocol.sql",
    "../migrations/0016_chat_profile_history.sql",
  ]) {
    for (const statement of unstable_splitSqlQuery(
      await readFile(new URL(file, import.meta.url), "utf8")
    ))
      await env.DB.prepare(statement).run();
  }
  await env.DB.prepare(
    "INSERT INTO users (id,email,display_name,role,supabase_user_id) VALUES (?,?,'Passkey','student',?)"
  )
    .bind(user.id, user.email, "passkey-user")
    .run();

  const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const credentialId = crypto.getRandomValues(new Uint8Array(32));
  const registrationOptions = await call("/api/chat/account/passkeys/register/options", {});
  assert.equal(registrationOptions.response.status, 200);
  const registrationChallenge = registrationOptions.payload.data.publicKey.challenge;
  const coseKey = cborMap([
    [1, cborUnsigned(2)],
    [3, cborInteger(-7)],
    [-1, cborUnsigned(1)],
    [-2, cborBytes(Buffer.from(publicJwk.x, "base64url"))],
    [-3, cborBytes(Buffer.from(publicJwk.y, "base64url"))],
  ]);
  const registrationAuthData = concat(
    await sha256("expassway.test"),
    Uint8Array.of(0x45),
    countBytes(0),
    new Uint8Array(16),
    Uint8Array.of(0, credentialId.length),
    credentialId,
    coseKey
  );
  const attestationObject = cborMap([
    ["fmt", cborText("none")],
    ["authData", cborBytes(registrationAuthData)],
    ["attStmt", cborMap([])],
  ]);
  const registrationCredential = {
    id: base64Url(credentialId),
    rawId: base64Url(credentialId),
    type: "public-key",
    response: {
      clientDataJSON: clientData("webauthn.create", registrationChallenge),
      attestationObject: base64Url(attestationObject),
      transports: ["internal"],
    },
    clientExtensionResults: { prf: { enabled: true } },
  };
  const registered = await call("/api/chat/account/passkeys/register/verify", {
    challenge: registrationChallenge,
    credential: registrationCredential,
  });
  assert.equal(registered.response.status, 201);
  assert.equal(registered.payload.data.credentialId, base64Url(credentialId));

  const authenticationOptions = await call("/api/chat/account/passkeys/authenticate/options", {});
  assert.equal(authenticationOptions.response.status, 200);
  const authenticationChallenge = authenticationOptions.payload.data.publicKey.challenge;
  const authenticationClientData = clientData("webauthn.get", authenticationChallenge);
  const authenticationData = concat(
    await sha256("expassway.test"),
    Uint8Array.of(0x05),
    countBytes(1)
  );
  const signedData = concat(
    authenticationData,
    await sha256(Buffer.from(authenticationClientData, "base64url"))
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signedData)
  );
  const assertion = {
    id: base64Url(credentialId),
    rawId: base64Url(credentialId),
    type: "public-key",
    response: {
      clientDataJSON: authenticationClientData,
      authenticatorData: base64Url(authenticationData),
      signature: base64Url(signature),
    },
    clientExtensionResults: { prf: { enabled: true } },
  };
  const authenticated = await call("/api/chat/account/passkeys/authenticate/verify", {
    challenge: authenticationChallenge,
    credential: assertion,
  });
  assert.equal(authenticated.response.status, 200);
  assert.equal(authenticated.payload.data.signCount, 1);
  const replay = await call("/api/chat/account/passkeys/authenticate/verify", {
    challenge: authenticationChallenge,
    credential: assertion,
  });
  assert.equal(replay.response.status, 400);

  const wrongOriginOptions = await call("/api/chat/account/passkeys/authenticate/options", {});
  const wrongOriginChallenge = wrongOriginOptions.payload.data.publicKey.challenge;
  const rejected = await call("/api/chat/account/passkeys/authenticate/verify", {
    challenge: wrongOriginChallenge,
    credential: {
      ...assertion,
      response: {
        ...assertion.response,
        clientDataJSON: clientData("webauthn.get", wrongOriginChallenge, "https://attacker.test"),
      },
    },
  });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.payload.error.code, "INVALID_WEBAUTHN_ORIGIN");

  const wrongRpOptions = await call("/api/chat/account/passkeys/authenticate/options", {});
  const wrongRpChallenge = wrongRpOptions.payload.data.publicKey.challenge;
  const wrongRpClientData = clientData("webauthn.get", wrongRpChallenge);
  const wrongRpAuthenticatorData = concat(
    await sha256("attacker.test"),
    Uint8Array.of(0x0d),
    countBytes(2)
  );
  const wrongRpSignedData = concat(
    wrongRpAuthenticatorData,
    await sha256(Buffer.from(wrongRpClientData, "base64url"))
  );
  const wrongRpSignature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.privateKey,
      wrongRpSignedData
    )
  );
  const wrongRp = await call("/api/chat/account/passkeys/authenticate/verify", {
    challenge: wrongRpChallenge,
    credential: {
      ...assertion,
      response: {
        ...assertion.response,
        clientDataJSON: wrongRpClientData,
        authenticatorData: base64Url(wrongRpAuthenticatorData),
        signature: base64Url(wrongRpSignature),
      },
    },
  });
  assert.equal(wrongRp.response.status, 400);
  assert.equal(wrongRp.payload.error.code, "INVALID_WEBAUTHN_RP_ID");

  const expiredOptions = await call("/api/chat/account/passkeys/authenticate/options", {});
  const expiredChallenge = expiredOptions.payload.data.publicKey.challenge;
  await env.DB.prepare(
    "UPDATE chat_webauthn_challenges SET expires_at='2000-01-01T00:00:00.000Z' WHERE challenge=?"
  )
    .bind(expiredChallenge)
    .run();
  const expired = await call("/api/chat/account/passkeys/authenticate/verify", {
    challenge: expiredChallenge,
    credential: assertion,
  });
  assert.equal(expired.response.status, 400);
  assert.equal(expired.payload.error.code, "INVALID_WEBAUTHN_CHALLENGE");

  const authOptionsAgain = await call("/api/chat/account/passkeys/authenticate/options", {});
  assert.equal(authOptionsAgain.payload.data.publicKey.extensions.prf.eval.first,
    authenticationOptions.payload.data.publicKey.extensions.prf.eval.first);
  console.log("Cloudflare chat passkey smoke checks passed.");
} finally {
  await mf.dispose();
}
