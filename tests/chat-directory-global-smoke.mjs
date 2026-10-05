import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
const now = new Date().toISOString();
const admin = { id: crypto.randomUUID(), email: "admin@example.com", role: "admin" };
const student = { id: crypto.randomUUID(), email: "student@example.com", role: "student" };
const late = { id: crypto.randomUUID(), email: "late@example.com", role: "student" };
for (const user of [admin, student, late]) {
  user.signing = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  user.signingPublicKey = b64(await crypto.subtle.exportKey("raw", user.signing.publicKey));
}

async function token(user) {
  const payload = b64(encoder.encode(JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: 1, exp: 4102444800 })));
  const key = await crypto.subtle.importKey("raw", encoder.encode(AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${b64(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))}`;
}
const mf = new Miniflare({ compatibilityDate: "2026-07-29", d1Databases: { DB: "directory-global-test" }, modules: true, script: "export default { fetch() { return new Response('ok'); } };" });
const env = { AUTH_SECRET, CHAT_ENABLED: "true", CHAT_ACCOUNT_V2_ENABLED: "true", DB: await mf.getD1Database("DB") };
async function call(user, path, method = "GET", body) {
  const headers = new Headers({ Authorization: `Bearer ${await token(user)}` });
  if (body !== undefined) headers.set("Content-Type", "application/json");
  const response = await handleChatApiRequest(new Request(`https://expassway.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  return { status: response.status, payload: await response.json().catch(() => null) };
}
function accountRow(db, user, keyVersion) {
  return [
    db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,status,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?)").bind(user.id, keyVersion, opaque(32), user.signingPublicKey, opaque(32), now, now),
    db.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, user.id, opaque(32), opaque(32), now),
    db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,'hkdf-sha256-v1',?,?,?)").bind(user.id, keyVersion, user.id, opaque(12), opaque(48), now),
    db.prepare("INSERT INTO chat_account_identity_heads (user_id,key_version,credential_id) VALUES (?,?,?)").bind(user.id, keyVersion, user.id),
  ];
}
function envelope(user, keyVersion) { return { userId: user.id, keyVersion, ephemeralPublicKey: opaque(32), nonce: opaque(12), ciphertext: opaque(48) }; }
function metadata(epoch) { return { epoch, version: epoch, nonce: opaque(12), ciphertext: opaque(32) }; }
async function sign(user, value) {
  return { ...value, signature: b64(await crypto.subtle.sign("Ed25519", user.signing.privateKey, encoder.encode(canonicalAccountJson(value)))) };
}
async function control(user, conversationId, expectedEpoch, action, payload) {
  return sign(user, { version: "account-v2", conversationId, expectedEpoch, action, payload, senderUserId: user.id, senderKeyId: `${user.email.split("@")[0]}-1` });
}
async function message(user, conversationId, epoch) {
  return sign(user, { version: "account-v2", conversationId, clientMessageId: crypto.randomUUID(), epoch,
    senderUserId: user.id, senderKeyId: `${user.email.split("@")[0]}-1`, nonce: opaque(12), ciphertext: opaque(48), attachmentRefs: [] });
}

try {
  const db = env.DB;
  for (const file of ["0001_initial", "0002_supabase_auth", "0003_admin_platform", "0006_chat_foundation", "0007_chat_crypto_hardening", "0008_chat_account_v2", "0009_chat_webauthn_context", "0010_chat_account_write_proofs", "0011_chat_messages_account_sender", "0012_chat_message_sender_key", "0013_chat_account_lifecycle", "0014_chat_passkey_hardening", "0015_chat_conversation_protocol", "0016_chat_profile_history", "0017_chat_directory_global", "0018_shared_passkeys", "0025_chat_friend_requests"]) {
    for (const statement of unstable_splitSqlQuery(await readFile(new URL(`../migrations/${file}.sql`, import.meta.url), "utf8"))) await db.prepare(statement).run();
  }
  for (const user of [admin, student, late]) {
    await db.prepare("INSERT INTO users (id,email,display_name,role,supabase_user_id) VALUES (?,?,?,?,?)").bind(user.id, user.email, user.email, user.role, user.id).run();
    await db.prepare("INSERT INTO chat_profiles (user_id,chat_alias,chat_user_id,profile_ciphertext,created_at,updated_at) VALUES (?,?,?,'',?,?)").bind(user.id, user.email.split("@")[0], `user_${user.id.slice(0, 8)}`, now, now).run();
  }
  await db.batch([...accountRow(db, admin, "admin-1"), ...accountRow(db, student, "student-1")]);

  const profile = await call(admin, "/api/chat/profile");
  assert.equal(profile.status, 200);
  const customId = `Admin_${admin.id.slice(0, 6)}`;
  const changedProfile = await call(admin, "/api/chat/profile", "PATCH", { chatUserId: customId, alias: profile.payload.data.alias });
  assert.equal(changedProfile.status, 200);
  assert.equal(changedProfile.payload.data.chatUserId, customId);
  const search = await call(admin, `/api/chat/users/search?q=${customId}`);
  assert.equal(search.status, 200);
  assert.equal(search.payload.data.some((item) => item.chatUserId === customId), false);
  const targetId = (await call(student, "/api/chat/profile")).payload.data.chatUserId;
  const found = await call(admin, `/api/chat/users/search?q=${targetId}`);
  assert.equal(found.status, 200);
  assert.equal(found.payload.data[0].enabled, true);
  assert.equal(Object.hasOwn(found.payload.data[0], "userId"), false);
  const retainedStudentVault = await db.prepare("SELECT * FROM chat_account_vault_versions WHERE user_id=?").bind(student.id).first();
  const retainedStudentHead = await db.prepare("SELECT * FROM chat_account_identity_heads WHERE user_id=?").bind(student.id).first();
  const replacementCredential = opaque(32);
  await db.batch([
    db.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), student.id, replacementCredential, opaque(32), opaque(32), now),
    db.prepare("UPDATE chat_passkeys SET revoked_at=? WHERE user_id=? AND credential_id=?").bind(now, student.id, student.id),
    db.prepare("INSERT INTO chat_account_vault_wrappers (user_id,key_version,credential_id,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(student.id, "other-version", replacementCredential, opaque(12), opaque(48), now),
  ]);
  const notLinked = await call(admin, `/api/chat/users/search?q=${targetId}`);
  assert.equal(notLinked.payload.data[0].enabled, false);
  assert.equal((await call(admin, "/api/chat/contacts/by-user-id", "POST", { chatUserId: targetId })).status, 409);
  const notGloballyReady = await call(admin, "/api/chat/global-discussion");
  assert.deepEqual(notGloballyReady.payload.data.pendingRecipients.map((recipient) => recipient.userId), [admin.id]);
  await db.prepare("INSERT INTO chat_account_vault_wrappers (user_id,key_version,credential_id,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?)")
    .bind(student.id, "student-1", replacementCredential, opaque(12), opaque(48), now).run();
  const wrappedReady = await call(student, "/api/chat/account/keys");
  assert.equal(wrappedReady.payload.data.enabled, true);
  assert.equal(wrappedReady.payload.data.credentialId, replacementCredential);
  const stillSearchable = await call(admin, `/api/chat/users/search?q=${targetId}`);
  assert.equal(stillSearchable.payload.data[0].enabled, true);
  assert.equal((await call(admin, "/api/chat/global-discussion")).payload.data.pendingRecipients.length, 2);
  assert.deepEqual(await db.prepare("SELECT * FROM chat_account_vault_versions WHERE user_id=?").bind(student.id).first(), retainedStudentVault);
  assert.deepEqual(await db.prepare("SELECT * FROM chat_account_identity_heads WHERE user_id=?").bind(student.id).first(), retainedStudentHead);
  assert.equal((await call(admin, "/api/chat/contacts/by-user-id", "POST", { chatUserId: targetId, introduction: "x".repeat(501) })).status, 413);
  assert.equal((await call(admin, "/api/chat/contacts/by-user-id", "POST", { chatUserId: targetId, introduction: {} })).status, 400);
  const added = await call(admin, "/api/chat/contacts/by-user-id", "POST", { chatUserId: targetId, introduction: "Hi, we study together." });
  assert.equal(added.status, 201);
  assert.equal(added.payload.data.id, null);
  assert.equal(added.payload.data.request.introduction, "Hi, we study together.");
  assert.equal(Object.hasOwn(added.payload.data, "peerUserId"), false);
  assert.equal((await call(admin, "/api/chat/contacts")).payload.data.length, 0);
  assert.equal((await call(student, "/api/chat/contacts")).payload.data.length, 0);
  const requestId = added.payload.data.request.id;
  assert.equal((await call(admin, "/api/chat/contact-requests")).payload.data.outgoing[0].id, requestId);
  assert.equal((await call(student, "/api/chat/contact-requests")).payload.data.incoming[0].id, requestId);
  const duplicate = await call(admin, "/api/chat/contacts/by-user-id", "POST", { chatUserId: targetId, introduction: "Another introduction" });
  assert.equal(duplicate.payload.data.request.id, requestId);
  assert.equal(duplicate.payload.data.request.introduction, "Hi, we study together.");
  const searchPending = (await call(student, `/api/chat/users/search?q=${customId}`)).payload.data[0];
  assert.equal(searchPending.requestId, requestId);
  assert.equal(searchPending.requestDirection, "incoming");
  assert.equal(searchPending.contactId, null);
  assert.equal((await call(admin, `/api/chat/contact-requests/${requestId}/accept`, "POST")).status, 403);
  assert.equal((await call(student, `/api/chat/contact-requests/${requestId}/cancel`, "POST")).status, 403);
  assert.equal((await call(late, `/api/chat/contact-requests/${requestId}/accept`, "POST")).status, 404);
  assert.equal((await call(admin, `/api/chat/contacts/${requestId}/account-key`)).status, 404);
  assert.equal((await call(admin, `/api/chat/contacts/${requestId}/prekey-bundle`)).status, 404);
  assert.equal((await call(admin, "/api/chat/conversations", "POST", { contactId: requestId })).status, 404);
  const unacceptedDirect = await control(admin, crypto.randomUUID(), 0, "create", { kind: "direct", contactIds: [requestId], recipients: [envelope(admin, "admin-1"), envelope(student, "student-1")] });
  assert.equal((await call(admin, "/api/chat/conversations", "POST", unacceptedDirect)).status, 404);
  const opposingRequest = await call(student, "/api/chat/contacts/by-user-id", "POST", { chatUserId: customId });
  assert.equal(opposingRequest.payload.data.request.id, requestId);
  assert.equal(opposingRequest.payload.data.request.direction, "incoming");
  assert.equal((await call(student, "/api/chat/contacts")).payload.data.length, 0);
  assert.equal((await call(student, `/api/chat/contact-requests/${requestId}/reject`, "POST")).payload.data.request.status, "rejected");
  assert.equal((await call(student, `/api/chat/contact-requests/${requestId}/accept`, "POST")).status, 409);
  const retry = await call(admin, "/api/chat/contacts/by-user-id", "POST", { chatUserId: targetId });
  assert.equal(retry.payload.data.request.introduction, "");
  assert.equal((await call(admin, `/api/chat/contact-requests/${retry.payload.data.request.id}/cancel`, "POST")).payload.data.request.status, "cancelled");
  const finalRequest = await call(admin, "/api/chat/contacts/by-user-id", "POST", { chatUserId: targetId, introduction: "Let's chat." });
  const accepted = await call(student, `/api/chat/contact-requests/${finalRequest.payload.data.request.id}/accept`, "POST");
  assert.equal(accepted.status, 200, JSON.stringify(accepted.payload));
  assert.equal(accepted.payload.data.request.status, "accepted");
  assert.ok(accepted.payload.data.contact.id);
  assert.equal((await call(admin, "/api/chat/contacts")).payload.data.length, 1);
  assert.equal((await call(student, "/api/chat/contacts")).payload.data.length, 1);
  assert.deepEqual((await call(student, "/api/chat/contact-requests")).payload.data, { incoming: [], outgoing: [] });
  const acceptedAt = (await call(student, "/api/chat/contacts")).payload.data[0].acceptedAt;
  const studentAddsAdmin = await call(student, "/api/chat/contacts/by-user-id", "POST", { chatUserId: customId });
  assert.equal(studentAddsAdmin.status, 201, JSON.stringify(studentAddsAdmin.payload));
  assert.equal(studentAddsAdmin.payload.data.request, null);
  assert.equal(studentAddsAdmin.payload.data.id, accepted.payload.data.contact.id);
  assert.equal((await call(student, "/api/chat/contacts")).payload.data[0].acceptedAt, acceptedAt);

  const conversationId = crypto.randomUUID();
  const created = await call(admin, "/api/chat/global-discussion", "POST", {
    conversationId,
    recipients: [envelope(admin, "admin-1"), envelope(student, "student-1")],
    metadata: metadata(1),
  });
  assert.equal(created.status, 201, JSON.stringify(created.payload));
  assert.equal(created.payload.data.conversation.isGlobalDiscussion, true);
  assert.equal((await call(student, "/api/chat/global-discussion")).payload.data.conversation.isGlobalDiscussion, true);
  assert.equal((await call(student, "/api/chat/global-discussion", "POST", {})).status, 403);

  const nonMemberLeave = await call(late, "/api/chat/global-discussion/leave", "POST", {});
  assert.equal(nonMemberLeave.status, 409);
  assert.equal((await db.prepare("SELECT rotation_required FROM chat_conversations WHERE id=?").bind(conversationId).first()).rotation_required, 0);
  const genericRoleChange = await call(student, `/api/chat/conversations/${conversationId}/members`, "PATCH", { action: "role" });
  assert.equal(genericRoleChange.status, 403);

  await db.prepare("UPDATE chat_conversation_members SET role='member' WHERE conversation_id=? AND user_id=?").bind(conversationId, admin.id).run();
  assert.equal((await call(admin, "/api/chat/global-discussion")).payload.data.pendingCount, 1);
  await db.prepare("UPDATE chat_conversation_members SET role='owner' WHERE conversation_id=? AND user_id=?").bind(conversationId, admin.id).run();
  assert.equal((await call(admin, "/api/chat/global-discussion")).payload.data.pendingCount, 0);

  const left = await call(student, `/api/chat/conversations/${conversationId}/members`, "PATCH", { version: "account-v2", conversationId, expectedEpoch: 1, action: "leave", payload: { globalDiscussion: true }, senderUserId: student.id, senderKeyId: "student-1", signature: opaque(64) });
  assert.notEqual(left.status, 200);
  const directLeave = await call(student, "/api/chat/global-discussion/leave", "POST", {});
  assert.equal(directLeave.status, 200);
  const adminLeave = await call(admin, "/api/chat/global-discussion/leave", "POST", {});
  assert.equal(adminLeave.status, 403);
  await db.batch(accountRow(db, late, "late-1"));
  const pending = await call(admin, "/api/chat/global-discussion");
  assert.equal(pending.payload.data.pendingCount, 1);
  assert.equal(pending.payload.data.pendingRecipients[0].chatUserId.startsWith("user_"), true);
  const rotated = await call(admin, "/api/chat/global-discussion/rotate", "POST", {
    conversationId, expectedEpoch: 1, epoch: 2,
    recipients: [envelope(admin, "admin-1"), envelope(late, "late-1")], metadata: metadata(2),
  });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.payload));
  assert.equal(rotated.payload.data.conversation.currentEpoch, 2);
  const lateInfo = await call(late, "/api/chat/global-discussion");
  assert.equal(lateInfo.payload.data.conversation.isGlobalDiscussion, true);
  assert.equal((await call(student, "/api/chat/global-discussion")).payload.data.optedOut, true);
  assert.equal((await call(student, "/api/chat/global-discussion")).payload.data.canJoin, true);
  const recipients = await db.prepare("SELECT user_id FROM chat_epoch_recipients WHERE conversation_id=? AND epoch=2").bind(conversationId).all();
  assert.deepEqual(recipients.results.map((item) => item.user_id).sort(), [admin.id, late.id].sort());
  await db.prepare("UPDATE users SET role='admin' WHERE id=?").bind(student.id).run();
  const promoted = await call(student, "/api/chat/global-discussion");
  assert.equal(promoted.payload.data.siteRole, "admin");
  assert.equal(promoted.payload.data.pendingCount, 1);
  await db.prepare("UPDATE users SET role='student' WHERE id=?").bind(student.id).run();
  assert.equal((await call(student, "/api/chat/global-discussion")).payload.data.pendingCount, 0);
  const join = await call(student, "/api/chat/global-discussion/join", "POST", {});
  assert.equal(join.status, 200);
  assert.equal(join.payload.data.membershipStatus, "pending");
  assert.equal(join.payload.data.pendingJoin, true);
  assert.equal(join.payload.data.conversation, null);
  assert.equal(join.payload.data.canJoin, false);
  assert.equal((await call(student, "/api/chat/global-discussion/join", "POST", {})).status, 200);
  assert.equal((await db.prepare("SELECT left_at FROM chat_conversation_members WHERE conversation_id=? AND user_id=?").bind(conversationId, student.id).first()).left_at !== null, true);
  assert.equal((await db.prepare("SELECT 1 FROM chat_epoch_recipients WHERE conversation_id=? AND epoch=2 AND user_id=?").bind(conversationId, student.id).first()), null);
  const rejoined = await call(admin, "/api/chat/global-discussion/rotate", "POST", {
    conversationId, expectedEpoch: 2, epoch: 3,
    recipients: [envelope(admin, "admin-1"), envelope(student, "student-1"), envelope(late, "late-1")], metadata: metadata(3),
  });
  assert.equal(rejoined.status, 200, JSON.stringify(rejoined.payload));
  assert.equal((await call(student, "/api/chat/global-discussion")).payload.data.membershipStatus, "active");
  assert.equal((await call(student, `/api/chat/conversations/${conversationId}/epochs`)).payload.data.some((item) => item.epoch === 2), false);
  const invalidRemoval = await control(admin, conversationId, 3, "remove", { userId: late.id, globalDiscussion: true });
  invalidRemoval.signature = opaque(64);
  assert.equal((await call(admin, "/api/chat/global-discussion/remove", "POST", invalidRemoval)).status, 400);
  assert.equal((await call(student, "/api/chat/global-discussion/remove", "POST", await control(student, conversationId, 3, "remove", { userId: late.id, globalDiscussion: true }))).status, 403);
  assert.equal((await call(admin, "/api/chat/global-discussion/remove", "POST", await control(admin, conversationId, 2, "remove", { userId: late.id, globalDiscussion: true }))).status, 409);
  assert.equal((await call(admin, "/api/chat/global-discussion/remove", "POST", await control(admin, conversationId, 3, "remove", { userId: admin.id, globalDiscussion: true }))).status, 403);
  assert.equal((await call(admin, `/api/chat/conversations/${conversationId}/members`, "PATCH", await control(admin, conversationId, 3, "remove", { userId: late.id }))).status, 403);
  const removed = await call(admin, "/api/chat/global-discussion/remove", "POST", await control(admin, conversationId, 3, "remove", { userId: late.id, globalDiscussion: true }));
  assert.equal(removed.status, 200, JSON.stringify(removed.payload));
  assert.equal(removed.payload.data.requiresEpochRotation, true);
  assert.equal(removed.payload.data.rotationRequired, true);
  const removedInfo = (await call(late, "/api/chat/global-discussion")).payload.data;
  assert.equal(removedInfo.membershipStatus, "removed");
  assert.equal(removedInfo.removed, true);
  assert.equal(removedInfo.canJoin, false);
  assert.equal(removedInfo.pendingJoin, false);
  assert.equal((await call(late, "/api/chat/global-discussion/join", "POST", {})).status, 403);
  assert.equal((await call(late, "/api/chat/global-discussion/leave", "POST", {})).status, 409);
  const sendDuringRotation = await call(admin, "/api/chat/messages", "POST", await message(admin, conversationId, 3));
  assert.equal(sendDuringRotation.status, 409);
  assert.equal(sendDuringRotation.payload.error.code, "ROTATION_REQUIRED");
  const removedRecipient = await call(admin, "/api/chat/global-discussion/rotate", "POST", {
    conversationId, expectedEpoch: 3, epoch: 4,
    recipients: [envelope(admin, "admin-1"), envelope(student, "student-1"), envelope(late, "late-1")], metadata: metadata(4),
  });
  assert.equal(removedRecipient.status, 409);
  const afterRemoval = await call(admin, "/api/chat/global-discussion/rotate", "POST", {
    conversationId, expectedEpoch: 3, epoch: 4,
    recipients: [envelope(admin, "admin-1"), envelope(student, "student-1")], metadata: metadata(4),
  });
  assert.equal(afterRemoval.status, 200, JSON.stringify(afterRemoval.payload));
  assert.equal((await call(late, `/api/chat/conversations/${conversationId}/epochs`)).status, 404);
  assert.equal((await db.prepare("SELECT 1 FROM chat_epoch_recipients WHERE conversation_id=? AND epoch=4 AND user_id=?").bind(conversationId, late.id).first()), null);
  const futureMessage = await call(admin, "/api/chat/messages", "POST", await message(admin, conversationId, 4));
  assert.equal(futureMessage.status, 201, JSON.stringify(futureMessage.payload));
  assert.equal((await call(late, `/api/chat/sync?conversationId=${conversationId}`)).payload.data.events.filter((event) => event.type === "message").length, 0);
  assert.equal((await call(student, `/api/chat/sync?conversationId=${conversationId}`)).payload.data.events.filter((event) => event.type === "message").length, 1);
  assert.equal((await call(admin, "/api/chat/global-discussion")).payload.data.pendingCount, 0);
  console.log("Chat directory and global discussion smoke checks passed.");
} finally {
  await mf.dispose();
}
