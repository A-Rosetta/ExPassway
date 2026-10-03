import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { webcrypto } from "node:crypto";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleChatApiRequest, handleChatWebSocketRequest, cleanupChatData } from "../cloudflare/chat-api.js";
import { canonicalAccountJson } from "../cloudflare/chat-account-v2.js";
import { ChatRoom } from "../cloudflare/chat-room.js";

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";
const encoder = new TextEncoder();
const b64 = (value) => Buffer.from(value).toString("base64url");
const opaque = (length) => b64(crypto.getRandomValues(new Uint8Array(length)));
const timestamp = new Date().toISOString();
const users = await Promise.all(["A", "B", "C"].map(async (alias) => ({
  id: crypto.randomUUID(), email: `${alias}@example.com`, role: "student", alias,
  signing: await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]), keyVersion: "key-1",
})));
const [alice, bob, carol] = users;
const mf = new Miniflare({ compatibilityDate: "2026-07-29", d1Databases: { DB: "chat-v2-test" }, r2Buckets: { CHAT_MEDIA_BUCKET: "chat-v2-media" }, modules: true, script: "export default { fetch() { return new Response('ok'); } };" });
let roomRequest;
const env = {
  AUTH_SECRET, CHAT_ENABLED: "true", CHAT_ACCOUNT_V2_ENABLED: "true",
  CHAT_WEBAUTHN_RP_ID: "expassway.test", CHAT_WEBAUTHN_ORIGIN: "https://expassway.test",
  DB: await mf.getD1Database("DB"), CHAT_MEDIA_BUCKET: await mf.getR2Bucket("CHAT_MEDIA_BUCKET"),
  CHAT_ROOMS: { idFromName: (name) => name, get: () => ({ fetch: async (request) => {
    if (request instanceof Request) roomRequest = request;
    return new Response("ok");
  } }) },
};
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
function envelopes(recipients) {
  return recipients.map((user) => ({ userId: user.id, keyVersion: user.keyVersion, ephemeralPublicKey: opaque(32), nonce: opaque(12), ciphertext: opaque(48) }));
}
function metadata(epoch, version = 1) { return { epoch, version, nonce: opaque(12), ciphertext: opaque(32) }; }
async function control(user, conversationId, expectedEpoch, action, payload) {
  return sign(user, { version: "account-v2", conversationId, expectedEpoch, action, payload, senderUserId: user.id, senderKeyId: user.keyVersion });
}
async function message(user, conversationId, epoch, attachmentRefs = []) {
  return sign(user, { version: "account-v2", conversationId, clientMessageId: crypto.randomUUID(), epoch,
    senderUserId: user.id, senderKeyId: user.keyVersion, nonce: opaque(12), ciphertext: opaque(48), attachmentRefs });
}
async function ws(conversationId, ticket, protocol = "expassway-chat-v2") {
  return handleChatWebSocketRequest(new Request(`https://expassway.test/api/chat/ws/${conversationId}`, {
    headers: { Upgrade: "websocket", "Sec-WebSocket-Protocol": `${protocol}, ticket.${ticket}` },
  }), env);
}
async function create(kind, recipients, contactIds) {
  const conversationId = crypto.randomUUID();
  const payload = { kind, contactIds, recipients: envelopes(recipients) };
  if (kind === "group") payload.metadata = metadata(1);
  const signed = await control(alice, conversationId, 0, "create", payload);
  const result = await call(alice, "/api/chat/conversations", "POST", signed);
  assert.equal(result.status, 201, JSON.stringify(result.payload));
  return conversationId;
}

try {
  const db = env.DB;
  for (const file of ["0001_initial", "0002_supabase_auth", "0003_admin_platform", "0006_chat_foundation", "0007_chat_crypto_hardening", "0008_chat_account_v2", "0009_chat_webauthn_context", "0010_chat_account_write_proofs", "0011_chat_messages_account_sender", "0012_chat_message_sender_key", "0013_chat_account_lifecycle", "0014_chat_passkey_hardening", "0015_chat_conversation_protocol"]) {
    for (const statement of unstable_splitSqlQuery(await readFile(new URL(`../migrations/${file}.sql`, import.meta.url), "utf8"))) await db.prepare(statement).run();
  }
  for (const user of users) {
    await db.batch([
      db.prepare("INSERT INTO users (id,email,display_name,role,supabase_user_id) VALUES (?,?,?,'student',?)").bind(user.id,user.email,user.alias,user.alias),
      db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
        .bind(user.id,user.keyVersion,opaque(32),b64(await crypto.subtle.exportKey("raw",user.signing.publicKey)),opaque(32),timestamp,timestamp),
      db.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),user.id,user.id,opaque(32),opaque(32),timestamp),
      db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,'hkdf-sha256-v1',?,?,?)")
        .bind(user.id,user.keyVersion,user.id,opaque(12),opaque(48),timestamp),
      db.prepare("INSERT INTO chat_account_identity_heads (user_id,key_version,credential_id) VALUES (?,?,?)").bind(user.id,user.keyVersion,user.id),
    ]);
  }
  const contactB = crypto.randomUUID();
  const contactC = crypto.randomUUID();
  await db.batch([
    db.prepare("INSERT INTO chat_contacts (id,user_id,peer_user_id,created_at,accepted_at) VALUES (?,?,?,?,?)").bind(contactB,alice.id,bob.id,timestamp,timestamp),
    db.prepare("INSERT INTO chat_contacts (id,user_id,peer_user_id,created_at,accepted_at) VALUES (?,?,?,?,?)").bind(contactC,alice.id,carol.id,timestamp,timestamp),
  ]);
  assert.equal((await call(alice, `/api/chat/contacts/${contactB}/account-key`)).payload.data.enabled,true);
  await db.prepare("UPDATE chat_passkeys SET revoked_at=? WHERE user_id=?").bind(timestamp,bob.id).run();
  assert.equal((await call(alice, `/api/chat/contacts/${contactB}/account-key`)).payload.data.enabled,false);
  const unready = await call(alice,"/api/chat/conversations","POST",await control(alice,crypto.randomUUID(),0,"create",{kind:"direct",contactIds:[contactB],recipients:envelopes([alice,bob])}));
  assert.equal(unready.status,409);
  assert.equal(unready.payload.error.code,"ACCOUNT_NOT_ENABLED");
  await db.prepare("UPDATE chat_passkeys SET revoked_at=NULL WHERE user_id=?").bind(bob.id).run();

  const direct = await create("direct",[alice,bob],[contactB]);
  const group = await create("group",[alice,bob],[contactB]);
  const listed = await call(alice,"/api/chat/conversations");
  assert.equal(listed.status,200);
  assert.deepEqual(listed.payload.data.map((item)=>item.protocolVersion),["account-v2","account-v2"]);
  assert.equal(listed.payload.data.find((item)=>item.id===group).metadata.version,1);
  const sentBody = await message(alice,direct,1);
  const sent = await call(alice,"/api/chat/messages","POST",sentBody);
  assert.equal(sent.status,201,JSON.stringify(sent.payload));
  assert.equal((await call(alice,"/api/chat/messages","POST",sentBody)).payload.data.duplicate,true);
  const tampered = await call(alice,"/api/chat/messages","POST",{...sentBody,ciphertext:opaque(48)});
  assert.equal(tampered.status,400);
  assert.equal(tampered.payload.error.code,"INVALID_ACCOUNT_V2_SIGNATURE");
  const wrongEpoch = await call(alice,"/api/chat/messages","POST",await message(alice,direct,2));
  assert.equal(wrongEpoch.status,409);
  assert.equal(wrongEpoch.payload.error.code,"EPOCH_CONFLICT");
  const malformed = await call(alice,"/api/chat/messages","POST",{...sentBody,nonce:"A"});
  assert.equal(malformed.status,400);
  assert.equal(malformed.payload.error.code,"INVALID_ACCOUNT_PAYLOAD");
  const firstSync = await call(bob,`/api/chat/sync-events?conversationId=${direct}`);
  assert.equal(firstSync.payload.data.events.at(-1).message.ciphertext,sentBody.ciphertext);
  assert.equal(firstSync.payload.data.events.at(-1).message.senderSigningPublicKey,b64(await crypto.subtle.exportKey("raw",alice.signing.publicKey)));
  assert.equal((await call(bob,`/api/chat/messages/${sent.payload.data.message.id}/delete`,"POST")).status,403);
  assert.equal((await call(alice,`/api/chat/messages/${sent.payload.data.message.id}/delete`,"POST")).status,200);
  const deletedSync = await call(bob,`/api/chat/sync-events?conversationId=${direct}&after=${firstSync.payload.data.nextCursor}`);
  assert.equal(deletedSync.payload.data.events[0].type,"deleted");
  assert.equal(deletedSync.payload.data.events[0].messageId,sent.payload.data.message.id);
  assert.equal((await call(bob,`/api/chat/sync-events?conversationId=${direct}&after=NaN`)).status,400);

  const tooMany = await call(alice,"/api/chat/conversations","POST",await control(alice,crypto.randomUUID(),0,"create",{kind:"group",contactIds:Array.from({length:50},()=>crypto.randomUUID()),recipients:[]}));
  assert.equal(tooMany.status,400);
  assert.equal(tooMany.payload.error.code,"INVALID_GROUP_MEMBERS");
  const edit = await call(alice,`/api/chat/conversations/${group}/metadata`,"PUT",await control(alice,group,1,"metadata",{metadata:metadata(1,2)}));
  assert.equal(edit.status,200,JSON.stringify(edit.payload));
  const forbiddenEdit = await call(bob,`/api/chat/conversations/${group}/metadata`,"PUT",await control(bob,group,1,"metadata",{metadata:metadata(1,3)}));
  assert.equal(forbiddenEdit.status,403);
  const oldMetadata = await call(alice,`/api/chat/conversations/${group}/metadata`,"PUT",await control(alice,group,1,"metadata",{metadata:metadata(1,2)}));
  assert.equal(oldMetadata.status,409);
  const oldGroupMessage = await call(alice,"/api/chat/messages","POST",await message(alice,group,1));
  const add = await call(alice,`/api/chat/conversations/${group}/members`,"PATCH",await control(alice,group,1,"add",{contactIds:[contactC],recipients:envelopes(users),metadata:metadata(2,3)}));
  assert.equal(add.status,200,JSON.stringify(add.payload));
  const carolEpochs = await call(carol,`/api/chat/conversations/${group}/epochs`);
  assert.deepEqual(carolEpochs.payload.data.map((item)=>item.epoch),[2]);
  const carolHistory = await call(carol,`/api/chat/sync-events?conversationId=${group}&limit=1`);
  assert.equal(carolHistory.payload.data.events.length,0);
  assert.equal(carolHistory.payload.data.hasMore,true);
  assert.ok(carolHistory.payload.data.nextCursor > 0);
  const allCarolHistory = await call(carol,`/api/chat/sync-events?conversationId=${group}`);
  assert.equal(allCarolHistory.payload.data.events.some((event)=>event.entityId===oldGroupMessage.payload.data.message.id),false);

  const ticket = await call(bob,"/api/chat/ws-ticket","POST",{conversationId:group});
  assert.equal((await ws(group,ticket.payload.data.ticket)).status,200);
  assert.equal(roomRequest.headers.get("X-Chat-Protocol"),"expassway-chat-v2");
  assert.equal(roomRequest.headers.get("X-Chat-Device"),null);
  assert.equal((await ws(group,ticket.payload.data.ticket)).status,401);
  const pendingTicket = await call(bob,"/api/chat/ws-ticket","POST",{conversationId:group});
  const remove = await call(alice,`/api/chat/conversations/${group}/members`,"PATCH",await control(alice,group,2,"remove",{userId:bob.id,recipients:envelopes([alice,carol]),metadata:metadata(3,4)}));
  assert.equal(remove.status,200,JSON.stringify(remove.payload));
  const removalSync = await call(bob,`/api/chat/sync-events?conversationId=${group}`);
  const ownRemoval = removalSync.payload.data.events.find((event)=>event.type==="remove" && event.entityId===bob.id);
  assert.ok(ownRemoval);
  assert.equal(ownRemoval.control,undefined);
  assert.equal(ownRemoval.message,undefined);
  assert.equal(ownRemoval.envelope,undefined);
  assert.equal((await ws(group,pendingTicket.payload.data.ticket)).status,404);
  assert.equal((await call(bob,`/api/chat/conversations/${group}/epochs`)).status,404);
  const staleChange = await call(alice,`/api/chat/conversations/${group}/members`,"PATCH",await control(alice,group,2,"remove",{userId:carol.id,recipients:envelopes([alice]),metadata:metadata(3,4)}));
  assert.equal(staleChange.status,409);
  assert.equal(staleChange.payload.error.code,"EPOCH_CONFLICT");
  assert.equal((await call(alice,"/api/chat/messages","POST",await message(alice,group,2))).status,409);
  const removedEpochMessage = await call(carol,"/api/chat/messages","POST",await message(carol,group,3));
  assert.equal(removedEpochMessage.status,201);
  const afterRemovalSync = await call(bob,`/api/chat/sync-events?conversationId=${group}&after=${removalSync.payload.data.nextCursor}`);
  assert.equal(afterRemovalSync.payload.data.events.some((event)=>event.entityId===removedEpochMessage.payload.data.message.id),false);
  const forbiddenRetention = await call(carol,`/api/chat/conversations/${group}/settings`,"PATCH",await control(carol,group,3,"retention",{retentionSeconds:86400}));
  assert.equal(forbiddenRetention.status,403);
  assert.equal((await call(bob,`/api/chat/conversations/${direct}/settings`,"PATCH",await control(bob,direct,1,"retention",{retentionSeconds:0}))).status,200);
  const rejoin = await call(alice,`/api/chat/conversations/${group}/members`,"PATCH",await control(alice,group,3,"add",{contactIds:[contactB],recipients:envelopes(users),metadata:metadata(4,5)}));
  assert.equal(rejoin.status,200,JSON.stringify(rejoin.payload));
  assert.deepEqual((await call(bob,`/api/chat/conversations/${group}/epochs`)).payload.data.map((item)=>item.epoch),[1,2,4]);
  assert.equal((await call(bob,`/api/chat/sync-events?conversationId=${group}`)).payload.data.events.some((event)=>event.entityId===removedEpochMessage.payload.data.message.id),false);
  const transfer = await call(alice,`/api/chat/conversations/${group}/members`,"PATCH",await control(alice,group,4,"transfer",{userId:carol.id}));
  assert.equal(transfer.status,200);
  const leave = await call(alice,`/api/chat/conversations/${group}/leave`,"POST",await control(alice,group,4,"leave",{}));
  assert.equal(leave.status,200);
  assert.equal(leave.payload.data.rotationRequired,true);
  const rotationBlocked = await call(carol,"/api/chat/messages","POST",await message(carol,group,4));
  assert.equal(rotationBlocked.status,409);
  assert.equal(rotationBlocked.payload.error.code,"ROTATION_REQUIRED");
  const rotate = await call(carol,`/api/chat/conversations/${group}/epochs`,"POST",await control(carol,group,4,"rotate",{recipients:envelopes([bob,carol]),metadata:metadata(5,6)}));
  assert.equal(rotate.status,200);
  const dissolve = await call(carol,`/api/chat/conversations/${group}/dissolve`,"POST",await control(carol,group,5,"dissolve",{}));
  assert.equal(dissolve.status,200,JSON.stringify(dissolve.payload));
  assert.equal(dissolve.payload.data.dissolved,true);
  assert.equal((await call(carol,"/api/chat/messages","POST",await message(carol,group,5))).status,404);

  const concurrentGroup = await create("group",[alice,bob],[contactB]);
  const concurrentInputs = await Promise.all([0,1].map(()=>control(alice,concurrentGroup,1,"add",{contactIds:[contactC],recipients:envelopes(users),metadata:metadata(2,2)})));
  const concurrent = await Promise.all(concurrentInputs.map((input)=>call(alice,`/api/chat/conversations/${concurrentGroup}/members`,"PATCH",input)));
  assert.deepEqual(concurrent.map((item)=>item.status).sort(),[200,409]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_conversation_epochs WHERE conversation_id=?").bind(concurrentGroup).first()).count,2);

  const reservation = await call(alice,"/api/chat/attachments/init","POST",{conversationId:direct,epoch:1,sizeBytes:48});
  assert.equal(reservation.status,200,JSON.stringify(reservation.payload));
  const attachmentId = reservation.payload.data.attachmentId;
  const encryptedFile = crypto.getRandomValues(new Uint8Array(48));
  const upload = await handleChatApiRequest(new Request(`https://expassway.test/api/chat/attachments/${attachmentId}`,{method:"PUT",headers:{Authorization:`Bearer ${await token(alice)}`},body:encryptedFile}),env);
  assert.equal(upload.status,200);
  assert.equal((await call(alice,`/api/chat/attachments/${attachmentId}/complete`,"POST")).status,200);
  const fileMessage = await call(alice,"/api/chat/messages","POST",await message(alice,direct,1,[attachmentId]));
  assert.equal(fileMessage.status,201,JSON.stringify(fileMessage.payload));
  const sharedFileMessage = await call(alice,"/api/chat/messages","POST",await message(alice,direct,1,[attachmentId]));
  assert.equal(sharedFileMessage.status,201);
  assert.equal((await call(alice,`/api/chat/messages/${sharedFileMessage.payload.data.message.id}/delete`,"POST")).status,200);
  assert.equal((await db.prepare("SELECT status FROM chat_attachments WHERE id=?").bind(attachmentId).first()).status,"complete");
  const download = await handleChatApiRequest(new Request(`https://expassway.test/api/chat/attachments/${attachmentId}`,{headers:{Authorization:`Bearer ${await token(bob)}`}}),env);
  assert.deepEqual(new Uint8Array(await download.arrayBuffer()),encryptedFile);
  await cleanupChatData(env);
  assert.equal((await db.prepare("SELECT deleted_at FROM chat_messages WHERE id=?").bind(fileMessage.payload.data.message.id).first()).deleted_at,null);
  await db.prepare("UPDATE chat_messages SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(fileMessage.payload.data.message.id).run();
  await cleanupChatData(env);
  const tombstone = await db.prepare("SELECT * FROM chat_messages WHERE id=?").bind(fileMessage.payload.data.message.id).first();
  assert.ok(tombstone.deleted_at);
  assert.equal(tombstone.ciphertext,"");
  assert.equal(await db.prepare("SELECT id FROM chat_attachments WHERE id=?").bind(attachmentId).first(),null);
  const cleanedSync = await call(bob,`/api/chat/sync-events?conversationId=${direct}`);
  assert.equal(cleanedSync.payload.data.events.some((event)=>event.type==="deleted" && event.messageId===fileMessage.payload.data.message.id),true);

  // More than one cleanup batch must preserve references to objects not yet removed.
  const bulk = Array.from({length:501},(_,index)=>({id:crypto.randomUUID(),key:`cleanup/${index}`}));
  await db.batch(bulk.map((item)=>db.prepare("INSERT INTO chat_attachments (id,conversation_id,object_key,size_bytes,size_bucket,created_at,status,deleted_at) VALUES (?,?,?,48,'large',?,'deleted',?)").bind(item.id,direct,item.key,timestamp,timestamp)));
  const deletedObjects = [];
  const cleanupEnv = {...env,CHAT_MEDIA_BUCKET:{delete:async (keys)=>deletedObjects.push(...keys)}};
  await cleanupChatData(cleanupEnv);
  assert.equal(deletedObjects.length,500);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_attachments WHERE status='deleted'").first()).count,1);
  await cleanupChatData(cleanupEnv);
  assert.equal(deletedObjects.length,501);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_attachments WHERE status='deleted'").first()).count,0);

  // A reset identity cannot be silently accepted by an unrelated membership change.
  const continuityGroup = await create("group",[alice,bob],[contactB]);
  const continuityLeaveGroup = await create("group",users,[contactB,contactC]);
  bob.keyVersion = "bob-reset";
  await db.batch([
    db.prepare("UPDATE chat_account_keys SET status='revoked' WHERE user_id=?").bind(bob.id),
    db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .bind(bob.id,bob.keyVersion,opaque(32),b64(await crypto.subtle.exportKey("raw",bob.signing.publicKey)),opaque(32),timestamp,timestamp),
    db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,'hkdf-sha256-v1',?,?,?)")
      .bind(bob.id,bob.keyVersion,bob.id,opaque(12),opaque(48),timestamp),
    db.prepare("UPDATE chat_account_identity_heads SET key_version=? WHERE user_id=?").bind(bob.keyVersion,bob.id),
  ]);
  const unrelatedAdd = await call(alice,`/api/chat/conversations/${continuityGroup}/members`,"PATCH",await control(alice,continuityGroup,1,"add",{contactIds:[contactC],recipients:envelopes(users),metadata:metadata(2,2)}));
  assert.equal(unrelatedAdd.status,409);
  assert.equal(unrelatedAdd.payload.error.code,"ACCOUNT_KEY_CHANGED");
  assert.equal(unrelatedAdd.payload.error.details.userId,bob.id);
  assert.equal((await db.prepare("SELECT current_epoch FROM chat_conversations WHERE id=?").bind(continuityGroup).first()).current_epoch,1);
  assert.equal(await db.prepare("SELECT 1 FROM chat_conversation_members WHERE conversation_id=? AND user_id=?").bind(continuityGroup,carol.id).first(),null);
  const unrelatedRemove = await call(alice,`/api/chat/conversations/${continuityLeaveGroup}/members`,"PATCH",await control(alice,continuityLeaveGroup,1,"remove",{userId:carol.id,recipients:envelopes([alice,bob]),metadata:metadata(2,2)}));
  assert.equal(unrelatedRemove.status,409);
  assert.equal(unrelatedRemove.payload.error.code,"ACCOUNT_KEY_CHANGED");
  assert.equal((await call(carol,`/api/chat/conversations/${continuityLeaveGroup}/leave`,"POST",await control(carol,continuityLeaveGroup,1,"leave",{}))).status,200);
  const unrelatedRotate = await call(alice,`/api/chat/conversations/${continuityLeaveGroup}/epochs`,"POST",await control(alice,continuityLeaveGroup,1,"rotate",{recipients:envelopes([alice,bob]),metadata:metadata(2,2)}));
  assert.equal(unrelatedRotate.status,409);
  assert.equal(unrelatedRotate.payload.error.code,"ACCOUNT_KEY_CHANGED");
  const removeReset = await call(alice,`/api/chat/conversations/${continuityGroup}/members`,"PATCH",await control(alice,continuityGroup,1,"remove",{userId:bob.id,recipients:envelopes([alice]),metadata:metadata(2,2)}));
  assert.equal(removeReset.status,200,JSON.stringify(removeReset.payload));
  const inviteReset = await call(alice,`/api/chat/conversations/${continuityGroup}/members`,"PATCH",await control(alice,continuityGroup,2,"add",{contactIds:[contactB],recipients:envelopes([alice,bob]),metadata:metadata(3,3)}));
  assert.equal(inviteReset.status,200,JSON.stringify(inviteReset.payload));
  assert.equal(inviteReset.payload.data.conversation.epoch,3);
  assert.equal((await call(bob,"/api/chat/messages","POST",await message(bob,continuityGroup,3))).status,201);

  // Identity selection follows the head even when vault/key timestamps tie.
  const resetKey = "key-2";
  const resetCredential = opaque(32);
  await db.batch([
    db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,created_at,updated_at) VALUES (?,?,?,?,?,?,?)").bind(alice.id,resetKey,opaque(32),opaque(32),opaque(32),timestamp,timestamp),
    db.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(),alice.id,resetCredential,opaque(32),opaque(32),timestamp),
    db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,'hkdf-sha256-v1',?,?,?)").bind(alice.id,resetKey,resetCredential,opaque(12),opaque(48),timestamp),
    db.prepare("UPDATE chat_account_identity_heads SET key_version=?,credential_id=? WHERE user_id=?").bind(resetKey,resetCredential,alice.id),
  ]);
  const resetBundle = await call(alice,"/api/chat/account/keys");
  assert.equal(resetBundle.payload.data.accountKey.keyVersion,resetKey);
  assert.equal(resetBundle.payload.data.credentialId,resetCredential);
  assert.equal((await call(alice,"/api/chat/account/vault")).payload.data.keyVersion,resetKey);
  const authOptions = await call(alice,"/api/chat/account/passkeys/authenticate/options","POST",{});
  assert.deepEqual(authOptions.payload.data.publicKey.allowCredentials.map((item)=>item.id),[resetCredential]);
  async function writeProof(keyVersion) {
    const proof = opaque(32);
    const proofHash = b64(await crypto.subtle.digest("SHA-256",encoder.encode(proof)));
    await db.prepare("INSERT INTO chat_account_write_proofs (id,token_hash,user_id,uses_remaining,expires_at,created_at,credential_id,key_version,purpose) VALUES (?,?,?,5,'2099-01-01T00:00:00.000Z',?,?,?,'account-write')")
      .bind(crypto.randomUUID(),proofHash,alice.id,timestamp,resetCredential,keyVersion).run();
    return proof;
  }
  const initialization = {reset:true,encryptionPublicKey:opaque(32),signingPublicKey:opaque(32),fingerprint:opaque(32),nonce:opaque(12),ciphertext:opaque(48)};
  const staleProof = await call(alice,"/api/chat/account/initialize","POST",{...initialization,keyVersion:"stale-reset",proof:await writeProof("key-1")});
  assert.equal(staleProof.status,409);
  assert.equal(staleProof.payload.error.code,"ACCOUNT_IDENTITY_CHANGED");
  const proof = await writeProof(resetKey);
  const initializations = await Promise.all(["key-3","key-4"].map((keyVersion)=>call(alice,"/api/chat/account/initialize","POST",{...initialization,keyVersion,proof})));
  assert.deepEqual(initializations.map((item)=>item.status).sort(),[201,409]);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_account_keys WHERE user_id=? AND status='active'").bind(alice.id).first()).count,1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM chat_account_vault_versions WHERE user_id=?").bind(alice.id).first()).count,3);

  // Exercise the room's actual protocol negotiation without Node's HTTP 101 restriction.
  const originalResponse = globalThis.Response;
  const originalPair = globalThis.WebSocketPair;
  let acceptedProtocol;
  globalThis.Response = class { constructor(_body,init={}) { Object.assign(this,init); } };
  globalThis.WebSocketPair = class { constructor() { this[0]={};this[1]={serializeAttachment(){}}; } };
  try {
    const room = new ChatRoom({acceptWebSocket(_socket,tags){acceptedProtocol=tags[0];}});
    const response = await room.fetch(new Request("https://chat-room/connect",{headers:{Upgrade:"websocket","X-Chat-User":alice.id,"X-Chat-Conversation":direct,"X-Chat-Protocol":"expassway-chat-v2"}}));
    assert.equal(response.status,101);
    assert.equal(response.headers["Sec-WebSocket-Protocol"],"expassway-chat-v2");
    assert.equal(acceptedProtocol,"expassway-chat-v2");
    assert.equal((await room.fetch(new Request("https://chat-room/connect",{headers:{Upgrade:"websocket","X-Chat-User":alice.id,"X-Chat-Conversation":direct}}))).status,400);
  } finally { globalThis.Response=originalResponse;globalThis.WebSocketPair=originalPair; }
  console.log("Cloudflare account-v2 signed chat, group lifecycle, attachments, sync, identity and WebSocket checks passed.");
} finally { await mf.dispose(); }
