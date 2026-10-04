import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleChatApiRequest } from "../cloudflare/chat-api.js";
import { handleAuthApiRequest } from "../cloudflare/auth-api.js";

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

async function issueToken(account = user) {
  const payload = Buffer.from(
    JSON.stringify({ sub: account.id, email: account.email, role: account.role, iat: 1, exp: 4102444800 })
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
  SUPABASE_URL: "https://supabase.test",
  SUPABASE_ANON_KEY: "test-anon-key",
  SUPABASE_AUTH_REDIRECT_URL: "https://expassway.test/pages/login.html",
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

async function authCall(path, body, method = "POST", authenticated = true) {
  const headers = { "Content-Type": "application/json" };
  if (authenticated) headers.Authorization = `Bearer ${await issueToken(typeof authenticated === "object" ? authenticated : user)}`;
  const response = await handleAuthApiRequest(new Request(`https://expassway.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { response, payload: await response.json() };
}

async function registrationFor(options) {
  const signing = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", signing.publicKey);
  const id = crypto.getRandomValues(new Uint8Array(32));
  const cose = cborMap([
    [1, cborUnsigned(2)], [3, cborInteger(-7)], [-1, cborUnsigned(1)],
    [-2, cborBytes(Buffer.from(jwk.x, "base64url"))], [-3, cborBytes(Buffer.from(jwk.y, "base64url"))],
  ]);
  const data = concat(await sha256("expassway.test"), Uint8Array.of(0x45), countBytes(0), new Uint8Array(16), Uint8Array.of(0, id.length), id, cose);
  return { signing, id: base64Url(id), credential: {
    id: base64Url(id), rawId: base64Url(id), type: "public-key",
    response: {
      clientDataJSON: clientData("webauthn.create", options.publicKey.challenge),
      attestationObject: base64Url(cborMap([["fmt", cborText("none")], ["authData", cborBytes(data)], ["attStmt", cborMap([])]])),
      transports: ["internal"],
    },
    clientExtensionResults: { prf: { enabled: true } },
  } };
}

async function assertionFor(options, credentialId, signing, count) {
  const data = clientData("webauthn.get", options.publicKey.challenge);
  const authenticatorData = concat(await sha256("expassway.test"), Uint8Array.of(0x05), countBytes(count));
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signing.privateKey,
    concat(authenticatorData, await sha256(Buffer.from(data, "base64url"))));
  return {
    id: credentialId, rawId: credentialId, type: "public-key",
    response: { clientDataJSON: data, authenticatorData: base64Url(authenticatorData), signature: base64Url(signature) },
    clientExtensionResults: { prf: { enabled: true } },
  };
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
    "../migrations/0005_email_otp_cooldown.sql",
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
    "../migrations/0017_chat_directory_global.sql",
    "../migrations/0018_shared_passkeys.sql",
  ]) {
    for (const statement of unstable_splitSqlQuery(
      await readFile(new URL(file, import.meta.url), "utf8")
    ))
      await env.DB.prepare(statement).run();
  }
  await env.DB.prepare(`INSERT INTO auth_passkey_challenges
    (id,email,challenge,rp_id,origin,expires_at,created_at) VALUES ('pre-migration-challenge','legacy@example.com',
      'old-challenge','expassway.test','https://expassway.test','2099-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`).run();
  for (const statement of unstable_splitSqlQuery(await readFile(new URL("../migrations/0021_auth_passkey_challenge_purpose.sql", import.meta.url), "utf8"))) {
    await env.DB.prepare(statement).run();
  }
  assert.ok((await env.DB.prepare("SELECT used_at FROM auth_passkey_challenges WHERE id='pre-migration-challenge'").first()).used_at);
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

  // A shared Passkey signs into the account without pretending it can decrypt
  // a vault encrypted with another authenticator's PRF secret.
  const initialized = await call("/api/chat/account/initialize", {
    proof: authenticated.payload.data.proof, keyVersion: "first-chat-key",
    encryptionPublicKey: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    signingPublicKey: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    fingerprint: base64Url(crypto.getRandomValues(new Uint8Array(32))),
    nonce: base64Url(crypto.getRandomValues(new Uint8Array(12))),
    ciphertext: base64Url(crypto.getRandomValues(new Uint8Array(48))),
  });
  assert.equal(initialized.response.status, 201, JSON.stringify(initialized.payload));
  const beforeKeys = await env.DB.prepare("SELECT * FROM chat_passkeys WHERE user_id=?").bind(user.id).all();
  const originalPasskey = beforeKeys.results[0];
  const sharedOptions = await authCall("/api/auth/me/passkeys/options", {});
  assert.equal(sharedOptions.response.status, 200);
  const shared = await registrationFor(sharedOptions.payload.data);
  const wrongRegistrationPurpose = await authCall("/api/auth/passkey/verify", {
    email: user.email, challenge: sharedOptions.payload.data.publicKey.challenge, credential: shared.credential,
  }, "POST", false);
  assert.equal(wrongRegistrationPurpose.payload.error.code, "INVALID_WEBAUTHN_CHALLENGE");
  const missingPrf = await authCall("/api/auth/me/passkeys/verify", {
    challenge: sharedOptions.payload.data.publicKey.challenge,
    credential: { ...shared.credential, clientExtensionResults: {} },
  });
  assert.equal(missingPrf.payload.error.code, "WEBAUTHN_PRF_REQUIRED");
  const sharedRegistered = await authCall("/api/auth/me/passkeys/verify", {
    challenge: sharedOptions.payload.data.publicKey.challenge, credential: shared.credential,
  });
  assert.equal(sharedRegistered.response.status, 201, JSON.stringify(sharedRegistered.payload));
  const registrationReplay = await authCall("/api/auth/me/passkeys/verify", {
    challenge: sharedOptions.payload.data.publicKey.challenge, credential: shared.credential,
  });
  assert.equal(registrationReplay.payload.error.code, "INVALID_WEBAUTHN_CHALLENGE");
  assert.equal((await env.DB.prepare("SELECT prf_salt FROM chat_passkeys WHERE credential_id=?").bind(base64Url(credentialId)).first()).prf_salt, originalPasskey.prf_salt);
  const listing = await authCall("/api/auth/me/passkeys", undefined, "GET");
  assert.equal(listing.payload.data.find((item) => item.credentialId === base64Url(credentialId)).chatUnlock, true);
  assert.equal(listing.payload.data.find((item) => item.credentialId === base64Url(credentialId)).revokeBlockedReason, "LAST_CHAT_PASSKEY");
  assert.equal(listing.payload.data.find((item) => item.credentialId === shared.id).canRevoke, true);
  const sharedLoginOptions = await authCall("/api/auth/passkey/options", { email: user.email }, "POST", false);
  assert.deepEqual(new Set(sharedLoginOptions.payload.data.publicKey.allowCredentials.map((item) => item.id)), new Set([base64Url(credentialId), shared.id]));
  assert.equal(sharedLoginOptions.payload.data.publicKey.extensions.prf.evalByCredential[base64Url(credentialId)].first, originalPasskey.prf_salt);
  const wrongAuthPurpose = await authCall("/api/auth/me/passkeys/verify", {
    challenge: sharedLoginOptions.payload.data.publicKey.challenge, credential: shared.credential,
  });
  assert.equal(wrongAuthPurpose.payload.error.code, "INVALID_WEBAUTHN_CHALLENGE");
  const sharedAssertion = await assertionFor(sharedLoginOptions.payload.data, shared.id, shared.signing, 1);
  const missingSignature = await authCall("/api/auth/passkey/verify", {
    email: user.email, challenge: sharedLoginOptions.payload.data.publicKey.challenge,
    credential: { ...sharedAssertion, response: { ...sharedAssertion.response, signature: undefined } },
  }, "POST", false);
  assert.equal(missingSignature.response.status, 400);
  const signedIn = await authCall("/api/auth/passkey/verify", {
    email: user.email, challenge: sharedLoginOptions.payload.data.publicKey.challenge, credential: sharedAssertion,
  }, "POST", false);
  assert.equal(signedIn.response.status, 200, JSON.stringify(signedIn.payload));
  assert.equal(signedIn.payload.data.user.id, user.id);
  assert.ok(signedIn.payload.data.token);
  const loginReplay = await authCall("/api/auth/passkey/verify", {
    email: user.email, challenge: sharedLoginOptions.payload.data.publicKey.challenge, credential: sharedAssertion,
  }, "POST", false);
  assert.equal(loginReplay.payload.error.code, "INVALID_WEBAUTHN_CHALLENGE");
  const chatWithShared = await call("/api/chat/account/passkeys/authenticate/options", {});
  assert.deepEqual(chatWithShared.payload.data.publicKey.allowCredentials.map((item) => item.id), [base64Url(credentialId)]);
  const rejectedSharedUnlock = await call("/api/chat/account/passkeys/authenticate/verify", {
    challenge: chatWithShared.payload.data.publicKey.challenge,
    credential: await assertionFor(chatWithShared.payload.data, shared.id, shared.signing, 2),
  });
  assert.equal(rejectedSharedUnlock.payload.error.code, "WEBAUTHN_CREDENTIAL_MISMATCH");
  const protectedChatCredential = await authCall(`/api/auth/me/passkeys/${originalPasskey.id}`, undefined, "DELETE");
  assert.equal(protectedChatCredential.payload.error.code, "LAST_CHAT_PASSKEY");
  const sharedRow = await env.DB.prepare("SELECT id FROM chat_passkeys WHERE credential_id=?").bind(shared.id).first();
  assert.equal((await authCall(`/api/auth/me/passkeys/${sharedRow.id}`, undefined, "DELETE")).response.status, 200);
  const protectedLastCredential = await authCall(`/api/auth/me/passkeys/${originalPasskey.id}`, undefined, "DELETE");
  assert.equal(protectedLastCredential.payload.error.code, "LAST_PASSKEY");
  const revokedLoginOptions = await authCall("/api/auth/passkey/options", { email: user.email }, "POST", false);
  const revokedLogin = await authCall("/api/auth/passkey/verify", {
    email: user.email, challenge: revokedLoginOptions.payload.data.publicKey.challenge,
    credential: await assertionFor(revokedLoginOptions.payload.data, shared.id, shared.signing, 2),
  }, "POST", false);
  assert.equal(revokedLogin.payload.error.code, "WEBAUTHN_CREDENTIAL_NOT_FOUND");

  // Preserved historical identities need their original credential even when
  // another credential now wraps the current identity.
  await env.DB.prepare("UPDATE chat_passkeys SET revoked_at=NULL WHERE credential_id=?").bind(shared.id).run();
  await env.DB.prepare(`INSERT INTO chat_account_vault_versions
    (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at)
    VALUES (?,'second-chat-key',?,'hkdf-sha256-v1',?,?,?)`).bind(user.id, shared.id,
    base64Url(crypto.getRandomValues(new Uint8Array(12))), base64Url(crypto.getRandomValues(new Uint8Array(48))), new Date().toISOString()).run();
  await env.DB.prepare("UPDATE chat_account_identity_heads SET key_version='second-chat-key',credential_id=? WHERE user_id=?").bind(shared.id, user.id).run();
  const protectedHistorical = await authCall(`/api/auth/me/passkeys/${originalPasskey.id}`, undefined, "DELETE");
  assert.equal(protectedHistorical.payload.error.code, "LAST_CHAT_PASSKEY");
  const retainedBeforeMigration = await env.DB.prepare("SELECT key_version,credential_id,nonce,ciphertext FROM chat_account_vault_versions WHERE user_id=? ORDER BY key_version").bind(user.id).all();
  for (const statement of unstable_splitSqlQuery(await readFile(new URL("../migrations/0018_shared_passkeys.sql", import.meta.url), "utf8"))) {
    await env.DB.prepare(statement).run();
  }
  const retainedAfterMigration = await env.DB.prepare("SELECT key_version,credential_id,nonce,ciphertext FROM chat_account_vault_versions WHERE user_id=? ORDER BY key_version").bind(user.id).all();
  assert.deepEqual(retainedAfterMigration.results, retainedBeforeMigration.results);
  assert.deepEqual((await env.DB.prepare("SELECT key_version,credential_id,nonce,ciphertext FROM chat_account_vault_wrappers WHERE user_id=? ORDER BY key_version").bind(user.id).all()).results, retainedBeforeMigration.results);
  assert.equal((await env.DB.prepare("PRAGMA foreign_key_check").all()).results.length, 0);

  // Two concurrent removals cannot race past the last-credential guard.
  const secondary = { id: crypto.randomUUID(), email: "parallel@example.com", role: "student" };
  await env.DB.prepare("INSERT INTO users (id,email,display_name,role) VALUES (?,?,'Parallel','student')").bind(secondary.id, secondary.email).run();
  const parallelIds = [crypto.randomUUID(), crypto.randomUUID()];
  for (const id of parallelIds) await env.DB.prepare(`INSERT INTO chat_passkeys
    (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)`).bind(id, secondary.id,
    base64Url(crypto.getRandomValues(new Uint8Array(32))), "test-unused-key", base64Url(crypto.getRandomValues(new Uint8Array(32))), new Date().toISOString()).run();
  const removals = await Promise.all(parallelIds.map((id) => authCall(`/api/auth/me/passkeys/${id}`, undefined, "DELETE", secondary)));
  assert.deepEqual(removals.map((item) => item.response.status).sort(), [200, 409]);
  assert.equal(removals.find((item) => item.response.status === 409).payload.error.code, "LAST_PASSKEY");
  assert.equal((await env.DB.prepare("SELECT COUNT(*) AS count FROM chat_passkeys WHERE user_id=? AND revoked_at IS NULL").bind(secondary.id).first()).count, 1);

  // Account login remains recoverable by email when a Passkey is unavailable.
  const originalFetch = globalThis.fetch;
  let otpSent = false;
  globalThis.fetch = async (url) => {
    assert.equal(String(url), "https://supabase.test/auth/v1/otp");
    otpSent = true;
    return Response.json({});
  };
  try {
    const fallback = await authCall("/api/auth/email/otp", { email: user.email }, "POST", false);
    assert.equal(fallback.response.status, 200);
    assert.equal(fallback.payload.data.sent, true);
    assert.equal(otpSent, true);
  } finally { globalThis.fetch = originalFetch; }
  console.log("Cloudflare chat passkey smoke checks passed.");
} finally {
  await mf.dispose();
}
