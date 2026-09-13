import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from "@privacyresearch/libsignal-protocol-typescript";
import sodium from "libsodium-wrappers-sumo";

const DB_NAME = "expassway-chat-crypto-v1";
const STORE_NAME = "vault";
const ACCOUNT_V2_VAULT_FORMAT = "expassway-chat-account-v2";
const ACCOUNT_V2_VAULT_VERSION = 2;
const ACCOUNT_V2_KDF_VERSION = "hkdf-sha256-v1";
const ACCOUNT_V2_PROTOCOL_VERSION = "account-v2";
const state = {
  identityKeyPair: null,
  registrationId: null,
  devices: {},
  sessions: {},
  trustedIdentities: {},
  sentPlaintexts: {},
  currentDeviceId: null,
  recoveryCandidate: null,
  verifiedSafetyNumbers: {},
  safetyNumberChanges: {},
  // Account-v2 secrets intentionally never enter IndexedDB. They live only for
  // the lifetime of this worker after a successful Passkey PRF unlock.
  accountV2: null,
  accountV2Candidate: null,
};

const deviceLocks = new Map();
let sodiumReadyPromise = null;

function cryptoError(code, message, cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
  return error;
}

function classifyCryptoError(error, fallbackCode = "DECRYPT_FAILED") {
  if (error?.code) return error;
  const text = String(error?.message || error || "").toLowerCase();
  if (text.includes("identity") || text.includes("trusted")) {
    return cryptoError("IDENTITY_CHANGED", "The peer identity key changed. Verify the safety number before continuing.", error);
  }
  if (text.includes("replay") || text.includes("duplicate") || text.includes("already processed")) {
    return cryptoError("DUPLICATE_OR_REPLAY", "This encrypted message was already processed.", error);
  }
  if (text.includes("gap") || text.includes("counter")) {
    return cryptoError("MESSAGE_GAP_TOO_LARGE", "The encrypted message counter gap is too large.", error);
  }
  if (text.includes("session") && text.includes("missing")) {
    return cryptoError("SESSION_MISSING", "The secure session is missing. Re-establish it before sending.", error);
  }
  return cryptoError(fallbackCode, "The encrypted message could not be processed.", error);
}

async function getSodium() {
  if (!sodiumReadyPromise) sodiumReadyPromise = sodium.ready.then(() => sodium);
  return sodiumReadyPromise;
}

function requireString(value, name) {
  if (typeof value !== "string" || !value) throw cryptoError("INVALID_INPUT", `${name} is required.`);
  return value;
}

function accountAad(conversationId, messageId, epoch, senderUserId) {
  return new TextEncoder().encode(`expassway-account-v2|${requireString(conversationId, "conversationId")}|${requireString(messageId, "messageId")}|${Number(epoch)}|${requireString(senderUserId, "senderUserId")}`);
}

async function hkdfKey(prfOutput, salt, info, usages) {
  const ikm = toByteArray(prfOutput);
  if (ikm.length < 16) throw cryptoError("INVALID_INPUT", "PRF output is too short.");
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: toByteArray(salt), info: new TextEncoder().encode(String(info)) }, base, 256);
  return crypto.subtle.importKey("raw", bits, "AES-GCM", false, usages);
}

async function generateAccountVault() {
  const s = await getSodium();
  const root = s.randombytes_buf(32);
  const encryption = s.crypto_box_keypair();
  const signing = s.crypto_sign_keypair();
  const fingerprint = bytesToBase64Url(await crypto.subtle.digest("SHA-256", signing.publicKey)).slice(0, 32);
  return {
    version: "account-v2",
    rootKey: bytesToBase64Url(root),
    encryptionKeyPair: { publicKey: bytesToBase64Url(encryption.publicKey), privateKey: bytesToBase64Url(encryption.privateKey) },
    signingKeyPair: { publicKey: bytesToBase64Url(signing.publicKey), privateKey: bytesToBase64Url(signing.privateKey) },
    bundle: { version: "account-v2", encryptionPublicKey: bytesToBase64Url(encryption.publicKey), signingPublicKey: bytesToBase64Url(signing.publicKey), fingerprint },
  };
}

async function wrapAccountVault({ vault, prfOutput, salt } = {}) {
  if (!vault || typeof vault !== "object") throw cryptoError("INVALID_INPUT", "vault is required.");
  const saltBytes = salt ? toByteArray(salt) : crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await hkdfKey(prfOutput, saltBytes, "expassway-account-v2-vault", ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, new TextEncoder().encode(JSON.stringify(vault)));
  return { version: "account-v2", kdfVersion: "hkdf-sha256-v1", salt: bytesToBase64Url(saltBytes), nonce: bytesToBase64Url(nonce), ciphertext: bytesToBase64Url(ciphertext) };
}

async function unwrapAccountVault({ wrapped, prfOutput } = {}) {
  if (!wrapped?.salt || !wrapped?.nonce || !wrapped?.ciphertext) throw cryptoError("INVALID_INPUT", "Invalid wrapped vault.");
  try {
    const key = await hkdfKey(prfOutput, base64ToBytes(wrapped.salt), "expassway-account-v2-vault", ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(wrapped.nonce) }, key, base64ToBytes(wrapped.ciphertext));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) { throw cryptoError("VAULT_UNLOCK_FAILED", "The account vault could not be unlocked.", error); }
}

async function createConversationEpoch({ conversationId, epoch = 1, contentKey, recipients = [] } = {}) {
  const s = await getSodium();
  const key = contentKey ? toByteArray(contentKey) : s.randombytes_buf(32);
  if (key.length !== 32) throw cryptoError("INVALID_INPUT", "contentKey must be 32 bytes.");
  const envelopes = recipients.map((recipient) => {
    const userId = requireString(recipient.userId, "recipient.userId");
    const keyVersion = requireString(recipient.keyVersion || "1", "recipient.keyVersion");
    const publicKey = base64ToBytes(requireString(recipient.encryptionPublicKey, "recipient.encryptionPublicKey"));
    if (publicKey.length !== s.crypto_box_PUBLICKEYBYTES) throw cryptoError("INVALID_INPUT", "Invalid recipient encryption key.");
    return { userId, keyVersion, ephemeralPublicKey: null, nonce: null, envelopeCiphertext: bytesToBase64Url(s.crypto_box_seal(key, publicKey)) };
  });
  return { conversationId: requireString(conversationId, "conversationId"), epoch: Number(epoch), contentKey: bytesToBase64Url(key), recipients: envelopes };
}

async function openEpochEnvelope({ envelopeCiphertext, encryptionKeyPair } = {}) {
  const s = await getSodium();
  const pair = { publicKey: base64ToBytes(encryptionKeyPair?.publicKey), privateKey: base64ToBytes(encryptionKeyPair?.privateKey) };
  const opened = s.crypto_box_seal_open(base64ToBytes(requireString(envelopeCiphertext, "envelopeCiphertext")), pair.publicKey, pair.privateKey);
  return { contentKey: bytesToBase64Url(opened) };
}

async function encryptAccountV2Message({ conversationId, messageId, epoch, senderUserId, contentKey, plaintext, signingPrivateKey } = {}) {
  const keyBytes = toByteArray(contentKey); if (keyBytes.length !== 32) throw cryptoError("INVALID_INPUT", "contentKey must be 32 bytes.");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: accountAad(conversationId, messageId, epoch, senderUserId) }, key, new TextEncoder().encode(String(plaintext)));
  const signature = signingPrivateKey ? (await getSodium()).crypto_sign_detached(new Uint8Array(ciphertext), base64ToBytes(signingPrivateKey)) : null;
  return { version: "account-v2", epoch: Number(epoch), nonce: bytesToBase64Url(nonce), ciphertext: bytesToBase64Url(ciphertext), senderKeyId: "1", signature: signature ? bytesToBase64Url(signature) : null };
}

async function decryptAccountV2Message({ conversationId, messageId, epoch, senderUserId, contentKey, nonce, ciphertext, signature, signingPublicKey } = {}) {
  const key = await crypto.subtle.importKey("raw", toByteArray(contentKey), "AES-GCM", false, ["decrypt"]);
  const encrypted = base64ToBytes(requireString(ciphertext, "ciphertext"));
  if (signature && signingPublicKey && !(await getSodium()).crypto_sign_verify_detached(base64ToBytes(signature), encrypted, base64ToBytes(signingPublicKey))) throw cryptoError("SIGNATURE_INVALID", "Message signature is invalid.");
  try { const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(nonce), additionalData: accountAad(conversationId, messageId, epoch, senderUserId) }, key, encrypted); return new TextDecoder().decode(plain); }
  catch (error) { throw cryptoError("DECRYPT_FAILED", "The account-v2 message could not be decrypted.", error); }
}

async function withDeviceLock(deviceId, fn) {
  const key = String(deviceId || "global");
  const previous = deviceLocks.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(fn);
  deviceLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (deviceLocks.get(key) === current) deviceLocks.delete(key);
  }
}

function withSessionLock(deviceId, peerDeviceId, peerDeviceNumber, fn) {
  const key = `${deviceId || "global"}|${peerDeviceId || "peer"}|${Number(peerDeviceNumber) || 0}`;
  return withDeviceLock(key, fn);
}

function toByteArray(value) {
  // Vault snapshots store key material as base64 strings; runtime libsignal keys are buffers.
  // Normalize both forms before encoding so a persisted pre-key is never encoded as an empty buffer.
  if (typeof value === "string") return base64ToBytes(value);
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value || []);
}

function bytesToBase64(bytes) {
  const array = toByteArray(bytes);
  let binary = "";
  for (const byte of array) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function binaryStringToBase64Url(value) {
  return bytesToBase64Url(Uint8Array.from(String(value), (character) => character.charCodeAt(0)));
}

function base64UrlToBinaryString(value) {
  return String.fromCharCode(...base64ToBytes(value));
}

function utf8(value) {
  return new TextEncoder().encode(String(value));
}

function accountV2Error(code, message, cause) {
  return cryptoError(code, message, cause);
}

function requiredBase64Bytes(value, field, expectedLength = null) {
  if (typeof value !== "string" || !value) throw accountV2Error("INVALID_ACCOUNT_V2_INPUT", `${field} is required.`);
  let bytes;
  try {
    bytes = base64ToBytes(value);
  } catch (error) {
    throw accountV2Error("INVALID_ACCOUNT_V2_INPUT", `${field} is not valid base64url.`, error);
  }
  if (expectedLength !== null && bytes.byteLength !== expectedLength) {
    throw accountV2Error("INVALID_ACCOUNT_V2_INPUT", `${field} has an invalid length.`);
  }
  return bytes;
}

function requiredAccountV2String(value, field, maxLength = 512) {
  const normalized = String(value || "");
  if (!normalized || normalized.length > maxLength) throw accountV2Error("INVALID_ACCOUNT_V2_INPUT", `${field} is invalid.`);
  return normalized;
}

function validEpoch(value) {
  const epoch = Number(value);
  if (!Number.isInteger(epoch) || epoch < 1 || epoch > 2147483647) {
    throw accountV2Error("INVALID_ACCOUNT_V2_INPUT", "epoch is invalid.");
  }
  return epoch;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw accountV2Error("INVALID_ACCOUNT_V2_INPUT", "The signed payload contains an invalid number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  throw accountV2Error("INVALID_ACCOUNT_V2_INPUT", "The signed payload contains an unsupported value.");
}

async function accountV2Hkdf(ikm, salt, info) {
  const material = await crypto.subtle.importKey("raw", toByteArray(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "HKDF",
    hash: "SHA-256",
    salt: toByteArray(salt),
    info: utf8(info),
  }, material, 256);
  return new Uint8Array(bits);
}

async function accountV2AesGcmEncrypt(keyBytes, plaintext, aad) {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", toByteArray(keyBytes), "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: toByteArray(aad) },
    key,
    toByteArray(plaintext),
  );
  return { nonce, ciphertext: new Uint8Array(ciphertext) };
}

async function accountV2AesGcmDecrypt(keyBytes, nonce, ciphertext, aad, code = "ACCOUNT_V2_DECRYPT_FAILED") {
  try {
    const key = await crypto.subtle.importKey("raw", toByteArray(keyBytes), "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toByteArray(nonce), additionalData: toByteArray(aad) },
      key,
      toByteArray(ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    throw accountV2Error(code, "The account-encrypted data could not be authenticated or decrypted.", error);
  }
}

async function accountV2Fingerprint(encryptionPublicKey, signingPublicKey) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    utf8(`${bytesToBase64Url(encryptionPublicKey)}.${bytesToBase64Url(signingPublicKey)}`),
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function accountV2VaultAad(userId, keyVersion) {
  return utf8(`expassway-chat-account-v2-vault|${String(userId)}|${String(keyVersion)}|${ACCOUNT_V2_KDF_VERSION}`);
}

function accountV2EnvelopeAad({ conversationId, epoch, userId, keyVersion, ephemeralPublicKey }) {
  return utf8(`expassway-chat-account-v2-envelope|${String(conversationId)}|${Number(epoch)}|${String(userId)}|${String(keyVersion)}|${String(ephemeralPublicKey)}`);
}

function accountV2MessageAad({ conversationId, clientMessageId, epoch, senderUserId }) {
  return utf8(`expassway-chat-account-v2-message|${String(conversationId)}|${String(clientMessageId)}|${Number(epoch)}|${String(senderUserId)}`);
}

function accountV2EpochKey(conversationId, epoch) {
  return `${String(conversationId)}:${Number(epoch)}`;
}

function accountV2RequireUnlocked() {
  if (!state.accountV2) {
    throw accountV2Error("ACCOUNT_VAULT_LOCKED", "Unlock the account chat vault with a Passkey before using encrypted chat.");
  }
  return state.accountV2;
}

function accountV2PublicBundle(account) {
  return {
    userId: account.userId,
    keyVersion: account.keyVersion,
    encryptionPublicKey: bytesToBase64Url(account.encryptionPublicKey),
    signingPublicKey: bytesToBase64Url(account.signingPublicKey),
    fingerprint: account.fingerprint,
    status: "active",
  };
}

function accountV2WipeAccount(account) {
  if (!account) return;
  for (const value of [account.vaultRootKey, account.encryptionPrivateKey, account.signingPrivateKey]) {
    if (value instanceof Uint8Array) value.fill(0);
  }
  for (const value of account.epochKeys?.values?.() || []) value.fill(0);
  account.epochKeys?.clear?.();
}

function randomRegistrationId() {
  const values = new Uint16Array(1);
  crypto.getRandomValues(values);
  return Math.max(1, values[0] & 0x3fff);
}

function cloneKeyPair(pair) {
  if (!pair) return null;
  return {
    pubKey: bytesToBase64(pair.pubKey),
    privKey: bytesToBase64(pair.privKey),
  };
}

function restoreKeyPair(pair) {
  return pair ? { pubKey: base64ToBytes(pair.pubKey).buffer, privKey: base64ToBytes(pair.privKey).buffer } : null;
}

function encodeRecoveryValue(value) {
  if (value instanceof ArrayBuffer) return { __type: "arraybuffer", value: bytesToBase64Url(value) };
  if (ArrayBuffer.isView(value)) return { __type: "arraybuffer", value: bytesToBase64Url(value) };
  if (Array.isArray(value)) return value.map(encodeRecoveryValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeRecoveryValue(item)]));
  }
  return value;
}

function decodeRecoveryValue(value) {
  if (Array.isArray(value)) return value.map(decodeRecoveryValue);
  if (value && typeof value === "object") {
    if (value.__type === "arraybuffer" && typeof value.value === "string") return base64ToBytes(value.value).buffer;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeRecoveryValue(item)]));
  }
  return value;
}

function serializeRecoveryDevice(device) {
  return {
    label: device.label || "",
    registrationId: device.registrationId,
    signedPreKeyId: device.signedPreKeyId,
    identityKeyPair: cloneKeyPair(device.identityKeyPair),
    signedPreKey: device.signedPreKey ? {
      publicKey: bytesToBase64Url(device.signedPreKey.publicKey),
      signature: bytesToBase64Url(device.signedPreKey.signature),
    } : null,
    oneTimePreKeys: (device.oneTimePreKeys || []).map((item) => ({
      id: item.id,
      keyPair: cloneKeyPair(item.keyPair),
    })),
    preKeys: Object.fromEntries(Object.entries(device.preKeys || {}).map(([id, pair]) => [id, cloneKeyPair(pair)])),
    signedPreKeys: Object.fromEntries(Object.entries(device.signedPreKeys || {}).map(([id, pair]) => [id, cloneKeyPair(pair)])),
  };
}

function restoreRecoveryDevice(device) {
  return {
    label: device.label || "",
    registrationId: device.registrationId,
    signedPreKeyId: device.signedPreKeyId,
    identityKeyPair: restoreKeyPair(device.identityKeyPair),
    signedPreKey: device.signedPreKey ? {
      publicKey: base64ToBytes(device.signedPreKey.publicKey).buffer,
      signature: base64ToBytes(device.signedPreKey.signature).buffer,
    } : null,
    oneTimePreKeys: (device.oneTimePreKeys || []).map((item) => ({ id: item.id, keyPair: restoreKeyPair(item.keyPair) })),
    preKeys: Object.fromEntries(Object.entries(device.preKeys || {}).map(([id, pair]) => [id, restoreKeyPair(pair)])),
    signedPreKeys: Object.fromEntries(Object.entries(device.signedPreKeys || {}).map(([id, pair]) => [id, restoreKeyPair(pair)])),
  };
}

function recoverySnapshot(sourceDeviceId, userId) {
  const device = state.devices[sourceDeviceId];
  if (!device || !device.identityKeyPair) throw cryptoError("SESSION_MISSING", "The source device is not available in this browser.");
  return {
    format: "expassway-chat-recovery-v1",
    version: 1,
    userId: String(userId || ""),
    sourceDeviceId: String(sourceDeviceId),
    createdAt: new Date().toISOString(),
    identityKeyPair: cloneKeyPair(device.identityKeyPair),
    registrationId: device.registrationId,
    devices: Object.fromEntries(Object.entries(state.devices).map(([id, value]) => [id, serializeRecoveryDevice(value)])),
    sessions: encodeRecoveryValue(state.sessions),
    trustedIdentities: encodeRecoveryValue(state.trustedIdentities),
  };
}

function recoveryAad(userId, sourceDeviceId, version = 1) {
  return new TextEncoder().encode(`expassway-chat-recovery-v1|${String(userId)}|${String(sourceDeviceId)}|${version}`);
}

async function deriveRecoveryKey(password, salt) {
  const s = await getSodium();
  return s.crypto_pwhash(
    32,
    String(password),
    salt,
    s.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    s.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    s.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function openVault() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open chat key vault."));
  });
}

async function loadVault() {
  const database = await openVault();
  return new Promise((resolve, reject) => {
    const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get("state");
    request.onsuccess = () => {
      if (request.result) {
        state.identityKeyPair = restoreKeyPair(request.result.identityKeyPair);
        state.registrationId = request.result.registrationId;
        state.devices = request.result.devices || {};
        state.sessions = request.result.sessions || {};
        state.trustedIdentities = request.result.trustedIdentities || {};
        state.sentPlaintexts = request.result.sentPlaintexts || {};
        state.verifiedSafetyNumbers = request.result.verifiedSafetyNumbers || {};
        state.safetyNumberChanges = request.result.safetyNumberChanges || {};
      }
      resolve();
    };
    request.onerror = () => reject(request.error || new Error("Could not load chat key vault."));
  });
}

async function saveVault() {
  const database = await openVault();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({
      identityKeyPair: cloneKeyPair(state.identityKeyPair),
      registrationId: state.registrationId,
      devices: state.devices,
      sessions: state.sessions,
      trustedIdentities: state.trustedIdentities,
      sentPlaintexts: state.sentPlaintexts,
      verifiedSafetyNumbers: state.verifiedSafetyNumbers || {},
      safetyNumberChanges: state.safetyNumberChanges || {},
    }, "state");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error("Could not save chat key vault."));
  });
}

function toArrayBuffer(value) {
  if (value instanceof ArrayBuffer) return value;
  if (ArrayBuffer.isView(value)) return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
  return base64ToBytes(String(value)).buffer;
}

class VaultStore {
  constructor(deviceId) {
    this.deviceId = String(deviceId || "");
  }
  device() { return state.devices[this.deviceId]; }
  sessionKey(identifier) { return `${this.deviceId}::${identifier}`; }
  async getIdentityKeyPair() { return this.device()?.identityKeyPair || state.identityKeyPair; }
  async getLocalRegistrationId() {
    return this.device()?.registrationId || state.registrationId;
  }
  async isTrustedIdentity(identifier, identityKey) {
    const encoded = bytesToBase64Url(identityKey);
    const previous = state.trustedIdentities[identifier];
    return !previous || previous === encoded;
  }
  async saveIdentity(identifier, identityKey) {
    const encoded = bytesToBase64Url(identityKey);
    const changed = state.trustedIdentities[identifier] !== encoded;
    state.trustedIdentities[identifier] = encoded;
    await saveVault();
    return changed;
  }
  async loadPreKey(keyId) {
    const value = this.device()?.preKeys?.[String(keyId)];
    return value ? restoreKeyPair(value) : undefined;
  }
  async storePreKey(keyId, keyPair) {
    const device = state.devices[this.deviceId] ||= { preKeys: {}, signedPreKeys: {} };
    device.preKeys[String(keyId)] = cloneKeyPair(keyPair);
    await saveVault();
  }
  async removePreKey(keyId) {
    const device = this.device();
    if (device) {
      delete device.preKeys[String(keyId)];
      device.oneTimePreKeys = (device.oneTimePreKeys || []).filter((item) => Number(item.id) !== Number(keyId));
    }
    await saveVault();
  }
  async loadSignedPreKey(keyId) {
    const value = this.device()?.signedPreKeys?.[String(keyId)];
    return value ? restoreKeyPair(value) : undefined;
  }
  async storeSignedPreKey(keyId, keyPair) {
    const device = state.devices[this.deviceId] ||= { preKeys: {}, signedPreKeys: {} };
    device.signedPreKeys[String(keyId)] = cloneKeyPair(keyPair);
    await saveVault();
  }
  // libsignal distinguishes an absent session (undefined) from an invalid record (null).
  // Returning null here makes the first X3DH session look like a corrupt serialized record.
  async loadSession(identifier) {
    return state.sessions[this.sessionKey(identifier)] || state.sessions[identifier] || undefined;
  }
  async storeSession(identifier, record) {
    state.sessions[this.sessionKey(identifier)] = record;
    delete state.sessions[identifier];
    await saveVault();
  }
  async deleteSession(identifier) {
    delete state.sessions[this.sessionKey(identifier)];
    delete state.sessions[identifier];
    await saveVault();
  }
  async deleteAllSessions(identifier) {
    const legacyPrefix = String(identifier);
    const namespacedPrefix = `${this.deviceId}::${legacyPrefix}`;
    for (const key of Object.keys(state.sessions)) {
      if (key.startsWith(namespacedPrefix) || key.startsWith(legacyPrefix)) delete state.sessions[key];
    }
    await saveVault();
  }
  async removeSignedPreKey(keyId) {
    const device = this.device();
    if (device) delete device.signedPreKeys[String(keyId)];
    await saveVault();
  }
  async storeIdentityKeyPair(pair) {
    if (this.device()) {
      this.device().identityKeyPair = pair;
    }
    if (state.currentDeviceId === this.deviceId) state.identityKeyPair = pair;
    await saveVault();
  }
}

function currentStore(deviceId) {
  return new VaultStore(deviceId);
}

function deviceBundle(deviceId, device) {
  const availablePreKeys = Object.entries(device.preKeys || {}).map(([id, keyPair]) => ({
    id: Number(id),
    publicKey: bytesToBase64Url(keyPair.pubKey),
  }));
  if (!device.identityKeyPair?.pubKey || !device.signedPreKey?.publicKey || !device.signedPreKey?.signature
    || availablePreKeys.some((item) => !item.publicKey)) {
    throw cryptoError("INVALID_DEVICE_KEYS", "The browser generated an incomplete chat device bundle.");
  }
  return {
    deviceId,
    identityPublicKey: bytesToBase64Url(device.identityKeyPair.pubKey),
    registrationId: device.registrationId,
    signedPreKey: {
      id: device.signedPreKeyId,
      publicKey: bytesToBase64Url(device.signedPreKey.publicKey),
      signature: bytesToBase64Url(device.signedPreKey.signature),
    },
    oneTimePreKeys: availablePreKeys,
  };
}

function nextPreKeyId(device) {
  const ids = Object.keys(device.preKeys || {}).map(Number).filter(Number.isFinite);
  return Math.max(0, ...ids) + 1;
}

async function generatePreKeyRefill({ deviceId, count = 20 } = {}) {
  return withDeviceLock(deviceId, async () => {
    await loadVault();
    const device = state.devices[deviceId];
    if (!device) throw cryptoError("SESSION_MISSING", "Local chat device is not registered in this browser.");
    const amount = Math.max(1, Math.min(100, Number(count) || 20));
    const preKeys = [];
    let keyId = nextPreKeyId(device);
    for (let index = 0; index < amount; index += 1, keyId += 1) {
      const generated = await KeyHelper.generatePreKey(keyId);
      device.preKeys[String(generated.keyId)] = cloneKeyPair(generated.keyPair);
      device.oneTimePreKeys ||= [];
      device.oneTimePreKeys.push({ id: generated.keyId, keyPair: generated.keyPair });
      preKeys.push({ id: generated.keyId, publicKey: bytesToBase64Url(generated.keyPair.pubKey) });
    }
    await saveVault();
    return { deviceId, oneTimePreKeys: preKeys };
  });
}

async function generateDeviceBundle({ deviceId = crypto.randomUUID(), label = "" } = {}) {
  await loadVault();
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  state.currentDeviceId = deviceId;
  state.identityKeyPair = identityKeyPair;
  const registrationId = randomRegistrationId();
  const signedPreKeyId = 1;
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
  const oneTimePreKeys = [];
  const preKeys = {};
  for (let id = 1; id <= 20; id += 1) {
    const generated = await KeyHelper.generatePreKey(id);
    oneTimePreKeys.push({ id: generated.keyId, keyPair: generated.keyPair });
    preKeys[String(generated.keyId)] = cloneKeyPair(generated.keyPair);
  }
  state.devices[deviceId] = {
    label,
    registrationId,
    identityKeyPair,
    signedPreKeyId,
    signedPreKey: { publicKey: signedPreKey.keyPair.pubKey, signature: signedPreKey.signature },
    oneTimePreKeys,
    preKeys,
    signedPreKeys: { [signedPreKeyId]: cloneKeyPair(signedPreKey.keyPair) },
  };
  await saveVault();
  const fingerprintDigest = await crypto.subtle.digest("SHA-256", identityKeyPair.pubKey);
  const fingerprint = bytesToBase64Url(fingerprintDigest).slice(0, 32);
  return { ...deviceBundle(deviceId, state.devices[deviceId]), identityFingerprint: fingerprint };
}

function preKeyBundleForSession(bundle) {
  return {
    identityKey: base64ToBytes(bundle.identityKey).buffer,
    registrationId: bundle.registrationId,
    signedPreKey: bundle.signedPreKey ? {
      keyId: bundle.signedPreKey.keyId,
      publicKey: base64ToBytes(bundle.signedPreKey.publicKey).buffer,
      signature: base64ToBytes(bundle.signedPreKey.signature).buffer,
    } : null,
    preKey: bundle.oneTimePreKey ? {
      keyId: bundle.oneTimePreKey.keyId,
      publicKey: base64ToBytes(bundle.oneTimePreKey.publicKey).buffer,
    } : undefined,
  };
}

function peerAddress(peerDeviceId, peerDeviceNumber) {
  return new SignalProtocolAddress(String(peerDeviceId), Number(peerDeviceNumber));
}

async function encryptMessage({ deviceId, peerDeviceId, peerDeviceNumber, plaintext }) {
  return withSessionLock(deviceId, peerDeviceId, peerDeviceNumber, async () => {
    await loadVault();
    const device = state.devices[deviceId];
    if (!device) throw cryptoError("SESSION_MISSING", "Local chat device is not registered in this browser.");
    try {
      const store = currentStore(deviceId);
      const address = peerAddress(peerDeviceId, peerDeviceNumber);
      const cipher = new SessionCipher(store, address);
      const encrypted = await cipher.encrypt(new TextEncoder().encode(String(plaintext)).buffer);
      await saveVault();
      return { type: encrypted.type, body: binaryStringToBase64Url(encrypted.body), registrationId: encrypted.registrationId };
    } catch (error) {
      throw classifyCryptoError(error, "SESSION_MISSING");
    }
  });
}

async function decryptMessage({ deviceId, peerDeviceId, peerDeviceNumber, ciphertext }) {
  return withSessionLock(deviceId, peerDeviceId, peerDeviceNumber, async () => {
    await loadVault();
    if (!state.devices[deviceId]) throw cryptoError("SESSION_MISSING", "Local chat device is not registered in this browser.");
    const before = {
      sessions: structuredClone(state.sessions),
      trustedIdentities: structuredClone(state.trustedIdentities),
      devices: structuredClone(state.devices),
    };
    try {
      const store = currentStore(deviceId);
      const address = peerAddress(peerDeviceId, peerDeviceNumber);
      const cipher = new SessionCipher(store, address);
      const body = base64UrlToBinaryString(ciphertext.body);
      const bytes = ciphertext.type === 3
        ? await cipher.decryptPreKeyWhisperMessage(body, "binary")
        : await cipher.decryptWhisperMessage(body, "binary");
      await saveVault();
      return new TextDecoder().decode(toArrayBuffer(bytes));
    } catch (error) {
      state.sessions = before.sessions;
      state.trustedIdentities = before.trustedIdentities;
      state.devices = before.devices;
      await saveVault();
      throw classifyCryptoError(error);
    }
  });
}

async function safetyNumber({ localDeviceId, localDevices = [], peerDevices = [] } = {}) {
  await loadVault();
  const local = state.devices[localDeviceId];
  if (!local?.identityKeyPair?.pubKey) throw cryptoError("SESSION_MISSING", "Local chat device is not registered in this browser.");
  const localEntries = (Array.isArray(localDevices) ? localDevices : []).length
    ? localDevices
    : [{ deviceId: localDeviceId, deviceNumber: 0, identityKey: bytesToBase64Url(local.identityKeyPair.pubKey) }];
  const localKeys = localEntries
    .filter((item) => item?.identityKey && Number.isInteger(Number(item.deviceNumber)))
    .map((item) => `${item.deviceNumber}:${item.identityKey}`);
  const peers = (Array.isArray(peerDevices) ? peerDevices : [])
    .filter((item) => item?.identityKey && Number.isInteger(Number(item.deviceNumber)))
    .map((item) => `${item.deviceNumber}:${item.identityKey}`)
  const allDevices = [...localKeys, ...peers].sort();
  const s = await getSodium();
  const digest = s.crypto_generichash(32, new TextEncoder().encode(
    `expassway-chat-safety-v1|${allDevices.join("|")}`,
  ));
  const groups = [];
  for (let index = 0; index < 12; index += 1) {
    const value = ((digest[index * 2] << 8) | digest[index * 2 + 1]) % 100000;
    groups.push(String(value).padStart(5, "0"));
  }
  return groups.join(" ");
}

async function setSafetyNumberVerification({ key, safety }) {
  await loadVault();
  const normalized = String(key || "");
  if (!normalized || !safety) throw new Error("Safety number is required.");
  state.verifiedSafetyNumbers[normalized] = String(safety);
  delete state.safetyNumberChanges[normalized];
  await saveVault();
  return { verified: true, safety: String(safety) };
}

async function getSafetyNumberVerification({ key }) {
  await loadVault();
  return state.verifiedSafetyNumbers[String(key || "")] || null;
}

async function markSafetyNumberChanged({ key, safety }) {
  await loadVault();
  const normalized = String(key || "");
  if (!normalized || !safety) throw new Error("Safety number is required.");
  state.safetyNumberChanges[normalized] = String(safety);
  await saveVault();
  return { changed: true, safety: String(safety) };
}

async function getSafetyNumberChange({ key }) {
  await loadVault();
  return state.safetyNumberChanges[String(key || "")] || null;
}

async function clearSafetyNumberVerification({ key }) {
  await loadVault();
  const normalized = String(key || "");
  if (normalized) delete state.verifiedSafetyNumbers[normalized];
  await saveVault();
  return { cleared: true };
}

async function createRecoveryBackup({ userId, sourceDeviceId, password } = {}) {
  await loadVault();
  if (!String(password || "")) throw new Error("Recovery password is required.");
  const snapshot = recoverySnapshot(sourceDeviceId, userId);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = await deriveRecoveryKey(password, salt);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const plaintext = new TextEncoder().encode(JSON.stringify(snapshot));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: recoveryAad(userId, sourceDeviceId, snapshot.version) }, key, plaintext);
  return {
    kdfVersion: "argon2id-v1",
    backupVersion: String(snapshot.version),
    sourceDeviceId,
    salt: bytesToBase64Url(salt),
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(ciphertext),
    restoreOperationId: crypto.randomUUID(),
  };
}

async function restoreRecoveryBackup({ userId, backup, password } = {}) {
  await loadVault();
  if (!backup || !String(password || "")) throw new Error("Recovery backup and password are required.");
  const version = Number(backup.backupVersion || 1);
  const salt = base64ToBytes(backup.salt);
  const nonce = base64ToBytes(backup.nonce);
  const keyBytes = await deriveRecoveryKey(password, salt);
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  let snapshot;
  try {
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: recoveryAad(userId, backup.sourceDeviceId, version) }, key, base64ToBytes(backup.ciphertext));
    snapshot = JSON.parse(new TextDecoder().decode(plaintext));
  } catch (error) {
    throw cryptoError("RECOVERY_PASSWORD_INVALID", "The recovery password is invalid or the backup is corrupted.", error);
  }
  if (snapshot.format !== "expassway-chat-recovery-v1" || snapshot.userId !== String(userId)
    || snapshot.sourceDeviceId !== String(backup.sourceDeviceId)) {
    throw cryptoError("RECOVERY_BACKUP_INVALID", "The recovery backup does not belong to this account or device.");
  }
  state.recoveryCandidate = { snapshot, backup };
  return { valid: true, sourceDeviceId: snapshot.sourceDeviceId, createdAt: snapshot.createdAt, deviceCount: Object.keys(snapshot.devices || {}).length };
}

async function createRestoredDeviceBundle({ deviceId, label = "Restored browser" } = {}) {
  await loadVault();
  const candidate = state.recoveryCandidate;
  if (!candidate?.snapshot) throw new Error("Validate a recovery backup first.");
  const snapshot = candidate.snapshot;
  const source = snapshot.devices?.[snapshot.sourceDeviceId];
  if (!source) throw cryptoError("RECOVERY_BACKUP_INVALID", "The source device is missing from the recovery backup.");
  const restoreOperationId = String(candidate.backup.restoreOperationId || crypto.randomUUID());
  candidate.backup.restoreOperationId = restoreOperationId;
  const restoredDeviceId = String(deviceId || crypto.randomUUID());
  const restored = restoreRecoveryDevice(source);
  restored.label = label;
  const signedPreKeyId = Math.max(1, Number(source.signedPreKeyId || 0) + 1);
  const signedPreKey = await KeyHelper.generateSignedPreKey(restored.identityKeyPair, signedPreKeyId);
  restored.signedPreKeyId = signedPreKeyId;
  restored.signedPreKey = { publicKey: signedPreKey.keyPair.pubKey, signature: signedPreKey.signature };
  restored.signedPreKeys = { [signedPreKeyId]: cloneKeyPair(signedPreKey.keyPair) };
  restored.preKeys = {};
  restored.oneTimePreKeys = [];
  for (let keyId = 1; keyId <= 20; keyId += 1) {
    const generated = await KeyHelper.generatePreKey(keyId);
    restored.preKeys[String(generated.keyId)] = cloneKeyPair(generated.keyPair);
    restored.oneTimePreKeys.push({ id: generated.keyId, keyPair: generated.keyPair });
  }
  const fingerprintDigest = await crypto.subtle.digest("SHA-256", restored.identityKeyPair.pubKey);
  state.recoveryCandidate.restoredDeviceId = restoredDeviceId;
  state.recoveryCandidate.restored = restored;
  return {
    ...deviceBundle(restoredDeviceId, restored),
    identityFingerprint: bytesToBase64Url(fingerprintDigest).slice(0, 32),
    sourceDeviceId: snapshot.sourceDeviceId,
    restoreOperationId,
  };
}

async function commitRestoredDeviceState({ deviceId } = {}) {
  await loadVault();
  const candidate = state.recoveryCandidate;
  if (!candidate?.snapshot || !candidate.restored) throw new Error("Validate a recovery backup and create a restored device bundle first.");
  if (String(deviceId) !== String(candidate.restoredDeviceId)) throw new Error("The restored device identifier does not match.");
  state.identityKeyPair = restoreKeyPair(candidate.snapshot.identityKeyPair);
  state.registrationId = candidate.snapshot.registrationId;
  state.devices = { [candidate.restoredDeviceId]: candidate.restored };
  state.currentDeviceId = candidate.restoredDeviceId;
  const restoredSessions = decodeRecoveryValue(candidate.snapshot.sessions || {});
  const sourcePrefix = `${candidate.snapshot.sourceDeviceId}::`;
  const restoredPrefix = `${candidate.restoredDeviceId}::`;
  state.sessions = Object.fromEntries(Object.entries(restoredSessions).flatMap(([key, value]) => {
    if (key.startsWith(sourcePrefix)) return [[`${restoredPrefix}${key.slice(sourcePrefix.length)}`, value]];
    if (!key.includes("::")) return [[`${restoredPrefix}${key}`, value]];
    return [];
  }));
    state.trustedIdentities = decodeRecoveryValue(candidate.snapshot.trustedIdentities || {});
  state.safetyNumberChanges = {};
  state.sentPlaintexts = {};
  await saveVault();
  state.recoveryCandidate = null;
  return { committed: true, deviceId: candidate.restoredDeviceId };
}

async function clearRestoredDeviceState() {
  await loadVault();
  state.recoveryCandidate = null;
  return { cleared: true };
}

async function processPreKeyBundle({ deviceId, peerDeviceId, peerDeviceNumber, bundle }) {
  return withSessionLock(deviceId, peerDeviceId, peerDeviceNumber || bundle?.deviceNumber, async () => {
    await loadVault();
    if (!state.devices[deviceId]) throw cryptoError("SESSION_MISSING", "Local chat device is not registered in this browser.");
    try {
      const store = currentStore(deviceId);
      const remoteNumber = Number(peerDeviceNumber || bundle.deviceNumber);
      if (!Number.isInteger(remoteNumber) || remoteNumber < 1) throw new Error("Remote device number is missing.");
      const address = peerAddress(peerDeviceId, remoteNumber);
      if (await store.loadSession(address.toString())) return { established: true, reused: true };
      const builder = new SessionBuilder(store, address);
      await builder.processPreKey(preKeyBundleForSession(bundle));
      await saveVault();
      return { established: true };
    } catch (error) {
      throw classifyCryptoError(error, "SESSION_MISSING");
    }
  });
}

async function resetSession({ deviceId, peerDeviceId, peerDeviceNumber } = {}) {
  return withSessionLock(deviceId, peerDeviceId, peerDeviceNumber, async () => {
    await loadVault();
    if (!state.devices[deviceId]) throw cryptoError("SESSION_MISSING", "Local chat device is not registered in this browser.");
    const address = peerAddress(peerDeviceId, peerDeviceNumber);
    delete state.sessions[`${deviceId}::${address.toString()}`];
    delete state.sessions[address.toString()];
    await saveVault();
    return { reset: true, address: address.toString() };
  });
}

async function encryptAttachment({ bytes }) {
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, toArrayBuffer(bytes));
  return { bytes: new Uint8Array(encrypted), key: bytesToBase64Url(keyBytes), nonce: bytesToBase64Url(nonce) };
}

async function decryptAttachment({ bytes, key: keyValue, nonce: nonceValue }) {
  const key = await crypto.subtle.importKey("raw", base64ToBytes(keyValue), "AES-GCM", false, ["decrypt"]);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(nonceValue) }, key, toArrayBuffer(bytes));
  return new Uint8Array(decrypted);
}

async function storeLocalPlaintext({ clientMessageId, plaintext }) {
  await loadVault();
  const keyBytes = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    new TextEncoder().encode(String(plaintext)),
  );
  state.sentPlaintexts[String(clientMessageId)] = {
    ciphertext: bytesToBase64Url(ciphertext),
    key: bytesToBase64Url(keyBytes),
    nonce: bytesToBase64Url(nonce),
  };
  await saveVault();
  return { stored: true };
}

async function getLocalPlaintext({ clientMessageId }) {
  await loadVault();
  const stored = state.sentPlaintexts[String(clientMessageId)];
  if (!stored) return null;
  const key = await crypto.subtle.importKey("raw", base64ToBytes(stored.key), "AES-GCM", false, ["decrypt"]);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(stored.nonce) },
    key,
    base64ToBytes(stored.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

async function generateAccountV2Vault({ userId, keyVersion = "1", prfOutput } = {}) {
  const user = requiredAccountV2String(userId, "userId", 256);
  const version = requiredAccountV2String(keyVersion, "keyVersion", 64);
  const prf = requiredBase64Bytes(prfOutput, "prfOutput", 32);
  const s = await getSodium();
  const account = {
    userId: user,
    keyVersion: version,
    vaultRootKey: s.randombytes(32),
    encryptionKeyPair: s.crypto_box_keypair(),
    signingKeyPair: s.crypto_sign_keypair(),
    epochKeys: new Map(),
  };
  account.encryptionPublicKey = account.encryptionKeyPair.publicKey;
  account.encryptionPrivateKey = account.encryptionKeyPair.privateKey;
  account.signingPublicKey = account.signingKeyPair.publicKey;
  account.signingPrivateKey = account.signingKeyPair.privateKey;
  account.fingerprint = await accountV2Fingerprint(account.encryptionPublicKey, account.signingPublicKey);
  const wrappingKey = await accountV2Hkdf(prf, utf8(`expassway-chat-account-v2-prf|${user}`), ACCOUNT_V2_KDF_VERSION);
  const encrypted = await accountV2AesGcmEncrypt(wrappingKey, utf8(JSON.stringify({ format: ACCOUNT_V2_VAULT_FORMAT, version: ACCOUNT_V2_VAULT_VERSION, userId: user, keyVersion: version, vaultRootKey: bytesToBase64Url(account.vaultRootKey), encryptionPrivateKey: bytesToBase64Url(account.encryptionPrivateKey), signingPrivateKey: bytesToBase64Url(account.signingPrivateKey) })), accountV2VaultAad(user, version));
  state.accountV2 = account;
  return { ...accountV2PublicBundle(account), kdfVersion: ACCOUNT_V2_KDF_VERSION, nonce: bytesToBase64Url(encrypted.nonce), ciphertext: bytesToBase64Url(encrypted.ciphertext) };
}

async function unlockAccountV2Vault({ userId, keyVersion = "1", prfOutput, nonce, ciphertext } = {}) {
  const user = requiredAccountV2String(userId, "userId", 256);
  const version = requiredAccountV2String(keyVersion, "keyVersion", 64);
  const prf = requiredBase64Bytes(prfOutput, "prfOutput", 32);
  const wrappingKey = await accountV2Hkdf(prf, utf8(`expassway-chat-account-v2-prf|${user}`), ACCOUNT_V2_KDF_VERSION);
  const plaintext = await accountV2AesGcmDecrypt(wrappingKey, requiredBase64Bytes(nonce, "nonce", 12), requiredBase64Bytes(ciphertext, "ciphertext"), accountV2VaultAad(user, version), "ACCOUNT_VAULT_UNLOCK_FAILED");
  let snapshot;
  try { snapshot = JSON.parse(new TextDecoder().decode(plaintext)); } catch (error) { throw accountV2Error("ACCOUNT_VAULT_UNLOCK_FAILED", "The account vault is malformed.", error); }
  if (snapshot.format !== ACCOUNT_V2_VAULT_FORMAT || snapshot.userId !== user) throw accountV2Error("ACCOUNT_VAULT_UNLOCK_FAILED", "The account vault does not belong to this account.");
  const s = await getSodium();
  const account = { userId: user, keyVersion: snapshot.keyVersion || version, vaultRootKey: requiredBase64Bytes(snapshot.vaultRootKey, "vaultRootKey", 32), encryptionPrivateKey: requiredBase64Bytes(snapshot.encryptionPrivateKey, "encryptionPrivateKey", 32), signingPrivateKey: requiredBase64Bytes(snapshot.signingPrivateKey, "signingPrivateKey", 64), epochKeys: new Map() };
  account.encryptionPublicKey = s.crypto_scalarmult_base(account.encryptionPrivateKey);
  account.signingPublicKey = s.crypto_sign_ed25519_sk_to_pk(account.signingPrivateKey);
  account.fingerprint = await accountV2Fingerprint(account.encryptionPublicKey, account.signingPublicKey);
  state.accountV2 = account;
  return { ...accountV2PublicBundle(account), unlocked: true };
}

async function lockAccountV2Vault() { accountV2WipeAccount(state.accountV2); state.accountV2 = null; return { locked: true }; }

async function createAccountV2Envelope({ conversationId, epoch, recipient, contentKey } = {}) {
  const account = accountV2RequireUnlocked();
  const recipientUserId = requiredAccountV2String(recipient?.userId, "recipient.userId", 256);
  const recipientKeyVersion = requiredAccountV2String(recipient?.keyVersion || "1", "recipient.keyVersion", 64);
  const recipientPublicKey = requiredBase64Bytes(recipient?.encryptionPublicKey, "recipient.encryptionPublicKey", 32);
  const key = requiredBase64Bytes(contentKey, "contentKey", 32);
  const s = await getSodium();
  const ephemeral = s.crypto_box_keypair();
  const shared = s.crypto_scalarmult(ephemeral.privateKey, recipientPublicKey);
  const wrapKey = await accountV2Hkdf(shared, utf8(`expassway-chat-account-v2-envelope-key|${conversationId}|${validEpoch(epoch)}`), ACCOUNT_V2_KDF_VERSION);
  const ephemeralPublicKey = bytesToBase64Url(ephemeral.publicKey);
  const aad = accountV2EnvelopeAad({ conversationId, epoch, userId: recipientUserId, keyVersion: recipientKeyVersion, ephemeralPublicKey });
  const encrypted = await accountV2AesGcmEncrypt(wrapKey, key, aad);
  return { userId: recipientUserId, keyVersion: recipientKeyVersion, ephemeralPublicKey, nonce: bytesToBase64Url(encrypted.nonce), ciphertext: bytesToBase64Url(encrypted.ciphertext) };
}

async function openAccountV2Envelope({ conversationId, epoch, envelope } = {}) {
  const account = accountV2RequireUnlocked();
  const ephemeralPublicKey = requiredBase64Bytes(envelope?.ephemeralPublicKey, "envelope.ephemeralPublicKey", 32);
  const nonce = requiredBase64Bytes(envelope?.nonce, "envelope.nonce", 12);
  const ciphertext = requiredBase64Bytes(envelope?.ciphertext, "envelope.ciphertext");
  const shared = (await getSodium()).crypto_scalarmult(account.encryptionPrivateKey, ephemeralPublicKey);
  const keyVersion = requiredAccountV2String(envelope.keyVersion || "1", "envelope.keyVersion", 64);
  const userId = requiredAccountV2String(envelope.userId, "envelope.userId", 256);
  const aad = accountV2EnvelopeAad({ conversationId, epoch, userId, keyVersion, ephemeralPublicKey: envelope.ephemeralPublicKey });
  const wrapKey = await accountV2Hkdf(shared, utf8(`expassway-chat-account-v2-envelope-key|${conversationId}|${validEpoch(epoch)}`), ACCOUNT_V2_KDF_VERSION);
  const key = await accountV2AesGcmDecrypt(wrapKey, nonce, ciphertext, aad, "ACCOUNT_V2_ENVELOPE_INVALID");
  if (key.byteLength !== 32) throw accountV2Error("ACCOUNT_V2_ENVELOPE_INVALID", "The epoch content key has an invalid length.");
  account.epochKeys.set(accountV2EpochKey(conversationId, epoch), key);
  return { conversationId, epoch: validEpoch(epoch), contentKey: bytesToBase64Url(key) };
}

async function accountV2SignMessage(payload) {
  const account = accountV2RequireUnlocked();
  const input = { version: ACCOUNT_V2_PROTOCOL_VERSION, conversationId: requiredAccountV2String(payload.conversationId, "conversationId", 256), clientMessageId: requiredAccountV2String(payload.clientMessageId, "clientMessageId", 256), epoch: validEpoch(payload.epoch), nonce: requiredAccountV2String(payload.nonce, "nonce", 256), ciphertext: requiredAccountV2String(payload.ciphertext, "ciphertext", 1024 * 1024), senderKeyId: requiredAccountV2String(payload.senderKeyId || account.keyVersion, "senderKeyId", 64), attachmentRefs: Array.isArray(payload.attachmentRefs) ? payload.attachmentRefs : [] };
  const signature = (await getSodium()).crypto_sign_detached(utf8(canonicalJson(input)), account.signingPrivateKey);
  return { ...input, signature: bytesToBase64Url(signature) };
}

async function accountV2VerifyMessage({ message, signingPublicKey } = {}) {
  const input = { version: ACCOUNT_V2_PROTOCOL_VERSION, conversationId: message?.conversationId, clientMessageId: message?.clientMessageId, epoch: validEpoch(message?.epoch), nonce: message?.nonce, ciphertext: message?.ciphertext, senderKeyId: message?.senderKeyId, attachmentRefs: Array.isArray(message?.attachmentRefs) ? message.attachmentRefs : [] };
  const valid = (await getSodium()).crypto_sign_verify_detached(requiredBase64Bytes(message?.signature, "signature", 64), utf8(canonicalJson(input)), requiredBase64Bytes(signingPublicKey, "signingPublicKey", 32));
  return { valid };
}

self.onmessage = async (event) => {
  const { id, action, payload = {} } = event.data || {};
  try {
    let result;
    if (action === "generateAccountVault") result = await generateAccountVault(payload);
    else if (action === "wrapAccountVault") result = await wrapAccountVault(payload);
    else if (action === "unwrapAccountVault") result = await unwrapAccountVault(payload);
    else if (action === "createConversationEpoch") result = await createConversationEpoch(payload);
    else if (action === "openEpochEnvelope") result = await openEpochEnvelope(payload);
    else if (action === "encryptAccountV2Message") result = await encryptAccountV2Message(payload);
    else if (action === "decryptAccountV2Message") result = await decryptAccountV2Message(payload);
    else if (action === "generateDeviceBundle") result = await generateDeviceBundle(payload);
    else if (action === "generatePreKeyRefill") result = await generatePreKeyRefill(payload);
    else if (action === "processPreKeyBundle") result = await processPreKeyBundle(payload);
    else if (action === "resetSession") result = await resetSession(payload);
    else if (action === "encryptMessage") result = await encryptMessage(payload);
    else if (action === "decryptMessage") result = await decryptMessage(payload);
    else if (action === "safetyNumber") result = await safetyNumber(payload);
    else if (action === "setSafetyNumberVerification") result = await setSafetyNumberVerification(payload);
    else if (action === "getSafetyNumberVerification") result = await getSafetyNumberVerification(payload);
    else if (action === "clearSafetyNumberVerification") result = await clearSafetyNumberVerification(payload);
    else if (action === "markSafetyNumberChanged") result = await markSafetyNumberChanged(payload);
    else if (action === "getSafetyNumberChange") result = await getSafetyNumberChange(payload);
    else if (action === "createRecoveryBackup") result = await createRecoveryBackup(payload);
    else if (action === "restoreRecoveryBackup") result = await restoreRecoveryBackup(payload);
    else if (action === "createRestoredDeviceBundle") result = await createRestoredDeviceBundle(payload);
    else if (action === "commitRestoredDeviceState") result = await commitRestoredDeviceState(payload);
    else if (action === "clearRestoredDeviceState") result = await clearRestoredDeviceState(payload);
    else if (action === "encryptAttachment") result = await encryptAttachment(payload);
    else if (action === "decryptAttachment") result = await decryptAttachment(payload);
    else if (action === "storeLocalPlaintext" || action === "storeSentPlaintext") result = await storeLocalPlaintext(payload);
    else if (action === "getLocalPlaintext" || action === "getSentPlaintext") result = await getLocalPlaintext(payload);
    else if (action === "generateAccountV2Vault") result = await generateAccountV2Vault(payload);
    else if (action === "unlockAccountV2Vault") result = await unlockAccountV2Vault(payload);
    else if (action === "lockAccountV2Vault") result = await lockAccountV2Vault(payload);
    else if (action === "createAccountV2Envelope") result = await createAccountV2Envelope(payload);
    else if (action === "openAccountV2Envelope") result = await openAccountV2Envelope(payload);
    else if (action === "signAccountV2Message") result = await accountV2SignMessage(payload);
    else if (action === "verifyAccountV2Message") result = await accountV2VerifyMessage(payload);
    else throw new Error(`Unknown chat crypto action: ${action}`);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error), code: error?.code || "CRYPTO_ERROR" });
  }
};
