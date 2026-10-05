import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleChatApiRequest } from "../cloudflare/chat-api.js";
import { canonicalAccountJson } from "../cloudflare/chat-account-v2.js";

const AUTH_SECRET = "test-only-chat-profile-secret-at-least-32-bytes";
const encoder = new TextEncoder();
const timestamp = new Date().toISOString();
const b64 = (bytes) => Buffer.from(bytes).toString("base64url");
const opaque = (length) => b64(crypto.getRandomValues(new Uint8Array(length)));
const users = await Promise.all(["Alice", "Bob", "Carol"].map(async (name) => ({
  id: crypto.randomUUID(), email: `${name}@example.com`, role: "student", name, keyVersion: "key-1",
  signing: await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]),
})));
const [alice, bob, carol] = users;
const mf = new Miniflare({ compatibilityDate: "2026-07-29", modules: true,
  d1Databases: { DB: "chat-profile-history" }, script: "export default { fetch() { return new Response('ok'); } };" });
const db = await mf.getD1Database("DB");
const env = { DB: db, AUTH_SECRET, CHAT_ENABLED: "true", CHAT_ACCOUNT_V2_ENABLED: "true" };
async function call(user, path, method = "GET", body) {
  const payload = b64(encoder.encode(JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: 1, exp: 4102444800 })));
  const key = await crypto.subtle.importKey("raw", encoder.encode(AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const headers = { Authorization: `Bearer ${payload}.${b64(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)))}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await handleChatApiRequest(new Request(`https://expassway.test${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: response.status, payload: await response.json() };
}
async function sign(user, value) {
  return { ...value, signature: b64(await crypto.subtle.sign("Ed25519", user.signing.privateKey, encoder.encode(canonicalAccountJson(value)))) };
}
const recipients = () => [alice, bob].map((user) => ({ userId: user.id, keyVersion: user.keyVersion,
  ephemeralPublicKey: opaque(32), nonce: opaque(12), ciphertext: opaque(48) }));
async function create(kind, contactId) {
  const conversationId = crypto.randomUUID();
  const payload = { kind, contactIds: [contactId], recipients: recipients() };
  if (kind === "group") payload.metadata = { epoch: 1, version: 1, nonce: opaque(12), ciphertext: opaque(32) };
  const body = await sign(alice, { version: "account-v2", conversationId, expectedEpoch: 0, action: "create", payload,
    senderUserId: alice.id, senderKeyId: alice.keyVersion });
  const result = await call(alice, "/api/chat/conversations", "POST", body);
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  return conversationId;
}
const list = async (user) => (await call(user, "/api/chat/conversations")).payload.data;
const avatar = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";

try {
  for (const file of ["0001_initial", "0002_supabase_auth", "0003_admin_platform", "0006_chat_foundation", "0007_chat_crypto_hardening",
    "0008_chat_account_v2", "0009_chat_webauthn_context", "0010_chat_account_write_proofs", "0011_chat_messages_account_sender",
    "0012_chat_message_sender_key", "0013_chat_account_lifecycle", "0014_chat_passkey_hardening", "0015_chat_conversation_protocol", "0016_chat_profile_history", "0017_chat_directory_global", "0025_chat_friend_requests", "0027_chat_contact_safety"]) {
    for (const statement of unstable_splitSqlQuery(await readFile(new URL(`../migrations/${file}.sql`, import.meta.url), "utf8")))
      await db.prepare(statement).run();
  }
  for (const user of users) {
    await db.batch([
      db.prepare("INSERT INTO users (id,email,display_name,role,supabase_user_id) VALUES (?,?,?,'student',?)").bind(user.id, user.email, user.name, user.id),
      db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(user.id, user.keyVersion, opaque(32), b64(await crypto.subtle.exportKey("raw", user.signing.publicKey)), opaque(32), timestamp, timestamp),
      db.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)")
        .bind(crypto.randomUUID(), user.id, user.id, opaque(32), opaque(32), timestamp),
      db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,'hkdf-sha256-v1',?,?,?)")
        .bind(user.id, user.keyVersion, user.id, opaque(12), opaque(48), timestamp),
      db.prepare("INSERT INTO chat_account_identity_heads (user_id,key_version,credential_id) VALUES (?,?,?)").bind(user.id, user.keyVersion, user.id),
    ]);
    assert.equal((await call(user, "/api/chat/profile")).payload.data.avatarDataUrl, "");
  }

  const customized = await call(alice, "/api/chat/profile", "PATCH", { alias: "  Agent R  ", avatarDataUrl: avatar });
  assert.equal(customized.status, 200);
  assert.equal(customized.payload.data.alias, "Agent R");
  assert.equal(customized.payload.data.avatarDataUrl, avatar);
  const duplicate = await call(bob, "/api/chat/profile", "PATCH", { alias: "Agent R" });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.payload.error.code, "CHAT_ALIAS_TAKEN");
  for (const body of [null, [], "Agent R"])
    assert.equal((await call(alice, "/api/chat/profile", "PATCH", body)).status, 400);
  for (const alias of ["", "x", "x".repeat(49), "name<script>", 42]) {
    const invalid = await call(alice, "/api/chat/profile", "PATCH", { alias });
    assert.equal(invalid.status, 400, JSON.stringify({ alias, result: invalid }));
    assert.equal(invalid.payload.error.code, "INVALID_CHAT_ALIAS");
  }
  for (const value of [null, "https://example.com/avatar.png", "data:image/svg+xml;base64,PHN2Zz4=",
    "data:image/png;base64,YmFk", avatar.replace("image/png", "image/jpeg"), avatar.replace(/=$/, ""),
    "data:image/png;base64,AAAA==="]) {
    const invalid = await call(alice, "/api/chat/profile", "PATCH", { avatarDataUrl: value });
    assert.equal(invalid.status, 400, JSON.stringify(invalid));
    assert.equal(invalid.payload.error.code, "INVALID_CHAT_AVATAR");
  }
  const oversized = await call(alice, "/api/chat/profile", "PATCH", { avatarDataUrl: `data:image/png;base64,${Buffer.alloc(256 * 1024 + 1).toString("base64")}` });
  assert.equal(oversized.status, 413);
  assert.equal((await call(alice, "/api/chat/profile")).payload.data.avatarDataUrl, avatar);
  // The other permitted formats retain their canonical image data URL.
  for (const [type, binary] of [["jpeg", Buffer.from([255, 216, 255, 217])], ["webp", Buffer.from("RIFF0000WEBPVP8 ")]]) {
    const avatarDataUrl = `data:image/${type};base64,${binary.toString("base64")}`;
    assert.equal((await call(alice, "/api/chat/profile", "PATCH", { avatarDataUrl })).payload.data.avatarDataUrl, avatarDataUrl);
  }
  await call(alice, "/api/chat/profile", "PATCH", { avatarDataUrl: avatar });
  // A profile edit affects only the authenticated account; supplied IDs are ignored.
  await call(bob, "/api/chat/profile", "PATCH", { alias: "Bob Custom", userId: alice.id });
  assert.equal((await call(alice, "/api/chat/profile")).payload.data.alias, "Agent R");

  const contactA = crypto.randomUUID(), contactB = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO chat_contacts (id,user_id,peer_user_id,created_at,accepted_at) VALUES (?,?,?,?,?)").bind(contactB, alice.id, bob.id, timestamp, timestamp),
    db.prepare("INSERT INTO chat_contacts (id,user_id,peer_user_id,created_at,accepted_at) VALUES (?,?,?,?,?)").bind(contactA, bob.id, alice.id, timestamp, timestamp),
  ]);
  const contact = (await call(bob, "/api/chat/contacts")).payload.data[0];
  assert.equal(contact.profile.alias, "Agent R");
  assert.equal(contact.profile.avatarDataUrl, avatar);
  const direct = await create("direct", contactB), group = await create("group", contactB);
  const listed = await list(bob);
  assert.equal(listed.find((c) => c.id === direct).historical, false);
  assert.equal(listed.find((c) => c.id === direct).peer.avatarDataUrl, avatar);
  assert.equal(listed.find((c) => c.id === group).group.members.find((m) => m.userId === alice.id).avatarDataUrl, avatar);
  const messageBody = await sign(alice, { version: "account-v2", conversationId: direct, clientMessageId: crypto.randomUUID(), epoch: 1,
    senderUserId: alice.id, senderKeyId: alice.keyVersion, nonce: opaque(12), ciphertext: opaque(48), attachmentRefs: [] });
  const sent = await call(alice, "/api/chat/messages", "POST", messageBody);
  assert.equal(sent.status, 201, JSON.stringify(sent));
  assert.equal(sent.payload.data.message.senderAvatarDataUrl, avatar);
  const messageSync = await call(bob, `/api/chat/sync-events?conversationId=${direct}`);
  assert.equal(messageSync.payload.data.events.find((event) => event.type === "message").message.senderAvatarDataUrl, avatar);
  for (const id of [direct, group]) {
    const invalid = await call(alice, `/api/chat/conversations/${id}/history`, "DELETE");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.payload.error.code, "HISTORICAL_CHAT_REQUIRED");
  }
  assert.equal((await call(carol, `/api/chat/conversations/${direct}/history`, "DELETE")).status, 404);

  const legacy = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO chat_conversations (id,kind,created_by,created_at,updated_at) VALUES (?,'direct',?,?,?)").bind(legacy, alice.id, timestamp, timestamp),
    ...[alice, bob].map((user) => db.prepare("INSERT INTO chat_conversation_members (conversation_id,user_id,joined_at) VALUES (?,?,?)").bind(legacy, user.id, timestamp)),
    db.prepare("INSERT INTO chat_messages (id,conversation_id,sender_user_id,client_message_id,ciphertext,created_at) VALUES (?,?,?,?,?,?)")
      .bind(crypto.randomUUID(), legacy, alice.id, crypto.randomUUID(), "opaque-legacy-history", timestamp),
  ]);
  const legacyView = (await list(bob)).find((c) => c.id === legacy);
  assert.equal(legacyView.historical, true);
  assert.equal(legacyView.peer.avatarDataUrl, avatar);
  const oldCount = await db.prepare("SELECT COUNT(*) AS n FROM chat_messages").first();
  const removeLegacy = await call(alice, `/api/chat/conversations/${legacy}/history`, "DELETE");
  assert.equal(removeLegacy.status, 200);
  assert.equal(removeLegacy.payload.data.hidden, true);
  const hiddenAt = (await db.prepare("SELECT history_hidden_at FROM chat_conversation_members WHERE conversation_id=? AND user_id=?").bind(legacy, alice.id).first()).history_hidden_at;
  assert.equal((await call(alice, `/api/chat/conversations/${legacy}/history`, "DELETE")).status, 200);
  assert.equal((await db.prepare("SELECT history_hidden_at FROM chat_conversation_members WHERE conversation_id=? AND user_id=?").bind(legacy, alice.id).first()).history_hidden_at, hiddenAt);
  assert.equal((await list(alice)).some((c) => c.id === legacy), false);
  assert.equal((await list(bob)).some((c) => c.id === legacy), true);
  assert.equal((await call(alice, `/api/chat/sync?conversationId=${legacy}`)).payload.data.hidden, true);
  assert.equal((await call(bob, `/api/chat/sync?conversationId=${legacy}`)).payload.data.messages[0].ciphertext, "opaque-legacy-history");
  assert.equal((await call(carol, `/api/chat/sync?conversationId=${legacy}`)).status, 404);

  // Reset Bob's current identity without changing any existing epoch envelopes.
  await db.batch([
    db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,created_at,updated_at) VALUES (?,'key-2',?,?,?,?,?)")
      .bind(bob.id, opaque(32), opaque(32), opaque(32), timestamp, timestamp),
    db.prepare("UPDATE chat_account_identity_heads SET key_version='key-2' WHERE user_id=?").bind(bob.id),
  ]);
  assert.equal((await list(alice)).find((c) => c.id === direct).historical, true);
  assert.equal((await list(bob)).find((c) => c.id === direct).historical, true);
  assert.equal((await list(alice)).find((c) => c.id === group).historical, false);
  assert.equal((await call(alice, `/api/chat/conversations/${direct}/history`, "DELETE")).status, 200);
  assert.equal((await list(alice)).some((c) => c.id === direct), false);
  assert.equal((await list(bob)).some((c) => c.id === direct), true);
  const hidden = await call(alice, `/api/chat/sync-events?conversationId=${direct}&cursor=1`);
  assert.equal(hidden.payload.data.hidden, true);
  assert.deepEqual(hidden.payload.data.events, []);
  assert.deepEqual(hidden.payload.data.messages, []);
  assert.equal((await call(bob, `/api/chat/sync-events?conversationId=${direct}`)).payload.data.events.some((event) => event.type === "message"), true);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM chat_messages").first()).n, oldCount.n);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM chat_account_vault_versions").first()).n, 3);

  const removedAvatar = await call(alice, "/api/chat/profile", "PATCH", { avatarDataUrl: "" });
  assert.equal(removedAvatar.status, 200);
  assert.equal(removedAvatar.payload.data.avatarDataUrl, "");
  assert.equal(removedAvatar.payload.data.alias, "Agent R");
  assert.equal((await call(bob, "/api/chat/contacts")).payload.data[0].profile.avatarDataUrl, "");
  console.log("Chat nickname/avatar validation, profile mapping and account-local historical removal passed.");
} finally { await mf.dispose(); }
