import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleChatApiRequest } from "../cloudflare/chat-api.js";
import { canonicalAccountJson } from "../cloudflare/chat-account-v2.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";
const encoder = new TextEncoder();
const b64 = (value) => Buffer.from(value).toString("base64url");
const opaque = (length) => b64(crypto.getRandomValues(new Uint8Array(length)));
const timestamp = new Date().toISOString();
const users = await Promise.all(["alice", "bob", "carol", "dan"].map(async (name) => ({
  id: crypto.randomUUID(), email: `${name}@example.com`, name, role: "student", keyVersion: `${name}-1`,
  signing: await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]),
})));
const [alice, bob, carol, dan] = users;
const mf = new Miniflare({ compatibilityDate: "2026-07-29", d1Databases: { DB: "chat-contact-safety" },
  r2Buckets: { CHAT_MEDIA_BUCKET: "chat-contact-media" }, modules: true, script: "export default { fetch() { return new Response('ok'); } };" });
const db = await mf.getD1Database("DB");
const env = { AUTH_SECRET, CHAT_ENABLED: "true", CHAT_ACCOUNT_V2_ENABLED: "true", DB: db, CHAT_MEDIA_BUCKET: await mf.getR2Bucket("CHAT_MEDIA_BUCKET") };
async function token(user) {
  const payload = b64(encoder.encode(JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: 1, exp: 4102444800 })));
  const key = await crypto.subtle.importKey("raw", encoder.encode(AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${b64(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))}`;
}
async function call(user, path, method = "GET", body) {
  const headers = new Headers({ Authorization: `Bearer ${await token(user)}` });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleChatApiRequest(new Request(`https://expassway.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: response.status, payload: await response.json().catch(() => null) };
}
async function sign(user, value) {
  return { ...value, signature: b64(await crypto.subtle.sign("Ed25519", user.signing.privateKey, encoder.encode(canonicalAccountJson(value)))) };
}
async function send(user, conversationId) {
  return sign(user, { version: "account-v2", conversationId, clientMessageId: crypto.randomUUID(), epoch: 1,
    senderUserId: user.id, senderKeyId: user.keyVersion, nonce: opaque(12), ciphertext: opaque(48), attachmentRefs: [] });
}
async function friend(sender, recipient) {
  const sent = await call(sender, "/api/chat/contacts/by-user-id", "POST", { chatUserId: recipient.name });
  assert.equal(sent.status, 201, JSON.stringify(sent.payload));
  const accepted = await call(recipient, `/api/chat/contact-requests/${sent.payload.data.request.id}/accept`, "POST");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
  return (await call(sender, "/api/chat/contacts")).payload.data.find((item) => item.profile.chatUserId === recipient.name).id;
}
async function create(kind, contactId) {
  const conversationId = crypto.randomUUID();
  const recipients = users.slice(0, 2).map((user) => ({ userId: user.id, keyVersion: user.keyVersion, ephemeralPublicKey: opaque(32), nonce: opaque(12), ciphertext: opaque(48) }));
  const payload = { kind, contactIds: [contactId], recipients };
  if (kind === "group") payload.metadata = { epoch: 1, version: 1, nonce: opaque(12), ciphertext: opaque(48) };
  const body = await sign(alice, { version: "account-v2", conversationId, expectedEpoch: 0, action: "create", payload,
    senderUserId: alice.id, senderKeyId: alice.keyVersion });
  const result = await call(alice, "/api/chat/conversations", "POST", body);
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  return { id: conversationId, body };
}
const listed = async (user, id) => (await call(user, "/api/chat/conversations")).payload.data.find((item) => item.id === id);

try {
  const directory = new URL("../migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort())
    for (const statement of unstable_splitSqlQuery(await readFile(new URL(file, directory), "utf8"))) await db.prepare(statement).run();
  for (const user of users) {
    await db.batch([
      db.prepare("INSERT INTO users (id,email,display_name,role,supabase_user_id) VALUES (?,?,?,'student',?)").bind(user.id, user.email, user.name, user.id),
      db.prepare("INSERT INTO chat_profiles (user_id,chat_alias,chat_user_id,profile_ciphertext,created_at,updated_at) VALUES (?,?,?,'',?,?)").bind(user.id, user.name, user.name, timestamp, timestamp),
      db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(user.id, user.keyVersion, opaque(32), b64(await crypto.subtle.exportKey("raw", user.signing.publicKey)), opaque(32), timestamp, timestamp),
      db.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, user.id, opaque(32), opaque(32), timestamp),
      db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,'hkdf-sha256-v1',?,?,?)").bind(user.id, user.keyVersion, user.id, opaque(12), opaque(48), timestamp),
      db.prepare("INSERT INTO chat_account_identity_heads (user_id,key_version,credential_id) VALUES (?,?,?)").bind(user.id, user.keyVersion, user.id),
    ]);
  }
  const contactId = await friend(alice, bob);
  const direct = await create("direct", contactId), group = await create("group", contactId);
  assert.equal((await listed(alice, direct.id)).canSend, true);
  assert.equal((await listed(alice, direct.id)).peer.chatUserId, "bob");
  assert.equal((await listed(alice, group.id)).group.members.find((member) => member.userId === bob.id).chatUserId, "bob");
  const message = await call(bob, "/api/chat/messages", "POST", await send(bob, direct.id));
  assert.equal(message.status, 201, JSON.stringify(message.payload));
  const report = await call(alice, "/api/chat/contact-reports", "POST", { chatUserId: "bob", reason: "harassment", details: "Please review this contact.", messageId: message.payload.data.message.id });
  assert.equal(report.status, 201);
  assert.equal((await db.prepare("SELECT details FROM chat_contact_reports WHERE id=?").bind(report.payload.data.reportId).first()).details, "Please review this contact.");
  assert.equal((await call(alice, "/api/chat/contact-reports", "POST", { chatUserId: "bob", reason: "harassment", messageId: message.payload.data.message.id })).payload.data.reportId, report.payload.data.reportId);
  assert.equal((await call(carol, "/api/chat/contact-reports", "POST", { chatUserId: "bob", reason: "spam" })).status, 403);
  assert.equal((await call(carol, "/api/chat/contact-reports", "POST", { chatUserId: "bob", reason: "spam", messageId: message.payload.data.message.id })).status, 404);
  assert.equal((await call(alice, "/api/chat/contact-reports", "POST", { chatUserId: "carol", reason: "spam", messageId: message.payload.data.message.id })).status, 404);
  assert.equal((await call(alice, "/api/chat/contact-reports", "POST", { chatUserId: "bob", reason: "bad" })).status, 400);
  assert.equal((await call(alice, "/api/chat/contact-reports", "POST", { chatUserId: "bob", reason: "spam", details: "x".repeat(2001) })).status, 413);

  const blocked = await call(alice, "/api/chat/blocks", "POST", { chatUserId: "bob" });
  assert.equal(blocked.status, 201);
  assert.equal(blocked.payload.data.profile.chatUserId, "bob");
  assert.equal((await call(alice, "/api/chat/blocks")).payload.data[0].chatUserId, "bob");
  assert.equal((await call(bob, "/api/chat/blocks")).payload.data.length, 0);
  assert.equal((await call(alice, "/api/chat/contacts")).payload.data[0].blockedBySelf, true);
  assert.equal((await listed(alice, direct.id)).peer.blockedBySelf, true);
  assert.equal((await listed(bob, direct.id)).peer.blockedBySelf, false);
  assert.equal((await listed(bob, direct.id)).canSend, false);
  for (const sender of [alice, bob]) {
    assert.equal((await call(sender, "/api/chat/messages", "POST", await send(sender, direct.id))).payload.error.code, "CHAT_CONTACT_BLOCKED");
    assert.equal((await call(sender, "/api/chat/attachments/init", "POST", { conversationId: direct.id, contentEpoch: 1, sizeBytes: 20 })).status, 403);
  }
  assert.equal((await call(alice, `/api/chat/contacts/${contactId}/account-key`)).status, 403);
  assert.equal((await call(bob, "/api/chat/contacts/by-user-id", "POST", { chatUserId: "alice" })).status, 403);
  assert.equal((await call(bob, "/api/chat/users/search?q=alice")).payload.data.length, 0);
  assert.equal((await call(alice, "/api/chat/messages", "POST", await send(alice, group.id))).status, 201);
  assert.equal((await call(alice, `/api/chat/sync-events?conversationId=${direct.id}`)).status, 200);
  await assert.rejects(db.prepare(`INSERT INTO chat_messages (id,conversation_id,sender_user_id,client_message_id,ciphertext,created_at)
    VALUES (?,?,?,?,?,?)`).bind(crypto.randomUUID(), direct.id, bob.id, crypto.randomUUID(), "encrypted", timestamp).run(), /CHAT_CONTACT_BLOCKED/);
  assert.equal((await call(alice, "/api/chat/blocks/bob", "DELETE")).status, 200);
  assert.equal((await listed(alice, direct.id)).canSend, true);
  assert.equal((await call(alice, "/api/chat/messages", "POST", await send(alice, direct.id))).status, 201);

  // Read markers must remain monotonic for out-of-order requests and tied times.
  const tiedTime = "2098-01-01T00:00:00.000Z";
  for (const id of ["read-a", "read-b", "read-c"])
    await db.prepare("INSERT INTO chat_messages (id,conversation_id,sender_user_id,client_message_id,ciphertext,created_at) VALUES (?,?,?,?,?,?)")
      .bind(id, direct.id, bob.id, id, "encrypted", tiedTime).run();
  const readB = await call(alice, `/api/chat/conversations/${direct.id}/read`, "POST", { messageId: "read-b" });
  assert.equal(readB.payload.data.unreadCount, 1);
  const stale = await call(alice, `/api/chat/conversations/${direct.id}/read`, "POST", { messageId: "read-a" });
  assert.equal(stale.payload.data.lastReadMessageId, "read-b");
  assert.equal(stale.payload.data.unreadCount, 1);
  await Promise.all(["read-a", "read-c"].map((messageId) => call(alice, `/api/chat/conversations/${direct.id}/read`, "POST", { messageId })));
  const readAll = await call(alice, `/api/chat/conversations/${direct.id}/read`, "POST", {});
  assert.equal(readAll.payload.data.lastReadMessageId, "read-c");
  assert.equal(readAll.payload.data.unreadCount, 0);

  const messageCount = (await db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id=?").bind(direct.id).first()).n;
  assert.equal((await call(carol, `/api/chat/contacts/${contactId}`, "DELETE")).status, 404);
  assert.equal((await call(alice, `/api/chat/contacts/${contactId}`, "DELETE")).status, 200);
  assert.equal((await call(alice, "/api/chat/contacts")).payload.data.length, 0);
  assert.equal((await call(bob, "/api/chat/contacts")).payload.data.length, 0);
  assert.equal((await listed(alice, direct.id)).peer.contactAccepted, false);
  assert.equal((await call(alice, "/api/chat/messages", "POST", await send(alice, direct.id))).payload.error.code, "CHAT_FRIENDSHIP_REQUIRED");
  assert.equal((await call(alice, `/api/chat/sync-events?conversationId=${direct.id}`)).status, 200);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE conversation_id=?").bind(direct.id).first()).n, messageCount);
  assert.equal((await call(alice, "/api/chat/contact-reports", "POST", { chatUserId: "bob", reason: "spam" })).status, 201);

  const pending = await call(carol, "/api/chat/contacts/by-user-id", "POST", { chatUserId: "dan" });
  assert.equal(pending.status, 201);
  await call(dan, "/api/chat/blocks", "POST", { chatUserId: "carol" });
  assert.deepEqual((await call(dan, "/api/chat/contact-requests")).payload.data, { incoming: [], outgoing: [] });
  assert.equal((await call(dan, `/api/chat/contact-requests/${pending.payload.data.request.id}/accept`, "POST")).status, 409);
  assert.equal((await call(carol, "/api/chat/contacts/by-user-id", "POST", { chatUserId: "dan" })).status, 403);
  await call(dan, "/api/chat/blocks/carol", "DELETE");
  const cooldown = await call(carol, "/api/chat/contacts/by-user-id", "POST", { chatUserId: "dan" });
  assert.equal(cooldown.status, 429);
  assert.equal(cooldown.payload.error.code, "FRIEND_REQUEST_COOLDOWN");
  assert.ok(cooldown.payload.error.retryAfterSeconds > 0 || cooldown.payload.error.details?.retryAfterSeconds > 0);

  // Concurrent creates cannot exceed the durable hourly cap.
  for (let i = 0; i < 9; i++)
    await db.prepare("INSERT INTO chat_friend_requests (id,sender_user_id,recipient_user_id,status,created_at,resolved_at) VALUES (?,?,?,'rejected',?,?)")
      .bind(crypto.randomUUID(), dan.id, bob.id, timestamp, timestamp).run();
  const raced = await Promise.all([alice, carol].map((target) => call(dan, "/api/chat/contacts/by-user-id", "POST", { chatUserId: target.name })));
  assert.deepEqual(raced.map((result) => result.status).sort(), [201, 429]);
  assert.equal(raced.find((result) => result.status === 429).payload.error.code, "FRIEND_REQUEST_RATE_LIMITED");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM chat_friend_requests WHERE sender_user_id=?").bind(dan.id).first()).n, 10);
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  console.log("Chat contact safety checks passed: report authorization, reversible blocks, preserved history, monotonic reads and concurrent request limits.");
} finally {
  await mf.dispose();
}
