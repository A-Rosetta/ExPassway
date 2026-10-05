import {
  AuthError,
  failure,
  readJsonBody,
  requireCurrentUser,
  requireString,
  routeNotFound,
  success,
} from "./auth-api.js";
import {
  WebAuthnError,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  webAuthnContext,
} from "./webauthn.js";
import { handleAccountV2Route, cleanupAccountV2, mapAccountConversation, isHistoricalConversation, canonicalAccountJson } from "./chat-account-v2.js";
import { AI_CALL_COOLDOWN_MS } from "./ai-call-cooldown.js";

const encoder = new TextEncoder();
const MAX_CIPHERTEXT_LENGTH = 512 * 1024;
const MAX_PROFILE_CIPHERTEXT_LENGTH = 64 * 1024;
const MAX_EVIDENCE_LENGTH = 2 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_AVATAR_BYTES = 256 * 1024;
const MAX_GROUP_MEMBERS = 50;
const MAX_GLOBAL_MEMBERS = 1000;
const GLOBAL_DISCUSSION_SLUG = "site-wide-discussion";
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
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function boundedString(value, field, maxLength) {
  const normalized = requireString(value, field);
  if (normalized.length > maxLength) {
    throw new AuthError(413, `Field "${field}" is too large.`, "PAYLOAD_TOO_LARGE");
  }
  return normalized;
}

function validateAvatarDataUrl(value) {
  if (value === "") return "";
  if (typeof value !== "string")
    throw new AuthError(400, "Choose a PNG, JPEG or WebP avatar.", "INVALID_CHAT_AVATAR");
  if (value.length > Math.ceil(MAX_AVATAR_BYTES / 3) * 4 + 32)
    throw new AuthError(413, "The avatar must be no larger than 256 KiB.", "CHAT_AVATAR_TOO_LARGE");
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  let binary;
  try {
    if (!match) throw new Error("format");
    binary = atob(match[2]);
    if (btoa(binary) !== match[2]) throw new Error("noncanonical");
  } catch (_) {
    throw new AuthError(400, "Choose a valid PNG, JPEG or WebP avatar.", "INVALID_CHAT_AVATAR");
  }
  if (binary.length > MAX_AVATAR_BYTES)
    throw new AuthError(413, "The avatar must be no larger than 256 KiB.", "CHAT_AVATAR_TOO_LARGE");
  const byte = (index) => binary.charCodeAt(index);
  const png = binary.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => byte(i) === n)
    && binary.slice(12, 16) === "IHDR";
  const jpeg = binary.length >= 4 && byte(0) === 255 && byte(1) === 216 && byte(2) === 255;
  const webp = binary.length >= 16 && binary.slice(0, 4) === "RIFF" && binary.slice(8, 12) === "WEBP"
    && ["VP8 ", "VP8L", "VP8X"].includes(binary.slice(12, 16));
  if (!(match[1] === "png" ? png : match[1] === "jpeg" ? jpeg : webp))
    throw new AuthError(400, "The avatar content does not match its image type.", "INVALID_CHAT_AVATAR");
  return value;
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
    throw new AuthError(503, "Chat is not enabled for this deployment yet.", "CHAT_NOT_ENABLED");
  }
}

function accountV2Enabled(env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.CHAT_ACCOUNT_V2_ENABLED || "").toLowerCase()
  );
}

function ensureAccountV2Enabled(env) {
  if (!accountV2Enabled(env))
    throw new AuthError(
      503,
      "Account synced E2EE is not enabled for this deployment yet.",
      "CHAT_ACCOUNT_V2_DISABLED"
    );
}

function recoveryEnabled(env) {
  return ["1", "true", "yes", "on"].includes(
    String(env.CHAT_RECOVERY_BACKUP_ENABLED || "").toLowerCase()
  );
}

function ensureRecoveryEnabled(env) {
  if (!recoveryEnabled(env)) {
    throw new AuthError(
      503,
      "Encrypted chat recovery is not enabled for this deployment yet.",
      "CHAT_RECOVERY_DISABLED"
    );
  }
}

function corsHeaders(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("Origin");
  const headers = {
    Vary: "Origin",
  };
  if (!origin || origin === requestUrl.origin)
    headers["Access-Control-Allow-Origin"] = requestUrl.origin;
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
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function decodeCursor(value) {
  if (!value) return null;
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - (normalized.length % 4)) % 4));
    const parsed = JSON.parse(binary);
    if (typeof parsed.createdAt !== "string" || typeof parsed.id !== "string")
      throw new Error("invalid");
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
  const existing = await db
    .prepare(
      `
    SELECT user_id, chat_alias, chat_user_id, identity_fingerprint, profile_ciphertext, avatar_data_url, created_at, updated_at
    FROM chat_profiles WHERE user_id = ?
  `
    )
    .bind(userId)
    .first();
  if (existing) {
    if (!existing.chat_user_id || (!existing.identity_fingerprint && fingerprint)) {
      let chatUserId = existing.chat_user_id;
      for (let attempt = 0; !chatUserId && attempt < 5; attempt += 1) {
        const candidate = `learner_${randomId(6).toLowerCase()}`;
        try {
          const result = await db.prepare("UPDATE chat_profiles SET chat_user_id = ? WHERE user_id = ? AND chat_user_id IS NULL")
            .bind(candidate, userId).run();
          if (Number(result?.meta?.changes ?? result?.changes ?? 0) === 1) chatUserId = candidate;
        } catch (error) {
          if (!String(error?.message || error).includes("UNIQUE")) throw error;
        }
      }
      await db
        .prepare(
          "UPDATE chat_profiles SET identity_fingerprint = COALESCE(?, identity_fingerprint), updated_at = ? WHERE user_id = ?"
        )
        .bind(fingerprint || null, nowIso(), userId)
        .run();
      return { ...existing, chat_user_id: chatUserId || existing.chat_user_id, identity_fingerprint: fingerprint || existing.identity_fingerprint };
    }
    return existing;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const alias = `learner-${randomId(5).toLowerCase()}`;
    const chatUserId = `learner_${randomId(6).toLowerCase()}`;
    const timestamp = nowIso();
    try {
      await db
        .prepare(
          `
        INSERT INTO chat_profiles
          (user_id, chat_alias, chat_user_id, identity_fingerprint, profile_ciphertext, created_at, updated_at)
        VALUES (?, ?, ?, ?, '', ?, ?)
      `
        )
        .bind(userId, alias, chatUserId, fingerprint || null, timestamp, timestamp)
        .run();
      return await db
        .prepare(
          `SELECT user_id, chat_alias, chat_user_id, identity_fingerprint, profile_ciphertext, avatar_data_url, created_at, updated_at
        FROM chat_profiles WHERE user_id = ?`
        )
        .bind(userId)
        .first();
    } catch (error) {
      if (!String(error?.message || error).includes("UNIQUE")) throw error;
    }
  }
  throw new AuthError(500, "Could not create a chat profile.", "CHAT_PROFILE_ERROR");
}

function mapProfile(row) {
  return {
    id: row.user_id,
    chatUserId: row.chat_user_id || null,
    alias: row.chat_alias,
    avatarDataUrl: row.avatar_data_url || "",
    identityFingerprint: row.identity_fingerprint || null,
    profileCiphertext: row.profile_ciphertext || "",
  };
}

function validChatUserId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{2,47}$/.test(value);
}

function mapDirectoryProfile(row, contactId = null) {
  return {
    chatUserId: row.chat_user_id,
    alias: row.chat_alias || "Paired contact",
    avatarDataUrl: row.avatar_data_url || "",
    enabled: Boolean(row.account_enabled),
    contactId: contactId || null,
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
  const row = await db
    .prepare(
      `SELECT window_start, request_count FROM chat_rate_limits WHERE user_id = ? AND action = ?`
    )
    .bind(userId, action)
    .first();
  if (!row || Number(row.window_start) !== windowStart) {
    await db
      .prepare(
        `
      INSERT INTO chat_rate_limits (user_id, action, window_start, request_count, updated_at)
      VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(user_id, action) DO UPDATE SET window_start = excluded.window_start,
        request_count = 1, updated_at = excluded.updated_at
    `
      )
      .bind(userId, action, windowStart, timestamp)
      .run();
    return;
  }
  if (Number(row.request_count) >= limit) {
    throw new AuthError(429, "Chat request rate limit exceeded.", "CHAT_RATE_LIMITED", {
      retryAfterSeconds: 60,
    });
  }
  try { await db
    .prepare(
      "UPDATE chat_rate_limits SET request_count = request_count + 1, updated_at = ? WHERE user_id = ? AND action = ?"
    )
    .bind(timestamp, userId, action)
    .run();
  } catch (_error) {
    // Rate limiting is best effort when the optional counter table is unavailable.
  }
}

async function requireConversationMember(db, conversationId, userId) {
  const row = await db
    .prepare(
      `
    SELECT c.*
    FROM chat_conversations c
    JOIN chat_conversation_members m ON m.conversation_id = c.id
    WHERE c.id = ? AND m.user_id = ? AND m.left_at IS NULL AND c.deleted_at IS NULL
  `
    )
    .bind(conversationId, userId)
    .first();
  if (!row) throw new AuthError(404, "Conversation not found.", "CONVERSATION_NOT_FOUND");
  return row;
}

async function requireOwnedDevice(db, deviceId, userId) {
  const row = await db
    .prepare(
      `
    SELECT id, user_id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
      signed_prekey_public, signed_prekey_signature, revoked_at, created_at, updated_at
    FROM chat_devices WHERE id = ? AND user_id = ?
  `
    )
    .bind(deviceId, userId)
    .first();
  if (!row || row.revoked_at) throw new AuthError(404, "Device not found.", "DEVICE_NOT_FOUND");
  return row;
}

async function requireContact(db, contactId, userId) {
  const row = await db
    .prepare(
      `
    SELECT c.id, c.user_id, c.peer_user_id, c.created_at, c.accepted_at,
      p.chat_alias, p.identity_fingerprint, p.profile_ciphertext, p.avatar_data_url
    FROM chat_contacts c
    LEFT JOIN chat_profiles p ON p.user_id = c.peer_user_id
    WHERE c.id = ? AND c.user_id = ?
  `
    )
    .bind(contactId, userId)
    .first();
  if (!row) throw new AuthError(404, "Contact not found.", "CONTACT_NOT_FOUND");
  return row;
}

async function existingDirectConversation(db, userId, peerUserId) {
  return db
    .prepare(
      `
    SELECT c.*
    FROM chat_conversations c
    JOIN chat_conversation_members mine ON mine.conversation_id = c.id AND mine.user_id = ? AND mine.left_at IS NULL
    JOIN chat_conversation_members peer ON peer.conversation_id = c.id AND peer.user_id = ? AND peer.left_at IS NULL
    WHERE c.kind = 'direct' AND c.deleted_at IS NULL
    LIMIT 1
  `
    )
    .bind(userId, peerUserId)
    .first();
}

async function mapConversation(db, row, userId) {
  if (row.protocol_version === "account-v2") return mapAccountConversation(db, row, userId);
  if (row.kind === "group") {
    const memberRows = await db
      .prepare(
        `
      SELECT m.user_id, m.role, m.joined_at, p.chat_alias, p.identity_fingerprint, p.avatar_data_url,
        (SELECT COUNT(*) FROM chat_devices d WHERE d.user_id = m.user_id AND d.revoked_at IS NULL) AS device_count
      FROM chat_conversation_members m
      LEFT JOIN chat_profiles p ON p.user_id = m.user_id
      WHERE m.conversation_id = ? AND m.left_at IS NULL
      ORDER BY m.joined_at, m.user_id
    `
      )
      .bind(row.id)
      .all();
    const members = [];
    for (const member of memberRows.results || []) {
      const contact =
        member.user_id === userId
          ? null
          : await db
              .prepare("SELECT id FROM chat_contacts WHERE user_id = ? AND peer_user_id = ?")
              .bind(userId, member.user_id)
              .first();
      members.push({
        contactId: contact?.id || null,
        alias: member.user_id === userId ? null : member.chat_alias || "Paired contact",
        avatarDataUrl: member.avatar_data_url || "",
        role: member.role,
        deviceCount: Number(member.device_count || 0),
        identityFingerprint: member.identity_fingerprint || null,
        isSelf: member.user_id === userId,
      });
    }
    const last = await db
      .prepare(
        `
      SELECT created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
    `
      )
      .bind(row.id)
      .first();
    return {
      id: row.id,
      kind: row.kind,
      protocolVersion: row.protocol_version || "signal-v1",
      historical: true,
      retentionSeconds: Number(row.retention_seconds),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastMessageAt: last?.created_at || null,
      group: { memberCount: members.length, members },
      peer: null,
    };
  }
  const peer = await db
    .prepare(
      `
    SELECT m.user_id, p.chat_alias, p.identity_fingerprint, p.profile_ciphertext, p.avatar_data_url,
      d.id AS device_id, d.device_number
    FROM chat_conversation_members m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    LEFT JOIN chat_devices d ON d.user_id = m.user_id AND d.revoked_at IS NULL
    WHERE m.conversation_id = ? AND m.user_id <> ? AND m.left_at IS NULL
    ORDER BY m.joined_at, d.created_at LIMIT 1
  `
    )
    .bind(row.id, userId)
    .first();
  const contact = peer
    ? await db
        .prepare("SELECT id FROM chat_contacts WHERE user_id = ? AND peer_user_id = ?")
        .bind(userId, peer.user_id)
        .first()
    : null;
  const last = await db
    .prepare(
      `
    SELECT created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT 1
  `
    )
    .bind(row.id)
    .first();
  return {
    id: row.id,
    kind: row.kind,
    protocolVersion: row.protocol_version || "signal-v1",
    historical: true,
    retentionSeconds: Number(row.retention_seconds),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: last?.created_at || null,
    peer: peer
      ? {
          contactId: contact?.id || null,
          deviceId: peer.device_id || null,
          deviceNumber: peer.device_number || null,
          alias: peer.chat_alias || "Paired contact",
          avatarDataUrl: peer.avatar_data_url || "",
          identityFingerprint: peer.identity_fingerprint || null,
          profileCiphertext: peer.profile_ciphertext || "",
        }
      : null,
  };
}

async function createGroupConversation(db, userId, body) {
  const rawContactIds = Array.isArray(body?.contactIds) ? body.contactIds : [];
  const contactIds = [
    ...new Set(rawContactIds.map((value) => String(value || "").trim()).filter(Boolean)),
  ];
  if (!contactIds.length || contactIds.length >= MAX_GROUP_MEMBERS) {
    throw new AuthError(
      400,
      `Choose between 1 and ${MAX_GROUP_MEMBERS - 1} paired friends.`,
      "INVALID_GROUP_MEMBERS"
    );
  }
  if (contactIds.some((value) => value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value))) {
    throw new AuthError(400, "Group member references are invalid.", "INVALID_GROUP_MEMBERS");
  }
  const placeholders = contactIds.map(() => "?").join(", ");
  const contacts = await db
    .prepare(
      `
    SELECT id, peer_user_id FROM chat_contacts
    WHERE user_id = ? AND id IN (${placeholders})
  `
    )
    .bind(userId, ...contactIds)
    .all();
  if ((contacts.results || []).length !== contactIds.length) {
    throw new AuthError(
      404,
      "One or more selected friends could not be found.",
      "CONTACT_NOT_FOUND"
    );
  }
  const memberUserIds = [...new Set((contacts.results || []).map((row) => row.peer_user_id))];
  if (memberUserIds.length !== contactIds.length) {
    throw new AuthError(400, "A friend can only appear once in a group.", "INVALID_GROUP_MEMBERS");
  }
  const timestamp = nowIso();
  const conversationId = randomId();
  const statements = [
    db
      .prepare(
        `
      INSERT INTO chat_conversations (id, kind, created_by, retention_seconds, created_at, updated_at)
      VALUES (?, 'group', ?, 2592000, ?, ?)
    `
      )
      .bind(conversationId, userId, timestamp, timestamp),
    db
      .prepare(
        `
      INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'owner', ?)
    `
      )
      .bind(conversationId, userId, timestamp),
  ];
  for (const memberUserId of memberUserIds) {
    statements.push(
      db
        .prepare(
          `
      INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'member', ?)
    `
        )
        .bind(conversationId, memberUserId, timestamp)
    );
  }
  await db.batch(statements);
  const row = await db
    .prepare(
      `
    SELECT id, kind, created_by, retention_seconds, created_at, updated_at
    FROM chat_conversations WHERE id = ?
  `
    )
    .bind(conversationId)
    .first();
  return mapConversation(db, row, userId);
}

async function listContacts(db, userId) {
  const rows = await db
    .prepare(
      `
      SELECT c.id, c.created_at, c.accepted_at, p.chat_user_id, p.chat_alias, p.identity_fingerprint, p.profile_ciphertext, p.avatar_data_url
    FROM chat_contacts c
    LEFT JOIN chat_profiles p ON p.user_id = c.peer_user_id
    WHERE c.user_id = ? ORDER BY c.accepted_at DESC
  `
    )
    .bind(userId)
    .all();
  return (rows.results || []).map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    acceptedAt: row.accepted_at,
    profile: {
      chatUserId: row.chat_user_id || null,
      alias: row.chat_alias || "Paired contact",
      avatarDataUrl: row.avatar_data_url || "",
      identityFingerprint: row.identity_fingerprint || null,
      profileCiphertext: row.profile_ciphertext || "",
    },
  }));
}

async function directoryAccountEnabled(db, userId) {
  const row = await db.prepare(`SELECT 1 FROM chat_account_keys k
    JOIN chat_account_identity_heads h ON h.user_id=k.user_id AND h.key_version=k.key_version
    JOIN chat_account_vault_versions v ON v.user_id=k.user_id AND v.key_version=k.key_version
    JOIN chat_passkeys pk ON pk.user_id=v.user_id AND pk.revoked_at IS NULL AND
      (v.credential_id IS NULL OR pk.credential_id=v.credential_id OR EXISTS (SELECT 1 FROM chat_account_vault_wrappers w
        WHERE w.user_id=v.user_id AND w.key_version=v.key_version AND w.credential_id=pk.credential_id))
    JOIN users u ON u.id=k.user_id AND u.disabled_at IS NULL
    WHERE k.user_id=? AND k.status='active' LIMIT 1`).bind(userId).first();
  return Boolean(row);
}

async function searchChatUsers(db, userId, query) {
  const q = String(query || "").trim();
  if (!validChatUserId(q)) throw new AuthError(400, "Enter at least 3 valid ID characters.", "INVALID_CHAT_USER_ID");
  const rows = await db.prepare(`SELECT p.chat_user_id,p.chat_alias,p.avatar_data_url,
      MAX(CASE WHEN k.user_id IS NOT NULL AND h.user_id IS NOT NULL AND v.user_id IS NOT NULL AND pk.user_id IS NOT NULL THEN 1 ELSE 0 END) AS account_enabled,
      c.id AS contact_id
    FROM chat_profiles p JOIN users u ON u.id=p.user_id AND u.disabled_at IS NULL
    LEFT JOIN chat_account_keys k ON k.user_id=p.user_id AND k.status='active'
    LEFT JOIN chat_account_identity_heads h ON h.user_id=k.user_id AND h.key_version=k.key_version
    LEFT JOIN chat_account_vault_versions v ON v.user_id=k.user_id AND v.key_version=k.key_version
    LEFT JOIN chat_passkeys pk ON pk.user_id=v.user_id AND pk.revoked_at IS NULL AND
      (v.credential_id IS NULL OR pk.credential_id=v.credential_id OR EXISTS (SELECT 1 FROM chat_account_vault_wrappers w
        WHERE w.user_id=v.user_id AND w.key_version=v.key_version AND w.credential_id=pk.credential_id))
    LEFT JOIN chat_contacts c ON c.user_id=? AND c.peer_user_id=p.user_id
    WHERE p.user_id<>? AND p.chat_user_id LIKE ?
    GROUP BY p.user_id ORDER BY p.chat_user_id LIMIT 20`).bind(userId, userId, `${q}%`).all();
  return (rows.results || []).map((row) => mapDirectoryProfile(row, row.contact_id));
}

async function addContactByChatUserId(db, userId, value) {
  const chatUserId = String(value || "").trim();
  if (!validChatUserId(chatUserId)) throw new AuthError(400, "The chat ID is invalid.", "INVALID_CHAT_USER_ID");
  const target = await db.prepare(`SELECT p.user_id,p.chat_user_id,p.chat_alias,p.avatar_data_url,
      MAX(CASE WHEN k.user_id IS NOT NULL AND h.user_id IS NOT NULL AND v.user_id IS NOT NULL AND pk.user_id IS NOT NULL THEN 1 ELSE 0 END) AS account_enabled
    FROM chat_profiles p JOIN users u ON u.id=p.user_id AND u.disabled_at IS NULL
    LEFT JOIN chat_account_keys k ON k.user_id=p.user_id AND k.status='active'
    LEFT JOIN chat_account_identity_heads h ON h.user_id=k.user_id AND h.key_version=k.key_version
    LEFT JOIN chat_account_vault_versions v ON v.user_id=k.user_id AND v.key_version=k.key_version
    LEFT JOIN chat_passkeys pk ON pk.user_id=v.user_id AND pk.revoked_at IS NULL AND
      (v.credential_id IS NULL OR pk.credential_id=v.credential_id OR EXISTS (SELECT 1 FROM chat_account_vault_wrappers w
        WHERE w.user_id=v.user_id AND w.key_version=v.key_version AND w.credential_id=pk.credential_id))
    WHERE p.chat_user_id=? GROUP BY p.user_id`).bind(chatUserId).first();
  if (!target || target.user_id === userId) throw new AuthError(404, "Chat user not found.", "CHAT_USER_NOT_FOUND");
  if (!target.account_enabled) throw new AuthError(409, "This user must enable secure chat first.", "ACCOUNT_NOT_ENABLED");
  if (!(await directoryAccountEnabled(db, userId))) throw new AuthError(409, "Enable secure chat before adding friends.", "ACCOUNT_NOT_ENABLED");
  const timestamp = nowIso();
  const existing = await db.prepare("SELECT id FROM chat_contacts WHERE user_id=? AND peer_user_id=?").bind(userId, target.user_id).first();
  const contactId = existing?.id || randomId();
  const peer = await db.prepare("SELECT id FROM chat_contacts WHERE user_id=? AND peer_user_id=?").bind(target.user_id, userId).first();
  const peerContactId = peer?.id || randomId();
  await db.batch([
    db.prepare(`INSERT INTO chat_contacts (id,user_id,peer_user_id,created_at,accepted_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,peer_user_id) DO UPDATE SET accepted_at=excluded.accepted_at`).bind(contactId, userId, target.user_id, timestamp, timestamp),
    db.prepare(`INSERT INTO chat_contacts (id,user_id,peer_user_id,created_at,accepted_at) VALUES (?,?,?,?,?)
      ON CONFLICT(user_id,peer_user_id) DO UPDATE SET accepted_at=excluded.accepted_at`).bind(peerContactId, target.user_id, userId, timestamp, timestamp),
  ]);
  return { id: contactId, profile: mapDirectoryProfile(target, contactId) };
}

async function globalReadyAccounts(db, conversationId = null) {
  const rows = await db.prepare(`SELECT k.user_id,k.key_version,k.encryption_public_key,k.signing_public_key,k.fingerprint,
      p.chat_user_id,p.chat_alias,p.avatar_data_url,u.role
    FROM chat_account_keys k
    JOIN chat_account_identity_heads h ON h.user_id=k.user_id AND h.key_version=k.key_version
    JOIN chat_account_vault_versions v ON v.user_id=k.user_id AND v.key_version=k.key_version
    JOIN chat_passkeys pk ON pk.user_id=v.user_id AND pk.revoked_at IS NULL AND
      (v.credential_id IS NULL OR pk.credential_id=v.credential_id OR EXISTS (SELECT 1 FROM chat_account_vault_wrappers w
        WHERE w.user_id=v.user_id AND w.key_version=v.key_version AND w.credential_id=pk.credential_id))
    JOIN users u ON u.id=k.user_id AND u.disabled_at IS NULL
    JOIN chat_profiles p ON p.user_id=k.user_id
    WHERE k.status='active' GROUP BY k.user_id ORDER BY p.chat_user_id`).all();
  const ready = rows.results || [];
  if (!conversationId) return ready;
  const optouts = await db.prepare("SELECT user_id FROM chat_global_optouts WHERE conversation_id=?").bind(conversationId).all();
  const optedOut = new Set((optouts.results || []).map((item) => item.user_id));
  return ready.filter((item) => item.role === "admin" || !optedOut.has(item.user_id));
}

function globalRecipientEnvelope(value, userId, keyVersion) {
  if (!value || value.userId !== userId || value.keyVersion !== keyVersion) {
    throw new AuthError(409, "Refresh the enabled account keys before joining the discussion.", "ACCOUNT_KEY_CHANGED");
  }
  for (const [field, length] of [["ephemeralPublicKey", 32], ["nonce", 12]]) {
    if (!isBase64Url(value[field], 512)) throw new AuthError(400, "The discussion key envelope is invalid.", "INVALID_GLOBAL_ENVELOPE");
    const normalized = value[field].replace(/-/g, "+").replace(/_/g, "/");
    let bytes;
    try { bytes = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4)); } catch (_) { throw new AuthError(400, "The discussion key envelope is invalid.", "INVALID_GLOBAL_ENVELOPE"); }
    if (bytes.length !== length) throw new AuthError(400, "The discussion key envelope is invalid.", "INVALID_GLOBAL_ENVELOPE");
  }
  if (!isBase64Url(value.ciphertext, MAX_CIPHERTEXT_LENGTH)) throw new AuthError(400, "The discussion key envelope is invalid.", "INVALID_GLOBAL_ENVELOPE");
  const cipherNormalized = value.ciphertext.replace(/-/g, "+").replace(/_/g, "/");
  let cipherBytes;
  try { cipherBytes = atob(cipherNormalized + "=".repeat((4 - (cipherNormalized.length % 4)) % 4)); } catch (_) { throw new AuthError(400, "The discussion key envelope is invalid.", "INVALID_GLOBAL_ENVELOPE"); }
  if (cipherBytes.length !== 48) throw new AuthError(400, "The discussion key envelope is invalid.", "INVALID_GLOBAL_ENVELOPE");
  return value;
}

function globalMetadata(value, epoch) {
  if (!value || Number(value.epoch) !== epoch || !Number.isSafeInteger(Number(value.version)) || Number(value.version) < 1
      || !isBase64Url(value.nonce, 512) || !isBase64Url(value.ciphertext, 64 * 1024)) {
    throw new AuthError(400, "Encrypted discussion metadata is invalid.", "INVALID_GLOBAL_METADATA");
  }
  return { ...value, epoch, version: Number(value.version) };
}

async function requireSiteAdmin(db, userId) {
  const row = await db.prepare("SELECT role FROM users WHERE id=? AND disabled_at IS NULL").bind(userId).first();
  if (row?.role !== "admin") throw new AuthError(403, "Only website administrators can manage the discussion.", "FORBIDDEN");
  return row;
}

async function globalDiscussion(db, userId) {
  const ready = await globalReadyAccounts(db);
  const siteRole = (await db.prepare("SELECT role FROM users WHERE id=? AND disabled_at IS NULL").bind(userId).first())?.role || null;
  const siteAdmin = siteRole === "admin";
  const row = await db.prepare("SELECT * FROM chat_conversations WHERE global_slug=? AND deleted_at IS NULL").bind(GLOBAL_DISCUSSION_SLUG).first();
  if (!row) return { conversation: null, conversationId: null, pendingRecipients: siteAdmin ? ready.map((item) => ({ userId: item.user_id, chatUserId: item.chat_user_id, alias: item.chat_alias || "", accountKey: mapAccountKey(item) })) : [], pendingCount: ready.length, needsBootstrap: true, canManage: siteAdmin, siteRole, studentCanLeave: false, adminCanLeave: false };
  const active = await db.prepare("SELECT user_id,role FROM chat_conversation_members WHERE conversation_id=? AND left_at IS NULL").bind(row.id).all();
  const activeIds = new Set((active.results || []).map((item) => item.user_id));
  const activeRoles = new Map((active.results || []).map((item) => [item.user_id, item.role]));
  const epochKeys = await db.prepare("SELECT user_id,key_version FROM chat_epoch_recipients WHERE conversation_id=? AND epoch=?").bind(row.id, row.current_epoch).all();
  const epochKeyVersions = new Map((epochKeys.results || []).map((item) => [item.user_id, item.key_version]));
  const optouts = await db.prepare("SELECT user_id FROM chat_global_optouts WHERE conversation_id=?").bind(row.id).all();
  const optedOut = new Set((optouts.results || []).map((item) => item.user_id));
  const pending = ready.filter((item) => {
    const expectedRole = item.role === "admin" ? (item.user_id === row.created_by ? "owner" : "admin") : "member";
    return (!activeIds.has(item.user_id) || epochKeyVersions.get(item.user_id) !== item.key_version || activeRoles.get(item.user_id) !== expectedRole)
      && (!optedOut.has(item.user_id) || item.role === "admin");
  });
  const self = (active.results || []).find((item) => item.user_id === userId);
  return {
    conversation: self ? { ...(await mapAccountConversation(db, row, userId)), global: true, globalSlug: GLOBAL_DISCUSSION_SLUG } : null,
    conversationId: row.id,
    epoch: Number(row.current_epoch),
    activeMemberCount: activeIds.size,
    pendingRecipients: siteAdmin ? pending.map((item) => ({ userId: item.user_id, chatUserId: item.chat_user_id, alias: item.chat_alias || "", accountKey: mapAccountKey(item) })) : [],
    pendingCount: pending.length,
    needsBootstrap: false,
    optedOut: optedOut.has(userId),
    canManage: siteAdmin,
    siteRole,
    studentCanLeave: Boolean(self && !siteAdmin),
    adminCanLeave: false,
    rotationRequired: Boolean(row.rotation_required),
    global: true,
    globalSlug: GLOBAL_DISCUSSION_SLUG,
  };
}

async function globalEnvelopeRows(db, recipients, readyById) {
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > MAX_GLOBAL_MEMBERS) throw new AuthError(400, "A discussion epoch needs at least one recipient.", "INVALID_GLOBAL_ENVELOPE");
  const seen = new Set();
  const rows = [];
  for (const recipient of recipients) {
    const account = readyById.get(recipient?.userId);
    if (!account || seen.has(recipient.userId)) throw new AuthError(409, "The recipient set is stale. Refresh and retry.", "GLOBAL_RECIPIENT_SET_CHANGED");
    seen.add(recipient.userId);
    globalRecipientEnvelope(recipient, account.user_id, account.key_version);
    rows.push({ account, envelope: recipient });
  }
  if (seen.size !== readyById.size) throw new AuthError(409, "Include every currently enabled secure-chat account in the discussion epoch.", "GLOBAL_RECIPIENT_SET_CHANGED");
  return rows;
}

async function createGlobalDiscussion(db, env, userId, body) {
  await requireSiteAdmin(db, userId);
  const existing = await db.prepare("SELECT id FROM chat_conversations WHERE global_slug=?").bind(GLOBAL_DISCUSSION_SLUG).first();
  if (existing) throw new AuthError(409, "The site discussion already exists. Refresh it before rotating the epoch.", "GLOBAL_DISCUSSION_EXISTS");
  const conversationId = boundedString(body?.conversationId, "conversationId", 100);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId)) throw new AuthError(400, "A UUID v4 conversation ID is required.", "INVALID_CONVERSATION_ID");
  const ready = await globalReadyAccounts(db);
  const readyById = new Map(ready.map((item) => [item.user_id, item]));
  const recipients = await globalEnvelopeRows(db, body?.recipients, readyById);
  if (!recipients.some((item) => item.account.user_id === userId)) throw new AuthError(403, "The creating administrator must be included in the discussion epoch.", "GLOBAL_ADMIN_NOT_INCLUDED");
  const metadata = globalMetadata(body?.metadata, 1);
  const timestamp = nowIso();
  const statements = [db.prepare(`INSERT INTO chat_conversations (id,kind,created_by,retention_seconds,protocol_version,current_epoch,control_revision,rotation_required,global_slug,created_at,updated_at)
    VALUES (?,'group',?,0,'account-v2',1,1,0,?,?,?)`).bind(conversationId, userId, GLOBAL_DISCUSSION_SLUG, timestamp, timestamp)];
  statements.push(db.prepare("INSERT INTO chat_conversation_epochs (conversation_id,epoch,created_by,created_at) VALUES (?,?,?,?)").bind(conversationId, 1, userId, timestamp));
  for (const item of recipients) {
    const role = item.account.role === "admin" ? (item.account.user_id === userId ? "owner" : "admin") : "member";
    statements.push(db.prepare("INSERT INTO chat_conversation_members (conversation_id,user_id,role,joined_at) VALUES (?,?,?,?)").bind(conversationId, item.account.user_id, role, timestamp));
    statements.push(db.prepare(`INSERT INTO chat_account_atomic_guards (id,valid) VALUES (?,CASE WHEN EXISTS
      (SELECT 1 FROM chat_account_keys k JOIN chat_account_identity_heads h ON h.user_id=k.user_id AND h.key_version=k.key_version
       JOIN chat_account_vault_versions v ON v.user_id=k.user_id AND v.key_version=k.key_version
       JOIN chat_passkeys pk ON pk.user_id=v.user_id AND pk.revoked_at IS NULL AND
         (v.credential_id IS NULL OR pk.credential_id=v.credential_id OR EXISTS (SELECT 1 FROM chat_account_vault_wrappers w
           WHERE w.user_id=v.user_id AND w.key_version=v.key_version AND w.credential_id=pk.credential_id))
       WHERE k.user_id=? AND k.key_version=? AND k.status='active') THEN 1 ELSE 0 END)`).bind(randomId(), item.account.user_id, item.account.key_version));
    statements.push(db.prepare("INSERT INTO chat_epoch_recipients (conversation_id,epoch,user_id,key_version,ephemeral_public_key,nonce,envelope_ciphertext,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(conversationId, 1, item.account.user_id, item.account.key_version, item.envelope.ephemeralPublicKey, item.envelope.nonce, item.envelope.ciphertext, timestamp));
  }
  statements.push(db.prepare("INSERT INTO chat_group_metadata (conversation_id,epoch,version,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?)").bind(conversationId, 1, metadata.version, metadata.nonce, metadata.ciphertext, timestamp));
  statements.push(db.prepare("INSERT INTO chat_sync_events (conversation_id,event_type,entity_id,content_epoch,created_at) VALUES (?,?,?,?,?)").bind(conversationId, "global-created", conversationId, 1, timestamp));
  statements.push(db.prepare("DELETE FROM chat_account_atomic_guards"));
  try { await db.batch(statements); } catch (error) {
    if (/CHECK constraint failed|UNIQUE constraint failed/.test(String(error?.message || error))) throw new AuthError(409, "Account keys changed during discussion setup. Refresh and retry.", "GLOBAL_RECIPIENT_SET_CHANGED");
    throw error;
  }
  const row = await db.prepare("SELECT * FROM chat_conversations WHERE id=?").bind(conversationId).first();
  return globalDiscussion(db, userId).then((result) => ({ ...result, conversation: row ? result.conversation : null }));
}

async function rotateGlobalDiscussion(db, userId, body) {
  await requireSiteAdmin(db, userId);
  const conversationId = boundedString(body?.conversationId, "conversationId", 100);
  const conversation = await db.prepare("SELECT * FROM chat_conversations WHERE id=? AND global_slug=? AND deleted_at IS NULL").bind(conversationId, GLOBAL_DISCUSSION_SLUG).first();
  if (!conversation) throw new AuthError(404, "Site discussion not found.", "GLOBAL_DISCUSSION_NOT_FOUND");
  const expectedEpoch = Number(body?.expectedEpoch);
  const epoch = Number(body?.epoch);
  if (!Number.isSafeInteger(expectedEpoch) || expectedEpoch !== Number(conversation.current_epoch) || epoch !== expectedEpoch + 1) throw new AuthError(409, "The discussion epoch changed. Refresh and retry.", "EPOCH_CONFLICT");
  const ready = await globalReadyAccounts(db, conversationId);
  const readyById = new Map(ready.map((item) => [item.user_id, item]));
  const recipients = await globalEnvelopeRows(db, body?.recipients, readyById);
  if (!recipients.some((item) => item.account.user_id === userId)) throw new AuthError(403, "The managing administrator must be included in the discussion epoch.", "GLOBAL_ADMIN_NOT_INCLUDED");
  const metadata = globalMetadata(body?.metadata, epoch);
  const timestamp = nowIso();
  const active = await db.prepare("SELECT user_id FROM chat_conversation_members WHERE conversation_id=? AND left_at IS NULL").bind(conversationId).all();
  const desired = new Set(recipients.map((item) => item.account.user_id));
  const statements = [db.prepare(`INSERT INTO chat_account_atomic_guards (id,valid) VALUES (?,CASE WHEN EXISTS
    (SELECT 1 FROM chat_conversations WHERE id=? AND current_epoch=? AND control_revision=? AND deleted_at IS NULL) THEN 1 ELSE 0 END)`).bind(randomId(), conversationId, expectedEpoch, conversation.control_revision)];
  for (const member of active.results || []) if (!desired.has(member.user_id)) statements.push(db.prepare("UPDATE chat_conversation_members SET left_at=? WHERE conversation_id=? AND user_id=? AND left_at IS NULL").bind(timestamp, conversationId, member.user_id));
  statements.push(db.prepare("INSERT INTO chat_conversation_epochs (conversation_id,epoch,created_by,created_at) VALUES (?,?,?,?)").bind(conversationId, epoch, userId, timestamp));
  for (const item of recipients) {
    const role = item.account.role === "admin" ? (item.account.user_id === conversation.created_by ? "owner" : "admin") : "member";
    statements.push(db.prepare(`INSERT INTO chat_conversation_members (conversation_id,user_id,role,joined_at,left_at) VALUES (?,?,?,?,NULL)
      ON CONFLICT(conversation_id,user_id) DO UPDATE SET role=excluded.role,left_at=NULL`).bind(conversationId, item.account.user_id, role, timestamp));
    statements.push(db.prepare(`INSERT INTO chat_account_atomic_guards (id,valid) VALUES (?,CASE WHEN EXISTS
      (SELECT 1 FROM chat_account_keys k JOIN chat_account_identity_heads h ON h.user_id=k.user_id AND h.key_version=k.key_version
       JOIN chat_account_vault_versions v ON v.user_id=k.user_id AND v.key_version=k.key_version
       JOIN chat_passkeys pk ON pk.user_id=v.user_id AND pk.revoked_at IS NULL AND
         (v.credential_id IS NULL OR pk.credential_id=v.credential_id OR EXISTS (SELECT 1 FROM chat_account_vault_wrappers w
           WHERE w.user_id=v.user_id AND w.key_version=v.key_version AND w.credential_id=pk.credential_id))
       WHERE k.user_id=? AND k.key_version=? AND k.status='active') THEN 1 ELSE 0 END)`).bind(randomId(), item.account.user_id, item.account.key_version));
    statements.push(db.prepare("INSERT INTO chat_epoch_recipients (conversation_id,epoch,user_id,key_version,ephemeral_public_key,nonce,envelope_ciphertext,created_at) VALUES (?,?,?,?,?,?,?,?)").bind(conversationId, epoch, item.account.user_id, item.account.key_version, item.envelope.ephemeralPublicKey, item.envelope.nonce, item.envelope.ciphertext, timestamp));
  }
  statements.push(db.prepare("UPDATE chat_group_metadata SET epoch=?,version=?,nonce=?,ciphertext=?,updated_at=? WHERE conversation_id=?").bind(epoch, metadata.version, metadata.nonce, metadata.ciphertext, timestamp, conversationId));
  statements.push(db.prepare("UPDATE chat_conversations SET current_epoch=?,rotation_required=0,control_revision=control_revision+1,updated_at=? WHERE id=?").bind(epoch, timestamp, conversationId));
  statements.push(db.prepare("INSERT INTO chat_sync_events (conversation_id,event_type,entity_id,content_epoch,created_at) VALUES (?,?,?,?,?)").bind(conversationId, "global-epoch", String(epoch), epoch, timestamp));
  statements.push(db.prepare("DELETE FROM chat_account_atomic_guards"));
  try { await db.batch(statements); } catch (error) { if (/CHECK constraint failed|UNIQUE constraint failed/.test(String(error?.message || error))) throw new AuthError(409, "The discussion changed. Refresh and retry.", "EPOCH_CONFLICT"); throw error; }
  return globalDiscussion(db, userId);
}

async function leaveGlobalDiscussion(db, userId) {
  const conversation = await db.prepare("SELECT * FROM chat_conversations WHERE global_slug=? AND deleted_at IS NULL").bind(GLOBAL_DISCUSSION_SLUG).first();
  if (!conversation) throw new AuthError(404, "Site discussion not found.", "GLOBAL_DISCUSSION_NOT_FOUND");
  const siteRole = (await db.prepare("SELECT role FROM users WHERE id=?").bind(userId).first())?.role;
  if (siteRole === "admin") throw new AuthError(403, "Website administrators cannot leave the discussion.", "ADMIN_CANNOT_LEAVE_GLOBAL_DISCUSSION");
  const membership = await db.prepare("SELECT role,left_at FROM chat_conversation_members WHERE conversation_id=? AND user_id=?").bind(conversation.id, userId).first();
  if (membership?.role === "admin" || membership?.role === "owner") throw new AuthError(403, "Administrators cannot leave the discussion.", "ADMIN_CANNOT_LEAVE_GLOBAL_DISCUSSION");
  if (!membership || membership.left_at !== null) throw new AuthError(409, "You are not an active member of the discussion.", "NOT_GLOBAL_DISCUSSION_MEMBER");
  const timestamp = nowIso();
  try {
    await db.batch([
      db.prepare(`INSERT INTO chat_account_atomic_guards (id,valid) VALUES (?,CASE WHEN EXISTS
        (SELECT 1 FROM chat_conversation_members WHERE conversation_id=? AND user_id=? AND left_at IS NULL) THEN 1 ELSE 0 END)`).bind(randomId(), conversation.id, userId),
      db.prepare(`INSERT INTO chat_account_atomic_guards (id,valid) VALUES (?,CASE WHEN EXISTS
        (SELECT 1 FROM chat_conversations WHERE id=? AND current_epoch=? AND control_revision=? AND deleted_at IS NULL) THEN 1 ELSE 0 END)`).bind(randomId(), conversation.id, conversation.current_epoch, conversation.control_revision),
      db.prepare("INSERT INTO chat_global_optouts (conversation_id,user_id,left_at) VALUES (?,?,?) ON CONFLICT(conversation_id,user_id) DO UPDATE SET left_at=excluded.left_at").bind(conversation.id, userId, timestamp),
      db.prepare("UPDATE chat_conversation_members SET left_at=? WHERE conversation_id=? AND user_id=? AND left_at IS NULL").bind(timestamp, conversation.id, userId),
      db.prepare("UPDATE chat_conversations SET rotation_required=1,control_revision=control_revision+1,updated_at=? WHERE id=?").bind(timestamp, conversation.id),
      db.prepare("INSERT INTO chat_sync_events (conversation_id,event_type,entity_id,content_epoch,created_at) VALUES (?,?,?,?,?)").bind(conversation.id, "global-member-left", userId, conversation.current_epoch, timestamp),
      db.prepare("DELETE FROM chat_account_atomic_guards"),
    ]);
  } catch (error) {
    if (/CHECK constraint failed|UNIQUE constraint failed/.test(String(error?.message || error))) throw new AuthError(409, "The discussion membership changed. Refresh and retry.", "GLOBAL_MEMBERSHIP_CHANGED");
    throw error;
  }
  return { left: true, conversationId: conversation.id, requiresEpochRotation: true };
}

async function listDevices(db, userId) {
  const rows = await db
    .prepare(
      `
    SELECT id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
      signed_prekey_public, signed_prekey_signature, revoked_at, created_at, updated_at,
      (SELECT COUNT(*) FROM chat_device_prekeys p WHERE p.device_id = chat_devices.id AND p.consumed_at IS NULL)
        AS one_time_prekey_count
    FROM chat_devices WHERE user_id = ? ORDER BY created_at ASC
  `
    )
    .bind(userId)
    .all();
  return (rows.results || []).map(mapDevice);
}

async function refillDevicePrekeys(db, userId, deviceId, body) {
  await requireOwnedDevice(db, deviceId, userId);
  const preKeys = Array.isArray(body?.oneTimePreKeys) ? body.oneTimePreKeys : [];
  if (!preKeys.length || preKeys.length > 100) {
    throw new AuthError(
      400,
      "Provide between 1 and 100 one-time pre-keys.",
      "INVALID_PREKEY_BATCH"
    );
  }
  const timestamp = nowIso();
  const statements = [];
  for (const item of preKeys) {
    const keyId = Number(item?.id);
    const publicKey = typeof item?.publicKey === "string" ? item.publicKey.trim() : "";
    if (!Number.isInteger(keyId) || keyId < 1 || !isBase64Url(publicKey, 1024)) {
      throw new AuthError(400, "One-time pre-key values are invalid.", "INVALID_DEVICE_KEYS");
    }
    statements.push(
      db
        .prepare(
          `
      INSERT INTO chat_device_prekeys (id, device_id, key_id, public_key, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(device_id, key_id) DO NOTHING
    `
        )
        .bind(randomId(), deviceId, keyId, publicKey, timestamp)
    );
  }
  await db.batch(statements);
  const row = await db
    .prepare(
      `
    SELECT COUNT(*) AS count FROM chat_device_prekeys
    WHERE device_id = ? AND consumed_at IS NULL
  `
    )
    .bind(deviceId)
    .first();
  return { deviceId, oneTimePreKeyCount: Number(row?.count || 0) };
}

async function registerDevice(db, userId, body) {
  const identityPublicKey = boundedString(body.identityPublicKey, "identityPublicKey", 1024);
  const signedPreKey = body.signedPreKey || {};
  const signedPreKeyPublic = boundedString(signedPreKey.publicKey, "signedPreKey.publicKey", 1024);
  const signedPreKeySignature = boundedString(
    signedPreKey.signature,
    "signedPreKey.signature",
    2048
  );
  if (
    !isBase64Url(identityPublicKey, 1024) ||
    !isBase64Url(signedPreKeyPublic, 1024) ||
    !isBase64Url(signedPreKeySignature, 2048)
  ) {
    throw new AuthError(400, "Device keys must be base64url values.", "INVALID_DEVICE_KEYS");
  }
  const registrationId = Number(body.registrationId);
  const signedPreKeyId = Number(signedPreKey.id);
  if (
    !Number.isInteger(registrationId) ||
    registrationId < 1 ||
    registrationId > 0x3fff ||
    !Number.isInteger(signedPreKeyId) ||
    signedPreKeyId < 1
  ) {
    throw new AuthError(400, "Device registration identifiers are invalid.", "INVALID_DEVICE_KEYS");
  }
  const preKeys = Array.isArray(body.oneTimePreKeys) ? body.oneTimePreKeys : [];
  if (preKeys.length > 100)
    throw new AuthError(413, "Too many one-time pre-keys.", "PAYLOAD_TOO_LARGE");
  const timestamp = nowIso();
  const activeCount = await db
    .prepare("SELECT COUNT(*) AS count FROM chat_devices WHERE user_id = ? AND revoked_at IS NULL")
    .bind(userId)
    .first();
  if (Number(activeCount?.count || 0) >= 3) {
    throw new AuthError(409, "Each account can have at most three active devices.", "DEVICE_LIMIT");
  }
  if (Number(activeCount?.count || 0) > 0) {
    const approvalToken = typeof body.approvalToken === "string" ? body.approvalToken.trim() : "";
    if (!approvalToken)
      throw new AuthError(
        403,
        "A trusted device must approve this new device.",
        "DEVICE_APPROVAL_REQUIRED"
      );
    const tokenHash = await sha256Base64Url(approvalToken);
    const approval = await db
      .prepare(
        `
      SELECT id FROM chat_device_approval_tickets
      WHERE token_hash = ? AND user_id = ? AND used_at IS NULL AND expires_at > ?
    `
      )
      .bind(tokenHash, userId, nowIso())
      .first();
    if (!approval)
      throw new AuthError(
        403,
        "The device approval token is invalid or expired.",
        "DEVICE_APPROVAL_INVALID"
      );
    const consumed = await db
      .prepare(
        "UPDATE chat_device_approval_tickets SET used_at = ? WHERE id = ? AND used_at IS NULL"
      )
      .bind(nowIso(), approval.id)
      .run();
    if (Number(consumed?.meta?.changes ?? consumed?.changes ?? 0) !== 1)
      throw new AuthError(
        403,
        "The device approval token is invalid or expired.",
        "DEVICE_APPROVAL_INVALID"
      );
  }
  const requestedDeviceId =
    typeof body.deviceId === "string" &&
    body.deviceId.length <= 100 &&
    /^[A-Za-z0-9_-]+$/.test(body.deviceId)
      ? body.deviceId
      : "";
  const deviceId = requestedDeviceId || randomId();
  if (requestedDeviceId) {
    const existingDevice = await db
      .prepare("SELECT id FROM chat_devices WHERE id = ? AND user_id = ?")
      .bind(deviceId, userId)
      .first();
    if (existingDevice)
      throw new AuthError(
        409,
        "This browser device is already registered.",
        "DEVICE_ALREADY_REGISTERED"
      );
  }
  const deviceNumber = randomDeviceNumber();
  const label = typeof body.label === "string" ? body.label.trim().slice(0, 80) : "";
  const statements = [
    db
      .prepare(
        `
    INSERT INTO chat_devices
      (id, user_id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
       signed_prekey_public, signed_prekey_signature, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
      )
      .bind(
        deviceId,
        userId,
        label,
        identityPublicKey,
        deviceNumber,
        registrationId,
        signedPreKeyId,
        signedPreKeyPublic,
        signedPreKeySignature,
        timestamp,
        timestamp
      ),
  ];
  for (const item of preKeys) {
    const keyId = Number(item?.id);
    const publicKey = typeof item?.publicKey === "string" ? item.publicKey.trim() : "";
    if (!Number.isInteger(keyId) || keyId < 1 || !isBase64Url(publicKey, 1024)) {
      throw new AuthError(400, "One-time pre-key values are invalid.", "INVALID_DEVICE_KEYS");
    }
    statements.push(
      db
        .prepare(
          `
      INSERT INTO chat_device_prekeys (id, device_id, key_id, public_key, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
        )
        .bind(randomId(), deviceId, keyId, publicKey, timestamp)
    );
  }
  await db.batch(statements);
  const profile = await ensureProfile(
    db,
    userId,
    typeof body.identityFingerprint === "string"
      ? body.identityFingerprint.trim().slice(0, 128)
      : ""
  );
  return {
    device: mapDevice(await requireOwnedDevice(db, deviceId, userId)),
    profile: mapProfile(profile),
  };
}

async function createDeviceApprovalTicket(db, userId, deviceId) {
  await requireOwnedDevice(db, deviceId, userId);
  const token = bytesToBase64Url(randomBytes(32));
  const timestamp = Date.now();
  const expiresAt = new Date(timestamp + 5 * 60 * 1000).toISOString();
  try {
    await db
    .prepare(
      `
    INSERT INTO chat_device_approval_tickets (id, token_hash, user_id, issuer_device_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `
    )
    .bind(
      randomId(),
      await sha256Base64Url(token),
      userId,
      deviceId,
      expiresAt,
      new Date(timestamp).toISOString()
    )
    .run();
  } catch (error) {
    if (!String(error?.message || error).includes("no column named credential_id")) throw error;
    await db.prepare("INSERT INTO chat_account_write_proofs (id,token_hash,user_id,uses_remaining,expires_at,created_at) VALUES (?,?,?,?,?,?)")
      .bind(randomId(), await sha256Base64Url(token), userId, 5, expiresAt, new Date(timestamp).toISOString()).run();
  }
  return { token, expiresAt };
}

async function restoreKeyBackup(db, env, userId, body) {
  ensureRecoveryEnabled(env);
  const operationId = boundedString(body.restoreOperationId, "restoreOperationId", 100);
  const sourceDeviceId = boundedString(body.sourceDeviceId, "sourceDeviceId", 100);
  const requestedDeviceId =
    typeof body.deviceId === "string" &&
    body.deviceId.length <= 100 &&
    /^[A-Za-z0-9_-]+$/.test(body.deviceId)
      ? body.deviceId
      : "";
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(operationId)) {
    throw new AuthError(
      400,
      "The restore operation identifier is invalid.",
      "INVALID_RESTORE_OPERATION"
    );
  }
  const identityPublicKey = boundedString(body.identityPublicKey, "identityPublicKey", 1024);
  const signedPreKey = body.signedPreKey || {};
  const signedPreKeyPublic = boundedString(signedPreKey.publicKey, "signedPreKey.publicKey", 1024);
  const signedPreKeySignature = boundedString(
    signedPreKey.signature,
    "signedPreKey.signature",
    2048
  );
  const registrationId = Number(body.registrationId);
  const signedPreKeyId = Number(signedPreKey.id);
  const preKeys = Array.isArray(body.oneTimePreKeys) ? body.oneTimePreKeys : [];
  const existingOperation = await db
    .prepare(
      `
    SELECT restored_device_id FROM chat_key_backups
    WHERE user_id = ? AND restore_operation_id = ?
  `
    )
    .bind(userId, operationId)
    .first();
  if (existingOperation?.restored_device_id) {
    const restored = await db
      .prepare(
        `
      SELECT d.id, d.label, d.identity_public_key, d.device_number, d.registration_id,
        d.signed_prekey_id, d.signed_prekey_public, d.signed_prekey_signature,
        d.revoked_at, d.created_at, d.updated_at,
        (SELECT COUNT(*) FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL)
          AS one_time_prekey_count
      FROM chat_devices d WHERE d.id = ? AND d.user_id = ?
    `
      )
      .bind(existingOperation.restored_device_id, userId)
      .first();
    if (restored) return { restored: true, idempotent: true, device: mapDevice(restored) };
  }
  if (
    !isBase64Url(identityPublicKey, 1024) ||
    !isBase64Url(signedPreKeyPublic, 1024) ||
    !isBase64Url(signedPreKeySignature, 2048) ||
    !Number.isInteger(registrationId) ||
    registrationId < 1 ||
    registrationId > 0x3fff ||
    !Number.isInteger(signedPreKeyId) ||
    signedPreKeyId < 1 ||
    preKeys.length < 1 ||
    preKeys.length > 100
  ) {
    throw new AuthError(400, "The restored device bundle is invalid.", "INVALID_RESTORE_BUNDLE");
  }
  const backup = await db
    .prepare(
      `
    SELECT source_device_id, consumed_at FROM chat_key_backups
    WHERE user_id = ? AND source_device_id = ?
  `
    )
    .bind(userId, sourceDeviceId)
    .first();
  if (!backup) {
    throw new AuthError(
      404,
      "Encrypted recovery backup not found for this device.",
      "BACKUP_NOT_FOUND"
    );
  }
  if (backup.consumed_at)
    throw new AuthError(
      409,
      "This recovery backup has already been consumed.",
      "BACKUP_ALREADY_USED"
    );
  const source = await requireOwnedDevice(db, sourceDeviceId, userId);
  const activeCount = await db
    .prepare("SELECT COUNT(*) AS count FROM chat_devices WHERE user_id = ? AND revoked_at IS NULL")
    .bind(userId)
    .first();
  if (Number(activeCount?.count || 0) > 3)
    throw new AuthError(409, "Too many active devices for recovery.", "DEVICE_LIMIT");
  const timestamp = nowIso();
  const newDeviceId = requestedDeviceId || randomId();
  const existingDevice = await db
    .prepare("SELECT id FROM chat_devices WHERE id = ?")
    .bind(newDeviceId)
    .first();
  if (existingDevice)
    throw new AuthError(
      409,
      "The restored device identifier is already in use.",
      "DEVICE_ALREADY_REGISTERED"
    );
  const deviceNumber = randomDeviceNumber();
  const statements = [
    db
      .prepare(
        "UPDATE chat_devices SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL"
      )
      .bind(timestamp, timestamp, sourceDeviceId, userId),
    db
      .prepare(
        `
      INSERT INTO chat_devices
        (id, user_id, label, identity_public_key, device_number, registration_id, signed_prekey_id,
         signed_prekey_public, signed_prekey_signature, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        newDeviceId,
        userId,
        boundedString(body.label || "Restored browser", "label", 80),
        identityPublicKey,
        deviceNumber,
        registrationId,
        signedPreKeyId,
        signedPreKeyPublic,
        signedPreKeySignature,
        timestamp,
        timestamp
      ),
    db
      .prepare(
        `
      UPDATE chat_key_backups SET restore_operation_id = ?, restored_device_id = ?, consumed_at = ?, updated_at = ?
      WHERE user_id = ? AND source_device_id = ? AND consumed_at IS NULL
    `
      )
      .bind(operationId, newDeviceId, timestamp, timestamp, userId, sourceDeviceId),
  ];
  for (const item of preKeys) {
    const keyId = Number(item?.id);
    const publicKey = typeof item?.publicKey === "string" ? item.publicKey.trim() : "";
    if (!Number.isInteger(keyId) || keyId < 1 || !isBase64Url(publicKey, 1024)) {
      throw new AuthError(400, "One-time pre-key values are invalid.", "INVALID_RESTORE_BUNDLE");
    }
    statements.push(
      db
        .prepare(
          `
      INSERT INTO chat_device_prekeys (id, device_id, key_id, public_key, created_at)
      VALUES (?, ?, ?, ?, ?)
    `
        )
        .bind(randomId(), newDeviceId, keyId, publicKey, timestamp)
    );
  }
  const results = await db.batch(statements);
  if (
    Number(results[0]?.meta?.changes ?? results[0]?.changes ?? 0) !== 1 ||
    Number(results[2]?.meta?.changes ?? results[2]?.changes ?? 0) !== 1
  ) {
    throw new AuthError(409, "The recovery backup is no longer available.", "BACKUP_ALREADY_USED");
  }
  const restored = await db
    .prepare(
      `
    SELECT d.id, d.label, d.identity_public_key, d.device_number, d.registration_id,
      d.signed_prekey_id, d.signed_prekey_public, d.signed_prekey_signature,
      d.revoked_at, d.created_at, d.updated_at,
      (SELECT COUNT(*) FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL)
        AS one_time_prekey_count
    FROM chat_devices d WHERE d.id = ? AND d.user_id = ?
  `
    )
    .bind(newDeviceId, userId)
    .first();
  return {
    restored: true,
    idempotent: false,
    previousDeviceId: source.id,
    device: mapDevice(restored),
  };
}

async function getPrekeyBundle(db, contactId, userId) {
  const contact = await requireContact(db, contactId, userId);
  const devices = await db
    .prepare(
      `
    SELECT d.id, d.device_number, d.identity_public_key, d.registration_id, d.signed_prekey_id,
      d.signed_prekey_public, d.signed_prekey_signature,
      (SELECT p.key_id FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_id,
      (SELECT p.public_key FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_public
    FROM chat_devices d WHERE d.user_id = ? AND d.revoked_at IS NULL
  `
    )
    .bind(contact.peer_user_id)
    .all();
  const timestamp = nowIso();
  const bundle = [];
  for (const row of devices.results || []) {
    if (row.one_time_prekey_id != null) {
      await db
        .prepare(
          "UPDATE chat_device_prekeys SET consumed_at = ? WHERE device_id = ? AND key_id = ? AND consumed_at IS NULL"
        )
        .bind(timestamp, row.id, row.one_time_prekey_id)
        .run();
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
      oneTimePreKey:
        row.one_time_prekey_id == null
          ? null
          : {
              keyId: row.one_time_prekey_id,
              publicKey: row.one_time_prekey_public,
            },
    });
  }
  return {
    contactId,
    profile: {
      alias: contact.chat_alias || "Paired contact",
      avatarDataUrl: contact.avatar_data_url || "",
      identityFingerprint: contact.identity_fingerprint || null,
      profileCiphertext: contact.profile_ciphertext || "",
    },
    devices: bundle,
  };
}

async function getOwnPrekeyBundle(db, userId, excludeDeviceId = "") {
  const devices = await db
    .prepare(
      `
    SELECT d.id, d.device_number, d.identity_public_key, d.registration_id, d.signed_prekey_id,
      d.signed_prekey_public, d.signed_prekey_signature,
      (SELECT p.key_id FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_id,
      (SELECT p.public_key FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
       ORDER BY p.created_at LIMIT 1) AS one_time_prekey_public
    FROM chat_devices d WHERE d.user_id = ? AND d.revoked_at IS NULL AND d.id <> ?
  `
    )
    .bind(userId, excludeDeviceId)
    .all();
  const timestamp = nowIso();
  const bundle = [];
  for (const row of devices.results || []) {
    if (row.one_time_prekey_id != null) {
      await db
        .prepare(
          "UPDATE chat_device_prekeys SET consumed_at = ? WHERE device_id = ? AND key_id = ? AND consumed_at IS NULL"
        )
        .bind(timestamp, row.id, row.one_time_prekey_id)
        .run();
    }
    bundle.push({
      deviceId: row.id,
      deviceNumber: row.device_number,
      identityKey: row.identity_public_key,
      registrationId: row.registration_id,
      signedPreKey: {
        keyId: row.signed_prekey_id,
        publicKey: row.signed_prekey_public,
        signature: row.signed_prekey_signature,
      },
      oneTimePreKey:
        row.one_time_prekey_id == null
          ? null
          : { keyId: row.one_time_prekey_id, publicKey: row.one_time_prekey_public },
    });
  }
  return { devices: bundle };
}

async function getConversationPrekeyBundle(db, conversationId, userId) {
  await requireConversationMember(db, conversationId, userId);
  const members = await db
    .prepare(
      `
    SELECT m.user_id, p.chat_alias, p.avatar_data_url
    FROM chat_conversation_members m
    LEFT JOIN chat_profiles p ON p.user_id = m.user_id
    WHERE m.conversation_id = ? AND m.user_id <> ? AND m.left_at IS NULL
    ORDER BY m.joined_at, m.user_id
  `
    )
    .bind(conversationId, userId)
    .all();
  const result = [];
  const timestamp = nowIso();
  for (const member of members.results || []) {
    const devices = await db
      .prepare(
        `
      SELECT d.id, d.device_number, d.identity_public_key, d.registration_id,
        d.signed_prekey_id, d.signed_prekey_public, d.signed_prekey_signature,
        (SELECT p.key_id FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
         ORDER BY p.created_at LIMIT 1) AS one_time_prekey_id,
        (SELECT p.public_key FROM chat_device_prekeys p WHERE p.device_id = d.id AND p.consumed_at IS NULL
         ORDER BY p.created_at LIMIT 1) AS one_time_prekey_public
      FROM chat_devices d WHERE d.user_id = ? AND d.revoked_at IS NULL
    `
      )
      .bind(member.user_id)
      .all();
    const deviceBundle = [];
    for (const row of devices.results || []) {
      if (row.one_time_prekey_id != null) {
        await db
          .prepare(
            "UPDATE chat_device_prekeys SET consumed_at = ? WHERE device_id = ? AND key_id = ? AND consumed_at IS NULL"
          )
          .bind(timestamp, row.id, row.one_time_prekey_id)
          .run();
      }
      deviceBundle.push({
        deviceId: row.id,
        deviceNumber: row.device_number,
        identityKey: row.identity_public_key,
        registrationId: row.registration_id,
        signedPreKey: {
          keyId: row.signed_prekey_id,
          publicKey: row.signed_prekey_public,
          signature: row.signed_prekey_signature,
        },
        oneTimePreKey:
          row.one_time_prekey_id == null
            ? null
            : { keyId: row.one_time_prekey_id, publicKey: row.one_time_prekey_public },
      });
    }
    result.push({
      userId: member.user_id,
      alias: member.chat_alias || "Paired contact",
      avatarDataUrl: member.avatar_data_url || "",
      devices: deviceBundle,
    });
  }
  return { conversationId, members: result };
}

function base64UrlToBytes(value, field = "value") {
  if (!isBase64Url(value, 2 * 1024 * 1024)) {
    throw new AuthError(400, `${field} is invalid.`, "INVALID_ACCOUNT_V2_MESSAGE");
  }
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function accountCanonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AuthError(400, "The signed account payload is invalid.", "INVALID_ACCOUNT_V2_MESSAGE");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => accountCanonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${accountCanonicalJson(value[key])}`).join(",")}}`;
  }
  throw new AuthError(400, "The signed account payload is invalid.", "INVALID_ACCOUNT_V2_MESSAGE");
}

function accountV2SignedMessage(body, userId, attachmentRefs) {
  return {
    version: "account-v2",
    conversationId: boundedString(body.conversationId, "conversationId", 100),
    clientMessageId: boundedString(body.clientMessageId, "clientMessageId", 160),
    epoch: Number(body.contentEpoch),
    senderUserId: userId,
    senderKeyId: boundedString(body.senderKeyId, "senderKeyId", 64),
    nonce: boundedString(body.nonce, "nonce", 256),
    ciphertext: boundedString(body.ciphertext, "ciphertext", MAX_CIPHERTEXT_LENGTH),
    attachmentRefs,
  };
}

async function verifyAccountV2MessageSignature(db, userId, body, attachmentRefs) {
  const signed = accountV2SignedMessage(body, userId, attachmentRefs);
  if (!Number.isInteger(signed.epoch) || signed.epoch < 1 || !isBase64Url(signed.nonce, 256)) {
    throw new AuthError(400, "Account-v2 message metadata is invalid.", "INVALID_ACCOUNT_V2_MESSAGE");
  }
  const key = await db
    .prepare(`SELECT signing_public_key FROM chat_account_keys
      WHERE user_id = ? AND key_version = ? AND status = 'active'`)
    .bind(userId, signed.senderKeyId)
    .first();
  if (!key) throw new AuthError(409, "Your account key changed. Unlock with the current Passkey before sending.", "ACCOUNT_KEY_CHANGED");
  let valid = false;
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      base64UrlToBytes(key.signing_public_key, "signingPublicKey"),
      { name: "Ed25519" },
      false,
      ["verify"]
    );
    valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      base64UrlToBytes(boundedString(body.signature, "signature", 1024), "signature"),
      encoder.encode(accountCanonicalJson(signed))
    );
  } catch (_error) {
    throw new AuthError(400, "The account-v2 signature is invalid.", "INVALID_ACCOUNT_V2_SIGNATURE");
  }
  if (!valid) throw new AuthError(400, "The account-v2 signature is invalid.", "INVALID_ACCOUNT_V2_SIGNATURE");
  return signed;
}

async function syncMessages(db, userId, url) {
  const conversationId = boundedString(
    url.searchParams.get("conversationId"),
    "conversationId",
    100
  );
  await requireConversationMember(db, conversationId, userId);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
  const rows = cursor
    ? await db
        .prepare(
          `
      SELECT m.id, m.conversation_id, m.sender_device_id, m.sender_user_id, m.sender_key_id,
        d.device_number AS sender_device_number, p.chat_alias AS sender_alias, p.avatar_data_url AS sender_avatar_data_url,
        ak.signing_public_key AS sender_signing_public_key,
        m.client_message_id, m.protocol_version, m.content_epoch, m.nonce, m.signature,
        m.ciphertext, m.attachment_refs, m.size_bucket,
        m.created_at, m.expires_at, m.deleted_at
      FROM chat_messages m LEFT JOIN chat_devices d ON d.id = m.sender_device_id
        LEFT JOIN chat_profiles p ON p.user_id = COALESCE(m.sender_user_id, d.user_id)
        LEFT JOIN chat_account_keys ak ON ak.user_id = m.sender_user_id AND ak.key_version = m.sender_key_id
      WHERE m.conversation_id = ? AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
      ORDER BY m.created_at ASC, m.id ASC LIMIT ?
    `
        )
        .bind(conversationId, cursor.createdAt, cursor.createdAt, cursor.id, limit)
        .all()
    : await db
        .prepare(
          `
      SELECT m.id, m.conversation_id, m.sender_device_id, m.sender_user_id, m.sender_key_id,
        d.device_number AS sender_device_number, p.chat_alias AS sender_alias, p.avatar_data_url AS sender_avatar_data_url,
        ak.signing_public_key AS sender_signing_public_key,
        m.client_message_id, m.protocol_version, m.content_epoch, m.nonce, m.signature,
        m.ciphertext, m.attachment_refs, m.size_bucket,
        m.created_at, m.expires_at, m.deleted_at
      FROM chat_messages m LEFT JOIN chat_devices d ON d.id = m.sender_device_id
        LEFT JOIN chat_profiles p ON p.user_id = COALESCE(m.sender_user_id, d.user_id)
        LEFT JOIN chat_account_keys ak ON ak.user_id = m.sender_user_id AND ak.key_version = m.sender_key_id
      WHERE m.conversation_id = ? ORDER BY m.created_at ASC, m.id ASC LIMIT ?
    `
        )
        .bind(conversationId, limit)
        .all();
  const messages = (rows.results || []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderDeviceId: row.sender_device_id,
    senderUserId: row.sender_user_id || null,
    senderKeyId: row.sender_key_id || null,
    senderDeviceNumber: row.sender_device_number,
    senderAlias: row.sender_alias || "Paired contact",
    senderAvatarDataUrl: row.sender_avatar_data_url || "",
    senderSigningPublicKey: row.sender_signing_public_key || null,
    clientMessageId: row.client_message_id,
    protocolVersion: row.protocol_version,
    contentEpoch: row.content_epoch == null ? null : Number(row.content_epoch),
    nonce: row.deleted_at ? null : row.nonce,
    signature: row.deleted_at ? null : row.signature,
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
  const protocolVersion =
    typeof body.protocolVersion === "string" && body.protocolVersion.trim()
      ? body.protocolVersion.trim().slice(0, 40)
      : "signal-v1";
  const device =
    protocolVersion === "account-v2"
      ? null
      : await requireOwnedDevice(
          db,
          boundedString(body.senderDeviceId, "senderDeviceId", 100),
          userId
        );
  const clientMessageId = boundedString(body.clientMessageId, "clientMessageId", 160);
  const ciphertext = boundedString(body.ciphertext, "ciphertext", MAX_CIPHERTEXT_LENGTH);
  if (!isBase64Url(ciphertext, MAX_CIPHERTEXT_LENGTH)) {
    throw new AuthError(400, "Ciphertext must be base64url encoded.", "INVALID_CIPHERTEXT");
  }
  if (protocolVersion === "account-v2") {
    ensureAccountV2Enabled(env);
    if (conversation.kind !== "direct" && conversation.kind !== "group") {
      throw new AuthError(400, "Account-v2 messages require a chat conversation.", "INVALID_ACCOUNT_V2_MESSAGE");
    }
  }
  const attachmentRefs = Array.isArray(body.attachmentRefs) ? body.attachmentRefs : [];
  if (attachmentRefs.length > 8 || attachmentRefs.some((item) => !isBase64Url(String(item), 100))) {
    throw new AuthError(400, "Attachment references are invalid.", "INVALID_ATTACHMENTS");
  }
  if (attachmentRefs.length) {
    const placeholders = attachmentRefs.map(() => "?").join(", ");
    const attachmentRows = await db
      .prepare(
        `
      SELECT id FROM chat_attachments
      WHERE conversation_id = ? AND status = 'complete' AND id IN (${placeholders})
    `
      )
      .bind(conversationId, ...attachmentRefs)
      .all();
    if ((attachmentRows.results || []).length !== attachmentRefs.length) {
      throw new AuthError(
        400,
        "One or more attachments are not ready for this conversation.",
        "INVALID_ATTACHMENTS"
      );
    }
  }
  const accountMessage = protocolVersion === "account-v2"
    ? await verifyAccountV2MessageSignature(db, userId, body, attachmentRefs)
    : null;
  if (accountMessage) {
    const envelope = await db.prepare(`SELECT 1 FROM chat_epoch_recipients
      WHERE conversation_id = ? AND epoch = ? AND user_id = ? AND key_version = ?`)
      .bind(conversationId, accountMessage.epoch, userId, accountMessage.senderKeyId).first();
    if (!envelope) throw new AuthError(409, "The requested conversation epoch is unavailable to this account.", "EPOCH_UNAVAILABLE");
  }
  const existing = await db
    .prepare(
      `
    SELECT id, conversation_id, ciphertext, deleted_at, created_at, expires_at, sender_device_id,
      client_message_id, protocol_version, attachment_refs, size_bucket
    FROM chat_messages WHERE ((sender_device_id = ? AND ? IS NOT NULL) OR (sender_user_id = ? AND ? IS NULL)) AND client_message_id = ?
  `
    )
    .bind(device?.id || null, device?.id || null, userId, device?.id || null, clientMessageId)
    .first();
  if (existing) {
    if (existing.ciphertext !== ciphertext)
      throw new AuthError(409, "Message id was already used.", "MESSAGE_ID_REUSED");
    const existingSender = existing.sender_device_id
      ? await db
          .prepare(
            `SELECT d.device_number, p.chat_alias AS sender_alias, p.avatar_data_url AS sender_avatar_data_url
          FROM chat_devices d LEFT JOIN chat_profiles p ON p.user_id = d.user_id WHERE d.id = ?`
          )
          .bind(existing.sender_device_id)
          .first()
      : await db
          .prepare(
            "SELECT NULL AS device_number, chat_alias AS sender_alias, avatar_data_url AS sender_avatar_data_url FROM chat_profiles WHERE user_id = ?"
          )
          .bind(userId)
          .first();
    return {
      message: {
        id: existing.id,
        conversationId: existing.conversation_id,
        senderDeviceId: existing.sender_device_id,
        senderDeviceNumber: existingSender?.device_number || null,
        senderAlias: existingSender?.sender_alias || "Paired contact",
        senderAvatarDataUrl: existingSender?.sender_avatar_data_url || "",
        clientMessageId: existing.client_message_id,
        protocolVersion: existing.protocol_version,
        ciphertext: existing.deleted_at ? "" : existing.ciphertext,
        attachmentRefs: existing.deleted_at ? [] : JSON.parse(existing.attachment_refs || "[]"),
        sizeBucket: existing.size_bucket,
        createdAt: existing.created_at,
        expiresAt: existing.expires_at,
        deleted: Boolean(existing.deleted_at),
      },
      duplicate: true,
    };
  }

  const id = randomId();
  const timestamp = nowIso();
  const expiresAt = retentionExpiry(Number(conversation.retention_seconds));
  const statements = [
    db
      .prepare(
        `
    INSERT INTO chat_messages
      (id, conversation_id, sender_device_id, sender_user_id, client_message_id, protocol_version, ciphertext,
       content_epoch, nonce, signature, sender_key_id, attachment_refs, size_bucket, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `
      )
      .bind(
        id,
        conversationId,
        device?.id || null,
        userId,
        clientMessageId,
        protocolVersion,
        ciphertext,
        accountMessage?.epoch || null,
        accountMessage?.nonce || null,
        protocolVersion === "account-v2" ? body.signature : null,
        accountMessage?.senderKeyId || null,
        JSON.stringify(attachmentRefs),
        bucketForSize(ciphertext.length),
        timestamp,
        expiresAt
      ),
  ];
  const memberDevices = protocolVersion === "account-v2" ? { results: [] } : await db
    .prepare(
      `
    SELECT d.id FROM chat_devices d
    JOIN chat_conversation_members m ON m.user_id = d.user_id
    WHERE m.conversation_id = ? AND m.left_at IS NULL AND d.revoked_at IS NULL AND d.id <> ?
  `
    )
    .bind(conversationId, device?.id || "")
    .all();
  for (const row of memberDevices.results || []) {
    statements.push(
      db
        .prepare(
          `
      INSERT INTO chat_message_deliveries (message_id, device_id) VALUES (?, ?)
    `
        )
        .bind(id, row.id)
    );
  }
  statements.push(
    db
      .prepare("UPDATE chat_conversations SET updated_at = ? WHERE id = ?")
      .bind(timestamp, conversationId)
  );
  if (protocolVersion === "account-v2") {
    statements.push(
      db
        .prepare(
          "INSERT INTO chat_sync_events (conversation_id,event_type,entity_id,payload_ciphertext,created_at) VALUES (?,?,?,?,?)"
        )
        .bind(conversationId, "message", id, ciphertext, timestamp)
    );
  }
  await db.batch(statements);
  const message = {
    id,
    conversationId,
    senderDeviceId: device?.id || null,
    senderDeviceNumber: device?.device_number || null,
    senderAlias:
      (
        await db
          .prepare("SELECT chat_alias FROM chat_profiles WHERE user_id = ?")
          .bind(userId)
          .first()
      )?.chat_alias || "You",
    senderAvatarDataUrl: (await db.prepare("SELECT avatar_data_url FROM chat_profiles WHERE user_id = ?").bind(userId).first())?.avatar_data_url || "",
    clientMessageId,
    protocolVersion,
    contentEpoch: accountMessage?.epoch || null,
    nonce: accountMessage?.nonce || null,
    signature: protocolVersion === "account-v2" ? body.signature : null,
    senderUserId: userId,
    senderKeyId: accountMessage?.senderKeyId || null,
    ciphertext,
    attachmentRefs,
    sizeBucket: bucketForSize(ciphertext.length),
    createdAt: timestamp,
    expiresAt,
    deleted: false,
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
  if (!env.CHAT_MEDIA_BUCKET)
    throw new AuthError(
      503,
      "Chat media storage is not configured yet.",
      "CHAT_MEDIA_NOT_CONFIGURED"
    );
  const conversationId = boundedString(body.conversationId, "conversationId", 100);
  const conversation = await requireConversationMember(db, conversationId, userId);
  const sizeBytes = Number(body.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) {
    throw new AuthError(413, "Encrypted images must be 10 MB or smaller.", "ATTACHMENT_TOO_LARGE");
  }
  const id = randomId();
  const objectKey = `chat/${randomId(24)}.bin`;
  const timestamp = nowIso();
  await db
    .prepare(
      `
    INSERT INTO chat_attachments (id, conversation_id, object_key, size_bytes, size_bucket, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .bind(
      id,
      conversationId,
      objectKey,
      sizeBytes,
      bucketForSize(sizeBytes),
      timestamp,
      retentionExpiry(Number(conversation.retention_seconds))
    )
    .run();
  return {
    attachmentId: id,
    maxBytes: MAX_IMAGE_BYTES,
    expiresAt: retentionExpiry(Number(conversation.retention_seconds)),
  };
}

async function putAttachment(db, env, userId, attachmentId, request) {
  if (!env.CHAT_MEDIA_BUCKET)
    throw new AuthError(
      503,
      "Chat media storage is not configured yet.",
      "CHAT_MEDIA_NOT_CONFIGURED"
    );
  const row = await db
    .prepare(
      `
    SELECT a.id, a.object_key, a.size_bytes, a.status, a.conversation_id
    FROM chat_attachments a
    JOIN chat_conversation_members m ON m.conversation_id = a.conversation_id AND m.user_id = ? AND m.left_at IS NULL
    WHERE a.id = ?
  `
    )
    .bind(userId, attachmentId)
    .first();
  if (!row || row.status !== "pending")
    throw new AuthError(404, "Attachment upload not found.", "ATTACHMENT_NOT_FOUND");
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength !== Number(row.size_bytes) || bytes.byteLength > MAX_IMAGE_BYTES) {
    throw new AuthError(
      400,
      "Encrypted attachment size does not match its reservation.",
      "ATTACHMENT_SIZE_MISMATCH"
    );
  }
  await env.CHAT_MEDIA_BUCKET.put(row.object_key, bytes, {
    httpMetadata: { contentType: "application/octet-stream" },
  });
  return { uploaded: true, attachmentId: row.id };
}

async function completeAttachment(db, env, userId, attachmentId) {
  if (!env.CHAT_MEDIA_BUCKET)
    throw new AuthError(
      503,
      "Chat media storage is not configured yet.",
      "CHAT_MEDIA_NOT_CONFIGURED"
    );
  const row = await db
    .prepare(
      `
    SELECT a.id, a.object_key, a.size_bytes, a.status
    FROM chat_attachments a
    JOIN chat_conversation_members m ON m.conversation_id = a.conversation_id AND m.user_id = ? AND m.left_at IS NULL
    WHERE a.id = ?
  `
    )
    .bind(userId, attachmentId)
    .first();
  if (!row) throw new AuthError(404, "Attachment not found.", "ATTACHMENT_NOT_FOUND");
  const object = await env.CHAT_MEDIA_BUCKET.head(row.object_key);
  if (!object || Number(object.size) !== Number(row.size_bytes)) {
    throw new AuthError(409, "Attachment upload is incomplete.", "ATTACHMENT_INCOMPLETE");
  }
  await db
    .prepare("UPDATE chat_attachments SET status = 'complete' WHERE id = ?")
    .bind(attachmentId)
    .run();
  return { attachmentId, complete: true };
}

async function getAttachment(db, env, userId, attachmentId) {
  if (!env.CHAT_MEDIA_BUCKET)
    throw new AuthError(
      503,
      "Chat media storage is not configured yet.",
      "CHAT_MEDIA_NOT_CONFIGURED"
    );
  const row = await db
    .prepare(
      `
    SELECT a.object_key, a.status FROM chat_attachments a
    JOIN chat_conversation_members m ON m.conversation_id = a.conversation_id AND m.user_id = ? AND m.left_at IS NULL
    WHERE a.id = ?
  `
    )
    .bind(userId, attachmentId)
    .first();
  if (!row || row.status !== "complete")
    throw new AuthError(404, "Attachment not found.", "ATTACHMENT_NOT_FOUND");
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
  const device = await requireOwnedDevice(
    db,
    boundedString(body.deviceId, "deviceId", 100),
    userId
  );
  const token = bytesToBase64Url(randomBytes(32));
  const timestamp = Date.now();
  const expiresAt = new Date(timestamp + 60 * 1000).toISOString();
  await db
    .prepare(
      `
    INSERT INTO chat_ws_tickets (id, token_hash, user_id, conversation_id, device_id, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `
    )
    .bind(
      randomId(),
      await sha256Base64Url(token),
      userId,
      conversationId,
      device.id,
      expiresAt,
      new Date(timestamp).toISOString()
    )
    .run();
  return { ticket: token, expiresAt, protocol: "expassway-chat-v1" };
}

function mapAccountKey(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    keyVersion: row.key_version,
    encryptionPublicKey: row.encryption_public_key,
    signingPublicKey: row.signing_public_key,
    fingerprint: row.fingerprint,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function accountKeyBundle(db, userId) {
  const row = await db
    .prepare(
      `SELECT k.* FROM chat_account_keys k LEFT JOIN chat_account_identity_heads h ON h.user_id=k.user_id
    WHERE k.user_id = ? AND k.status = 'active' AND (h.key_version IS NULL OR h.key_version=k.key_version)
    ORDER BY k.updated_at DESC,k.key_version DESC LIMIT 1`
    )
    .bind(userId)
    .first();
  let credential = null;
  let vault = null;
  try {
    vault = row && (await listAccountVaults(db, userId)).find((value) => value.keyVersion === row.key_version);
    credential = await db.prepare(`SELECT credential_id,backup_eligible,revoked_at FROM chat_passkeys
      WHERE user_id=? AND revoked_at IS NULL AND (? IS NULL OR credential_id=?) ORDER BY created_at DESC,id DESC LIMIT 1`)
      .bind(userId, vault?.credentialId || null, vault?.credentialId || null).first();
  } catch (_error) {
    // Older test/compatibility databases predate the hardening migration.
  }
  return {
    accountKey: mapAccountKey(row),
    enabled: Boolean(row && credential && vault?.wrappers.length),
    passkeyReady: Boolean(credential),
    credentialId: credential?.credential_id || null,
    vaultKeyVersion: vault?.keyVersion || null,
    credentialIds: vault?.wrappers.map((wrapper) => wrapper.credentialId) || [],
  };
}

async function issueAccountWriteProof(db, userId, credentialId, keyVersion = null, purpose = "account-write") {
  const token = bytesToBase64Url(randomBytes(32));
  const timestamp = Date.now();
  const expiresAt = new Date(timestamp + 5 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO chat_account_write_proofs (id,token_hash,user_id,uses_remaining,expires_at,created_at,credential_id,key_version,purpose)
       VALUES (?,?,?,?,?,?,?,?,?)`
    )
    .bind(randomId(), await sha256Base64Url(token), userId, 5, expiresAt, new Date(timestamp).toISOString(), credentialId || null, keyVersion, purpose)
    .run();
  return { proof: token, proofExpiresAt: expiresAt };
}

async function requireAccountWriteProof(db, userId, body, purpose = "account-write") {
  const proof = boundedString(body?.proof, "proof", 256);
  const result = await db
    .prepare(
      `UPDATE chat_account_write_proofs SET uses_remaining = uses_remaining - 1
       WHERE token_hash = ? AND user_id = ? AND expires_at > ? AND uses_remaining > 0
         AND COALESCE(purpose,'account-write') = ?
         AND EXISTS (SELECT 1 FROM chat_passkeys p WHERE p.user_id=chat_account_write_proofs.user_id
           AND p.credential_id=chat_account_write_proofs.credential_id AND p.revoked_at IS NULL)`
    )
    .bind(await sha256Base64Url(proof), userId, nowIso(), purpose)
    .run();
  if (Number(result?.meta?.changes ?? result?.changes ?? 0) !== 1) {
    throw new AuthError(
      403,
      "Verify your Passkey again before changing secure chat keys or vault data.",
      "ACCOUNT_WRITE_PROOF_REQUIRED"
    );
  }
  return db.prepare("SELECT credential_id,key_version,purpose FROM chat_account_write_proofs WHERE token_hash=? AND user_id=? ORDER BY created_at DESC LIMIT 1").bind(await sha256Base64Url(proof), userId).first();
}

async function upsertAccountKey(db, userId, body) {
  await requireAccountWriteProof(db, userId, body);
  const encryptionPublicKey = boundedString(body.encryptionPublicKey, "encryptionPublicKey", 512);
  const signingPublicKey = boundedString(body.signingPublicKey, "signingPublicKey", 512);
  const keyVersion = boundedString(body.keyVersion || "1", "keyVersion", 64);
  const fingerprint = boundedString(
    body.fingerprint || (await sha256Base64Url(`${encryptionPublicKey}.${signingPublicKey}`)),
    "fingerprint",
    256
  );
  if (
    ![encryptionPublicKey, signingPublicKey, fingerprint].every((value) => isBase64Url(value, 512))
  ) {
    throw new AuthError(400, "Account public keys are invalid.", "INVALID_ACCOUNT_KEYS");
  }
  const timestamp = nowIso();
  if (await db.prepare("SELECT 1 FROM chat_account_keys WHERE user_id=?").bind(userId).first())
    throw new AuthError(409, "This account key is immutable; use account reset to create a new version.", "ACCOUNT_KEY_IMMUTABLE");
  await db
    .prepare(
      `INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,status,created_at,updated_at)
    VALUES (?,?,?,?,?,'active',?,?)`
    )
    .bind(
      userId,
      keyVersion,
      encryptionPublicKey,
      signingPublicKey,
      fingerprint,
      timestamp,
      timestamp
    )
    .run();
  return accountKeyBundle(db, userId);
}

function webAuthnCredentialId(credential) {
  const value = credential?.rawId || credential?.id;
  if (!isBase64Url(value, 1024))
    throw new AuthError(400, "WebAuthn credential ID is invalid.", "INVALID_WEBAUTHN_CREDENTIAL");
  return value;
}

function webAuthnPrfEnabled(credential) {
  return credential?.clientExtensionResults?.prf?.enabled === true;
}

function webAuthnTransports(credential) {
  const transports = credential?.response?.transports ?? credential?.transports;
  if (!Array.isArray(transports)) return [];
  return transports.filter((value) => typeof value === "string" && value.length <= 32).slice(0, 8);
}

async function passkeyOptions(db, userId, kind, request, env, body = {}) {
  const context = webAuthnContext(request, env);
  const challenge = bytesToBase64Url(randomBytes(32));
  const credentialRows = (await db.prepare(`SELECT credential_id,transports,prf_salt FROM chat_passkeys
    WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at ASC,id ASC`).bind(userId).all()).results || [];
  const purpose = kind === "authentication" && body.purpose === "account-wrap" ? "account-wrap" : "account-write";
  const requestedCredential = body.credentialId ? boundedString(body.credentialId, "credentialId", 1024) : null;
  const head = await db.prepare("SELECT key_version FROM chat_account_identity_heads WHERE user_id=?").bind(userId).first();
  const keyVersion = kind === "authentication" ? (body.keyVersion ? boundedString(body.keyVersion, "keyVersion", 64) : head?.key_version || null) : null;
  const vault = keyVersion && (await listAccountVaults(db, userId)).find((value) => value.keyVersion === keyVersion);
  if (kind === "authentication" && keyVersion && !vault)
    throw new AuthError(404, "The retained secure chat identity was not found.", "ACCOUNT_VAULT_NOT_FOUND");
  if (purpose === "account-wrap" && !requestedCredential)
    throw new AuthError(400, "Choose the account Passkey to synchronize.", "PASSKEY_REQUIRED");
  const credentials = credentialRows.filter((value) => kind === "registration" || (
    (!requestedCredential || value.credential_id === requestedCredential)
    && (purpose === "account-wrap" || !vault || vault.wrappers.some((wrapper) => wrapper.credentialId === value.credential_id))
  ));
  if (kind === "authentication" && !credentials.length)
    throw new AuthError(409, "Use an account Passkey that unlocks this retained secure chat identity.", "CHAT_VAULT_PASSKEY_UNAVAILABLE");
  const existingPrf = kind === "authentication" ? credentials[0] : null;
  const prfSalt = existingPrf?.prf_salt || bytesToBase64Url(randomBytes(32));
  const timestamp = Date.now();
  const expiresAt = new Date(timestamp + 5 * 60 * 1000).toISOString();
  await db
    .prepare(
      `INSERT INTO chat_webauthn_challenges (id,user_id,challenge,kind,rp_id,origin,prf_salt,expires_at,created_at,credential_id,reserved_key_version,purpose) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .bind(
      randomId(),
      userId,
      challenge,
      kind,
      context.rpId,
      context.origin,
      prfSalt,
      expiresAt,
      new Date(timestamp).toISOString(),
      kind === "authentication" ? requestedCredential : null,
      keyVersion,
      purpose
    )
    .run();
  const prf = kind === "registration" ? { eval: { first: prfSalt } } : {
    evalByCredential: Object.fromEntries(credentials.map((value) => [value.credential_id, { first: value.prf_salt }])),
  };
  const publicKey =
    kind === "registration"
      ? {
          challenge,
          rp: { id: context.rpId, name: "ExPassway" },
          user: {
            id: bytesToBase64Url(encoder.encode(userId)),
            name: userId,
            displayName: "ExPassway account",
          },
          pubKeyCredParams: [{ type: "public-key", alg: -7 }],
          timeout: 300000,
          attestation: "none",
          authenticatorSelection: { residentKey: "required", userVerification: "required" },
          excludeCredentials: credentials.map((row) => ({
            type: "public-key",
            id: row.credential_id,
            transports: JSON.parse(row.transports || "[]"),
          })),
          extensions: { prf },
        }
      : {
          challenge,
          rpId: context.rpId,
          timeout: 300000,
          userVerification: "required",
          allowCredentials: credentials.map((row) => ({
            type: "public-key",
            id: row.credential_id,
            transports: JSON.parse(row.transports || "[]"),
          })),
          extensions: { prf },
        };
  return { publicKey, expiresAt, kind };
}

async function verifyPasskey(db, userId, body, kind, request, env) {
  const challenge = boundedString(body.challenge, "challenge", 256);
  const row = await db
    .prepare(
      `SELECT id,rp_id,origin,prf_salt,credential_id,reserved_key_version,purpose FROM chat_webauthn_challenges WHERE user_id = ? AND challenge = ? AND kind = ? AND used_at IS NULL AND expires_at > ?`
    )
    .bind(userId, challenge, kind, nowIso())
    .first();
  if (!row)
    throw new AuthError(
      400,
      "WebAuthn challenge is invalid or expired.",
      "INVALID_WEBAUTHN_CHALLENGE"
    );
  const credential = body.credential;
  if (!credential || credential.type !== "public-key")
    throw new AuthError(
      400,
      "A WebAuthn public-key credential is required.",
      "INVALID_WEBAUTHN_CREDENTIAL"
    );
  const context = webAuthnContext(request, env);
  if (row.rp_id !== context.rpId || row.origin !== context.origin) {
    throw new AuthError(
      409,
      "The WebAuthn relying-party settings changed. Start again.",
      "WEBAUTHN_CONTEXT_CHANGED"
    );
  }
  let verified;
  try {
    if (kind === "registration") {
      verified = await verifyRegistrationResponse({
        credential,
        challenge,
        rpId: row.rp_id,
        origins: [row.origin],
      });
      if (verified.credentialId !== webAuthnCredentialId(credential)) {
        throw new AuthError(
          400,
          "The WebAuthn credential ID does not match authenticator data.",
          "INVALID_WEBAUTHN_CREDENTIAL"
        );
      }
    } else {
      const credentialId = webAuthnCredentialId(credential);
      if (row.credential_id && row.credential_id !== credentialId) {
        throw new AuthError(400, "Use the Passkey selected for this account vault.", "WEBAUTHN_CREDENTIAL_MISMATCH");
      }
      const passkey = await db
        .prepare(
          `SELECT id,user_id,credential_id,public_key,sign_count,backup_eligible,prf_salt FROM chat_passkeys
        WHERE credential_id=? AND user_id=? AND revoked_at IS NULL`
        )
        .bind(credentialId, userId)
        .first();
      if (!passkey)
        throw new AuthError(
          404,
          "The WebAuthn credential is not registered for this account.",
          "WEBAUTHN_CREDENTIAL_NOT_FOUND"
        );
      if (row.purpose !== "account-wrap" && row.reserved_key_version) {
        const vault = (await listAccountVaults(db, userId)).find((value) => value.keyVersion === row.reserved_key_version);
        if (!vault?.wrappers.some((wrapper) => wrapper.credentialId === credentialId))
          throw new AuthError(400, "Use an account Passkey synchronized with this retained chat identity.", "WEBAUTHN_CREDENTIAL_MISMATCH");
      }
      verified = await verifyAuthenticationResponse({
        credential,
        challenge,
        rpId: row.rp_id,
        origins: [row.origin],
        publicKey: passkey.public_key,
        expectedSignCount: Number(passkey.sign_count || 0),
      });
      verified.credentialId = credentialId;
      verified.passkeyId = passkey.id;
      verified.expectedSignCount = Number(passkey.sign_count || 0);
      verified.prfSalt = passkey.prf_salt;
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    if (error instanceof WebAuthnError)
      throw new AuthError(error.status, error.message, error.code);
    throw error;
  }
  if (!webAuthnPrfEnabled(credential)) {
    throw new AuthError(
      400,
      "This passkey does not expose the required PRF extension.",
      "WEBAUTHN_PRF_REQUIRED"
    );
  }
  const timestamp = nowIso();
  const consume = await db
    .prepare("UPDATE chat_webauthn_challenges SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(timestamp, row.id)
    .run();
  if (Number(consume?.meta?.changes ?? consume?.changes ?? 0) !== 1) {
    throw new AuthError(
      409,
      "The WebAuthn challenge was already used.",
      "WEBAUTHN_CHALLENGE_REPLAYED"
    );
  }
  if (kind === "registration") {
    const existing = await db
      .prepare("SELECT user_id FROM chat_passkeys WHERE credential_id = ?")
      .bind(verified.credentialId)
      .first();
    if (existing)
      throw new AuthError(
        409,
        existing.user_id === userId ? "This Passkey is already registered. Use it to unlock secure chat." : "This passkey belongs to another account.",
        existing.user_id === userId ? "WEBAUTHN_CREDENTIAL_EXISTS" : "WEBAUTHN_CREDENTIAL_CONFLICT"
      );
    try { await db
      .prepare(
        `INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,sign_count,transports,created_at,last_used_at)
      VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .bind(
        randomId(),
        userId,
        verified.credentialId,
        JSON.stringify(verified.publicKey),
        row.prf_salt,
        verified.signCount,
        JSON.stringify(webAuthnTransports(credential)),
        timestamp,
        timestamp
      )
      .run(); } catch (error) {
      if (/UNIQUE constraint failed/.test(String(error?.message || error))) {
        throw new AuthError(409, "This Passkey was already registered. Start again.", "WEBAUTHN_CREDENTIAL_EXISTS");
      }
      throw error;
    }
    await db.prepare("UPDATE chat_passkeys SET backup_eligible=?, backup_state=? WHERE credential_id=?")
      .bind(verified.backupEligible ? 1 : 0, verified.backupState ? 1 : 0, verified.credentialId)
      .run();
    return {
      verified: true,
      credentialId: verified.credentialId,
      prfSalt: row.prf_salt,
      signCount: verified.signCount,
    };
  }
  const updated = await db
    .prepare(
      `UPDATE chat_passkeys SET sign_count=?,last_used_at=?
    WHERE id=? AND user_id=? AND revoked_at IS NULL AND sign_count=?`
    )
    .bind(verified.signCount, timestamp, verified.passkeyId, userId, verified.expectedSignCount)
    .run();
  if (Number(updated?.meta?.changes ?? updated?.changes ?? 0) !== 1) {
    throw new AuthError(
      409,
      "The WebAuthn credential changed while it was being verified.",
      "WEBAUTHN_COUNTER_CONFLICT"
    );
  }
  const identity = await db.prepare("SELECT key_version,credential_id FROM chat_account_identity_heads WHERE user_id=?").bind(userId).first();
  return {
    verified: true,
    credentialId: verified.credentialId,
    prfSalt: verified.prfSalt,
    keyVersion: row.reserved_key_version || null,
    signCount: verified.signCount,
    ...(await issueAccountWriteProof(db, userId, verified.credentialId, row.reserved_key_version || identity?.key_version || null, row.purpose || "account-write")),
  };
}

async function saveVault(db, userId, body) {
  const proof = await requireAccountWriteProof(db, userId, body);
  const keyVersion = boundedString(body.keyVersion || "1", "keyVersion", 64);
  const nonce = boundedString(body.nonce, "nonce", 256);
  const ciphertext = boundedString(body.ciphertext, "ciphertext", 512 * 1024);
  if (![nonce, ciphertext].every((value) => isBase64Url(value, 512 * 1024)))
    throw new AuthError(400, "Encrypted vault is invalid.", "INVALID_VAULT");
  const timestamp = nowIso();
  const existing = await db.prepare("SELECT key_version FROM chat_account_vault_versions WHERE user_id=? AND key_version=?").bind(userId, keyVersion).first();
  if (existing) throw new AuthError(409, "This account vault version already exists.", "ACCOUNT_VAULT_IMMUTABLE");
  try { await db.batch([
    db.prepare(`INSERT INTO chat_account_initialization_guards (id,valid)
      VALUES (?,CASE WHEN EXISTS (SELECT 1 FROM chat_passkeys
        WHERE user_id=? AND credential_id=? AND revoked_at IS NULL) THEN 1 ELSE 0 END)`)
      .bind(randomId(), userId, proof?.credential_id || null),
    db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?,?)").bind(userId,keyVersion,proof?.credential_id || null,"hkdf-sha256-v1",nonce,ciphertext,timestamp),
    db.prepare("INSERT INTO chat_account_vault_wrappers (user_id,key_version,credential_id,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?)").bind(userId,keyVersion,proof?.credential_id || null,nonce,ciphertext,timestamp),
    db.prepare("INSERT INTO chat_account_identity_heads (user_id,key_version,credential_id) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET key_version=excluded.key_version,credential_id=excluded.credential_id").bind(userId,keyVersion,proof?.credential_id || null),
    db.prepare("DELETE FROM chat_account_initialization_guards"),
  ]); } catch (error) {
    if (/CHECK constraint failed/.test(String(error?.message || error))) {
      throw new AuthError(403, "Verify an active Passkey again before changing the secure chat vault.", "ACCOUNT_WRITE_PROOF_REQUIRED");
    }
    throw error;
  }
  return { saved: true, keyVersion, updatedAt: timestamp };
}

async function initializeAccount(db, userId, body) {
  const proof = await requireAccountWriteProof(db, userId, body);
  const keyVersion = boundedString(body.keyVersion || "1", "keyVersion", 64);
  const encryptionPublicKey = boundedString(body.encryptionPublicKey, "encryptionPublicKey", 512);
  const signingPublicKey = boundedString(body.signingPublicKey, "signingPublicKey", 512);
  const fingerprint = boundedString(body.fingerprint || (await sha256Base64Url(`${encryptionPublicKey}.${signingPublicKey}`)), "fingerprint", 256);
  const nonce = boundedString(body.nonce, "nonce", 256);
  const ciphertext = boundedString(body.ciphertext, "ciphertext", 512 * 1024);
  if (![encryptionPublicKey, signingPublicKey, fingerprint, nonce, ciphertext].every((value) => isBase64Url(value, 512 * 1024)))
    throw new AuthError(400, "The account initialization payload is invalid.", "INVALID_ACCOUNT_INITIALIZATION");
  const existing = await db.prepare("SELECT key_version FROM chat_account_identity_heads WHERE user_id=?").bind(userId).first();
  if ((proof?.key_version || null) !== (existing?.key_version || null))
    throw new AuthError(409,"The secure chat identity changed after Passkey verification. Verify again.","ACCOUNT_IDENTITY_CHANGED");
  if (existing && body.reset !== true)
    throw new AuthError(409, "This account already has a secure chat identity.", "ACCOUNT_IDENTITY_ALREADY_INITIALIZED");
  const current = await db.prepare("SELECT key_version FROM chat_account_keys WHERE user_id=? AND key_version=?").bind(userId, keyVersion).first();
  if (current) throw new AuthError(409, "This account key version already exists.", "ACCOUNT_KEY_VERSION_EXISTS");
  const timestamp = nowIso();
  try { await db.batch([
    db.prepare(`INSERT INTO chat_account_initialization_guards (id,valid) VALUES (?,CASE WHEN
      ((? IS NULL AND NOT EXISTS (SELECT 1 FROM chat_account_identity_heads WHERE user_id=?)) OR
       EXISTS (SELECT 1 FROM chat_account_identity_heads WHERE user_id=? AND key_version=?))
       AND EXISTS (SELECT 1 FROM chat_passkeys WHERE user_id=? AND credential_id=? AND revoked_at IS NULL)
       THEN 1 ELSE 0 END)`)
      .bind(randomId(), existing?.key_version || null, userId, userId, existing?.key_version || null, userId, proof?.credential_id || null),
    db.prepare("UPDATE chat_account_keys SET status='revoked',updated_at=? WHERE user_id=? AND status='active'").bind(timestamp,userId),
    db.prepare("INSERT INTO chat_account_keys (user_id,key_version,encryption_public_key,signing_public_key,fingerprint,status,created_at,updated_at) VALUES (?,?,?,?,?,'active',?,?)").bind(userId,keyVersion,encryptionPublicKey,signingPublicKey,fingerprint,timestamp,timestamp),
    db.prepare("INSERT INTO chat_account_vault_versions (user_id,key_version,credential_id,kdf_version,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?,?)").bind(userId,keyVersion,proof?.credential_id || null,"hkdf-sha256-v1",nonce,ciphertext,timestamp),
    db.prepare("INSERT INTO chat_account_vault_wrappers (user_id,key_version,credential_id,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?)").bind(userId,keyVersion,proof?.credential_id || null,nonce,ciphertext,timestamp),
    db.prepare("INSERT INTO chat_account_identity_heads (user_id,key_version,credential_id) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET key_version=excluded.key_version,credential_id=excluded.credential_id").bind(userId,keyVersion,proof?.credential_id || null),
    db.prepare("UPDATE chat_passkeys SET key_version=? WHERE user_id=? AND credential_id=?").bind(keyVersion,userId,proof?.credential_id || null),
    db.prepare("DELETE FROM chat_account_initialization_guards"),
  ]); } catch (error) {
    if (/CHECK constraint failed|UNIQUE constraint failed/.test(String(error?.message || error))) {
      throw new AuthError(409,"The secure chat identity changed. Refresh and verify your Passkey again.","ACCOUNT_IDENTITY_CHANGED");
    }
    throw error;
  }
  return { initialized: true, reset: Boolean(existing), keyVersion, fingerprint, updatedAt: timestamp };
}

async function listAccountVaults(db, userId) {
  const versions = (await db.prepare(`SELECT v.*,k.encryption_public_key,k.signing_public_key,k.fingerprint,k.status,k.created_at
    FROM chat_account_vault_versions v LEFT JOIN chat_account_keys k ON k.user_id=v.user_id AND k.key_version=v.key_version
    WHERE v.user_id=? ORDER BY v.updated_at ASC,v.key_version ASC`).bind(userId).all()).results || [];
  const passkeys = (await db.prepare("SELECT credential_id FROM chat_passkeys WHERE user_id=? AND revoked_at IS NULL ORDER BY created_at ASC,id ASC").bind(userId).all()).results || [];
  let additional = [];
  try { additional = (await db.prepare(`SELECT w.* FROM chat_account_vault_wrappers w JOIN chat_passkeys p
    ON p.user_id=w.user_id AND p.credential_id=w.credential_id AND p.revoked_at IS NULL WHERE w.user_id=? ORDER BY w.updated_at,w.credential_id`).bind(userId).all()).results || []; }
  catch (_error) { /* Earlier databases still retain their original vault wrapper. */ }
  return versions.map((version) => {
    const wrappers = additional.filter((wrapper) => wrapper.key_version === version.key_version).map((wrapper) => ({
      credentialId: wrapper.credential_id, keyVersion: version.key_version, kdfVersion: version.kdf_version,
      nonce: wrapper.nonce, ciphertext: wrapper.ciphertext, updatedAt: wrapper.updated_at,
    }));
    for (const passkey of passkeys) {
      if ((!version.credential_id || passkey.credential_id === version.credential_id)
          && !wrappers.some((wrapper) => wrapper.credentialId === passkey.credential_id))
        wrappers.push({ credentialId: passkey.credential_id, keyVersion: version.key_version, kdfVersion: version.kdf_version,
          nonce: version.nonce, ciphertext: version.ciphertext, updatedAt: version.updated_at,
          legacyCandidate: !version.credential_id });
    }
    const preferred = wrappers.find((wrapper) => wrapper.credentialId === version.credential_id) || wrappers[0];
    return { keyVersion: version.key_version, kdfVersion: version.kdf_version, credentialId: preferred?.credentialId || version.credential_id,
      nonce: preferred?.nonce || version.nonce, ciphertext: preferred?.ciphertext || version.ciphertext,
      updatedAt: preferred?.updatedAt || version.updated_at, legacyCandidate: Boolean(preferred?.legacyCandidate), wrappers,
      accountKey: version.encryption_public_key ? mapAccountKey(version) : null };
  });
}

async function getVault(db, userId, input = {}) {
  const versions = await listAccountVaults(db, userId);
  const head = await db.prepare("SELECT key_version FROM chat_account_identity_heads WHERE user_id=?").bind(userId).first();
  const keyVersion = input.keyVersion || head?.key_version || versions.at(-1)?.keyVersion;
  const version = versions.find((value) => value.keyVersion === keyVersion);
  if (input.keyVersion && !version) throw new AuthError(404, "The retained secure chat vault was not found.", "ACCOUNT_VAULT_NOT_FOUND");
  if (version && input.credentialId) {
    const wrapper = version.wrappers.find((value) => value.credentialId === input.credentialId);
    if (!wrapper) throw new AuthError(409, "Synchronize this Passkey using an existing secure chat Passkey first.", "CHAT_VAULT_PASSKEY_NOT_LINKED");
    return { ...version, ...wrapper };
  }
  if (version) return version;
  const row = await db.prepare("SELECT key_version,kdf_version,nonce,ciphertext,updated_at FROM chat_vaults WHERE user_id = ?").bind(userId).first();
  return row
    ? {
        keyVersion: row.key_version,
        kdfVersion: row.kdf_version,
        nonce: row.nonce,
        ciphertext: row.ciphertext,
        updatedAt: row.updated_at,
      }
    : null;
}

async function saveVaultWrapper(db, userId, body) {
  const keyVersion = boundedString(body.keyVersion, "keyVersion", 64);
  const credentialId = boundedString(body.credentialId, "credentialId", 1024);
  const nonce = boundedString(body.nonce, "nonce", 256);
  const ciphertext = boundedString(body.ciphertext, "ciphertext", 512 * 1024);
  const signature = boundedString(body.signature, "signature", 256);
  if (!isBase64Url(nonce, 256) || base64UrlToBytes(nonce).length !== 12
      || !isBase64Url(ciphertext, 512 * 1024) || base64UrlToBytes(ciphertext).length < 16
      || !isBase64Url(signature, 256) || base64UrlToBytes(signature).length !== 64)
    throw new AuthError(400, "The encrypted account wrapper is invalid.", "INVALID_VAULT_WRAPPER");
  const proof = await requireAccountWriteProof(db, userId, body, "account-wrap");
  if (proof.credential_id !== credentialId || proof.key_version !== keyVersion)
    throw new AuthError(403, "Verify the selected Passkey for this retained account identity again.", "ACCOUNT_WRITE_PROOF_REQUIRED");
  const key = await db.prepare(`SELECT k.* FROM chat_account_keys k JOIN chat_account_vault_versions v
    ON v.user_id=k.user_id AND v.key_version=k.key_version WHERE k.user_id=? AND k.key_version=?`).bind(userId,keyVersion).first();
  if (!key) throw new AuthError(404, "The retained secure chat identity was not found.", "ACCOUNT_VAULT_NOT_FOUND");
  const value = { version: "account-v2", action: "wrap-vault", senderUserId: userId, senderKeyId: keyVersion, credentialId, nonce, ciphertext };
  let verified = false;
  try {
    const publicKey = await crypto.subtle.importKey("raw", base64UrlToBytes(key.signing_public_key), { name: "Ed25519" }, false, ["verify"]);
    verified = await crypto.subtle.verify("Ed25519", publicKey, base64UrlToBytes(signature), encoder.encode(canonicalAccountJson(value)));
  } catch (_error) { /* Reject invalid crypto input with the same account signature error. */ }
  if (!verified) throw new AuthError(400, "Unlock the original account identity before synchronizing its Passkey wrapper.", "INVALID_VAULT_WRAPPER_SIGNATURE");
  const existing = await db.prepare("SELECT nonce,ciphertext FROM chat_account_vault_wrappers WHERE user_id=? AND key_version=? AND credential_id=?").bind(userId,keyVersion,credentialId).first();
  if (existing) {
    if (existing.nonce !== nonce || existing.ciphertext !== ciphertext)
      throw new AuthError(409, "This Passkey already has an immutable wrapper for this identity.", "ACCOUNT_VAULT_WRAPPER_IMMUTABLE");
    return { saved: true, keyVersion, credentialId, unchanged: true };
  }
  const timestamp = nowIso();
  try { await db.batch([
    db.prepare(`INSERT INTO chat_account_initialization_guards (id,valid) VALUES (?,CASE WHEN EXISTS
      (SELECT 1 FROM chat_passkeys WHERE user_id=? AND credential_id=? AND revoked_at IS NULL)
      AND EXISTS (SELECT 1 FROM chat_account_vault_versions WHERE user_id=? AND key_version=?) THEN 1 ELSE 0 END)`)
      .bind(randomId(),userId,credentialId,userId,keyVersion),
    db.prepare("INSERT INTO chat_account_vault_wrappers (user_id,key_version,credential_id,nonce,ciphertext,updated_at) VALUES (?,?,?,?,?,?)")
      .bind(userId,keyVersion,credentialId,nonce,ciphertext,timestamp),
    db.prepare("DELETE FROM chat_account_initialization_guards"),
  ]); } catch (error) {
    if (/CHECK constraint failed|UNIQUE constraint failed/.test(String(error?.message || error)))
      throw new AuthError(409, "The Passkey or retained vault changed. Refresh and try again.", "ACCOUNT_VAULT_WRAPPER_CONFLICT");
    throw error;
  }
  return { saved: true, keyVersion, credentialId, updatedAt: timestamp };
}

async function listEpochs(db, conversationId, userId) {
  await requireConversationMember(db, conversationId, userId);
  const rows = await db
    .prepare(
      `SELECT e.epoch,e.created_by,e.created_at,r.user_id,r.key_version,r.ephemeral_public_key,r.nonce,r.envelope_ciphertext
    FROM chat_conversation_epochs e JOIN chat_epoch_recipients r ON r.conversation_id=e.conversation_id AND r.epoch=e.epoch
    WHERE e.conversation_id=? AND r.user_id=? ORDER BY e.epoch DESC`
    )
    .bind(conversationId, userId)
    .all();
  return (rows.results || []).map((row) => ({
    epoch: row.epoch,
    createdBy: row.created_by,
    createdAt: row.created_at,
    envelope: {
      userId: row.user_id,
      keyVersion: row.key_version,
      ephemeralPublicKey: row.ephemeral_public_key,
      nonce: row.nonce,
      ciphertext: row.envelope_ciphertext,
    },
  }));
}

async function syncEvents(db, conversationId, userId, url) {
  await requireConversationMember(db, conversationId, userId);
  const after = Math.max(0, Number(url.searchParams.get("after") || 0));
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 100)));
  const rows = await db
    .prepare(
      `SELECT sequence,event_type,entity_id,payload_ciphertext,created_at FROM chat_sync_events WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT ?`
    )
    .bind(conversationId, Number.isFinite(after) ? after : 0, limit)
    .all();
  const events = (rows.results || []).map((row) => ({
    sequence: row.sequence,
    type: row.event_type,
    entityId: row.entity_id || null,
    payloadCiphertext: row.payload_ciphertext || null,
    createdAt: row.created_at,
  }));
  return { events, nextCursor: events.at(-1)?.sequence || after };
}

async function acceptWebSocketTicket(db, token, conversationId) {
  const hash = await sha256Base64Url(token);
  const row = await db
    .prepare(
      `
    SELECT id, user_id, conversation_id, device_id, expires_at, used_at
    FROM chat_ws_tickets WHERE token_hash = ? AND conversation_id = ?
  `
    )
    .bind(hash, conversationId)
    .first();
  const timestamp = nowIso();
  if (!row || row.used_at || row.expires_at <= timestamp)
    throw new AuthError(401, "Chat connection ticket is invalid.", "WS_TICKET_INVALID");
  const result = await db
    .prepare("UPDATE chat_ws_tickets SET used_at = ? WHERE id = ? AND used_at IS NULL")
    .bind(timestamp, row.id)
    .run();
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

  if (parts[0] === "api" && parts[1] === "chat" && parts[2] === "invites") {
    throw new AuthError(
      410,
      "Friend invite links have been removed. Add friends by their chat user ID.",
      "CHAT_INVITES_REMOVED"
    );
  }

  // History visibility is account-local and works for both encryption protocols.
  if (method === "DELETE" && parts.length === 5 && parts[0] === "api" && parts[1] === "chat"
      && parts[2] === "conversations" && parts[4] === "history") {
    const conversation = await requireConversationMember(db, parts[3], user.id);
    const membership = await db.prepare("SELECT history_hidden_at FROM chat_conversation_members WHERE conversation_id = ? AND user_id = ?")
      .bind(conversation.id, user.id).first();
    if (!membership.history_hidden_at && !await isHistoricalConversation(db, conversation))
      throw new AuthError(400, "Only a historical chat can be removed from your history.", "HISTORICAL_CHAT_REQUIRED");
    await db.prepare("UPDATE chat_conversation_members SET history_hidden_at = COALESCE(history_hidden_at, ?) WHERE conversation_id = ? AND user_id = ?")
      .bind(nowIso(), conversation.id, user.id).run();
    return success({ conversationId: conversation.id, hidden: true }, method);
  }
  if (method === "GET" && ["/api/chat/sync", "/api/chat/sync-events"].includes(url.pathname)) {
    const conversationId = url.searchParams.get("conversationId");
    if (conversationId) {
      const membership = await db.prepare("SELECT history_hidden_at FROM chat_conversation_members WHERE conversation_id = ? AND user_id = ?")
        .bind(conversationId, user.id).first();
      if (membership?.history_hidden_at)
        return success({ conversationId, hidden: true, events: [], messages: [], nextCursor: null, hasMore: false }, method);
    }
  }

  // Account-v2 owns its conversation, message, attachment and sync contract.
  const accountV2Response = await handleAccountV2Route(request, env, user);
  if (accountV2Response) return accountV2Response;

  if (url.pathname.startsWith("/api/chat/global-discussion")) {
    ensureAccountV2Enabled(env);
    if (method === "GET" && url.pathname === "/api/chat/global-discussion")
      return success(await globalDiscussion(db, user.id), method);
    if (method === "POST" && url.pathname === "/api/chat/global-discussion")
      return success(await createGlobalDiscussion(db, env, user.id, await readJsonBody(request)), method, 201);
    if (method === "POST" && url.pathname === "/api/chat/global-discussion/rotate")
      return success(await rotateGlobalDiscussion(db, user.id, await readJsonBody(request)), method);
    if (method === "POST" && url.pathname === "/api/chat/global-discussion/leave")
      return success(await leaveGlobalDiscussion(db, user.id), method);
    throw new AuthError(404, "Global discussion route not found.", "ROUTE_NOT_FOUND");
  }

  // Account-v2 lifecycle. The Worker verifies the WebAuthn ceremony and stores
  // only public credential metadata plus the client-encrypted account vault.
  if (url.pathname.startsWith("/api/chat/account")) ensureAccountV2Enabled(env);
  if (method === "GET" && url.pathname === "/api/chat/account/keys")
    return success(await accountKeyBundle(db, user.id), method);
  if (method === "POST" && url.pathname === "/api/chat/account/initialize")
    return success(await initializeAccount(db, user.id, await readJsonBody(request)), method, 201);
  if (method === "PUT" && url.pathname === "/api/chat/account/keys")
    return success(await upsertAccountKey(db, user.id, await readJsonBody(request)), method);
  if (method === "POST" && url.pathname === "/api/chat/account/passkeys/register/options")
    return success(await passkeyOptions(db, user.id, "registration", request, env), method);
  if (method === "POST" && url.pathname === "/api/chat/account/passkeys/authenticate/options")
    return success(await passkeyOptions(db, user.id, "authentication", request, env, await readJsonBody(request)), method);
  if (method === "POST" && url.pathname === "/api/chat/account/passkeys/register/verify")
    return success(
      await verifyPasskey(db, user.id, await readJsonBody(request), "registration", request, env),
      method,
      201
    );
  if (method === "POST" && url.pathname === "/api/chat/account/passkeys/authenticate/verify")
    return success(
      await verifyPasskey(db, user.id, await readJsonBody(request), "authentication", request, env),
      method
    );
  if (method === "GET" && url.pathname === "/api/chat/account/vault")
    return success(await getVault(db, user.id, { credentialId: url.searchParams.get("credentialId"), keyVersion: url.searchParams.get("keyVersion") }), method);
  if (method === "GET" && url.pathname === "/api/chat/account/vaults")
    return success(await listAccountVaults(db, user.id), method);
  if (method === "PUT" && url.pathname === "/api/chat/account/vault/wrappers")
    return success(await saveVaultWrapper(db, user.id, await readJsonBody(request)), method);
  if (method === "PUT" && url.pathname === "/api/chat/account/vault")
    return success(await saveVault(db, user.id, await readJsonBody(request)), method);

  if (method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "conversations" && parts[3] && parts[4] === "epochs") {
    ensureAccountV2Enabled(env);
    await requireConversationMember(db, parts[3], user.id);
    const body = await readJsonBody(request);
    const epoch = Number(body.epoch);
    const recipients = Array.isArray(body.recipients) ? body.recipients : [];
    if (!Number.isInteger(epoch) || epoch < 1 || recipients.length < 1 || recipients.length > MAX_GROUP_MEMBERS) {
      throw new AuthError(400, "The account epoch request is invalid.", "INVALID_ACCOUNT_EPOCH");
    }
    const current = await db.prepare("SELECT MAX(epoch) AS epoch FROM chat_conversation_epochs WHERE conversation_id=?").bind(parts[3]).first();
    if (Number(current?.epoch || 0) + 1 !== epoch) throw new AuthError(409, "The conversation epoch is stale.", "EPOCH_CONFLICT");
    const memberRows = await db.prepare("SELECT user_id FROM chat_conversation_members WHERE conversation_id=? AND left_at IS NULL").bind(parts[3]).all();
    const activeMembers = new Set((memberRows.results || []).map((row) => row.user_id));
    if (recipients.some((item) => !activeMembers.has(item?.userId))) throw new AuthError(403, "Every epoch recipient must be an active conversation member.", "INVALID_ACCOUNT_EPOCH");
    const timestamp = nowIso();
    const statements = [db.prepare("INSERT INTO chat_conversation_epochs (conversation_id,epoch,created_by,created_at) VALUES (?,?,?,?)").bind(parts[3], epoch, user.id, timestamp)];
    for (const recipient of recipients) {
      const userId = boundedString(recipient.userId, "recipient.userId", 256);
      const keyVersion = boundedString(recipient.keyVersion || "1", "recipient.keyVersion", 64);
      const ephemeralPublicKey = boundedString(recipient.ephemeralPublicKey, "recipient.ephemeralPublicKey", 256);
      const nonce = boundedString(recipient.nonce, "recipient.nonce", 256);
      const ciphertext = boundedString(recipient.ciphertext, "recipient.ciphertext", MAX_CIPHERTEXT_LENGTH);
      if (![ephemeralPublicKey, nonce, ciphertext].every((value) => isBase64Url(value, MAX_CIPHERTEXT_LENGTH))) throw new AuthError(400, "The epoch envelope is invalid.", "INVALID_ACCOUNT_EPOCH");
      statements.push(db.prepare(`INSERT INTO chat_epoch_recipients (conversation_id,epoch,user_id,key_version,ephemeral_public_key,nonce,envelope_ciphertext,created_at) VALUES (?,?,?,?,?,?,?,?)`).bind(parts[3], epoch, userId, keyVersion, ephemeralPublicKey, nonce, ciphertext, timestamp));
    }
    statements.push(db.prepare("INSERT INTO chat_sync_events (conversation_id,event_type,entity_id,payload_ciphertext,created_at) VALUES (?,?,?,?,?)").bind(parts[3], "epoch", String(epoch), null, timestamp));
    await db.batch(statements);
    return success({ conversationId: parts[3], epoch, createdAt: timestamp }, method, 201);
  }
  if (method === "POST" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "conversations" && parts[3] && parts[4] === "leave") {
    ensureAccountV2Enabled(env);
    const conversation = await requireConversationMember(db, parts[3], user.id);
    if (conversation.kind !== "group") throw new AuthError(400, "Only group conversations can be left this way.", "INVALID_CONVERSATION");
    const member = await db.prepare("SELECT role FROM chat_conversation_members WHERE conversation_id=? AND user_id=? AND left_at IS NULL").bind(parts[3], user.id).first();
    if (member?.role === "owner") throw new AuthError(409, "Transfer ownership before leaving the group.", "OWNER_TRANSFER_REQUIRED");
    const timestamp = nowIso();
    await db.batch([
      db.prepare("UPDATE chat_conversation_members SET left_at=? WHERE conversation_id=? AND user_id=? AND left_at IS NULL").bind(timestamp, parts[3], user.id),
      db.prepare("UPDATE chat_conversations SET updated_at=? WHERE id=?").bind(timestamp, parts[3]),
      db.prepare("INSERT INTO chat_sync_events (conversation_id,event_type,entity_id,payload_ciphertext,created_at) VALUES (?,?,?,?,?)").bind(parts[3], "member-left", user.id, null, timestamp),
    ]);
    return success({ left: true, requiresEpochRotation: true }, method);
  }

  if (
    method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "conversations" &&
    parts[3] &&
    parts[4] === "epochs"
  ) {
    ensureAccountV2Enabled(env);
    return success(await listEpochs(db, parts[3], user.id), method);
  }
  if (method === "GET" && url.pathname === "/api/chat/sync-events") {
    ensureAccountV2Enabled(env);
    const conversationId = boundedString(
      url.searchParams.get("conversationId"),
      "conversationId",
      100
    );
    return success(await syncEvents(db, conversationId, user.id, url), method);
  }

  if (method === "GET" && url.pathname === "/api/chat/contacts")
    return success(await listContacts(db, user.id), method);
  if (method === "GET" && url.pathname === "/api/chat/users/search") {
    ensureAccountV2Enabled(env);
    return success(await searchChatUsers(db, user.id, url.searchParams.get("q")), method);
  }
  if (method === "POST" && url.pathname === "/api/chat/contacts/by-user-id") {
    ensureAccountV2Enabled(env);
    const body = await readJsonBody(request);
    return success(await addContactByChatUserId(db, user.id, body?.chatUserId), method, 201);
  }
  if (method === "GET" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "contacts" && parts[4] === "account-bundle") {
    const contact = await requireContact(db, parts[3], user.id);
    const account = await accountKeyBundle(db, contact.peer_user_id);
    // Expose only the readiness bit and public account key. Credential IDs and
    // vault versions are not needed by the contact picker and should remain
    // out of the UI response.
    return success({ contactId: parts[3], accountKey: account.accountKey, enabled: account.enabled }, method);
  }
  if (
    method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "contacts" &&
    parts[4] === "bundle"
  ) {
    return success(await getPrekeyBundle(db, contactIdFromParts(parts), user.id), method);
  }
  if (
    method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "conversations" &&
    parts[3] &&
    parts[4] === "bundle"
  ) {
    return success(await getConversationPrekeyBundle(db, parts[3], user.id), method);
  }
  if (method === "GET" && parts[0] === "api" && parts[1] === "chat" && parts[2] === "conversations" && parts[3] && parts[4] === "account-bundle") {
    ensureAccountV2Enabled(env);
    await requireConversationMember(db, parts[3], user.id);
    const members = await db.prepare(`SELECT m.user_id,p.chat_alias,p.avatar_data_url,m.role
      FROM chat_conversation_members m LEFT JOIN chat_profiles p ON p.user_id=m.user_id
      WHERE m.conversation_id=? AND m.left_at IS NULL ORDER BY m.joined_at,m.user_id`).bind(parts[3]).all();
    const result = [];
    for (const member of members.results || []) {
      const account = await accountKeyBundle(db, member.user_id);
      result.push({ userId: member.user_id, alias: member.chat_alias || "Paired contact",
      avatarDataUrl: member.avatar_data_url || "", role: member.role, accountKey: account.accountKey });
    }
    return success({ conversationId: parts[3], members: result }, method);
  }
  if (method === "GET" && url.pathname === "/api/chat/devices/bundle") {
    const excludeDeviceId = url.searchParams.get("excludeDeviceId") || "";
    await requireOwnedDevice(db, excludeDeviceId, user.id);
    return success(await getOwnPrekeyBundle(db, user.id, excludeDeviceId), method);
  }

  if (method === "GET" && url.pathname === "/api/chat/devices")
    return success(await listDevices(db, user.id), method);
  if (
    method === "POST" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "devices" &&
    parts[3] &&
    parts[4] === "prekeys"
  ) {
    const body = await readJsonBody(request);
    return success(await refillDevicePrekeys(db, user.id, parts[3], body), method, 201);
  }
  if (method === "POST" && url.pathname === "/api/chat/devices/approval") {
    const body = await readJsonBody(request);
    return success(
      await createDeviceApprovalTicket(db, user.id, boundedString(body.deviceId, "deviceId", 100)),
      method,
      201
    );
  }
  if (method === "POST" && url.pathname === "/api/chat/devices") {
    return success(await registerDevice(db, user.id, await readJsonBody(request)), method, 201);
  }
  if (
    method === "DELETE" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "devices" &&
    parts[3]
  ) {
    await requireOwnedDevice(db, parts[3], user.id);
    await db
      .prepare(
        "UPDATE chat_devices SET revoked_at = ?, updated_at = ? WHERE id = ? AND user_id = ?"
      )
      .bind(nowIso(), nowIso(), parts[3], user.id)
      .run();
    return success({ revoked: true }, method);
  }

  if (method === "GET" && url.pathname === "/api/chat/profile") {
    return success(mapProfile(await ensureProfile(db, user.id)), method);
  }
  if (method === "PATCH" && url.pathname === "/api/chat/profile") {
    const body = await readJsonBody(request);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new AuthError(400, "Chat profile must be an object.", "INVALID_CHAT_PROFILE");
    const current = await ensureProfile(db, user.id);
    const alias = body.alias === undefined ? current.chat_alias
      : typeof body.alias === "string" ? body.alias.trim() : "";
    const chatUserId = body.chatUserId === undefined ? current.chat_user_id
      : typeof body.chatUserId === "string" ? body.chatUserId.trim() : "";
    if (!validChatUserId(chatUserId)) {
      throw new AuthError(400, "Chat ID must be 3–48 letters, numbers, dots, hyphens or underscores.", "INVALID_CHAT_USER_ID");
    }
    const profileCiphertext =
      typeof body.profileCiphertext === "string"
        ? boundedString(body.profileCiphertext, "profileCiphertext", MAX_PROFILE_CIPHERTEXT_LENGTH)
        : current.profile_ciphertext;
    if (!/^[\p{L}\p{N} _.-]{2,48}$/u.test(alias)) {
      throw new AuthError(
        400,
        "Chat nickname must contain 2–48 letters, numbers, spaces, underscores, dots or hyphens.",
        "INVALID_CHAT_ALIAS"
      );
    }
    const avatarDataUrl = body.avatarDataUrl === undefined ? current.avatar_data_url || ""
      : validateAvatarDataUrl(body.avatarDataUrl);
    try { await db
      .prepare(
        `UPDATE chat_profiles SET chat_alias = ?, chat_user_id = ?, profile_ciphertext = ?, avatar_data_url = ?, updated_at = ? WHERE user_id = ?`
      )
      .bind(alias, chatUserId, profileCiphertext, avatarDataUrl, nowIso(), user.id)
      .run(); } catch (error) {
      if (/UNIQUE constraint failed:\s*chat_profiles\.chat_alias/.test(String(error?.message || error)))
        throw new AuthError(409, "This chat nickname is already in use. Choose another one.", "CHAT_ALIAS_TAKEN");
      if (/UNIQUE constraint failed:\s*chat_profiles\.chat_user_id/.test(String(error?.message || error)))
        throw new AuthError(409, "This chat ID is already in use. Choose another one.", "CHAT_USER_ID_TAKEN");
      throw error;
    }
    return success(mapProfile(await ensureProfile(db, user.id)), method);
  }

  if (method === "GET" && url.pathname === "/api/chat/conversations") {
    const rows = await db
      .prepare(
        `
      SELECT c.*
      FROM chat_conversations c JOIN chat_conversation_members m ON m.conversation_id = c.id
      WHERE m.user_id = ? AND m.left_at IS NULL AND m.history_hidden_at IS NULL AND c.deleted_at IS NULL
      ORDER BY c.updated_at DESC
    `
      )
      .bind(user.id)
      .all();
    const conversations = [];
    for (const row of rows.results || [])
      conversations.push(await mapConversation(db, row, user.id));
    return success(conversations, method);
  }
  if (method === "POST" && url.pathname === "/api/chat/conversations") {
    const body = await readJsonBody(request);
    if (body?.kind === "group") {
      return success(await createGroupConversation(db, user.id, body), method, 201);
    }
    const contact = await requireContact(
      db,
      boundedString(body.contactId, "contactId", 100),
      user.id
    );
    const existing = await existingDirectConversation(db, user.id, contact.peer_user_id);
    if (existing) return success(await mapConversation(db, existing, user.id), method);
    const timestamp = nowIso();
    const id = randomId();
    await db.batch([
      db
        .prepare(
          `INSERT INTO chat_conversations (id, kind, created_by, retention_seconds, created_at, updated_at)
        VALUES (?, 'direct', ?, 2592000, ?, ?)`
        )
        .bind(id, user.id, timestamp, timestamp),
      db
        .prepare(
          `INSERT INTO chat_conversation_members (conversation_id, user_id, role, joined_at)
        VALUES (?, ?, 'owner', ?), (?, ?, 'member', ?)`
        )
        .bind(id, user.id, timestamp, id, contact.peer_user_id, timestamp),
    ]);
    return success(
      await mapConversation(
        db,
        {
          id,
          kind: "direct",
          created_by: user.id,
          retention_seconds: 2592000,
          created_at: timestamp,
          updated_at: timestamp,
        },
        user.id
      ),
      method,
      201
    );
  }
  if (
    method === "PATCH" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "conversations" &&
    parts[3] &&
    parts[4] === "settings"
  ) {
    await requireConversationMember(db, parts[3], user.id);
    const body = await readJsonBody(request);
    const retentionSeconds = Number(body.retentionSeconds);
    if (!RETENTION_OPTIONS.has(retentionSeconds))
      throw new AuthError(400, "Unsupported retention period.", "INVALID_RETENTION");
    await db
      .prepare("UPDATE chat_conversations SET retention_seconds = ?, updated_at = ? WHERE id = ?")
      .bind(retentionSeconds, nowIso(), parts[3])
      .run();
    return success({ retentionSeconds }, method);
  }

  if (method === "GET" && url.pathname === "/api/chat/sync")
    return success(await syncMessages(db, user.id, url), method);
  if (method === "POST" && url.pathname === "/api/chat/messages")
    return success(await postMessage(db, env, user.id, await readJsonBody(request)), method, 201);
  if (
    method === "POST" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "messages" &&
    parts[4] === "delete"
  ) {
    const row = await db
      .prepare(
        `
      SELECT m.id, m.sender_device_id FROM chat_messages m
      JOIN chat_conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = ? AND cm.left_at IS NULL
      WHERE m.id = ?
    `
      )
      .bind(user.id, parts[3])
      .first();
    if (!row) throw new AuthError(404, "Message not found.", "MESSAGE_NOT_FOUND");
    const owner = await db
      .prepare("SELECT user_id FROM chat_devices WHERE id = ?")
      .bind(row.sender_device_id)
      .first();
    if (owner?.user_id !== user.id)
      throw new AuthError(403, "Only the sender can delete this message.", "FORBIDDEN");
    await db
      .prepare("UPDATE chat_messages SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .bind(nowIso(), parts[3])
      .run();
    return success({ deleted: true }, method);
  }

  if (method === "POST" && url.pathname === "/api/chat/attachments/init")
    return success(
      await initAttachment(db, env, user.id, await readJsonBody(request)),
      method,
      201
    );
  if (
    method === "PUT" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "attachments" &&
    parts[3]
  )
    return success(await putAttachment(db, env, user.id, parts[3], request), method);
  if (
    method === "POST" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "attachments" &&
    parts[4] === "complete"
  )
    return success(await completeAttachment(db, env, user.id, parts[3]), method);
  if (
    method === "GET" &&
    parts[0] === "api" &&
    parts[1] === "chat" &&
    parts[2] === "attachments" &&
    parts[3]
  )
    return getAttachment(db, env, user.id, parts[3]);

  if (method === "POST" && url.pathname === "/api/chat/ws-ticket")
    return success(
      await issueWebSocketTicket(db, user.id, await readJsonBody(request)),
      method,
      201
    );

  if (method === "GET" && url.pathname === "/api/chat/key-backup") {
    ensureRecoveryEnabled(env);
    const row = await db
      .prepare(
        `SELECT kdf_version, salt, nonce, ciphertext, source_device_id,
        backup_version, restore_operation_id, restored_device_id, consumed_at, created_at, updated_at
      FROM chat_key_backups WHERE user_id = ?`
      )
      .bind(user.id)
      .first();
    return success(
      row
        ? {
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
          }
        : null,
      method
    );
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
    const restoreOperationId = boundedString(
      body.restoreOperationId || randomId(),
      "restoreOperationId",
      100
    );
    if (![salt, nonce, ciphertext].every((value) => isBase64Url(value, 512 * 1024)))
      throw new AuthError(400, "Encrypted backup fields are invalid.", "INVALID_BACKUP");
    const timestamp = nowIso();
    await db
      .prepare(
        `
      INSERT INTO chat_key_backups
        (user_id, kdf_version, salt, nonce, ciphertext, source_device_id, backup_version, restore_operation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET kdf_version = excluded.kdf_version, salt = excluded.salt,
        nonce = excluded.nonce, ciphertext = excluded.ciphertext, source_device_id = excluded.source_device_id,
        backup_version = excluded.backup_version, restore_operation_id = excluded.restore_operation_id, restored_device_id = NULL,
        consumed_at = NULL, updated_at = excluded.updated_at
    `
      )
      .bind(
        user.id,
        kdfVersion,
        salt,
        nonce,
        ciphertext,
        sourceDeviceId,
        backupVersion,
        restoreOperationId,
        timestamp,
        timestamp
      )
      .run();
    return success({ saved: true, updatedAt: timestamp }, method);
  }
  if (method === "POST" && url.pathname === "/api/chat/key-backup/restore") {
    const body = await readJsonBody(request);
    return success(await restoreKeyBackup(db, env, user.id, body), method, 201);
  }

  if (method === "POST" && url.pathname === "/api/chat/reports") {
    const body = await readJsonBody(request);
    const evidenceCiphertext = boundedString(
      body.evidenceCiphertext,
      "evidenceCiphertext",
      MAX_EVIDENCE_LENGTH
    );
    const evidenceKeyVersion = boundedString(body.evidenceKeyVersion, "evidenceKeyVersion", 64);
    if (!isBase64Url(evidenceCiphertext, MAX_EVIDENCE_LENGTH))
      throw new AuthError(400, "Encrypted evidence is invalid.", "INVALID_EVIDENCE");
    const conversationId = body.conversationId
      ? boundedString(body.conversationId, "conversationId", 100)
      : null;
    const messageId = body.messageId ? boundedString(body.messageId, "messageId", 100) : null;
    if (conversationId) await requireConversationMember(db, conversationId, user.id);
    if (messageId) {
      const message = await db
        .prepare(
          `
        SELECT m.id, m.conversation_id FROM chat_messages m
        JOIN chat_conversation_members cm ON cm.conversation_id = m.conversation_id
          AND cm.user_id = ? AND cm.left_at IS NULL
        WHERE m.id = ?
      `
        )
        .bind(user.id, messageId)
        .first();
      if (!message || (conversationId && message.conversation_id !== conversationId)) {
        throw new AuthError(404, "Message not found.", "MESSAGE_NOT_FOUND");
      }
    }
    const timestamp = nowIso();
    await db
      .prepare(
        `
      INSERT INTO chat_reports (id, reporter_user_id, conversation_id, message_id, evidence_ciphertext, evidence_key_version, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .bind(
        randomId(),
        user.id,
        conversationId,
        messageId,
        evidenceCiphertext,
        evidenceKeyVersion,
        timestamp
      )
      .run();
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
    if (error instanceof AuthError)
      return withCors(
        request,
        failure(error.status, error.code, error.message, request.method, error.details)
      );
    console.error("Chat API request failed", error);
    return withCors(
      request,
      failure(500, "INTERNAL_SERVER_ERROR", "Chat request failed.", request.method)
    );
  }
}

export async function handleChatWebSocketRequest(request, env) {
  try {
    ensureEnabled(env);
    if (request.headers.get("Upgrade") !== "websocket")
      throw new AuthError(426, "Expected a WebSocket upgrade.", "WEBSOCKET_REQUIRED");
    const url = new URL(request.url);
    const conversationId = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) || "");
    if (!conversationId) throw new AuthError(400, "Conversation is required.", "INVALID_INPUT");
    const protocols = String(request.headers.get("Sec-WebSocket-Protocol") || "")
      .split(",")
      .map((value) => value.trim());
    const ticketProtocol = protocols.find((value) => value.startsWith("ticket."));
    if (!ticketProtocol)
      throw new AuthError(401, "A one-time chat ticket is required.", "WS_TICKET_REQUIRED");
    const ticket = ticketProtocol.slice("ticket.".length);
    const ticketRow = await acceptWebSocketTicket(env.DB, ticket, conversationId);
    const conversation = await env.DB.prepare(`SELECT c.protocol_version FROM chat_conversations c
      JOIN chat_conversation_members m ON m.conversation_id=c.id
      WHERE c.id=? AND m.user_id=? AND m.left_at IS NULL AND c.deleted_at IS NULL`)
      .bind(conversationId,ticketRow.user_id).first();
    if (!conversation) throw new AuthError(404,"Conversation not found.","CONVERSATION_NOT_FOUND");
    const protocol = conversation.protocol_version === "account-v2" ? "expassway-chat-v2" : "expassway-chat-v1";
    if (conversation.protocol_version === "account-v2") ensureAccountV2Enabled(env);
    else await requireOwnedDevice(env.DB,ticketRow.device_id,ticketRow.user_id);
    if (!protocols.includes(protocol)) throw new AuthError(400,"The chat WebSocket protocol does not match this conversation.","PROTOCOL_MISMATCH");
    if (!env.CHAT_ROOMS)
      throw new AuthError(
        503,
        "Chat realtime storage is not configured yet.",
        "CHAT_REALTIME_NOT_CONFIGURED"
      );
    const roomId = env.CHAT_ROOMS.idFromName(conversationId);
    const roomRequest = new Request("https://chat-room/connect", {
      method: "GET",
      headers: {
        Upgrade: "websocket",
        "X-Chat-User": ticketRow.user_id,
        ...(ticketRow.device_id ? { "X-Chat-Device": ticketRow.device_id } : {}),
        "X-Chat-Conversation": ticketRow.conversation_id,
        "X-Chat-Protocol": protocol,
      },
    });
    return env.CHAT_ROOMS.get(roomId).fetch(roomRequest);
  } catch (error) {
    if (error instanceof AuthError)
      return withCors(request, failure(error.status, error.code, error.message, request.method));
    return withCors(
      request,
      failure(500, "INTERNAL_SERVER_ERROR", "Chat realtime connection failed.", request.method)
    );
  }
}

export async function cleanupChatData(env) {
  if (!env.DB) return;
  // Capture one cutoff before doing any work: a concurrent request reserving a
  // new challenge or cooldown after this point must remain valid.
  const nowMs = Date.now();
  const timestamp = new Date(nowMs).toISOString();
  const nowSeconds = Math.floor(nowMs / 1000);
  const minuteStart = Math.floor(nowSeconds / 60) * 60;
  await cleanupAccountV2(env.DB, timestamp);
  if (env.CHAT_MEDIA_BUCKET) {
    const expired = await env.DB.prepare(
      `
      SELECT id,object_key FROM chat_attachments
      WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR status = 'deleted'
      LIMIT 500
    `
    )
      .bind(timestamp)
      .all();
    const attachments = expired.results || [];
    if (attachments.length) {
      await env.CHAT_MEDIA_BUCKET.delete(attachments.map((row) => row.object_key));
      const deletions = [];
      for (let offset = 0; offset < attachments.length; offset += 90) {
        const ids = attachments.slice(offset, offset + 90).map((row) => row.id);
        deletions.push(env.DB.prepare(`DELETE FROM chat_attachments WHERE id IN (${ids.map(() => "?").join(",")})
          AND ((expires_at IS NOT NULL AND expires_at <= ?) OR status='deleted')`).bind(...ids,timestamp));
      }
      await env.DB.batch(deletions);
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM chat_messages WHERE protocol_version <> 'account-v2' AND expires_at IS NOT NULL AND expires_at <= ?"
    ).bind(timestamp),
    env.DB.prepare(
      "DELETE FROM chat_device_prekeys WHERE consumed_at IS NOT NULL AND consumed_at <= datetime(?, '-1 day')"
    ).bind(timestamp),
    env.DB.prepare("DELETE FROM chat_ws_tickets WHERE julianday(expires_at) <= julianday(?) OR used_at IS NOT NULL").bind(
      timestamp
    ),
    env.DB.prepare(
      "DELETE FROM chat_device_approval_tickets WHERE julianday(expires_at) <= julianday(?) OR used_at IS NOT NULL"
    ).bind(timestamp),
    env.DB.prepare(
      "DELETE FROM chat_reports WHERE expires_at IS NOT NULL AND expires_at <= ?"
    ).bind(timestamp),
    env.DB.prepare(
      "DELETE FROM chat_webauthn_challenges WHERE used_at IS NOT NULL OR julianday(expires_at) <= julianday(?)"
    ).bind(timestamp),
    env.DB.prepare(
      "DELETE FROM auth_passkey_challenges WHERE used_at IS NOT NULL OR julianday(expires_at) <= julianday(?)"
    ).bind(timestamp),
    env.DB.prepare(
      // The final authorized write reads proof metadata after consuming its
      // last use. Keep exhausted proofs until expiry to preserve that request.
      "DELETE FROM chat_account_write_proofs WHERE julianday(expires_at) <= julianday(?)"
    ).bind(timestamp),
    env.DB.prepare("DELETE FROM email_otp_cooldowns WHERE available_at <= ?").bind(nowSeconds),
    env.DB.prepare("DELETE FROM chat_rate_limits WHERE action = 'invite' OR window_start < ?").bind(minuteStart),
    env.DB.prepare("DELETE FROM ai_call_cooldowns WHERE called_at <= ?").bind(nowMs - AI_CALL_COOLDOWN_MS),
  ]);
}
