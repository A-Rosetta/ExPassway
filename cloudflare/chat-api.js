import {
  AuthError,
  failure,
  readJsonBody,
  requireCurrentUser,
  requireString,
  routeNotFound,
  success,
} from "./auth-api.js";

const encoder = new TextEncoder();
const MAX_CIPHERTEXT_LENGTH = 512 * 1024;
const MAX_PROFILE_CIPHERTEXT_LENGTH = 64 * 1024;
const MAX_EVIDENCE_LENGTH = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_GROUP_MEMBERS = 50;
const RETENTION_OPTIONS = new Set([86400, 604800, 2592000, 0]);

function nowIso() {
  return new Date().toISOString();
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomId(length = 18) {
  return bytesToBase64Url(randomBytes(length));
}

function randomDeviceNumber() {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  return Math.max(1, values[0] & 0x3fff);
}

function isBase64Url(value, maxLength) {
  return typeof value === "string"
    && value.length > 0
    && value.length <= maxLength
    && /^[A-Za-z0-9_-]+$/.test(value);
}

function boundedString(value, field, maxLength) {
  const normalized = requireString(value, field);
  if (normalized.length > maxLength) {
    throw new AuthError(413, `Field "${field}" is too large.`, "PAYLOAD_TOO_LARGE");
  }
  return normalized;
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function isEnabled(env) {
  return ["1", "true", "yes", "on"].includes(String(env.CHAT_ENABLED || "").toLowerCase());
}

function ensureEnabled(env) {
  if (!isEnabled(env)) {
    throw new AuthError(
      503,
      "Chat is not enabled for this deployment yet.",
      "CHAT_NOT_ENABLED"
    );
  }
}

function recoveryEnabled(env) {
  return ["1", "true", "yes", "on"].includes(String(env.CHAT_RECOVERY_BACKUP_ENABLED || "").toLowerCase());
}

function ensureRecoveryEnabled(env) {
  if (!recoveryEnabled(env)) {
    throw new AuthError(503, "Encrypted chat recovery is not enabled for this deployment yet.", "CHAT_RECOVERY_DISABLED");
  }
}

function corsHeaders(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  const headers = {
    "Vary": "Origin",
  };
  if (!origin || origin === requestUrl.origin) headers["Access-Control-Allow-Origin"] = requestUrl.origin;
  return headers;
}

function preflightResponse(request) {
  const headers = corsHeaders(request);
  headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
  headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
  headers["Access-Control-Max-Age"] = "600";
  return new Response(null, { status: 204, headers });
}

function withCors(request, response) {
  const headers = new Headers(response.headers);
  const allowed = corsHeaders(request);
  for (const [key, value] of Object.entries(allowed)) headers.set(key, value);
  if (!allowed["Access-Control-Allow-Origin"]) headers.delete("Access-Control-Allow-Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const parsed = JSON.parse(binary);
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string") throw new Error("invalid");
    return parsed;
  } catch (_error) {
    throw new AuthError(400, "The sync cursor is invalid.", "INVALID_CURSOR");
  }
}

function encodeCursor(value) {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

function bucketForSize(size) {
  if (size <= 4096) return "small";
  if (size <= 16384) return "medium";
  if (size <= 65536) return "large";
  if (size <= 262144) return "xlarge";
  return "oversize";
}

function retentionExpiry(retentionSeconds, createdAtMs = Date.now()) {
  if (!retentionSeconds) return null;
  return new Date(createdAtMs + retentionSeconds * 1000).toISOString();
}

function getRouteParts(url) {
  return url.pathname.split("/").filter(Boolean);
}

function contactIdFromParts(parts) {
  return parts[3] || "";
}

async function ensureProfile(db, userId, fingerprint = "") {
  const existing = await db.prepare(`
    SELECT user_id, chat_alias, identity_fingerprint, profile_ciphertext, created_at, updated_at
    FROM chat_profiles WHERE user_id = ?
  `).bind(userId).first();
  if (existing) {
    if (!existing.identity_fingerprint && fingerprint) {
      await db.prepare("UPDATE chat_profiles SET identity_fingerprint = ?, updated_at = ? WHERE user_id = ?")
        .bind(fingerprint, nowIso(), userId).run();
      return { ...existing, identity_fingerprint: fingerprint };
    }
    return existing;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const alias = `learner-${randomId(5).toLowerCase()}`;
    const timestamp = nowIso();
    try {
      await db.prepare(`
        INSERT INTO chat_profiles
          (user_id, chat_alias, identity_fingerprint, profile_ciphertext, created_at, updated_at)
        VALUES (?, ?, ?, '', ?, ?)
      `).bind(userId, alias, fingerprint || null, timestamp, timestamp).run();
      return await db.prepare(`SELECT user_id, chat_alias, identity_fingerprint, profile_ciphertext, created_at, updated_at
        FROM chat_profiles WHERE user_id = ?`).bind(userId).first();
    } catch (error) {
      if (!String(error?.message || error).includes("UNIQUE")) throw error;
    }
  }
  throw new AuthError(500, "Could not create a chat profile.", "CHAT_PROFILE_ERROR");
}

function mapProfile(row) {
  return {
    id: row.user_id,
    alias: row.chat_alias,
    identityFingerprint: row.identity_fingerprint || null,
    profileCiphertext: row.profile_ciphertext || "",
  };
}

function mapDevice(row) {
  return {
    id: row.id,
    label: row.label,
    deviceNumber: row.device_number,
    identityPublicKey: row.identity_public_key,
    registrationId: row.registration_id,
    signedPreKey: {
      id: row.signed_prekey_id,
      publicKey: row.signed_prekey_public,
      signature: row.signed_prekey_signature,
    },
    oneTimePreKeyCount: Number(row.one_time_prekey_count || 0),
    revokedAt: row.revoked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireUserAndChat(request, env) {
  const auth = await requireCurrentUser(request, env);
  ensureEnabled(env);
  await enforceRateLimit(env.DB, auth.user.id, rateLimitAction(request), rateLimitLimit(request));
  return auth;
}

function rateLimitAction(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/chat/messages") return "message";
  if (url.pathname === "/api/chat/invites" && request.method === "POST") return "invite";
  if (url.pathname === "/api/chat/attachments/init") return "attachment";
  if (url.pathname === "/api/chat/reports") return "report";
  return "read";
}

function rateLimitLimit(request) {
  const action = rateLimitAction(request);
  return action === "message" ? 240 : action === "read" ? 600 : 30;
}

async function enforceRateLimit(db, userId, action, limit) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(nowSeconds / 60) * 60;
  const timestamp = nowIso();
  const row = await db.prepare(`SELECT window_start, request_count FROM chat_rate_limits WHERE user_id = ? AND action = ?`)
    .bind(userId, action).first();
  if (!row || Number(row.window_start) !== windowStart) {
    await db.prepare(`
      INSERT INTO chat_rate_limits (user_id, action, window_start, request_count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(user_id, action) DO UPDATE SET window_start = excluded.window_start,
        request_count = 1, updated_at = excluded.updated_at
    `).bind(userId, action, windowStart, timestamp).run();
    return;
  }
  if (Number(row.request_count) >= limit) {
    throw new AuthError(429, "Chat request rate limit exceeded.", "CHAT_RATE_LIMITED", { retryAfterSeconds: 60 });
  }
  await db.prepare("UPDATE chat_rate_limits SET request_count = request_count + 1, updated_at = ? WHERE user_id = ? AND action = ?")
    .bind(timestamp, userId, action).run();
}

async function requireConversationMember(db, conversationId, userId) {
  const row = await db.prepare(`
    SELECT c.id, c.kind, c.created_by, c.retention_seconds, c.created_at, c.updated_at
    FROM chat_conversations c
    JOIN chat_conversation_members m ON m.conversation_id = c.id
    WHERE c.id = ? AND m.user_id = ? AND m.left_at IS NULL AND c.deleted_at IS NULL
  `).bind(conversationId, userId).first();
  if (!row) throw new AuthError(404, "Conversation not found.", "CONVERSATION_NOT_FOUND");
  return row;
}

async function requireOwnedDevice(db, deviceId, userId) {
  const row = await db.prepare(`
    SELECT id, user_id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
      signed_prekey_public, signed_prekey_signature, revoked_at, created_at, updated_at
    FROM chat_devices WHERE id = ? AND user_id = ?
  `).bind(deviceId, userId).first();
  if (!row || row.revoked_at) throw new AuthError(404, "Device not found.", "DEVICE_NOT_FOUND");
  return row;
}

async function requireContact(db, contactId, userId) {
  const row = await db.prepare(`
    SELECT c.id, c.user_id, c.peer_user_id, c.created_at, c.accepted_at,
      p.chat_alias, p.identity_fingerprint, p.profile_ciphertext
    FROM chat_contacts c
    LEFT JOIN chat_profiles p ON p.user_id = c.peer_user_id
    WHERE c.id = ? AND c.user_id = ?
  `).bind(contactId, userId).first();
  if (!row) throw new AuthError(404, "Contact not found.", "CONTACT_NOT_FOUND");
  return row;
}

async function existingDirectConversation(db, userId, peerUserId) {
  return db.prepare(`
    SELECT c.id, c.kind, c.created_by, c.retention_seconds, c.created_at, c.updated_at
    FROM chat_conversations c
    JOIN chat_conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ? AND mine.left_at IS NULL
    JOIN chat_conversation_members peer ON peer.conversation_id = c.id AND peer.user_id = ? AND peer.left_at IS NULL
    WHERE c.kind = 'direct' AND c.deleted_at IS NULL
    LIMIT 1
  `).bind(userId, peerUserId).first();
}

async function mapConversation(db, row, userId) {
  if (row.kind === "group") {
    const memberRows = await db.prepare(`
      SELECT m.user_id, m.role, m.joined_at, p.chat_alias, p.identity_fingerprint,
        (SELECT COUNT(*) FROM chat_devices d WHERE d.user_id = m.user_id AND d.revoked_at IS NULL) AS device_count
      FROM chat_conversation_members m
      LEFT JOIN chat_profiles p ON p.user_id = m.user_id
      WHERE m.conversation_id = ? AND m.left_at IS NULL
      ORDER BY m.joined_at, m.user_id
    `).bind(row.id).all();
    const members = [];
    for (const member of memberRows.results || []) {
      const contact = member.user_id === userId
        ? null
        : await db.prepare("SELECT id FROM chat_contacts WHERE user_id = ? AND peer_user_id = ?")
          .bind(userId, member.user_id).first();
      members.push({
        contactId: contact?.id || null,
        alias: member.user_id === userId ? "You" : member.chat_alias || "Paired contact",
        role: member.role,
        deviceCount: Number(member.device_count || 0),
        identityFingerprint: member.identity_fingerprint || null,
        isSelf: member.user_id === userId,
      });
    }
    const last = await db.prepare(`
      SELECT created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
    `).bind(row.id).first();
    return {
      id: row.id,
      kind: row.kind,
      retentionSeconds: Number(row.retention_seconds),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: last?.created_at || null,
      group: { memberCount: members.length, members },
      peer: null,
    };
  }
  const peer = await db.prepare(`
    SELECT m.user_id, p.chat_alias, p.identity_fingerprint, p.profile_ciphertext,
      d.id AS device_id, d.device_number
    FROM chat_conversation_members m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    LEFT JOIN chat_devices d ON d.user_id = m.user_id AND d.revoked_at IS NULL
    WHERE m.conversation_id = ? AND m.user_id <> ? AND m.left_at IS NULL
    ORDER BY m.joined_at, d.created_at LIMIT 1
  `).bind(row.id, userId).first();
  const contact = peer ? await db.prepare("SELECT id FROM chat_contacts WHERE user_id = ? AND peer_user_id = ?")
    .bind(userId, peer.user_id).first() : null;
  const last = await db.prepare(`
    SELECT created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
  `).bind(row.id).first();
  return {
    id: row.id,
    kind: row.kind,
    retentionSeconds: Number(row.retention_seconds),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: last?.created_at || null,
    peer: peer ? {
      contactId: contact?.id || null,
      deviceId: peer.device_id || null,
      deviceNumber: peer.device_number || null,
      alias: peer.chat_alias || "Paired contact",
      identityFingerprint: peer.identity_fingerprint || null,
      profileCiphertext: peer.profile_ciphertext || "",
    } : null,
  };
}

async function createGroupConversation(db, userId, body) {
  const rawContactIds = Array.isArray(body?.contactIds) ? body.contactIds : [];
  const contactIds = [...new Set(rawContactIds.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!contactIds.length || contactIds.length >= MAX_GROUP_MEMBERS) {
    throw new AuthError(400, `Choose between 1 and ${MAX_GROUP_MEMBERS - 1} paired friends.`, "INVALID_GROUP_MEMBERS");
  }
  if (contactIds.some((value) => value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value))) {
    throw new AuthError(400, "Group member references are invalid.", "INVALID_GROUP_MEMBERS");
  }
  const placeholders = contactIds.map(() => "?").join(", ");
  const contacts = await db.prepare(`
    SELECT id, peer_user_id FROM chat_contacts
    WHERE user_id = ? AND id IN (${placeholders})
  `).bind(userId, ...contactIds).all();
  if ((contacts.results || []).length !== contactIds.length) {
    throw new AuthError(404, "One or more selected friends could not be found.", "CONTACT_NOT_FOUND");
  }
  const memberUserIds = [...new Set((contacts.results || []).map((row) => row.peer_user_id))];
  if (memberUserIds.length !== contactIds.length) {
    throw new AuthError(400, "A friend can only appear once in a group.", "INVALID_GROUP_MEMBERS");
  }
  const timestamp = nowIso();
  const conversationId = randomId();
  const statements = [
    db.prepare(`
      INSERT INTO chat_conversations (id, kind, created_by, retention_seconds, created_at, updated_at)
      VALUES (?, 'group', ?, 2592000, ?, ?)
    `).bind(conversationId, userId, timestamp, timestamp),
    db.prepare(`
      INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)
    `).bind(conversationId, userId, timestamp),
  ];
  for (const memberUserId of memberUserIds) {
    statements.push(db.prepare(`
      INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'member', ?)
    `).bind(conversationId, memberUserId, timestamp));
  }
  await db.batch(statements);
  const row = await db.prepare(`
    SELECT id, kind, created_by, retention_seconds, created_at, updated_at
    FROM chat_conversations WHERE id = ?
  `).bind(conversationId).first();
  return mapConversation(db, row, userId);
}

async function createInvite(db, userId) {
  const token = bytesToBase64Url(randomBytes(32));
  const timestamp = Date.now();
  const expiresAt = new Date(timestamp + 7 * 24 * 60 * 60 * 1000).toISOString();
  const id = randomId();
  await db.prepare(`
    INSERT INTO chat_invites (id, creator_user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, userId, await sha256Base64Url(token), expiresAt, new Date(timestamp).toISOString()).run();
  return { id, token, expiresAt };
}

async function listInvites(db, userId) {
  const rows = await db.prepare(`
    SELECT id, expires_at, used_at, revoked_at, created_at
    FROM chat_invites WHERE creator_user_id = ? ORDER BY created_at DESC LIMIT 100
  `).bind(userId).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    expiresAt: row.expires_at,
    usedAt: row.used_at,
    revokedAt: row.revoked_at,
    createdAt: row.created_at,
    active: !row.used_at && !row.revoked_at && row.expires_at > nowIso(),
  }));
}

async function acceptInvite(db, token, userId) {
  const tokenHash = await sha256Base64Url(token);
  const invite = await db.prepare(`
    SELECT id, creator_user_id, expires_at, used_at, revoked_at
    FROM chat_invites WHERE token_hash = ?
  `).bind(tokenHash).first();
  if (invite?.creator_user_id === userId) {
    throw new AuthError(409, "You cannot accept an invite created by this account. Sign in with the other account.", "INVITE_SELF");
  }
  if (!invite) {
    throw new AuthError(404, "This invite is invalid.", "INVITE_INVALID");
  }
  if (invite.used_at || invite.revoked_at || invite.expires_at <= nowIso()) {
    throw new AuthError(409, "This invite has expired or was already used.", "INVITE_UNAVAILABLE");
  }

  const existingContact = await db.prepare(`
    SELECT id FROM chat_contacts WHERE user_id = ? AND peer_user_id = ?
  `).bind(userId, invite.creator_user_id).first();
  const timestamp = nowIso();
  const contactId = existingContact?.id || randomId();
  const peerContactId = existingContact
    ? (await db.prepare("SELECT id FROM chat_contacts WHERE user_id = ? AND peer_user_id = ?")
      .bind(invite.creator_user_id, userId).first())?.id || randomId()
    : randomId();
  const conversation = await existingDirectConversation(db, userId, invite.creator_user_id);
  const conversationId = conversation?.id || randomId();

  const statements = [db.prepare(`
    UPDATE chat_invites SET used_at = ?
    WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?
  `).bind(timestamp, invite.id, timestamp)];
  if (!existingContact) {
    statements.push(db.prepare(`
      INSERT INTO chat_contacts (id, user_id, peer_user_id, created_at, accepted_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(contactId, userId, invite.creator_user_id, timestamp, timestamp));
    statements.push(db.prepare(`
      INSERT INTO chat_contacts (id, user_id, peer_user_id, created_at, accepted_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(peerContactId, invite.creator_user_id, userId, timestamp, timestamp));
  }
  if (!conversation) {
    statements.push(db.prepare(`
      INSERT INTO chat_conversations (id, kind, created_by, retention_seconds, created_at, updated_at)
      VALUES (?, 'direct', ?, 2592000, ?, ?)
    `).bind(conversationId, invite.creator_user_id, timestamp, timestamp));
    statements.push(db.prepare(`
      INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?), (?, ?, 'member', ?)
    `).bind(conversationId, invite.creator_user_id, timestamp, conversationId, userId, timestamp));
  }
  const results = await db.batch(statements);
  if (Number(results[0]?.meta?.changes ?? results[0]?.changes ?? 0) !== 1) {
    throw new AuthError(409, "This invite is no longer available.", "INVITE_UNAVAILABLE");
  }
  return { contactId, conversationId };
}

async function listContacts(db, userId) {
  const rows = await db.prepare(`
    SELECT c.id, c.created_at, c.accepted_at, p.chat_alias, p.identity_fingerprint, p.profile_ciphertext
    FROM chat_contacts c
    LEFT JOIN chat_profiles p ON p.user_id = c.peer_user_id
    WHERE c.user_id = ? ORDER BY c.accepted_at DESC
  `).bind(userId).all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    profile: {
      alias: row.chat_alias || "Paired contact",
      identityFingerprint: row.identity_fingerprint || null,
      profileCiphertext: row.profile_ciphertext || "",
    },
  }));
}

async function listDevices(db, userId) {
  const rows = await db.prepare(`
    SELECT id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
      signed_prekey_public, signed_prekey_signature, revoked_at, created_at, updated_at,
      (SELECT COUNT(*) FROM chat_device_prekeys p WHERE p.device_id = chat_devices.id AND p.consumed_at IS NULL)
        AS one_time_prekey_count
    FROM chat_devices WHERE user_id = ? ORDER BY created_at ASC
  `).bind(userId).all();
  return (rows.results || []).map(mapDevice);
}

async function refillDevicePrekeys(db, userId, deviceId, body) {
  await requireOwnedDevice(db, deviceId, userId);
  const preKeys = Array.isArray(body?.oneTimePreKeys) ? body.oneTimePreKeys : [];
  if (!preKeys.length || preKeys.length > 100) {
    throw new AuthError(400, "Provide between 1 and 100 one-time pre-keys.", "INVALID_PREKEY_BATCH");
  }
  const timestamp = nowIso();
  const statements = [];
  for (const item of preKeys) {
    const keyId = Number(item?.id);
    const publicKey = typeof item?.publicKey === "string" ? item.publicKey.trim() : "";
    if (!Number.isInteger(keyId) || keyId < 1 || !isBase64Url(publicKey, 1024)) {
      throw new AuthError(400, "One-time pre-key values are invalid.", "INVALID_DEVICE_KEYS");
    }
    statements.push(db.prepare(`
      INSERT INTO chat_device_prekeys (id, device_id, key_id, public_key, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id, key_id) DO NOTHING
    `).bind(randomId(), deviceId, keyId, publicKey, timestamp));
  }
  await db.batch(statements);
  const row = await db.prepare(`
    SELECT COUNT(*) AS count FROM chat_device_prekeys
    WHERE device_id = ? AND consumed_at IS NULL
  `).bind(deviceId).first();
  return { deviceId, oneTimePreKeyCount: Number(row?.count || 0) };
}

async function registerDevice(db, userId, body) {
  const identityPublicKey = boundedString(body.identityPublicKey, "identityPublicKey", 1024);
  const signedPreKey = body.signedPreKey || {};
  const signedPreKeyPublic = boundedString(signedPreKey.publicKey, "signedPreKey.publicKey", 1024);
  const signedPreKeySignature = boundedString(signedPreKey.signature, "signedPreKey.signature", 2048);
  if (!isBase64Url(identityPublicKey, 1024) || !isBase64Url(signedPreKeyPublic, 1024) || !isBase64Url(signedPreKeySignature, 2048)) {
    throw new AuthError(400, "Device keys must be base64url values.", "INVALID_DEVICE_KEYS");
  }
  const registrationId = Number(body.registrationId);
  const signedPreKeyId = Number(signedPreKey.id);
  if (!Number.isInteger(registrationId) || registrationId < 1 || registrationId > 0x3fff
    || !Number.isInteger(signedPreKeyId) || signedPreKeyId < 1) {
    throw new AuthError(400, "Device registration identifiers are invalid.", "INVALID_DEVICE_KEYS");
  }
  const preKeys = Array.isArray(body.oneTimePreKeys) ? body.oneTimePreKeys : [];
  if (preKeys.length > 100) throw new AuthError(413, "Too many one-time pre-keys.", "PAYLOAD_TOO_LARGE");
  const timestamp = nowIso();
  const activeCount = await db.prepare("SELECT COUNT(*) AS count FROM chat_devices WHERE user_id = ? AND revoked_at IS NULL")
    .bind(userId).first();
  if (Number(activeCount?.count || 0) >= 3) {
    throw new AuthError(409, "Each account can have at most three active devices.", "DEVICE_LIMIT");
  }
  if (Number(activeCount?.count || 0) > 0) {
    const approvalToken = typeof body.approvalToken === "string" ? body.approvalToken.trim() : "";
    if (!approvalToken) throw new AuthError(403, "A trusted device must approve this new device.", "DEVICE_APPROVAL_REQUIRED");
    const tokenHash = await sha256Base64Url(approvalToken);
    const approval = await db.prepare(`
      SELECT id FROM chat_device_approval_tickets
      WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?
    `).bind(tokenHash, userId, nowIso()).first();
    if (!approval) throw new AuthError(403, "The device approval token is invalid or expired.", "DEVICE_APPROVAL_INVALID");
    const consumed = await db.prepare("UPDATE chat_device_approval_tickets SET used_at = ? WHERE id = ? AND used_at IS NULL")
      .bind(nowIso(), approval.id).run();
    if (Number(consumed?.meta?.changes ?? consumed?.changes ?? 0) !== 1) throw new AuthError(403, "The device approval token is invalid or expired.", "DEVICE_APPROVAL_INVALID");
  }
  const requestedDeviceId = typeof body.deviceId === "string"
    && body.deviceId.length <= 100
    && /^[A-Za-z0-9_-]+$/.test(body.deviceId)
    ? body.deviceId
    : "";
  const deviceId = requestedDeviceId || randomId();
  if (requestedDeviceId) {
    const existingDevice = await db.prepare("SELECT id FROM chat_devices WHERE id = ? AND user_id = ?")
      .bind(deviceId, userId).first();
    if (existingDevice) throw new AuthError(409, "This browser device is already registered.", "DEVICE_ALREADY_REGISTERED");
  }
  const deviceNumber = randomDeviceNumber();
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
  const statements = [db.prepare(`
    INSERT INTO chat_devices
      (id, user_id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
       signed_prekey_public, signed_prekey_signature, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(deviceId, userId, label, identityPublicKey, deviceNumber, registrationId, signedPreKeyId,
    signedPreKeyPublic, signedPreKeySignature, timestamp, timestamp)];
  for (const item of preKeys) {
    const keyId = Number(item?.id);
    const publicKey = typeof item?.publicKey === "string" ? item.publicKey.trim() : "";
    if (!Number.isInteger(keyId) || keyId < 1 || !isBase64Url(publicKey, 1024)) {
      throw new AuthError(400, "One-time pre-key values are invalid.", "INVALID_DEVICE_KEYS");
    }
    statements.push(db.prepare(`
      INSERT INTO chat_device_prekeys (id, device_id, key_id, public_key, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(randomId(), deviceId, keyId, publicKey, timestamp));
  }
  await db.batch(statements);
  const profile = await ensureProfile(db, userId, typeof body.identityFingerprint === "string" ? body.identityFingerprint.trim().slice(0, 128) : "");
  return { device: mapDevice(await requireOwnedDevice(db, deviceId, userId)), profile: mapProfile(profile) };
}

async function createDeviceApprovalTicket(db, userId, deviceId) {
  await requireOwnedDevice(db, deviceId, userId);
  const token = bytesToBase64Url(randomBytes(32));
  const timestamp = Date.now();
  const expiresAt = new Date(timestamp + 5 * 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO chat_device_approval_tickets (id, token_hash, user_id, issuer_device_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(randomId(), await sha256Base64Url(token), userId, deviceId, expiresAt, new Date(timestamp).toISOString()).run();
  return { token, expiresAt };
}

async function restoreKeyBackup(db, env, userId, body) {
  ensureRecoveryEnabled(env);
  const operationId = boundedString(body.restoreOperationId, "restoreOperationId", 100);
  const sourceDeviceId = boundedString(body.sourceDeviceId, "sourceDeviceId", 100);
  const requestedDeviceId = typeof body.deviceId === "string"
    && body.deviceId.length <= 100 && /^[A-Za-z0-9_-]+$/.test(body.deviceId)
    ? body.deviceId : "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(operationId)) {
    throw new AuthError(400, "The restore operation identifier is invalid.", "INVALID_RESTORE_OPERATION");
  }
  const identityPublicKey = boundedString(body.identityPublicKey, "identityPublicKey", 1024);
  const signedPreKey = body.signedPreKey || {};
  const signedPreKeyPublic = boundedString(signedPreKey.publicKey, "signedPreKey.publicKey", 1024);
  const signedPreKeySignature = boundedString(signedPreKey.signature, "signedPreKey.signature", 2048);
  const registrationId = Number(body.registrationId);
  const signedPreKeyId = Number(signedPreKey.id);
  const preKeys = Array.isArray(body.oneTimePreKeys) ? body.oneTimePreKeys : [];
  const existingOperation = await db.prepare(`
    SELECT restored_device_id FROM chat_key_backups
    WHERE user_id = ? AND restore_operation_id = ?
  `).bind(userId, operationId).first();
  if (existingOperation?.restored_device_id) {
    const restored = await db.prepare(`
      SELECT d.id, d.label, d.identity_public_key, d.device_number, d.registration_id,
        d.signed_prekey_id, d.signed_prekey_public, d.signed_prekey_signature,
        d.revoked_at, d.created_at, d.updated_at,
        (SELECT COUNT(*) FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL)
          AS one_time_prekey_count
      FROM chat_devices d WHERE d.id = ? AND d.user_id = ?
    `).bind(existingOperation.restored_device_id, userId).first();
    if (restored) return { restored: true, idempotent: true, device: mapDevice(restored) };
  }
  if (!isBase64Url(identityPublicKey, 1024) || !isBase64Url(signedPreKeyPublic, 1024)
    || !isBase64Url(signedPreKeySignature, 2048)
    || !Number.isInteger(registrationId) || registrationId < 1 || registrationId > 0x3fff
    || !Number.isInteger(signedPreKeyId) || signedPreKeyId < 1
    || preKeys.length < 1 || preKeys.length > 100) {
    throw new AuthError(400, "The restored device bundle is invalid.", "INVALID_RESTORE_BUNDLE");
  }
  const backup = await db.prepare(`
    SELECT source_device_id, consumed_at FROM chat_key_backups
    WHERE user_id = ? AND source_device_id = ?
  `).bind(userId, sourceDeviceId).first();
  if (!backup) {
    throw new AuthError(404, "Encrypted recovery backup not found for this device.", "BACKUP_NOT_FOUND");
  }
  if (backup.consumed_at) throw new AuthError(409, "This recovery backup has already been consumed.", "BACKUP_ALREADY_USED");
  const source = await requireOwnedDevice(db, sourceDeviceId, userId);
  const activeCount = await db.prepare("SELECT COUNT(*) AS count FROM chat_devices WHERE user_id = ? AND revoked_at IS NULL")
    .bind(userId).first();
  if (Number(activeCount?.count || 0) > 3) throw new AuthError(409, "Too many active devices for recovery.", "DEVICE_LIMIT");
  const timestamp = nowIso();
  const newDeviceId = requestedDeviceId || randomId();
  const existingDevice = await db.prepare("SELECT id FROM chat_devices WHERE id = ?").bind(newDeviceId).first();
  if (existingDevice) throw new AuthError(409, "The restored device identifier is already in use.", "DEVICE_ALREADY_REGISTERED");
  const deviceNumber = randomDeviceNumber();
  const statements = [
    db.prepare("UPDATE chat_devices SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .bind(timestamp, timestamp, sourceDeviceId, userId),
    db.prepare(`
      INSERT INTO chat_devices
        (id, user_id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
         signed_prekey_public, signed_prekey_signature, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(newDeviceId, userId, boundedString(body.label || "Restored browser", "label", 80), identityPublicKey,
      deviceNumber, registrationId, signedPreKeyId, signedPreKeyPublic, signedPreKeySignature, timestamp, timestamp),
    db.prepare(`
      UPDATE chat_key_backups SET restore_operation_id = ?, restored_device_id = ?, consumed_at = ?, updated_at = ?
      WHERE user_id = ? AND source_device_id = ? AND consumed_at IS NULL
    `).bind(operationId, newDeviceId, timestamp, timestamp, userId, sourceDeviceId),
  ];
  for (const item of preKeys) {
    const keyId = Number(item?.id);
    const publicKey = typeof item?.publicKey === "string" ? item.publicKey.trim() : "";
    if (!Number.isInteger(keyId) || keyId < 1 || !isBase64Url(publicKey, 1024)) {
      throw new AuthError(400, "One-time pre-key values are invalid.", "INVALID_RESTORE_BUNDLE");
    }
    statements.push(db.prepare(`
      INSERT INTO chat_device_prekeys (id, device_id, key_id, public_key, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(randomId(), newDeviceId, keyId, publicKey, timestamp));
  }
  const results = await db.batch(statements);
  if (Number(results[0]?.meta?.changes ?? results[0]?.changes ?? 0) !== 1
    || Number(results[2]?.meta?.changes ?? results[2]?.changes ?? 0) !== 1) {
    throw new AuthError(409, "The recovery backup is no longer available.", "BACKUP_ALREADY_USED");
  }
  const restored = await db.prepare(`
    SELECT d.id, d.label, d.identity_public_key, d.device_number, d.registration_id,
      d.signed_prekey_id, d.signed_prekey_public, d.signed_prekey_signature,
      d.revoked_at, d.created_at, d.updated_at,
      (SELECT COUNT(*) FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL)
        AS one_time_prekey_count
    FROM chat_devices d WHERE d.id = ? AND d.user_id = ?
  `).bind(newDeviceId, userId).first();
  return { restored: true, idempotent: false, previousDeviceId: source.id, device: mapDevice(restored) };
}

async function getPrekeyBundle(db, contactId, userId) {
  const contact = await requireContact(db, contactId, userId);
  const devices = await db.prepare(`
    SELECT d.id, d.device_number, d.identity_public_key, d.registration_id, d.signed_prekey_id,
      d.signed_prekey_public, d.signed_prekey_signature,
      (SELECT p.key_id FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_id,
      (SELECT p.public_key FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_public
    FROM chat_devices d WHERE d.user_id = ? AND d.revoked_at IS NULL
  `).bind(contact.peer_user_id).all();
  const timestamp = nowIso();
  const bundle = [];
  for (const row of devices.results || []) {
    if (row.one_time_prekey_id != null) {
      await db.prepare("UPDATE chat_device_prekeys SET consumed_at = ? WHERE device_id = ? AND key_id = ? AND consumed_at IS NULL")
        .bind(timestamp, row.id, row.one_time_prekey_id).run();
    }
    bundle.push({
      deviceId: row.id,
      deviceNumber: row.device_number,
      identityKey: row.identity_public_key,
      registrationId: row.registration_id,
      preKey: {
        keyId: row.signed_prekey_id,
        publicKey: row.signed_prekey_public,
        signature: row.signed_prekey_signature,
      },
      signedPreKey: {
        keyId: row.signed_prekey_id,
        publicKey: row.signed_prekey_public,
        signature: row.signed_prekey_signature,
      },
      oneTimePreKey: row.one_time_prekey_id == null ? null : {
        keyId: row.one_time_prekey_id,
        publicKey: row.one_time_prekey_public,
      },
    });
  }
  return { contactId, profile: { alias: contact.chat_alias || "Paired contact", identityFingerprint: contact.identity_fingerprint || null, profileCiphertext: contact.profile_ciphertext || "" }, devices: bundle };
}

async function getOwnPrekeyBundle(db, userId, excludeDeviceId = "") {
  const devices = await db.prepare(`
    SELECT d.id, d.device_number, d.identity_public_key, d.registration_id, d.signed_prekey_id,
      d.signed_prekey_public, d.signed_prekey_signature,
      (SELECT p.key_id FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_id,
      (SELECT p.public_key FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_public
    FROM chat_devices d WHERE d.user_id = ? AND d.revoked_at IS NULL AND d.id <> ?
  `).bind(userId, excludeDeviceId).all();
  const timestamp = nowIso();
  const bundle = [];
  for (const row of devices.results || []) {
    if (row.one_time_prekey_id != null) {
      await db.prepare("UPDATE chat_device_prekeys SET consumed_at = ? WHERE device_id = ? AND key_id = ? AND consumed_at IS NULL")
        .bind(timestamp, row.id, row.one_time_prekey_id).run();
    }
    bundle.push({
      deviceId: row.id,
      deviceNumber: row.device_number,
      identityKey: row.identity_public_key,
      registrationId: row.registration_id,
      signedPreKey: { keyId: row.signed_prekey_id, publicKey: row.signed_prekey_public, signature: row.signed_prekey_signature },
      oneTimePreKey: row.one_time_prekey_id == null ? null : { keyId: row.one_time_prekey_id, publicKey: row.one_time_prekey_public },
    });
  }
  return { devices: bundle };
}

async function getConversationPrekeyBundle(db, conversationId, userId) {
  await requireConversationMember(db, conversationId, userId);
  const members = await db.prepare(`
    SELECT m.user_id, p.chat_alias
    FROM chat_conversation_members m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    WHERE m.conversation_id = ? AND m.user_id <> ? AND m.left_at IS NULL
    ORDER BY m.joined_at, m.user_id
  `).bind(conversationId, userId).all();
  const result = [];
  const timestamp = nowIso();
  for (const member of members.results || []) {
    const devices = await db.prepare(`
      SELECT d.id, d.device_number, d.identity_public_key, d.registration_id,
        d.signed_prekey_id, d.signed_prekey_public, d.signed_prekey_signature,
        (SELECT p.key_id FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
         ORDER BY p.created_at LIMIT 1) AS one_time_prekey_id,
        (SELECT p.public_key FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
         ORDER BY p.created_at LIMIT 1) AS one_time_prekey_public
      FROM chat_devices d WHERE d.user_id = ? AND d.revoked_at IS NULL
    `).bind(member.user_id).all();
    const deviceBundle = [];
    for (const row of devices.results || []) {
      if (row.one_time_prekey_id != null) {
        await db.prepare("UPDATE chat_device_prekeys SET consumed_at = ? WHERE device_id = ? AND key_id = ? AND consumed_at IS NULL")
          .bind(timestamp, row.id, row.one_time_prekey_id).run();
      }
      deviceBundle.push({
        deviceId: row.id,
        deviceNumber: row.device_number,
        identityKey: row.identity_public_key,
        registrationId: row.registration_id,
        signedPreKey: { keyId: row.signed_prekey_id, publicKey: row.signed_prekey_public, signature: row.signed_prekey_signature },
        oneTimePreKey: row.one_time_prekey_id == null ? null : { keyId: row.one_time_prekey_id, publicKey: row.one_time_prekey_public },
      });
    }
    result.push({ userId: member.user_id, alias: member.chat_alias || "Paired contact", devices: deviceBundle });
  }
  return { conversationId, members: result };
}

async function syncMessages(db, userId, url) {
  const conversationId = boundedString(url.searchParams.get("conversationId"), "conversationId", 100);
  await requireConversationMember(db, conversationId, userId);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const rows = cursor
    ? await db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_device_id, d.device_number AS sender_device_number,
        p.chat_alias AS sender_alias,
        m.client_message_id, m.protocol_version, m.ciphertext, m.attachment_refs, m.size_bucket,
        m.created_at, m.expires_at, m.deleted_at
      FROM chat_messages m JOIN chat_devices d ON d.id = m.sender_device_id
        LEFT JOIN chat_profiles p ON p.user_id = d.user_id
      WHERE m.conversation_id = ? AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
      ORDER BY m.created_at ASC, m.id ASC LIMIT ?
    `).bind(conversationId, cursor.createdAt, cursor.createdAt, cursor.id, limit).all()
    : await db.prepare(`
      SELECT m.id, m.conversation_id, m.sender_device_id, d.device_number AS sender_device_number,
        p.chat_alias AS sender_alias,
        m.client_message_id, m.protocol_version, m.ciphertext, m.attachment_refs, m.size_bucket,
        m.created_at, m.expires_at, m.deleted_at
      FROM chat_messages m JOIN chat_devices d ON d.id = m.sender_device_id
        LEFT JOIN chat_profiles p ON p.user_id = d.user_id
      WHERE m.conversation_id = ? ORDER BY m.created_at ASC, m.id ASC LIMIT ?
    `).bind(conversationId, limit).all();
  const messages = (rows.results || []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderDeviceId: row.sender_device_id,
    senderDeviceNumber: row.sender_device_number,
    senderAlias: row.sender_alias || "Paired contact",
    clientMessageId: row.client_message_id,
    protocolVersion: row.protocol_version,
    ciphertext: row.deleted_at ? "" : row.ciphertext,
    attachmentRefs: row.deleted_at ? [] : JSON.parse(row.attachment_refs || "[]"),
    sizeBucket: row.size_bucket,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    deleted: Boolean(row.deleted_at),
  }));
  const last = messages.at(-1);
  return {
    messages,
    nextCursor: last ? encodeCursor({ createdAt: last.createdAt, id: last.id }) : null,
  };
}

async function postMessage(db, env, userId, body) {
  const conversationId = boundedString(body.conversationId, "conversationId", 100);
  const conversation = await requireConversationMember(db, conversationId, userId);
  const device = await requireOwnedDevice(db, boundedString(body.senderDeviceId, "senderDeviceId", 100), userId);
  const clientMessageId = boundedString(body.clientMessageId, "clientMessageId", 160);
  const ciphertext = boundedString(body.ciphertext, "ciphertext", MAX_CIPHERTEXT_LENGTH);
  if (!isBase64Url(ciphertext, MAX_CIPHERTEXT_LENGTH)) {
    throw new AuthError(400, "Ciphertext must be base64url encoded.", "INVALID_CIPHERTEXT");
  }
  const protocolVersion = typeof body.protocolVersion === "string" && body.protocolVersion.trim()
    ? body.protocolVersion.trim().slice(0, 40)
    : "signal-v1";
  const attachmentRefs = Array.isArray(body.attachmentRefs) ? body.attachmentRefs : [];
  if (attachmentRefs.length > 8 || attachmentRefs.some((item) => !isBase64Url(String(item), 100))) {
    throw new AuthError(400, "Attachment references are invalid.", "INVALID_ATTACHMENTS");
  }
  if (attachmentRefs.length) {
    const placeholders = attachmentRefs.map(() => "?").join(", ");
    const attachmentRows = await db.prepare(`
      SELECT id FROM chat_attachments
      WHERE conversation_id = ? AND status = 'complete' AND id IN (${placeholders})
    `).bind(conversationId, ...attachmentRefs).all();
    if ((attachmentRows.results || []).length !== attachmentRefs.length) {
      throw new AuthError(400, "One or more attachments are not ready for this conversation.", "INVALID_ATTACHMENTS");
    }
  }
  const existing = await db.prepare(`
    SELECT id, conversation_id, ciphertext, deleted_at, created_at, expires_at, sender_device_id,
      client_message_id, protocol_version, attachment_refs, size_bucket
    FROM chat_messages WHERE sender_device_id = ? AND client_message_id = ?
  `).bind(device.id, clientMessageId).first();
  if (existing) {
    if (existing.ciphertext !== ciphertext) throw new AuthError(409, "Message id was already used.", "MESSAGE_ID_REUSED");
    const existingSender = await db.prepare(`
      SELECT d.device_number, p.chat_alias AS sender_alias
      FROM chat_devices d LEFT JOIN chat_profiles p ON p.user_id = d.user_id WHERE d.id = ?
    `).bind(existing.sender_device_id).first();
    return { message: {
      id: existing.id, conversationId: existing.conversation_id, senderDeviceId: existing.sender_device_id,
      senderDeviceNumber: existingSender?.device_number || null,
      senderAlias: existingSender?.sender_alias || "Paired contact",
      clientMessageId: existing.client_message_id, protocolVersion: existing.protocol_version,
      ciphertext: existing.deleted_at ? "" : existing.ciphertext,
      attachmentRefs: existing.deleted_at ? [] : JSON.parse(existing.attachment_refs || "[]"),
      sizeBucket: existing.size_bucket, createdAt: existing.created_at, expiresAt: existing.expires_at,
      deleted: Boolean(existing.deleted_at),
    }, duplicate: true };
  }

  const id = randomId();
  const timestamp = nowIso();
  const expiresAt = retentionExpiry(Number(conversation.retention_seconds));
  const statements = [db.prepare(`
    INSERT INTO chat_messages
      (id, conversation_id, sender_device_id, client_message_id, protocol_version, ciphertext,
       attachment_refs, size_bucket, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(id, conversationId, device.id, clientMessageId, protocolVersion, ciphertext,
    JSON.stringify(attachmentRefs), bucketForSize(ciphertext.length), timestamp, expiresAt)];
  const memberDevices = await db.prepare(`
    SELECT d.id FROM chat_devices d
    JOIN chat_conversation_members m ON m.user_id = d.user_id
    WHERE m.conversation_id = ? AND m.left_at IS NULL AND d.revoked_at IS NULL AND d.id <> ?
  `).bind(conversationId, device.id).all();
  for (const row of memberDevices.results || []) {
    statements.push(db.prepare(`
      INSERT INTO chat_message_deliveries (message_id, device_id) VALUES (?, ?)
    `).bind(id, row.id));
  }
  statements.push(db.prepare("UPDATE chat_conversations SET updated_at = ? WHERE id = ?").bind(timestamp, conversationId));
  await db.batch(statements);
  const message = {
    id, conversationId, senderDeviceId: device.id, senderDeviceNumber: device.device_number,
    senderAlias: (await db.prepare("SELECT chat_alias FROM chat_profiles WHERE user_id = ?").bind(userId).first())?.chat_alias || "You",
    clientMessageId, protocolVersion, ciphertext,
    attachmentRefs, sizeBucket: bucketForSize(ciphertext.length), createdAt: timestamp, expiresAt, deleted: false,
  };
  if (env.CHAT_ROOMS) {
    try {
      const roomId = env.CHAT_ROOMS.idFromName(conversationId);
      await env.CHAT_ROOMS.get(roomId).fetch("https://chat-room/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "message", message }),
      });
    } catch (_error) {
      // D1 remains the source of truth; clients can recover through cursor sync.
    }
  }
  return { message, duplicate: false };
}

async function initAttachment(db, env, userId, body) {
  if (!env.CHAT_MEDIA_BUCKET) throw new AuthError(503, "Chat media storage is not configured yet.", "CHAT_MEDIA_NOT_CONFIGURED");
  const conversationId = boundedString(body.conversationId, "conversationId", 100);
  const conversation = await requireConversationMember(db, conversationId, userId);
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) {
    throw new AuthError(413, "Encrypted images must be 10 MB or smaller.", "ATTACHMENT_TOO_LARGE");
  }
  const id = randomId();
  const objectKey = `chat/${randomId(24)}.bin`;
  const timestamp = nowIso();
  await db.prepare(`
    INSERT INTO chat_attachments (id, conversation_id, object_key, size_bytes, size_bucket, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(id, conversationId, objectKey, sizeBytes, bucketForSize(sizeBytes), timestamp,
    retentionExpiry(Number(conversation.retention_seconds))).run();
  return { attachmentId: id, maxBytes: MAX_IMAGE_BYTES, expiresAt: retentionExpiry(Number(conversation.retention_seconds)) };
}

async function putAttachment(db, env, userId, attachmentId, request) {
  if (!env.CHAT_MEDIA_BUCKET) throw new AuthError(503, "Chat media storage is not configured yet.", "CHAT_MEDIA_NOT_CONFIGURED");
  const row = await db.prepare(`
    SELECT a.id, a.object_key, a.size_bytes, a.status, a.conversation_id
    FROM chat_attachments a
    JOIN chat_conversation_members m ON m.conversation_id = a.conversation_id AND m.user_id = ? AND m.left_at IS NULL
    WHERE a.id = ?
  `).bind(userId, attachmentId).first();
  if (!row || row.status !== "pending") throw new AuthError(404, "Attachment upload not found.", "ATTACHMENT_NOT_FOUND");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== Number(row.size_bytes) || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AuthError(400, "Encrypted attachment size does not match its reservation.", "ATTACHMENT_SIZE_MISMATCH");
  }
  await env.CHAT_MEDIA_BUCKET.put(row.object_key, bytes, { httpMetadata: { contentType: "application/octet-stream" } });
  return { uploaded: true, attachmentId: row.id };
}

async function completeAttachment(db, env, userId, attachmentId) {
  if (!env.CHAT_MEDIA_BUCKET) throw new AuthError(503, "Chat media storage is not configured yet.", "CHAT_MEDIA_NOT_CONFIGURED");
  const row = await db.prepare(`
    SELECT a.id, a.object_key, a.size_bytes, a.status
    FROM chat_attachments a
    JOIN chat_conversation_members m ON m.conversation_id = a.conversation_id AND m.user_id = ? AND m.left_at IS NULL
    WHERE a.id = ?
  `).bind(userId, attachmentId).first();
  if (!row) throw new AuthError(404, "Attachment not found.", "ATTACHMENT_NOT_FOUND");
  const object = await env.CHAT_MEDIA_BUCKET.head(row.object_key);
  if (!object || Number(object.size) !== Number(row.size_bytes)) {
    throw new AuthError(409, "Attachment upload is incomplete.", "ATTACHMENT_INCOMPLETE");
  }
  await db.prepare("UPDATE chat_attachments SET status = 'complete' WHERE id = ?").bind(attachmentId).run();
  return { attachmentId, complete: true };
}

async function getAttachment(db, env, userId, attachmentId) {
  if (!env.CHAT_MEDIA_BUCKET) throw new AuthError(503, "Chat media storage is not configured yet.", "CHAT_MEDIA_NOT_CONFIGURED");
  const row = await db.prepare(`
    SELECT a.object_key, a.status FROM chat_attachments a
    JOIN chat_conversation_members m ON m.conversation_id = a.conversation_id AND m.user_id = ? AND m.left_at IS NULL
    WHERE a.id = ?
  `).bind(userId, attachmentId).first();
  if (!row || row.status !== "complete") throw new AuthError(404, "Attachment not found.", "ATTACHMENT_NOT_FOUND");
  const object = await env.CHAT_MEDIA_BUCKET.get(row.object_key);
  if (!object) throw new AuthError(404, "Attachment object not found.", "ATTACHMENT_NOT_FOUND");
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "private, no-store",
      "Content-Length": String(object.size || ""),
    },
  });
}

async function issueWebSocketTicket(db, userId, body) {
  const conversationId = boundedString(body.conversationId, "conversationId", 100);
  await requireConversationMember(db, conversationId, userId);
  const device = await requireOwnedDevice(db, boundedString(body.deviceId, "deviceId", 100), userId);
  const token = bytesToBase64Url(randomBytes(32));
  const timestamp = Date.now();
  const expiresAt = new Date(timestamp + 60 * 1000).toISOString();
  await db.prepare(`
    INSERT INTO chat_ws_tickets (id, token_hash, user_id, conversation_id, device_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(randomId(), await sha256Base64Url(token), userId, conversationId, device.id, expiresAt,
    new Date(timestamp).toISOString()).run();
  return { ticket: token, expiresAt, protocol: "expassway-chat-v1" };
}

async function acceptWebSocketTicket(db, token, conversationId) {
  const hash = await sha256Base64Url(token);
  const row = await db.prepare(`
    SELECT id, user_id, conversation_id, device_id, expires_at, used_at
    FROM chat_ws_tickets WHERE token_hash = ? AND conversation_id = ?
  `).bind(hash, conversationId).first();
  const timestamp = nowIso();
  if (!row || row.used_at || row.expires_at <= timestamp) throw new AuthError(401, "Chat connection ticket is invalid.", "WS_TICKET_INVALID");
  const result = await db.prepare("UPDATE chat_ws_tickets SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(timestamp, row.id).run();
  if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) {
    throw new AuthError(401, "Chat connection ticket is invalid.", "WS_TICKET_INVALID");
  }
  return row;
}

async function handleRoute(request, env, user) {
  const url = new URL(request.url);
  const parts = getRouteParts(url);
  const method = request.method;
  const db = env.DB;

  if (method === "GET" && url.pathname === "/api/chat/invites") return success(await listInvites(db, user.id), method);
  if (method === "POST" && url.pathname === "/api/chat/invites") return success(await createInvite(db, user.id), method, 201);
  if (method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "invites" && parts[4] === "accept") {
    const token = boundedString(parts[3], "token", 200);
    const accepted = await acceptInvite(db, token, user.id);
    return success(accepted, method, 201);
  }
  if (method === "DELETE" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "invites" && parts[3]) {
    const result = await db.prepare("UPDATE chat_invites SET revoked_at = ? WHERE id = ? AND creator_user_id = ? AND used_at IS NULL AND revoked_at IS NULL")
      .bind(nowIso(), parts[3], user.id).run();
    if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) throw new AuthError(404, "Invite not found.", "INVITE_NOT_FOUND");
    return success({ revoked: true }, method);
  }

  if (method === "GET" && url.pathname === "/api/chat/contacts") return success(await listContacts(db, user.id), method);
  if (method === "GET" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "contacts" && parts[4] === "bundle") {
    return success(await getPrekeyBundle(db, contactIdFromParts(parts), user.id), method);
  }
  if (method === "GET" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "conversations"
    && parts[3] && parts[4] === "bundle") {
    return success(await getConversationPrekeyBundle(db, parts[3], user.id), method);
  }
  if (method === "GET" && url.pathname === "/api/chat/devices/bundle") {
    const excludeDeviceId = url.searchParams.get("excludeDeviceId") || "";
    await requireOwnedDevice(db, excludeDeviceId, user.id);
    return success(await getOwnPrekeyBundle(db, user.id, excludeDeviceId), method);
  }

  if (method === "GET" && url.pathname === "/api/chat/devices") return success(await listDevices(db, user.id), method);
  if (method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "devices"
    && parts[3] && parts[4] === "prekeys") {
    const body = await readJsonBody(request);
    return success(await refillDevicePrekeys(db, user.id, parts[3], body), method, 201);
  }
  if (method === "POST" && url.pathname === "/api/chat/devices/approval") {
    const body = await readJsonBody(request);
    return success(await createDeviceApprovalTicket(db, user.id, boundedString(body.deviceId, "deviceId", 100)), method, 201);
  }
  if (method === "POST" && url.pathname === "/api/chat/devices") {
    return success(await registerDevice(db, user.id, await readJsonBody(request)), method, 201);
  }
  if (method === "DELETE" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "devices" && parts[3]) {
    await requireOwnedDevice(db, parts[3], user.id);
    await db.prepare("UPDATE chat_devices SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(nowIso(), nowIso(), parts[3], user.id).run();
    return success({ revoked: true }, method);
  }

  if (method === "GET" && url.pathname === "/api/chat/profile") {
    return success(mapProfile(await ensureProfile(db, user.id)), method);
  }
  if (method === "PATCH" && url.pathname === "/api/chat/profile") {
    const body = await readJsonBody(request);
    const current = await ensureProfile(db, user.id);
    const alias = typeof body.alias === "string" && body.alias.trim()
      ? body.alias.trim().slice(0, 48)
      : current.chat_alias;
    const profileCiphertext = typeof body.profileCiphertext === "string"
      ? boundedString(body.profileCiphertext, "profileCiphertext", MAX_PROFILE_CIPHERTEXT_LENGTH)
      : current.profile_ciphertext;
    if (!/^[\p{L}\p{N} _.-]{2,48}$/u.test(alias)) {
      throw new AuthError(400, "Chat nickname contains unsupported characters.", "INVALID_CHAT_ALIAS");
    }
    await db.prepare(`UPDATE chat_profiles SET chat_alias = ?, profile_ciphertext = ?, updated_at = ? WHERE user_id = ?`)
      .bind(alias, profileCiphertext, nowIso(), user.id).run();
    return success(mapProfile(await ensureProfile(db, user.id)), method);
  }

  if (method === "GET" && url.pathname === "/api/chat/conversations") {
    const rows = await db.prepare(`
      SELECT c.id, c.kind, c.created_by, c.retention_seconds, c.created_at, c.updated_at
      FROM chat_conversations c JOIN chat_conversation_members m ON m.conversation_id = c.id
      WHERE m.user_id = ? AND m.left_at IS NULL AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC
    `).bind(user.id).all();
    const conversations = [];
    for (const row of rows.results || []) conversations.push(await mapConversation(db, row, user.id));
    return success(conversations, method);
  }
  if (method === "POST" && url.pathname === "/api/chat/conversations") {
    const body = await readJsonBody(request);
    if (body?.kind === "group") {
      return success(await createGroupConversation(db, user.id, body), method, 201);
    }
    const contact = await requireContact(db, boundedString(body.contactId, "contactId", 100), user.id);
    const existing = await existingDirectConversation(db, user.id, contact.peer_user_id);
    if (existing) return success(await mapConversation(db, existing, user.id), method);
    const timestamp = nowIso();
    const id = randomId();
    await db.batch([
      db.prepare(`INSERT INTO chat_conversations (id, kind, created_by, retention_seconds, created_at, updated_at)
        VALUES (?, 'direct', ?, 2592000, ?, ?)`).bind(id, user.id, timestamp, timestamp),
      db.prepare(`INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, 'owner', ?), (?, ?, 'member', ?)`).bind(id, user.id, timestamp, id, contact.peer_user_id, timestamp),
    ]);
    return success(await mapConversation(db, { id, kind: "direct", created_by: user.id, retention_seconds: 2592000, created_at: timestamp, updated_at: timestamp }, user.id), method, 201);
  }
  if (method === "PATCH" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "conversations" && parts[3] && parts[4] === "settings") {
    await requireConversationMember(db, parts[3], user.id);
    const body = await readJsonBody(request);
    const retentionSeconds = Number(body.retentionSeconds);
    if (!RETENTION_OPTIONS.has(retentionSeconds)) throw new AuthError(400, "Unsupported retention period.", "INVALID_RETENTION");
    await db.prepare("UPDATE chat_conversations SET retention_seconds = ?, updated_at = ? WHERE id = ?")
      .bind(retentionSeconds, nowIso(), parts[3]).run();
    return success({ retentionSeconds }, method);
  }

  if (method === "GET" && url.pathname === "/api/chat/sync") return success(await syncMessages(db, user.id, url), method);
  if (method === "POST" && url.pathname === "/api/chat/messages") return success(await postMessage(db, env, user.id, await readJsonBody(request)), method, 201);
  if (method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "messages" && parts[4] === "delete") {
    const row = await db.prepare(`
      SELECT m.id, m.sender_device_id FROM chat_messages m
      JOIN chat_conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ? AND cm.left_at IS NULL
      WHERE m.id = ?
    `).bind(user.id, parts[3]).first();
    if (!row) throw new AuthError(404, "Message not found.", "MESSAGE_NOT_FOUND");
    const owner = await db.prepare("SELECT user_id FROM chat_devices WHERE id = ?").bind(row.sender_device_id).first();
    if (owner?.user_id !== user.id) throw new AuthError(403, "Only the sender can delete this message.", "FORBIDDEN");
    await db.prepare("UPDATE chat_messages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(nowIso(), parts[3]).run();
    return success({ deleted: true }, method);
  }

  if (method === "POST" && url.pathname === "/api/chat/attachments/init") return success(await initAttachment(db, env, user.id, await readJsonBody(request)), method, 201);
  if (method === "PUT" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "attachments" && parts[3]) return success(await putAttachment(db, env, user.id, parts[3], request), method);
  if (method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "attachments" && parts[4] === "complete") return success(await completeAttachment(db, env, user.id, parts[3]), method);
  if (method === "GET" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "attachments" && parts[3]) return getAttachment(db, env, user.id, parts[3]);

  if (method === "POST" && url.pathname === "/api/chat/ws-ticket") return success(await issueWebSocketTicket(db, user.id, await readJsonBody(request)), method, 201);

  if (method === "GET" && url.pathname === "/api/chat/key-backup") {
    ensureRecoveryEnabled(env);
    const row = await db.prepare(`SELECT kdf_version, salt, nonce, ciphertext, source_device_id,
        backup_version, restore_operation_id, restored_device_id, consumed_at, created_at, updated_at
      FROM chat_key_backups WHERE user_id = ?`).bind(user.id).first();
    return success(row ? {
      kdfVersion: row.kdf_version,
      salt: row.salt,
      nonce: row.nonce,
      ciphertext: row.ciphertext,
      sourceDeviceId: row.source_device_id,
      backupVersion: row.backup_version,
      restoreOperationId: row.restore_operation_id,
      restoredDeviceId: row.restored_device_id,
      consumedAt: row.consumed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    } : null, method);
  }
  if (method === "PUT" && url.pathname === "/api/chat/key-backup") {
    ensureRecoveryEnabled(env);
    const body = await readJsonBody(request);
    const kdfVersion = boundedString(body.kdfVersion, "kdfVersion", 32);
    const salt = boundedString(body.salt, "salt", 256);
    const nonce = boundedString(body.nonce, "nonce", 256);
    const ciphertext = boundedString(body.ciphertext, "ciphertext", 512 * 1024);
    const sourceDeviceId = boundedString(body.sourceDeviceId, "sourceDeviceId", 100);
    await requireOwnedDevice(db, sourceDeviceId, user.id);
    const backupVersion = boundedString(body.backupVersion || "1", "backupVersion", 32);
    const restoreOperationId = boundedString(body.restoreOperationId || randomId(), "restoreOperationId", 100);
    if (![salt, nonce, ciphertext].every((value) => isBase64Url(value, 512 * 1024))) throw new AuthError(400, "Encrypted backup fields are invalid.", "INVALID_BACKUP");
    const timestamp = nowIso();
    await db.prepare(`
      INSERT INTO chat_key_backups
        (user_id, kdf_version, salt, nonce, ciphertext, source_device_id, backup_version, restore_operation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET kdf_version = excluded.kdf_version, salt = excluded.salt,
        nonce = excluded.nonce, ciphertext = excluded.ciphertext, source_device_id = excluded.source_device_id,
        backup_version = excluded.backup_version, restore_operation_id = excluded.restore_operation_id, restored_device_id = NULL,
        consumed_at = NULL, updated_at = excluded.updated_at
    `).bind(user.id, kdfVersion, salt, nonce, ciphertext, sourceDeviceId, backupVersion, restoreOperationId, timestamp, timestamp).run();
    return success({ saved: true, updatedAt: timestamp }, method);
  }
  if (method === "POST" && url.pathname === "/api/chat/key-backup/restore") {
    const body = await readJsonBody(request);
    return success(await restoreKeyBackup(db, env, user.id, body), method, 201);
  }

  if (method === "POST" && url.pathname === "/api/chat/reports") {
    const body = await readJsonBody(request);
    const evidenceCiphertext = boundedString(body.evidenceCiphertext, "evidenceCiphertext", MAX_EVIDENCE_LENGTH);
    const evidenceKeyVersion = boundedString(body.evidenceKeyVersion, "evidenceKeyVersion", 64);
    if (!isBase64Url(evidenceCiphertext, MAX_EVIDENCE_LENGTH)) throw new AuthError(400, "Encrypted evidence is invalid.", "INVALID_EVIDENCE");
    const conversationId = body.conversationId ? boundedString(body.conversationId, "conversationId", 100) : null;
    const messageId = body.messageId ? boundedString(body.messageId, "messageId", 100) : null;
    if (conversationId) await requireConversationMember(db, conversationId, user.id);
    if (messageId) {
      const message = await db.prepare(`
        SELECT m.id, m.conversation_id FROM chat_messages m
        JOIN chat_conversation_members cm ON cm.conversation_id = m.conversation_id
          AND cm.user_id = ? AND cm.left_at IS NULL
        WHERE m.id = ?
      `).bind(user.id, messageId).first();
      if (!message || (conversationId && message.conversation_id !== conversationId)) {
        throw new AuthError(404, "Message not found.", "MESSAGE_NOT_FOUND");
      }
    }
    const timestamp = nowIso();
    await db.prepare(`
      INSERT INTO chat_reports (id, reporter_user_id, conversation_id, message_id, evidence_ciphertext, evidence_key_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(randomId(), user.id, conversationId, messageId, evidenceCiphertext, evidenceKeyVersion, timestamp).run();
    return success({ submitted: true }, method, 201);
  }

  return routeNotFound(request, url);
}

export async function handleChatApiRequest(request, env) {
  if (request.method === "OPTIONS") return preflightResponse(request);
  try {
    const { user } = await requireUserAndChat(request, env);
    const response = await handleRoute(request, env, user);
    return withCors(request, response);
  } catch (error) {
    if (error instanceof AuthError) return withCors(request, failure(error.status, error.code, error.message, request.method, error.details));
    console.error("Chat API request failed");
    return withCors(request, failure(500, "INTERNAL_SERVER_ERROR", "Chat request failed.", request.method));
  }
}

export async function handleChatWebSocketRequest(request, env) {
  try {
    ensureEnabled(env);
    if (request.headers.get("Upgrade") !== "websocket") throw new AuthError(426, "Expected a WebSocket upgrade.", "WEBSOCKET_REQUIRED");
    const url = new URL(request.url);
    const conversationId = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
    if (!conversationId) throw new AuthError(400, "Conversation is required.", "INVALID_INPUT");
    const protocols = String(request.headers.get("Sec-WebSocket-Protocol") || "")
      .split(",").map((value) => value.trim());
    const ticketProtocol = protocols.find((value) => value.startsWith("ticket."));
    if (!ticketProtocol) throw new AuthError(401, "A one-time chat ticket is required.", "WS_TICKET_REQUIRED");
    const ticket = ticketProtocol.slice("ticket.".length);
    const ticketRow = await acceptWebSocketTicket(env.DB, ticket, conversationId);
    if (!env.CHAT_ROOMS) throw new AuthError(503, "Chat realtime storage is not configured yet.", "CHAT_REALTIME_NOT_CONFIGURED");
    const roomId = env.CHAT_ROOMS.idFromName(conversationId);
    const roomRequest = new Request("https://chat-room/connect", {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "X-Chat-User": ticketRow.user_id,
        "X-Chat-Device": ticketRow.device_id,
        "X-Chat-Conversation": ticketRow.conversation_id,
      },
    });
    return env.CHAT_ROOMS.get(roomId).fetch(roomRequest);
  } catch (error) {
    if (error instanceof AuthError) return withCors(request, failure(error.status, error.code, error.message, request.method));
    return withCors(request, failure(500, "INTERNAL_SERVER_ERROR", "Chat realtime connection failed.", request.method));
  }
}

export async function cleanupChatData(env) {
  if (!env.DB) return;
  const timestamp = nowIso();
  if (env.CHAT_MEDIA_BUCKET) {
    const expired = await env.DB.prepare(`
      SELECT object_key FROM chat_attachments
      WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR status = 'deleted'
      LIMIT 500
    `).bind(timestamp).all();
    for (const row of expired.results || []) {
      await env.CHAT_MEDIA_BUCKET.delete(row.object_key);
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM chat_messages WHERE expires_at IS NOT NULL AND expires_at <= ?").bind(timestamp),
    env.DB.prepare("DELETE FROM chat_attachments WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR status = 'deleted'").bind(timestamp),
    env.DB.prepare("DELETE FROM chat_invites WHERE expires_at <= ? OR used_at IS NOT NULL OR revoked_at IS NOT NULL").bind(timestamp),
    env.DB.prepare("DELETE FROM chat_device_prekeys WHERE consumed_at IS NOT NULL AND consumed_at <= datetime(?, '-1 day')").bind(timestamp),
    env.DB.prepare("DELETE FROM chat_ws_tickets WHERE expires_at <= ? OR used_at IS NOT NULL").bind(timestamp),
    env.DB.prepare("DELETE FROM chat_device_approval_tickets WHERE expires_at <= ? OR used_at IS NOT NULL").bind(timestamp),
    env.DB.prepare("DELETE FROM chat_reports WHERE expires_at IS NOT NULL AND expires_at <= ?").bind(timestamp),
  ]);
}
