import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleChatApiRequest, cleanupChatData } from "../cloudflare/chat-api.js";

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
const envBase = { AUTH_SECRET, CHAT_ENABLED: "true", CHAT_ACCOUNT_V2_ENABLED: "true", CHAT_RECOVERY_BACKUP_ENABLED: "true", DB: await mf.getD1Database("DB"), CHAT_MEDIA_BUCKET: await mf.getR2Bucket("CHAT_MEDIA_BUCKET") };

async function call(user, path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (user) headers.set("Authorization", `Bearer ${await issueToken(user)}`);
  if (options.body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleChatApiRequest(new Request(`https://expassway.test${path}`, { ...options, headers }), envBase);
  return { response, payload: await response.json().catch(() => null) };
}

try {
  const db = envBase.DB;
  const migrationDirectory = new URL("../migrations/", import.meta.url);
  const cleanupMigration = "0024_retired_invites_cleanup.sql";
  for (const file of (await readdir(migrationDirectory)).filter((file) => file.endsWith(".sql") && file !== cleanupMigration).sort()) {
    const sql = await readFile(new URL(file, migrationDirectory), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
  }
  await db.batch([
    db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, ?, 'A', 'student', ?)").bind(userA.id, userA.email, "supabase-a"),
    db.prepare("INSERT INTO users (id, email, display_name, role, supabase_user_id) VALUES (?, ?, 'B', 'student', ?)").bind(userB.id, userB.email, "supabase-b"),
  ]);
  const retiredInvites = [
    { id: "retired-active", tokenHash: "active-token-hash", expiresAt: "2099-01-01T00:00:00.000Z" },
    { id: "retired-expired", tokenHash: "expired-token-hash", expiresAt: "2000-01-01T00:00:00.000Z" },
  ];
  for (const invite of retiredInvites) {
    await db.prepare("INSERT INTO chat_invites (id,creator_user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)")
      .bind(invite.id, userA.id, invite.tokenHash, invite.expiresAt, "2000-01-01T00:00:00.000Z").run();
  }
  const retainedTableCounts = async () => {
    const tables = (await db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND substr(name,1,4) <> '_cf_' AND name <> 'chat_invites' ORDER BY name").all()).results;
    return Promise.all(tables.map(async ({ name }) => {
      try {
        return [name, (await db.prepare(`SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`).first()).count];
      } catch (error) {
        throw new Error(`Cannot snapshot table ${name}: ${error.message}`, { cause: error });
      }
    }));
  };
  const countsBeforeMigration = await retainedTableCounts();
  for (const statement of unstable_splitSqlQuery(await readFile(new URL(cleanupMigration, migrationDirectory), "utf8"))) await db.prepare(statement).run();
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='chat_invites'").first()).count, 0);
  assert.deepEqual(await retainedTableCounts(), countsBeforeMigration);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  for (const [path, method] of [
    ["/api/chat/invites", "GET"],
    ["/api/chat/invites", "POST"],
    ["/api/chat/invites/retired-active", "DELETE"],
    ["/api/chat/invites/active-token-hash/accept", "POST"],
    ["/api/chat/invites/unknown-token/accept", "POST"],
  ]) {
    assert.equal((await call(null, path, { method })).response.status, 401);
    const removed = await call(userA, path, { method });
    assert.equal(removed.response.status, 410);
    assert.equal(removed.payload.error.code, "CHAT_INVITES_REMOVED");
    assert.equal(Object.hasOwn(removed.payload, "data"), false);
  }
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='chat_invites'").first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_account_write_proofs").first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_contacts").first()).count, 0);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_rate_limits WHERE action='invite'").first()).count, 0);
  const invalidKey = { identityPublicKey: "bad.key", registrationId: 12, signedPreKey: { id: 1, publicKey: "key", signature: "sig" }, oneTimePreKeys: [] };
  assert.equal((await call(userA, "/api/chat/devices", { method: "POST", body: JSON.stringify(invalidKey) })).response.status, 400);
  const makeDevice = (prefix) => ({ identityPublicKey: `${prefix}Identity`, registrationId: 123, signedPreKey: { id: 1, publicKey: `${prefix}Signed`, signature: `${prefix}Signature` }, oneTimePreKeys: [{ id: 1, publicKey: `${prefix}Pre` }] });
  const deviceA = await call(userA, "/api/chat/devices", { method: "POST", body: JSON.stringify(makeDevice("a")) });
  const deviceB = await call(userB, "/api/chat/devices", { method: "POST", body: JSON.stringify(makeDevice("b")) });
  assert.equal(deviceA.response.status, 201);
  assert.equal(deviceB.response.status, 201);
  // The current friend path is lookup by public chat ID. Keep the legacy
  // conversation protocol below to cover existing Signal-v1 history as well.
  const timestamp = new Date().toISOString();
  for (const user of [userA, userB]) {
    await db.batch([
      db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,created_at,updated_at) VALUES (?,'test-1',?,?,?,?,?)")
        .bind(user.id, "public-encryption-key", "public-signing-key", "public-fingerprint", timestamp, timestamp),
      db.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), user.id, user.id, "public-passkey", "prf-salt", timestamp),
      db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,'test-1',?,'hkdf-sha256-v1','nonce','encrypted-vault',?)")
        .bind(user.id, user.id, timestamp),
      db.prepare("INSERT INTO chat_account_identity_heads (user_id,key_version,credential_id) VALUES (?,'test-1',?)")
        .bind(user.id, user.id),
    ]);
  }
  const profileB = (await call(userB, "/api/chat/profile")).payload.data;
  const found = await call(userA, `/api/chat/users/search?q=${encodeURIComponent(profileB.chatUserId)}`);
  assert.equal(found.response.status, 200);
  assert.equal(found.payload.data[0].chatUserId, profileB.chatUserId);
  assert.equal(found.payload.data[0].enabled, true);
  const contact = await call(userA, "/api/chat/contacts/by-user-id", {
    method: "POST", body: JSON.stringify({ chatUserId: profileB.chatUserId }),
  });
  assert.equal(contact.response.status, 201);
  const repeatedContact = await call(userA, "/api/chat/contacts/by-user-id", {
    method: "POST", body: JSON.stringify({ chatUserId: profileB.chatUserId }),
  });
  assert.equal(repeatedContact.payload.data.id, contact.payload.data.id);
  const createdConversation = await call(userA, "/api/chat/conversations", {
    method: "POST", body: JSON.stringify({ contactId: contact.payload.data.id }),
  });
  assert.equal(createdConversation.response.status, 201);
  const conversationId = createdConversation.payload.data.id;
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
  // Test expiration at the exact boundary in each storage unit, as well as
  // consumed-but-unexpired records and both supported SQL timestamp formats.
  const cleanupNowMs = Math.floor(Date.now() / 1000) * 1000;
  const cleanupNowSeconds = cleanupNowMs / 1000;
  const cleanupMinute = Math.floor(cleanupNowSeconds / 60) * 60;
  const cleanupTimestamp = new Date(cleanupNowMs).toISOString();
  const activeTimestamp = new Date(cleanupNowMs + 60_000).toISOString();
  const activeSqlTimestamp = activeTimestamp.replace("T", " ").replace(".000Z", "");
  const cleanupUserId = "33333333-3333-4333-8333-333333333333";
  await db.prepare("INSERT INTO users (id,email,display_name,role) VALUES (?, 'maintenance@example.com', 'Maintenance', 'student')").bind(cleanupUserId).run();
  for (const [id, expiresAt, usedAt] of [
    ["active", activeTimestamp, null],
    ["active-sql", activeSqlTimestamp, null],
    ["expired", cleanupTimestamp, null],
    ["used", activeTimestamp, cleanupTimestamp],
  ]) {
    await db.batch([
      db.prepare("INSERT INTO auth_passkey_challenges (id,email,user_id,challenge,rp_id,origin,expires_at,created_at,used_at,purpose) VALUES (?,?,?,?, 'expassway.test','https://expassway.test',?,?,?, 'authenticate')")
        .bind(`cleanup-${id}`, userA.email, userA.id, `auth-cleanup-${id}`, expiresAt, cleanupTimestamp, usedAt),
      db.prepare("INSERT INTO chat_webauthn_challenges (id,user_id,challenge,kind,expires_at,created_at,used_at) VALUES (?,?,?,'authentication',?,?,?)")
        .bind(`cleanup-${id}`, userA.id, `chat-cleanup-${id}`, expiresAt, cleanupTimestamp, usedAt),
    ]);
  }
  for (const [id, expiresAt, usesRemaining] of [
    ["active", activeTimestamp, 5], ["expired", cleanupTimestamp, 5], ["exhausted", activeTimestamp, 0],
  ]) await db.prepare("INSERT INTO chat_account_write_proofs (id,token_hash,user_id,uses_remaining,expires_at,created_at) VALUES (?,?,?,?,?,?)")
    .bind(`cleanup-${id}`, `proof-cleanup-${id}`, userA.id, usesRemaining, expiresAt, cleanupTimestamp).run();
  for (const [id, expiresAt, usedAt] of [
    ["active", activeTimestamp, null], ["expired", cleanupTimestamp, null], ["used", activeTimestamp, cleanupTimestamp],
  ]) await db.batch([
    db.prepare("INSERT INTO chat_ws_tickets (id,token_hash,user_id,conversation_id,expires_at,created_at,used_at) VALUES (?,?,?,?,?,?,?)")
      .bind(`cleanup-${id}`, `ws-cleanup-${id}`, userA.id, conversationId, expiresAt, cleanupTimestamp, usedAt),
    db.prepare("INSERT INTO chat_device_approval_tickets (id,token_hash,user_id,issuer_device_id,expires_at,created_at,used_at) VALUES (?,?,?,?,?,?,?)")
      .bind(`cleanup-${id}`, `approval-cleanup-${id}`, userB.id, deviceB.payload.data.device.id, expiresAt, cleanupTimestamp, usedAt),
  ]);
  for (const [emailHash, availableAt] of [["active", cleanupNowSeconds + 1], ["expired", cleanupNowSeconds], ["older", cleanupNowSeconds - 1]])
    await db.prepare("INSERT INTO email_otp_cooldowns (email_hash,available_at,updated_at) VALUES (?,?,?)").bind(emailHash, availableAt, cleanupTimestamp).run();
  for (const [action, windowStart] of [["cleanup-active", cleanupMinute], ["cleanup-old", cleanupMinute - 60], ["cleanup-future", cleanupMinute + 60], ["invite", cleanupMinute + 60]])
    await db.prepare("INSERT INTO chat_rate_limits (user_id,action,window_start,request_count,updated_at) VALUES (?,?,?,10,?)").bind(userA.id, action, windowStart, cleanupTimestamp).run();
  for (const [userId, calledAt] of [[userA.id, cleanupNowMs - 29_999], [userB.id, cleanupNowMs - 30_000], [cleanupUserId, cleanupNowMs - 30_001]])
    await db.prepare("INSERT INTO ai_call_cooldowns (user_id,reservation_id,called_at) VALUES (?,?,?)").bind(userId, `cleanup-${userId}`, calledAt).run();
  const protectedTables = ["users", "chat_messages", "chat_conversations", "chat_devices", "chat_device_prekeys", "chat_passkeys", "chat_account_keys", "chat_vaults", "chat_account_vault_versions", "chat_account_vault_wrappers", "chat_account_identity_heads", "chat_epoch_recipients", "ai_hint_generation_events", "structured_practice_attempts", "practice_sessions", "question_attempts", "saved_papers"];
  const protectedRows = async () => Promise.all(protectedTables.map(async (table) => [table, (await db.prepare(`SELECT * FROM ${table}`).all()).results]));
  const rowsBeforeMaintenance = await protectedRows();
  const actualDateNow = Date.now;
  Date.now = () => cleanupNowMs;
  try {
    await cleanupChatData(envBase);
  } finally {
    Date.now = actualDateNow;
  }
  assert.deepEqual(await protectedRows(), rowsBeforeMaintenance);
  for (const table of ["auth_passkey_challenges", "chat_webauthn_challenges"])
    assert.deepEqual((await db.prepare(`SELECT id FROM ${table} WHERE id LIKE 'cleanup-%' ORDER BY id`).all()).results.map(({ id }) => id), ["cleanup-active", "cleanup-active-sql"]);
  assert.deepEqual((await db.prepare("SELECT id FROM chat_account_write_proofs WHERE id LIKE 'cleanup-%' ORDER BY id").all()).results.map(({ id }) => id), ["cleanup-active", "cleanup-exhausted"]);
  for (const table of ["chat_ws_tickets", "chat_device_approval_tickets"])
    assert.deepEqual((await db.prepare(`SELECT id FROM ${table} WHERE id LIKE 'cleanup-%' ORDER BY id`).all()).results.map(({ id }) => id), ["cleanup-active"]);
  assert.deepEqual((await db.prepare("SELECT email_hash FROM email_otp_cooldowns ORDER BY email_hash").all()).results, [{ email_hash: "active" }]);
  assert.deepEqual((await db.prepare("SELECT action FROM chat_rate_limits WHERE action LIKE 'cleanup-%' OR action='invite' ORDER BY action").all()).results, [{ action: "cleanup-active" }, { action: "cleanup-future" }]);
  assert.deepEqual((await db.prepare("SELECT user_id,called_at FROM ai_call_cooldowns").all()).results, [{ user_id: userA.id, called_at: cleanupNowMs - 29_999 }]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM sqlite_schema WHERE name='chat_invites'").first()).count, 0);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  console.log("Cloudflare chat API smoke checks passed: retired invite migration, active cooldown boundaries, ID contacts and legacy chat history preserved.");
} finally {
  await mf.dispose();
}
