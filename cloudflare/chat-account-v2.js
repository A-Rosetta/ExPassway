import { AuthError, readJsonBody, success } from "./auth-api.js";

const enc = new TextEncoder();
const RETENTION = new Set([0, 86400, 604800, 2592000]);
const VERSION = "account-v2";
const MAX_CIPHER = 512 * 1024;
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const fail = (status, code, message, details = null) => { throw new AuthError(status, message, code, details); };
const rows = async (statement) => (await statement.all()).results || [];
const enabled = (env) => ["true", "1", "yes", "on"].includes(String(env.CHAT_ACCOUNT_V2_ENABLED).toLowerCase());

function str(value, name, max = 100) {
  if (typeof value !== "string" || !value.length || value.length > max) fail(400, "INVALID_ACCOUNT_PAYLOAD", `${name} is invalid.`);
  return value;
}
function bytes(value, name, length) {
  str(value, name, MAX_CIPHER);
  if (!/^[A-Za-z0-9_-]+$/.test(value)) fail(400, "INVALID_ACCOUNT_PAYLOAD", `${name} must be base64url.`);
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  let result;
  try { result = Uint8Array.from(atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)), (c) => c.charCodeAt(0)); }
  catch (_) { fail(400, "INVALID_ACCOUNT_PAYLOAD", `${name} must be valid base64url.`); }
  if (length && result.length !== length) fail(400, "INVALID_ACCOUNT_PAYLOAD", `${name} has an invalid length.`);
  return result;
}
function b64(value) {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function canonicalAccountJson(value) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalAccountJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalAccountJson(value[key])}`).join(",")}}`;
  fail(400, "INVALID_ACCOUNT_PAYLOAD", "The signed payload is invalid.");
}
function expiry(seconds, timestamp = Date.now()) { return seconds ? new Date(timestamp + seconds * 1000).toISOString() : null; }
function bundle(row) {
  return row ? { userId: row.user_id, keyVersion: row.key_version, encryptionPublicKey: row.encryption_public_key,
    signingPublicKey: row.signing_public_key, fingerprint: row.fingerprint, status: row.status } : null;
}
async function activeKey(db, userId) {
  return db.prepare(`SELECT k.* FROM chat_account_keys k LEFT JOIN chat_account_identity_heads h ON h.user_id = k.user_id
    WHERE k.user_id = ? AND k.status = 'active' AND (h.key_version IS NULL OR k.key_version = h.key_version)
    ORDER BY k.updated_at DESC, k.key_version DESC LIMIT 1`).bind(userId).first();
}
async function accountReady(db, userId, keyVersion) {
  if (!keyVersion) return false;
  let vault;
  try { vault = await db.prepare(`SELECT v.key_version FROM chat_account_vault_versions v
    JOIN chat_passkeys p ON p.user_id=v.user_id AND p.revoked_at IS NULL AND
      (p.credential_id=v.credential_id OR v.credential_id IS NULL OR EXISTS (SELECT 1 FROM chat_account_vault_wrappers w
        WHERE w.user_id=v.user_id AND w.key_version=v.key_version AND w.credential_id=p.credential_id))
    WHERE v.user_id=? AND v.key_version=? LIMIT 1`).bind(userId,keyVersion).first(); }
  catch (_error) { vault = await db.prepare(`SELECT v.key_version FROM chat_account_vault_versions v
    JOIN chat_passkeys p ON (p.credential_id=v.credential_id OR v.credential_id IS NULL) AND p.user_id=v.user_id AND p.revoked_at IS NULL
    WHERE v.user_id=? AND v.key_version=? LIMIT 1`).bind(userId,keyVersion).first(); }
  return Boolean(vault);
}
async function verifySigned(db, userId, value, signature, code = "INVALID_CONTROL_SIGNATURE") {
  if (value.senderUserId !== userId || value.version !== VERSION) fail(400, code, "The signed account identity is invalid.");
  const key = await activeKey(db, userId);
  if (!key || key.key_version !== value.senderKeyId) fail(409, "ACCOUNT_KEY_CHANGED", "Unlock the current account identity before continuing.");
  let verified = false;
  try {
    const publicKey = await crypto.subtle.importKey("raw", bytes(key.signing_public_key, "signing key", 32), { name: "Ed25519" }, false, ["verify"]);
    verified = await crypto.subtle.verify("Ed25519", publicKey, bytes(signature, "signature", 64), enc.encode(canonicalAccountJson(value)));
  } catch (_) { /* Invalid cryptographic input is reported uniformly. */ }
  if (!verified) fail(400, code, "The account signature is invalid.");
  return key;
}
async function control(db, userId, body, conversationId, action) {
  const value = { version: body.version, conversationId: body.conversationId, expectedEpoch: body.expectedEpoch,
    action: body.action, payload: body.payload, senderUserId: body.senderUserId, senderKeyId: body.senderKeyId };
  if (value.conversationId !== conversationId || value.action !== action || !Number.isSafeInteger(value.expectedEpoch) || value.expectedEpoch < 0 || !value.payload || Array.isArray(value.payload)) {
    fail(400, "INVALID_ACCOUNT_CONTROL", "The signed control does not match this operation.");
  }
  await verifySigned(db, userId, value, body.signature);
  return { ...value, signature: body.signature };
}
export async function verifyAccountControl(db, userId, body, conversationId, action) {
  return control(db, userId, body, conversationId, action);
}
async function member(db, conversationId, userId, allowLeft = false) {
  const row = await db.prepare(`SELECT c.*, m.role, m.left_at, m.joined_at FROM chat_conversations c
    JOIN chat_conversation_members m ON m.conversation_id = c.id
    WHERE c.id = ? AND m.user_id = ? ${allowLeft ? "" : "AND m.left_at IS NULL AND c.deleted_at IS NULL"}`)
    .bind(conversationId, userId).first();
  if (!row || row.protocol_version !== VERSION) fail(404, "CONVERSATION_NOT_FOUND", "Account conversation not found.");
  return row;
}
async function members(db, conversationId) {
  return rows(db.prepare(`SELECT m.*, p.chat_alias, p.avatar_data_url FROM chat_conversation_members m LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    WHERE m.conversation_id = ? AND m.left_at IS NULL ORDER BY m.joined_at, m.user_id`).bind(conversationId));
}
async function contactUsers(db, userId, contactIds) {
  if (!Array.isArray(contactIds) || !contactIds.length || contactIds.length > 49 || new Set(contactIds).size !== contactIds.length) fail(400, "INVALID_GROUP_MEMBERS", "Choose between 1 and 49 distinct paired contacts.");
  const result = [];
  for (const contactId of contactIds) {
    const contact = await db.prepare("SELECT peer_user_id FROM chat_contacts WHERE id = ? AND user_id = ? AND accepted_at IS NOT NULL").bind(str(contactId, "contactId"), userId).first();
    if (!contact || contact.peer_user_id === userId) fail(404, "CONTACT_NOT_FOUND", "A selected paired contact is unavailable.");
    result.push(contact.peer_user_id);
  }
  if (new Set(result).size !== result.length) fail(400, "INVALID_GROUP_MEMBERS", "A contact appears more than once.");
  return result;
}
async function recipientKeys(db, recipients, userIds) {
  if (!Array.isArray(recipients) || recipients.length !== userIds.length || new Set(recipients.map((r) => r?.userId)).size !== userIds.length) fail(400, "INVALID_EPOCH_RECIPIENTS", "Exactly one envelope is required for each active account.");
  const keys = [];
  for (const userId of userIds) {
    const key = await activeKey(db, userId);
    const ready = key && await accountReady(db, userId, key.key_version);
    if (!ready) fail(409, "ACCOUNT_NOT_ENABLED", "Every participant must first enable secure account sync.");
    const recipient = recipients.find((r) => r.userId === userId);
    if (!recipient || recipient.keyVersion !== key.key_version) fail(409, "ACCOUNT_KEY_CHANGED", "An account key changed. Refresh the member keys.");
    bytes(recipient.ephemeralPublicKey, "ephemeralPublicKey", 32);
    bytes(recipient.nonce, "envelope nonce", 12);
    bytes(recipient.ciphertext, "envelope ciphertext", 48);
    keys.push(key);
  }
  return keys;
}
function metadata(value, epoch) {
  if (!value || !Number.isSafeInteger(value.version) || value.version < 1 || Number(value.epoch) !== epoch) fail(400, "INVALID_GROUP_METADATA", "Encrypted group metadata must use the current epoch.");
  bytes(value.nonce, "metadata nonce", 12);
  const cipher = bytes(value.ciphertext, "metadata ciphertext");
  if (cipher.length < 16 || value.ciphertext.length > 64 * 1024) fail(400, "INVALID_GROUP_METADATA", "Encrypted group metadata is invalid.");
  return value;
}
function epochStatements(db, conversationId, epoch, userId, recipients, timestamp) {
  return [db.prepare("INSERT INTO chat_conversation_epochs (conversation_id, epoch, created_by, created_at) VALUES (?, ?, ?, ?)").bind(conversationId, epoch, userId, timestamp),
    ...recipients.map((r) => db.prepare(`INSERT INTO chat_epoch_recipients (conversation_id, epoch, user_id, key_version, ephemeral_public_key, nonce, envelope_ciphertext, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(conversationId, epoch, r.userId, r.keyVersion, r.ephemeralPublicKey, r.nonce, r.ciphertext, timestamp))];
}
function metadataStatement(db, conversationId, data, timestamp) {
  return db.prepare(`INSERT INTO chat_group_metadata (conversation_id, epoch, version, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET epoch = excluded.epoch, version = excluded.version, nonce = excluded.nonce, ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`)
    .bind(conversationId, data.epoch, data.version, data.nonce, data.ciphertext, timestamp);
}
async function conversationSummary(db, conversationId, userId) {
  const latest = await db.prepare(`SELECT m.id, m.conversation_id, m.sender_device_id, m.sender_user_id, m.sender_key_id,
      d.device_number AS sender_device_number, p.chat_alias AS sender_alias, p.avatar_data_url AS sender_avatar_data_url,
      ak.signing_public_key AS sender_signing_public_key, m.client_message_id, m.protocol_version, m.content_epoch,
      m.nonce, m.signature, m.ciphertext, m.attachment_refs, m.size_bucket, m.created_at, m.expires_at, m.deleted_at
    FROM chat_messages m LEFT JOIN chat_devices d ON d.id=m.sender_device_id
      LEFT JOIN chat_profiles p ON p.user_id=COALESCE(m.sender_user_id,d.user_id)
      LEFT JOIN chat_account_keys ak ON ak.user_id=m.sender_user_id AND ak.key_version=m.sender_key_id
    WHERE m.conversation_id=? ORDER BY m.created_at DESC,m.id DESC LIMIT 1`).bind(conversationId).first();
  let membership = null;
  try { membership = await db.prepare("SELECT last_read_at,last_read_message_id FROM chat_conversation_members WHERE conversation_id=? AND user_id=?").bind(conversationId,userId).first(); } catch (_) {}
  let unreadCount = 0;
  try {
    const count = await db.prepare(`SELECT COUNT(*) AS count FROM chat_messages m
      LEFT JOIN chat_devices d ON d.id=m.sender_device_id WHERE m.conversation_id=? AND m.deleted_at IS NULL
      AND (m.created_at>COALESCE(?, '') OR (m.created_at=COALESCE(?, '') AND m.id>COALESCE(?, '')))
      AND COALESCE(m.sender_user_id,d.user_id)<>?`).bind(conversationId,membership?.last_read_at||null,membership?.last_read_at||null,membership?.last_read_message_id||null,userId).first();
    unreadCount = Number(count?.count || 0);
  } catch (_) {}
  const latestMessage = latest ? { id: latest.id, conversationId: latest.conversation_id, senderDeviceId: latest.sender_device_id || null, senderUserId: latest.sender_user_id || null, senderKeyId: latest.sender_key_id || null, senderDeviceNumber: latest.sender_device_number == null ? null : Number(latest.sender_device_number), senderAlias: latest.sender_alias || "Paired contact", senderAvatarDataUrl: latest.sender_avatar_data_url || "", senderSigningPublicKey: latest.sender_signing_public_key || null, clientMessageId: latest.client_message_id, protocolVersion: latest.protocol_version || VERSION, contentEpoch: latest.content_epoch == null ? null : Number(latest.content_epoch), nonce: latest.deleted_at ? null : latest.nonce, signature: latest.deleted_at ? null : latest.signature, ciphertext: latest.deleted_at ? "" : latest.ciphertext, attachmentRefs: latest.deleted_at ? [] : JSON.parse(latest.attachment_refs || "[]"), sizeBucket: latest.size_bucket, createdAt: latest.created_at, expiresAt: latest.expires_at, deleted: Boolean(latest.deleted_at) } : null;
  return { unreadCount, lastReadAt: membership?.last_read_at || null, lastReadMessageId: membership?.last_read_message_id || null, lastMessageAt: latest?.created_at || null, latestMessage };
}
function eventStatement(db, conversationId, type, entityId, epoch, timestamp, signed = null) {
  return db.prepare(`INSERT INTO chat_sync_events (conversation_id, event_type, entity_id, content_epoch, control_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(conversationId, type, entityId, epoch, signed ? JSON.stringify(signed) : null, timestamp);
}
function keyGuard(db, key) {
  return db.prepare(`INSERT INTO chat_account_atomic_guards (id, valid) VALUES (?, CASE WHEN EXISTS
    (SELECT 1 FROM chat_account_keys WHERE user_id = ? AND key_version = ? AND status = 'active') THEN 1 ELSE 0 END)`)
    .bind(id(), key.user_id, key.key_version);
}
async function atomic(db, statements) {
  try { await db.batch([...statements, db.prepare("DELETE FROM chat_account_atomic_guards")]); }
  catch (error) {
    if (/CHECK constraint failed|UNIQUE constraint failed/.test(String(error.message))) fail(409, "EPOCH_CONFLICT", "The conversation or account changed. Refresh and retry.");
    throw error;
  }
}
function cas(db, conversation, expectedEpoch) {
  if (Number(conversation.current_epoch) !== expectedEpoch) fail(409, "EPOCH_CONFLICT", "The conversation epoch changed. Refresh and retry.");
  return db.prepare(`INSERT INTO chat_account_atomic_guards (id, valid) VALUES (?, CASE WHEN EXISTS
    (SELECT 1 FROM chat_conversations WHERE id = ? AND current_epoch = ? AND control_revision = ? AND deleted_at IS NULL) THEN 1 ELSE 0 END)`)
    .bind(id(), conversation.id, expectedEpoch, conversation.control_revision);
}
async function broadcast(db, env, conversationId) {
  const event = await db.prepare("SELECT MAX(sequence) AS sequence FROM chat_sync_events WHERE conversation_id = ?").bind(conversationId).first();
  if (env.CHAT_ROOMS && event?.sequence) {
    try { await env.CHAT_ROOMS.get(env.CHAT_ROOMS.idFromName(conversationId)).fetch("https://chat-room/broadcast", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type: "sync", conversationId, sequence: event.sequence }),
    }); } catch (_) { /* Cursor sync recovers disconnected clients. */ }
  }
  return Number(event?.sequence || 0);
}
export async function isHistoricalConversation(db, row) {
  if (row.protocol_version !== VERSION) return true;
  if (row.kind !== "direct") return false;
  // A reset by either participant makes this immutable direct epoch historical.
  const changed = await db.prepare(`SELECT 1 FROM chat_conversation_members m
    LEFT JOIN chat_epoch_recipients r ON r.conversation_id = m.conversation_id
      AND r.epoch = ? AND r.user_id = m.user_id
    LEFT JOIN chat_account_identity_heads h ON h.user_id = m.user_id
    WHERE m.conversation_id = ? AND m.left_at IS NULL
      AND (r.key_version IS NULL OR h.key_version IS NULL OR r.key_version <> h.key_version)
    LIMIT 1`).bind(row.current_epoch, row.id).first();
  return Boolean(changed);
}
export async function mapAccountConversation(db, row, userId) {
  if (row.protocol_version !== VERSION) return null;
  const active = await members(db, row.id);
  const mapped = [];
  for (const m of active) {
    const contact = m.user_id === userId ? null : await db.prepare("SELECT id FROM chat_contacts WHERE user_id = ? AND peer_user_id = ? AND accepted_at IS NOT NULL").bind(userId, m.user_id).first();
    const profile = await db.prepare("SELECT chat_user_id FROM chat_profiles WHERE user_id=?").bind(m.user_id).first();
    mapped.push({ userId: m.user_id, chatUserId: profile?.chat_user_id || null, alias: m.chat_alias || "Paired contact", avatarDataUrl: m.avatar_data_url || "", role: m.role, joinedAt: m.joined_at, isSelf: m.user_id === userId, contactId: contact?.id || null, accountKey: bundle(await activeKey(db, m.user_id)) });
  }
  const data = await db.prepare("SELECT * FROM chat_group_metadata WHERE conversation_id = ?").bind(row.id).first();
  const summary = await conversationSummary(db, row.id, userId);
  const isGlobalDiscussion = row.global_slug === "site-wide-discussion";
  const siteRole = (await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first())?.role || null;
  const peer = row.kind === "direct" ? mapped.find((m) => !m.isSelf) || null : null;
  if (peer) {
    const blocks = await db.prepare(`SELECT
      EXISTS(SELECT 1 FROM chat_user_blocks WHERE user_id=? AND blocked_user_id=?) AS own_block,
      EXISTS(SELECT 1 FROM chat_user_blocks WHERE (user_id=? AND blocked_user_id=?) OR (user_id=? AND blocked_user_id=?)) AS blocked`)
      .bind(userId, peer.userId, userId, peer.userId, peer.userId, userId).first();
    peer.blockedBySelf = Boolean(blocks.own_block);
    peer.contactAccepted = Boolean(peer.contactId);
    peer.canSend = peer.contactAccepted && !blocks.blocked;
  }
  return { id: row.id, kind: row.kind, protocolVersion: VERSION, historical: await isHistoricalConversation(db, row), epoch: Number(row.current_epoch), currentEpoch: Number(row.current_epoch),
    rotationRequired: Boolean(row.rotation_required), role: mapped.find((m) => m.isSelf)?.role || null, retentionSeconds: row.retention_seconds,
    createdAt: row.created_at, updatedAt: row.updated_at, ...summary, legacySourceId: row.legacy_source_id || null,
    members: mapped, group: row.kind === "group" ? { members: mapped, memberCount: mapped.length } : null,
    peer, canSend: row.kind === "direct" ? Boolean(peer?.canSend) : true,
    metadata: data ? { epoch: data.epoch, version: data.version, nonce: data.nonce, ciphertext: data.ciphertext } : null,
    isGlobalDiscussion,
    globalDiscussion: isGlobalDiscussion,
    globalSlug: isGlobalDiscussion ? row.global_slug : null,
    siteRole };
}
async function createConversation(db, env, userId, body) {
  const conversationId = str(body.conversationId, "conversationId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) fail(400, "INVALID_CONVERSATION_ID", "A client-generated UUID v4 is required.");
  const signed = await control(db, userId, body, conversationId, "create");
  if (signed.expectedEpoch !== 0) fail(400, "INVALID_ACCOUNT_EPOCH", "The initial epoch must follow epoch zero.");
  const p = signed.payload;
  if (!["direct", "group"].includes(p.kind)) fail(400, "INVALID_CONVERSATION", "Conversation kind is invalid.");
  const peers = await contactUsers(db, userId, p.contactIds);
  if (p.kind === "direct" && peers.length !== 1) fail(400, "INVALID_CONVERSATION", "A direct conversation has exactly two accounts.");
  const userIds = [userId, ...peers];
  if (p.legacySourceId) {
    const source = await db.prepare("SELECT protocol_version FROM chat_conversations WHERE id = ?").bind(p.legacySourceId).first();
    const original = await members(db, p.legacySourceId);
    if (!source || source.protocol_version !== "signal-v1" || original.length !== userIds.length || original.some((m) => !userIds.includes(m.user_id))) fail(403, "INVALID_MIGRATION_RECIPIENTS", "A legacy archive must have exactly the original conversation members.");
  }
  const keys = await recipientKeys(db, p.recipients, userIds);
  const data = p.kind === "group" ? metadata(p.metadata, 1) : null;
  const timestamp = now();
  const statements = keys.map((key) => keyGuard(db, key));
  statements.push(db.prepare(`INSERT INTO chat_conversations (id, kind, created_by, retention_seconds, protocol_version, current_epoch, legacy_source_id, created_at, updated_at)
    VALUES (?, ?, ?, 0, 'account-v2', 1, ?, ?, ?)`).bind(conversationId, p.kind, userId, p.legacySourceId || null, timestamp, timestamp));
  for (const memberId of userIds) statements.push(db.prepare("INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)").bind(conversationId, memberId, memberId === userId ? "owner" : "member", timestamp));
  statements.push(...epochStatements(db, conversationId, 1, userId, p.recipients, timestamp));
  if (data) statements.push(metadataStatement(db, conversationId, data, timestamp));
  statements.push(db.prepare("INSERT INTO chat_account_controls (signature, conversation_id, control_json, created_at) VALUES (?, ?, ?, ?)").bind(signed.signature, conversationId, JSON.stringify(signed), timestamp), eventStatement(db, conversationId, "created", conversationId, 1, timestamp, signed));
  await atomic(db, statements);
  await broadcast(db, env, conversationId);
  return mapAccountConversation(db, await member(db, conversationId, userId), userId);
}
async function changeConversation(db, env, userId, conversationId, body) {
  const c = await member(db, conversationId, userId);
  if (c.global_slug === "site-wide-discussion" && body?.action !== "leave") {
    if (body?.action !== "metadata") fail(403, "GLOBAL_MEMBERSHIP_MANAGED", "Website administrators manage membership and roles for the global discussion.");
    const siteRole = (await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first())?.role;
    if (siteRole !== "admin") fail(403, "FORBIDDEN", "Only website administrators can publish a global discussion announcement.");
  }
  const signed = await control(db, userId, body, conversationId, str(body.action, "action", 40));
  const p = signed.payload;
  const active = await members(db, conversationId);
  const actor = active.find((m) => m.user_id === userId);
  const target = active.find((m) => m.user_id === p.userId);
  const timestamp = now();
  const statements = [cas(db, c, signed.expectedEpoch)];
  let epoch = Number(c.current_epoch);
  let next = active.map((m) => ({ ...m }));
  let rotate = false;
  let leaving = false;
  let dissolve = false;
  if (signed.action === "retention") {
    if (c.kind === "group" && actor.role !== "owner") fail(403, "FORBIDDEN", "Only the owner can change group retention.");
    if (!RETENTION.has(p.retentionSeconds)) fail(400, "INVALID_RETENTION", "Unsupported retention period.");
    statements.push(db.prepare("UPDATE chat_conversations SET retention_seconds = ? WHERE id = ?").bind(p.retentionSeconds, conversationId));
    statements.push(db.prepare("UPDATE chat_messages SET expires_at = CASE WHEN ? = 0 THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || ? || ' seconds') END WHERE conversation_id = ? AND deleted_at IS NULL").bind(p.retentionSeconds, p.retentionSeconds, conversationId));
    statements.push(db.prepare("UPDATE chat_attachments SET expires_at = CASE WHEN ? = 0 THEN NULL ELSE strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+' || ? || ' seconds') END WHERE conversation_id = ? AND status <> 'deleted'").bind(p.retentionSeconds, p.retentionSeconds, conversationId));
  } else {
    if (c.kind !== "group") fail(400, "INVALID_GROUP_OPERATION", "Direct conversations require a new conversation to change participants or identity.");
    if (signed.action === "leave") {
      if (c.global_slug === "site-wide-discussion") {
        const siteRole = (await db.prepare("SELECT role FROM users WHERE id = ?").bind(userId).first())?.role;
        if (siteRole === "admin" || actor.role === "admin" || actor.role === "owner") {
          fail(403, "ADMIN_CANNOT_LEAVE_GLOBAL_DISCUSSION", "Website administrators cannot leave the discussion.");
        }
        statements.push(db.prepare("INSERT INTO chat_global_optouts (conversation_id, user_id, left_at, reason) VALUES (?, ?, ?, 'left') ON CONFLICT(conversation_id, user_id) DO UPDATE SET left_at = excluded.left_at, reason = 'left'").bind(conversationId, userId, timestamp));
      }
      if (actor.role === "owner") fail(409, "OWNER_TRANSFER_REQUIRED", "Transfer ownership before leaving.");
      next = next.filter((m) => m.user_id !== userId);
      leaving = true;
      statements.push(db.prepare("UPDATE chat_conversation_members SET left_at = ? WHERE conversation_id = ? AND user_id = ?").bind(timestamp, conversationId, userId));
    } else {
      if (!["owner", "admin"].includes(actor.role)) fail(403, "FORBIDDEN", "An owner or administrator is required.");
      if (signed.action === "add") {
        const added = await contactUsers(db, userId, p.contactIds);
        if (next.length + added.length > 50 || added.some((addedId) => next.some((m) => m.user_id === addedId))) fail(400, "INVALID_GROUP_MEMBERS", "A group supports at most 50 distinct accounts.");
        if (c.legacy_source_id) fail(409, "ARCHIVE_MEMBERS_FIXED", "Legacy archives keep their original recipients.");
        for (const addedId of added) {
          next.push({ user_id: addedId, role: "member" });
          statements.push(db.prepare(`INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at) VALUES (?, ?, 'member', ?)
            ON CONFLICT(conversation_id, user_id) DO UPDATE SET role = 'member', joined_at = excluded.joined_at, left_at = NULL`).bind(conversationId, addedId, timestamp));
        }
        rotate = true;
      } else if (signed.action === "remove") {
        if (!target || target.role === "owner" || target.user_id === userId || (actor.role === "admin" && target.role !== "member")) fail(403, "FORBIDDEN", "This member cannot be removed by your role.");
        next = next.filter((m) => m.user_id !== target.user_id);
        statements.push(db.prepare("UPDATE chat_conversation_members SET left_at = ? WHERE conversation_id = ? AND user_id = ?").bind(timestamp, conversationId, target.user_id));
        rotate = true;
      } else if (signed.action === "rotate") {
        if (!c.rotation_required) fail(409, "ROTATION_NOT_REQUIRED", "No pending membership rotation exists.");
        rotate = true;
      } else if (signed.action === "role") {
        if (actor.role !== "owner" || !target || target.role === "owner" || !["admin", "member"].includes(p.role)) fail(403, "FORBIDDEN", "Only the owner can assign member roles.");
        statements.push(db.prepare("UPDATE chat_conversation_members SET role = ? WHERE conversation_id = ? AND user_id = ?").bind(p.role, conversationId, target.user_id));
      } else if (signed.action === "transfer") {
        if (actor.role !== "owner" || !target || target.user_id === userId) fail(403, "FORBIDDEN", "Only the owner can transfer ownership to another member.");
        statements.push(db.prepare("UPDATE chat_conversation_members SET role = CASE WHEN user_id = ? THEN 'owner' ELSE 'admin' END WHERE conversation_id = ? AND user_id IN (?, ?)").bind(target.user_id, conversationId, target.user_id, userId));
      } else if (signed.action === "dissolve") {
        if (actor.role !== "owner") fail(403, "FORBIDDEN", "Only the owner can dissolve the group.");
        dissolve = true;
        statements.push(db.prepare("UPDATE chat_conversations SET deleted_at = ? WHERE id = ?").bind(timestamp, conversationId));
      } else if (signed.action !== "metadata") fail(400, "INVALID_GROUP_OPERATION", "Unknown group operation.");
    }
  }
  if (rotate) {
    epoch += 1;
    const previous = await db.prepare("SELECT version FROM chat_group_metadata WHERE conversation_id = ?").bind(conversationId).first();
    const data = metadata(p.metadata, epoch);
    if (data.version !== Number(previous?.version || 0) + 1) fail(409, "METADATA_CONFLICT", "The group profile changed. Refresh it first.");
    const keys = await recipientKeys(db, p.recipients, next.map((m) => m.user_id));
    const previousRecipients = await rows(db.prepare("SELECT user_id,key_version FROM chat_epoch_recipients WHERE conversation_id=? AND epoch=?").bind(conversationId,c.current_epoch));
    for (const key of keys) {
      if (!active.some((m) => m.user_id === key.user_id)) continue;
      const previousRecipient = previousRecipients.find((r) => r.user_id === key.user_id);
      if (previousRecipient?.key_version !== key.key_version) {
        fail(409,"ACCOUNT_KEY_CHANGED","A current member reset their identity. Remove and invite that account again before rotating the group key.",{userId:key.user_id});
      }
    }
    statements.push(...keys.map((key) => keyGuard(db, key)), ...epochStatements(db, conversationId, epoch, userId, p.recipients, timestamp));
    statements.push(metadataStatement(db, conversationId, data, timestamp));
  } else if (signed.action === "metadata") {
    if (c.rotation_required) fail(409, "ROTATION_REQUIRED", "Complete the membership rotation first.");
    const previous = await db.prepare("SELECT version FROM chat_group_metadata WHERE conversation_id = ?").bind(conversationId).first();
    const data = metadata(p.metadata, epoch);
    if (data.version !== Number(previous?.version || 0) + 1) fail(409, "METADATA_CONFLICT", "The group profile changed. Refresh it first.");
    statements.push(metadataStatement(db, conversationId, data, timestamp));
  }
  statements.push(db.prepare("UPDATE chat_conversations SET current_epoch = ?, rotation_required = ?, control_revision = control_revision + 1, updated_at = ? WHERE id = ?").bind(epoch, leaving ? 1 : rotate ? 0 : c.rotation_required, timestamp, conversationId));
  statements.push(db.prepare("INSERT INTO chat_account_controls (signature, conversation_id, control_json, created_at) VALUES (?, ?, ?, ?)").bind(signed.signature, conversationId, JSON.stringify(signed), timestamp));
  statements.push(eventStatement(db, conversationId, signed.action, p.userId || conversationId, epoch, timestamp, signed));
  await atomic(db, statements);
  const sequence = await broadcast(db, env, conversationId);
  return leaving || dissolve ? { conversationId, left: leaving, dissolved: dissolve, rotationRequired: leaving, sequence } : { conversation: await mapAccountConversation(db, await member(db, conversationId, userId), userId), sequence };
}

async function sendable(db, conversation, userId, senderKeyId, epoch) {
  if (conversation.kind === "direct") {
    const peer = await db.prepare("SELECT user_id FROM chat_conversation_members WHERE conversation_id=? AND user_id<>? AND left_at IS NULL LIMIT 1")
      .bind(conversation.id, userId).first();
    const blocked = peer && await db.prepare("SELECT 1 FROM chat_user_blocks WHERE (user_id=? AND blocked_user_id=?) OR (user_id=? AND blocked_user_id=?)")
      .bind(userId, peer.user_id, peer.user_id, userId).first();
    if (blocked) fail(403, "CHAT_CONTACT_BLOCKED", "This contact cannot receive your message.");
    if (!peer || !await db.prepare("SELECT 1 FROM chat_contacts WHERE user_id=? AND peer_user_id=? AND accepted_at IS NOT NULL").bind(userId, peer.user_id).first())
      fail(403, "CHAT_FRIENDSHIP_REQUIRED", "An accepted friendship is required to send messages.");
  }
  if (conversation.rotation_required) fail(409, "ROTATION_REQUIRED", "A member left. Rotate the group key before sending.");
  if (Number(conversation.current_epoch) !== epoch) fail(409, "EPOCH_CONFLICT", "Refresh the conversation epoch before sending.");
  const active = await members(db, conversation.id);
  const recipients = await rows(db.prepare("SELECT user_id, key_version FROM chat_epoch_recipients WHERE conversation_id = ? AND epoch = ?").bind(conversation.id, epoch));
  if (active.length !== recipients.length) fail(409, "ROTATION_REQUIRED", "The active member set requires a new epoch.");
  const keys = [];
  for (const m of active) {
    const key = await activeKey(db, m.user_id);
    const envelope = recipients.find((r) => r.user_id === m.user_id);
    if (!key || envelope?.key_version !== key.key_version || (m.user_id === userId && key.key_version !== senderKeyId)) fail(409, "ACCOUNT_KEY_CHANGED", "A participant changed their identity. Establish a new secure membership first.");
    keys.push(key);
  }
  return keys;
}
function mapMessage(row) {
  return { id: row.id, conversationId: row.conversation_id, protocolVersion: VERSION, version: VERSION,
    senderUserId: row.sender_user_id, senderKeyId: row.sender_key_id, senderSigningPublicKey: row.signing_public_key,
    senderAlias: row.chat_alias || "Paired contact", senderAvatarDataUrl: row.avatar_data_url || "", clientMessageId: row.client_message_id, contentEpoch: row.content_epoch, epoch: row.content_epoch,
    nonce: row.deleted_at ? null : row.nonce, ciphertext: row.deleted_at ? "" : row.ciphertext, signature: row.deleted_at ? null : row.signature,
    attachmentRefs: row.deleted_at ? [] : JSON.parse(row.attachment_refs), createdAt: row.created_at, expiresAt: row.expires_at, deleted: Boolean(row.deleted_at) };
}
async function messageById(db, messageId) {
  return db.prepare(`SELECT m.*, k.signing_public_key, p.chat_alias, p.avatar_data_url FROM chat_messages m
    LEFT JOIN chat_account_keys k ON k.user_id = m.sender_user_id AND k.key_version = m.sender_key_id
    LEFT JOIN chat_profiles p ON p.user_id = m.sender_user_id WHERE m.id = ?`).bind(messageId).first();
}
async function postAccountMessage(db, env, userId, body) {
  const conversationId = str(body.conversationId, "conversationId");
  const c = await member(db, conversationId, userId);
  const epoch = Number(body.contentEpoch ?? body.epoch);
  const refs = body.attachmentRefs || [];
  if (!Array.isArray(refs) || refs.length > 8 || new Set(refs).size !== refs.length) fail(400, "INVALID_ATTACHMENTS", "Attachment references are invalid.");
  const signed = { version: VERSION, conversationId, clientMessageId: str(body.clientMessageId, "clientMessageId", 160), epoch,
    senderUserId: userId, senderKeyId: str(body.senderKeyId, "senderKeyId", 64), nonce: body.nonce, ciphertext: body.ciphertext, attachmentRefs: refs };
  bytes(signed.nonce, "message nonce", 12);
  if (bytes(signed.ciphertext, "ciphertext").length < 16) fail(400, "INVALID_CIPHERTEXT", "Ciphertext is too short.");
  await verifySigned(db, userId, signed, body.signature, "INVALID_ACCOUNT_V2_SIGNATURE");
  const existing = await db.prepare("SELECT * FROM chat_messages WHERE sender_user_id = ? AND client_message_id = ?").bind(userId, signed.clientMessageId).first();
  if (existing) {
    if (existing.conversation_id !== conversationId || existing.ciphertext !== signed.ciphertext || existing.signature !== body.signature) fail(409, "MESSAGE_ID_REUSED", "This message ID was already used.");
    return { duplicate: true, message: mapMessage(await messageById(db, existing.id)) };
  }
  const keys = await sendable(db, c, userId, signed.senderKeyId, epoch);
  for (const ref of refs) {
    const file = await db.prepare("SELECT * FROM chat_attachments WHERE id = ? AND conversation_id = ? AND status = 'complete' AND owner_user_id = ? AND content_epoch = ? AND (expires_at IS NULL OR expires_at > ?)").bind(str(ref, "attachmentId"), conversationId, userId, epoch, now()).first();
    if (!file) fail(400, "INVALID_ATTACHMENTS", "An attachment is unavailable to this sender and epoch.");
  }
  let source = null;
  if (body.sourceMessageId) {
    if (!c.legacy_source_id) fail(400, "INVALID_LEGACY_ARCHIVE", "A designated legacy archive is required.");
    source = await db.prepare("SELECT * FROM chat_messages WHERE id = ? AND conversation_id = ? AND protocol_version = 'signal-v1' AND deleted_at IS NULL").bind(body.sourceMessageId, c.legacy_source_id).first();
    if (!source) fail(404, "LEGACY_MESSAGE_UNAVAILABLE", "The original legacy message is unavailable.");
    const original = await members(db, c.legacy_source_id);
    const current = await members(db, conversationId);
    if (original.length !== current.length || original.some((m) => !current.some((n) => n.user_id === m.user_id))) fail(403, "INVALID_MIGRATION_RECIPIENTS", "Archives may only be delivered to the original members.");
    const previous = await db.prepare("SELECT target_message_id FROM chat_legacy_message_migrations WHERE source_message_id = ?").bind(source.id).first();
    if (previous) {
      const target = await messageById(db, previous.target_message_id);
      if (!target) fail(410, "MIGRATED_MESSAGE_UNAVAILABLE", "The migrated message is no longer retained.");
      return { duplicate: true, message: mapMessage(target) };
    }
  }
  const messageId = id();
  const timestamp = now();
  const statements = [cas(db, c, epoch), ...keys.map((key) => keyGuard(db, key)), db.prepare(`INSERT INTO chat_messages
    (id, conversation_id, sender_user_id, sender_key_id, client_message_id, protocol_version, content_epoch, nonce, ciphertext, signature, attachment_refs, size_bucket, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, 'account-v2', ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(messageId, conversationId, userId, signed.senderKeyId, signed.clientMessageId, epoch, signed.nonce, signed.ciphertext, body.signature, JSON.stringify(refs), signed.ciphertext.length > 65536 ? "large" : "small", timestamp, expiry(c.retention_seconds))];
  if (source) statements.push(db.prepare("INSERT INTO chat_legacy_message_migrations (source_message_id, target_message_id, conversation_id, migrated_by, created_at) VALUES (?, ?, ?, ?, ?)").bind(source.id, messageId, conversationId, userId, timestamp));
  statements.push(eventStatement(db, conversationId, "message", messageId, epoch, timestamp), db.prepare("UPDATE chat_conversations SET updated_at = ? WHERE id = ?").bind(timestamp, conversationId));
  await atomic(db, statements);
  const sequence = await broadcast(db, env, conversationId);
  return { message: mapMessage(await messageById(db, messageId)), duplicate: false, sequence };
}
async function events(db, conversationId, userId, url) {
  const c = await member(db, conversationId, userId, true);
  const after = Number(url.searchParams.get("after") || url.searchParams.get("cursor") || 0);
  const limit = Number(url.searchParams.get("limit") || 100);
  if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200) fail(400, "INVALID_CURSOR", "The event cursor is invalid.");
  const raw = await rows(db.prepare(`SELECT e.* FROM chat_sync_events e WHERE e.conversation_id = ? AND e.sequence > ?
    AND (? IS NULL OR e.created_at <= ?) ORDER BY e.sequence LIMIT ?`).bind(conversationId, after, c.left_at, c.left_at, limit));
  const result = [];
  for (const event of raw) {
    const ownRemoval = event.event_type === "remove" && event.entity_id === userId;
    if (event.content_epoch && !ownRemoval && !(await db.prepare("SELECT 1 FROM chat_epoch_recipients WHERE conversation_id = ? AND epoch = ? AND user_id = ?").bind(conversationId, event.content_epoch, userId).first())) continue;
    const item = { sequence: event.sequence, type: event.event_type, entityId: event.entity_id, epoch: event.content_epoch, createdAt: event.created_at };
    if (event.event_type === "message") {
      const message = await messageById(db, event.entity_id);
      if (!message || message.deleted_at || (message.expires_at && message.expires_at <= now())) { item.type = "deleted"; item.messageId = event.entity_id; }
      else item.message = mapMessage(message);
    } else if (event.event_type === "deleted") item.messageId = event.entity_id;
    else if (event.control_json && !ownRemoval) item.control = JSON.parse(event.control_json);
    result.push(item);
  }
  return { events: result, nextCursor: raw.at(-1)?.sequence || after, hasMore: raw.length === limit };
}
async function epochs(db, conversationId, userId) {
  await member(db, conversationId, userId);
  return (await rows(db.prepare(`SELECT e.*, r.user_id, r.key_version, r.ephemeral_public_key, r.nonce, r.envelope_ciphertext
    FROM chat_conversation_epochs e JOIN chat_epoch_recipients r ON r.conversation_id = e.conversation_id AND r.epoch = e.epoch
    WHERE e.conversation_id = ? AND r.user_id = ? ORDER BY e.epoch`).bind(conversationId, userId))).map((r) => ({ epoch: r.epoch, createdBy: r.created_by, createdAt: r.created_at,
      envelope: { userId: r.user_id, keyVersion: r.key_version, ephemeralPublicKey: r.ephemeral_public_key, nonce: r.nonce, ciphertext: r.envelope_ciphertext } }));
}
async function deleteMessage(db, env, userId, messageId) {
  const message = await messageById(db, messageId);
  if (!message) fail(404, "MESSAGE_NOT_FOUND", "Message not found.");
  await member(db, message.conversation_id, userId);
  if (message.sender_user_id !== userId) fail(403, "FORBIDDEN", "Only the sender can delete this message.");
  if (!message.deleted_at) {
    await tombstone(db, message, now());
    await broadcast(db, env, message.conversation_id);
  }
  return { deleted: true };
}
async function tombstone(db, message, timestamp) {
  const refs = JSON.parse(message.attachment_refs || "[]");
  await db.batch([
    db.prepare("UPDATE chat_messages SET deleted_at = ?, ciphertext = '', nonce = NULL, signature = NULL, attachment_refs = '[]' WHERE id = ? AND deleted_at IS NULL").bind(timestamp, message.id),
    db.prepare("UPDATE chat_sync_events SET payload_ciphertext = NULL WHERE conversation_id = ? AND entity_id = ?").bind(message.conversation_id, message.id),
    eventStatement(db, message.conversation_id, "deleted", message.id, message.content_epoch, timestamp),
    ...refs.map((ref) => db.prepare(`UPDATE chat_attachments SET status = 'deleted', deleted_at = ? WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM chat_messages m, json_each(m.attachment_refs) r
        WHERE r.value = ? AND m.deleted_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > ?))`).bind(timestamp, ref, ref, timestamp)),
  ]);
}
export async function cleanupAccountV2(db, timestamp) {
  const expired = await rows(db.prepare("SELECT * FROM chat_messages WHERE protocol_version = 'account-v2' AND deleted_at IS NULL AND expires_at IS NOT NULL AND expires_at <= ?").bind(timestamp));
  for (const message of expired) await tombstone(db, message, timestamp);
}
async function attachmentRoute(db, env, userId, request, parts, body) {
  if (!env.CHAT_MEDIA_BUCKET) fail(503, "CHAT_MEDIA_NOT_CONFIGURED", "Chat media storage is not configured.");
  if (parts[3] === "init") {
    const c = await member(db, body.conversationId, userId);
    const key = await activeKey(db, userId);
    await sendable(db, c, userId, key?.key_version, Number(body.contentEpoch ?? body.epoch));
    const size = body.sizeBytes;
    if (!Number.isSafeInteger(size) || size < 17 || size > 10 * 1024 * 1024) fail(413, "ATTACHMENT_TOO_LARGE", "Encrypted attachments must be at most 10 MB.");
    const attachmentId = id();
    await db.prepare(`INSERT INTO chat_attachments (id, conversation_id, owner_user_id, content_epoch, object_key, size_bytes, size_bucket, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, 'large', ?, ?)`)
      .bind(attachmentId, c.id, userId, c.current_epoch, `chat/${id()}.bin`, size, now(), expiry(c.retention_seconds)).run();
    return { attachmentId, maxBytes: 10 * 1024 * 1024, expiresAt: expiry(c.retention_seconds) };
  }
  const file = await db.prepare("SELECT * FROM chat_attachments WHERE id = ?").bind(parts[3]).first();
  if (!file || file.status === "deleted" || (file.expires_at && file.expires_at <= now())) fail(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
  const c = await member(db, file.conversation_id, userId);
  const recipient = await db.prepare("SELECT 1 FROM chat_epoch_recipients WHERE conversation_id = ? AND epoch = ? AND user_id = ?").bind(c.id, file.content_epoch, userId).first();
  if (!recipient) fail(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
  if (request.method === "GET") {
    if (file.status !== "complete") fail(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    const object = await env.CHAT_MEDIA_BUCKET.get(file.object_key);
    if (!object) fail(404, "ATTACHMENT_NOT_FOUND", "Attachment object not found.");
    return new Response(object.body, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store" } });
  }
  if (file.owner_user_id !== userId || file.content_epoch !== c.current_epoch || c.rotation_required) fail(403, "FORBIDDEN", "This account cannot upload to that attachment reservation.");
  if (request.method === "PUT") {
    if (file.status !== "pending") fail(409, "ATTACHMENT_ALREADY_COMPLETE", "This upload is already complete.");
    const data = await request.arrayBuffer();
    if (data.byteLength !== file.size_bytes) fail(400, "ATTACHMENT_SIZE_MISMATCH", "Encrypted size differs from the reservation.");
    await env.CHAT_MEDIA_BUCKET.put(file.object_key, data, { httpMetadata: { contentType: "application/octet-stream" } });
    return { uploaded: true, attachmentId: file.id };
  }
  if (request.method === "POST" && parts[4] === "complete") {
    const object = await env.CHAT_MEDIA_BUCKET.head(file.object_key);
    if (!object || object.size !== file.size_bytes) fail(409, "ATTACHMENT_INCOMPLETE", "The upload is incomplete.");
    await db.prepare("UPDATE chat_attachments SET status = 'complete' WHERE id = ?").bind(file.id).run();
    return { complete: true, attachmentId: file.id };
  }
  fail(405, "METHOD_NOT_ALLOWED", "Unsupported attachment operation.");
}

export async function handleAccountV2Route(request, env, user) {
  const db = env.DB;
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const method = request.method;
  if (url.pathname.startsWith("/api/chat/account/")) return null;
  let conversationId = parts[2] === "conversations" && parts[3] ? parts[3] : url.searchParams.get("conversationId");
  let body = null;
  if (["POST", "PATCH"].includes(method) && ["conversations", "messages", "attachments", "ws-ticket"].includes(parts[2]) && !parts[4]) {
    body = await readJsonBody(request.clone());
    conversationId ||= body.conversationId;
  }
  if (method === "GET" && parts[2] === "contacts" && parts[3] && parts[4] === "account-key") {
    if (!enabled(env)) fail(503, "CHAT_ACCOUNT_V2_DISABLED", "Account sync is disabled.");
    const contact = await db.prepare("SELECT peer_user_id FROM chat_contacts WHERE user_id = ? AND id = ? AND accepted_at IS NOT NULL").bind(user.id, parts[3]).first();
    if (!contact) fail(404, "CONTACT_NOT_FOUND", "Contact not found.");
    const accountKey = await activeKey(db, contact.peer_user_id);
    const ready = await accountReady(db, contact.peer_user_id, accountKey?.key_version);
    return success({ contactId: parts[3], accountKey: bundle(accountKey), enabled: ready, passkeyReady: ready }, method);
  }
  let conversation = conversationId ? await db.prepare("SELECT * FROM chat_conversations WHERE id = ?").bind(conversationId).first() : null;
  if (["messages", "attachments"].includes(parts[2]) && parts[3] && parts[3] !== "init") {
    const table = parts[2] === "messages" ? "chat_messages" : "chat_attachments";
    const row = await db.prepare(`SELECT conversation_id FROM ${table} WHERE id = ?`).bind(parts[3]).first();
    if (row) { conversationId = row.conversation_id; conversation = await db.prepare("SELECT * FROM chat_conversations WHERE id = ?").bind(conversationId).first(); }
  }
  const v2 = conversation?.protocol_version === VERSION || body?.protocolVersion === VERSION || body?.version === VERSION;
  if (!v2) {
    if (conversation?.protocol_version === VERSION) fail(400, "PROTOCOL_MISMATCH", "This conversation requires account-v2.");
    return null;
  }
  if (!enabled(env)) fail(503, "CHAT_ACCOUNT_V2_DISABLED", "Account sync is disabled.");
  if (parts[2] === "conversations" && !parts[3] && method === "GET") {
    const rows = await db.prepare(`SELECT c.* FROM chat_conversations c JOIN chat_conversation_members m ON m.conversation_id=c.id AND m.user_id=? AND m.left_at IS NULL AND m.history_hidden_at IS NULL WHERE c.protocol_version='account-v2' AND c.deleted_at IS NULL ORDER BY c.updated_at DESC`).bind(user.id).all();
    const result = [];
    for (const row of rows.results || []) result.push(await mapAccountConversation(db, row, user.id));
    return success(result, method);
  }
  if (parts[2] === "conversations" && !parts[3] && method === "POST") return success(await createConversation(db, env, user.id, body), method, 201);
  if (parts[2] === "conversations" && parts[3]) {
    if (method === "GET" && ["members", "account-bundle"].includes(parts[4])) return success(await mapAccountConversation(db, await member(db, parts[3], user.id), user.id), method);
    if (method === "GET" && parts[4] === "epochs") return success(await epochs(db, parts[3], user.id), method);
    if ((["POST", "PATCH"].includes(method) && ["control", "members", "epochs", "leave", "settings", "metadata", "dissolve"].includes(parts[4])) || (method === "PUT" && parts[4] === "metadata")) return success(await changeConversation(db, env, user.id, parts[3], await readJsonBody(request)), method);
    fail(400, "PROTOCOL_MISMATCH", "This operation is unavailable for account-v2.");
  }
  if (parts[2] === "messages" && method === "POST") {
    if (parts[4] === "delete") return success(await deleteMessage(db, env, user.id, parts[3]), method);
    if (!parts[3]) {
      if (body.protocolVersion !== VERSION && body.version !== VERSION) fail(400, "PROTOCOL_MISMATCH", "This conversation requires account-v2 messages.");
      return success(await postAccountMessage(db, env, user.id, body), method, 201);
    }
  }
  if (["sync", "sync-events"].includes(parts[2]) && method === "GET") return success(await events(db, conversationId, user.id, url), method);
  if (parts[2] === "attachments") {
    const result = await attachmentRoute(db, env, user.id, request, parts, body);
    return result instanceof Response ? result : success(result, method);
  }
  if (parts[2] === "ws-ticket" && method === "POST") {
    await member(db, conversationId, user.id);
    const ticket = b64(crypto.getRandomValues(new Uint8Array(32)));
    const hash = b64(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(ticket))));
    const expiresAt = new Date(Date.now() + 60000).toISOString();
    await db.prepare("INSERT INTO chat_ws_tickets (id, token_hash, user_id, conversation_id, device_id, expires_at, created_at) VALUES (?, ?, ?, ?, NULL, ?, ?)").bind(id(), hash, user.id, conversationId, expiresAt, now()).run();
    return success({ ticket, expiresAt, protocol: "expassway-chat-v2" }, method, 201);
  }
  return null;
}
