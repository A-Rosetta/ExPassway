import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleChatApiRequest } from "../cloudflare/chat-api.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";

async function issueToken(user) {
  const payload = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: 1, exp: 4102444800 })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
}

const mf = new Miniflare({ compatibilityDate: "2026-07-29", d1Databases: { DB: "chat-api-test" }, r2Buckets: { CHAT_MEDIA_BUCKET: "chat-media-test" }, modules: true, script: "export default { fetch() { return new Response('ok'); } };" });
const userA = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.com", role: "student" };
const userB = { id: "22222222-2222-4222-8222-222222222222", email: "b@example.com", role: "student" };
const envBase = { AUTH_SECRET, CHAT_ENABLED: "true", CHAT_RECOVERY_BACKUP_ENABLED: "true", DB: await mf.getD1Database("DB"), CHAT_MEDIA_BUCKET: await mf.getR2Bucket("CHAT_MEDIA_BUCKET") };

async function call(user, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (user) headers.set("Authorization", `Bearer ${await issueToken(user)}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleChatApiRequest(new Request(`https://expassway.test${path}`, { ...options, headers }), envBase);
  return { response, payload: await response.json().catch(() => null) };
}

try {
  const db = envBase.DB;
  for (const file of ["../migrations/0001_initial.sql", "../migrations/0002_supabase_auth.sql", "../migrations/0003_admin_platform.sql", "../migrations/0006_chat_foundation.sql", "../migrations/0007_chat_crypto_hardening.sql"]) {
    const sql = await readFile(new URL(file, import.meta.url), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
  }
  await db.batch([
    db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, ?, 'A', 'student', ?)").bind(userA.id, userA.email, "supabase-a"),
    db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, ?, 'B', 'student', ?)").bind(userB.id, userB.email, "supabase-b"),
  ]);
  assert.equal((await call(null, "/api/chat/invites")).response.status, 401);
  const invalidKey = { identityPublicKey: "bad.key", registrationId: 12, signedPreKey: { id: 1, publicKey: "key", signature: "sig" }, oneTimePreKeys: [] };
  assert.equal((await call(userA, "/api/chat/devices", { method: "POST", body: JSON.stringify(invalidKey) })).response.status, 400);
  const makeDevice = (prefix) => ({ identityPublicKey: `${prefix}Identity`, registrationId: 123, signedPreKey: { id: 1, publicKey: `${prefix}Signed`, signature: `${prefix}Signature` }, oneTimePreKeys: [{ id: 1, publicKey: `${prefix}Pre` }] });
  const deviceA = await call(userA, "/api/chat/devices", { method: "POST", body: JSON.stringify(makeDevice("a")) });
  const deviceB = await call(userB, "/api/chat/devices", { method: "POST", body: JSON.stringify(makeDevice("b")) });
  assert.equal(deviceA.response.status, 201);
  assert.equal(deviceB.response.status, 201);
  const invite = await call(userA, "/api/chat/invites", { method: "POST" });
  assert.equal(invite.response.status, 201);
  const accepted = await call(userB, `/api/chat/invites/${invite.payload.data.token}/accept`, { method: "POST" });
  assert.equal(accepted.response.status, 201);
  assert.equal((await call(userB, `/api/chat/invites/${invite.payload.data.token}/accept`, { method: "POST" })).response.status, 409);
  const conversationId = accepted.payload.data.conversationId;
  const contactsA = await call(userA, "/api/chat/contacts");
  assert.equal(contactsA.response.status, 200);
  const group = await call(userA, "/api/chat/conversations", {
    method: "POST",
    body: JSON.stringify({ kind: "group", contactIds: [contactsA.payload.data[0].id] }),
  });
  assert.equal(group.response.status, 201);
  assert.equal(group.payload.data.kind, "group");
  assert.equal(group.payload.data.group.memberCount, 2);
  const groupBundle = await call(userA, `/api/chat/conversations/${group.payload.data.id}/bundle`);
  assert.equal(groupBundle.response.status, 200);
  assert.equal(groupBundle.payload.data.members.length, 1);
  assert.equal(groupBundle.payload.data.members[0].devices.length, 1);
  const ciphertext = Buffer.from(JSON.stringify({ type: 3, body: "secret-ciphertext" })).toString("base64url");
  const messageInput = { conversationId, senderDeviceId: deviceB.payload.data.device.id, clientMessageId: "client-1", ciphertext, protocolVersion: "signal-v1" };
  const message = await call(userB, "/api/chat/messages", { method: "POST", body: JSON.stringify(messageInput) });
  assert.equal(message.response.status, 201);
  const duplicate = await call(userB, "/api/chat/messages", { method: "POST", body: JSON.stringify(messageInput) });
  assert.equal(duplicate.response.status, 201);
  assert.equal(duplicate.payload.data.duplicate, true);
  const sync = await call(userA, `/api/chat/sync?conversationId=${encodeURIComponent(conversationId)}`);
  assert.equal(sync.response.status, 200);
  assert.equal(sync.payload.data.messages[0].ciphertext, ciphertext);
  assert.equal(sync.payload.data.messages[0].ciphertext.includes("secret"), false);
  const groupMessageInput = {
    conversationId: group.payload.data.id,
    senderDeviceId: deviceA.payload.data.device.id,
    clientMessageId: "group-client-1",
    ciphertext,
    protocolVersion: "signal-v1",
  };
  const groupMessage = await call(userA, "/api/chat/messages", { method: "POST", body: JSON.stringify(groupMessageInput) });
  assert.equal(groupMessage.response.status, 201);
  const groupSync = await call(userB, `/api/chat/sync?conversationId=${encodeURIComponent(group.payload.data.id)}`);
  assert.equal(groupSync.response.status, 200);
  assert.equal(groupSync.payload.data.messages.length, 1);
  assert.equal(groupSync.payload.data.messages[0].ciphertext, ciphertext);
  const backup = await call(userA, "/api/chat/key-backup", { method: "PUT", body: JSON.stringify({ kdfVersion: "argon2id-v1", salt: "salt", nonce: "nonce", ciphertext: "encrypted-key-package" }) });
  assert.equal(backup.response.status, 400);
  const validBackup = await call(userA, "/api/chat/key-backup", { method: "PUT", body: JSON.stringify({
    kdfVersion: "argon2id-v1", backupVersion: "1", sourceDeviceId: deviceA.payload.data.device.id,
    salt: "c2FsdA", nonce: "bm9uY2U", ciphertext: "ZW5jcnlwdGVkLWtleS1wYWNrYWdl",
  }) });
  assert.equal(validBackup.response.status, 200);
  const devices = await call(userA, "/api/chat/devices");
  assert.equal(typeof devices.payload.data[0].oneTimePreKeyCount, "number");
  const refill = await call(userA, `/api/chat/devices/${deviceA.payload.data.device.id}/prekeys`, {
    method: "POST", body: JSON.stringify({ oneTimePreKeys: [{ id: 101, publicKey: "cHJla2V5" }] }),
  });
  assert.equal(refill.response.status, 201);
  const storedBackup = await call(userA, "/api/chat/key-backup");
  const restoreOperationId = storedBackup.payload.data.restoreOperationId;
  const restoreInput = {
    deviceId: restoreOperationId,
    restoreOperationId,
    sourceDeviceId: deviceA.payload.data.device.id,
    identityPublicKey: "aIdentity",
    registrationId: 123,
    signedPreKey: { id: 2, publicKey: "aSigned2", signature: "aSignature2" },
    oneTimePreKeys: [{ id: 1, publicKey: "aPre" }],
    label: "Restored test device",
  };
  const restored = await call(userA, "/api/chat/key-backup/restore", { method: "POST", body: JSON.stringify(restoreInput) });
  assert.equal(restored.response.status, 201);
  assert.equal(restored.payload.data.idempotent, false);
  assert.equal(restored.payload.data.previousDeviceId, deviceA.payload.data.device.id);
  assert.equal((await call(userA, `/api/chat/devices/${deviceA.payload.data.device.id}/prekeys`, {
    method: "POST", body: JSON.stringify({ oneTimePreKeys: [{ id: 102, publicKey: "cHJla2V5" }] }),
  })).response.status, 404);
  const repeated = await call(userA, "/api/chat/key-backup/restore", { method: "POST", body: JSON.stringify(restoreInput) });
  assert.equal(repeated.response.status, 201);
  assert.equal(repeated.payload.data.idempotent, true);
  assert.equal(repeated.payload.data.device.id, restored.payload.data.device.id);
  console.log("Cloudflare chat API smoke checks passed.");
} finally {
  await mf.dispose();
}
