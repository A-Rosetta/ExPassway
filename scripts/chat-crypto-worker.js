import {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
} from "@privacyresearch/libsignal-protocol-typescript";

const DB_NAME = "expassway-chat-crypto-v1";
const STORE_NAME = "vault";
const state = {
  identityKeyPair: null,
  registrationId: null,
  devices: {},
  sessions: {},
  trustedIdentities: {},
  sentPlaintexts: {},
};

function bytesToBase64(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
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
  async getIdentityKeyPair() { return state.devices[state.currentDeviceId]?.identityKeyPair || state.identityKeyPair; }
  async getLocalRegistrationId() {
    return state.devices[state.currentDeviceId]?.registrationId || state.registrationId;
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
    const value = state.devices[state.currentDeviceId]?.preKeys?.[String(keyId)];
    return value ? restoreKeyPair(value) : undefined;
  }
  async storePreKey(keyId, keyPair) {
    const device = state.devices[state.currentDeviceId] ||= { preKeys: {}, signedPreKeys: {} };
    device.preKeys[String(keyId)] = cloneKeyPair(keyPair);
    await saveVault();
  }
  async removePreKey(keyId) {
    const device = state.devices[state.currentDeviceId];
    if (device) delete device.preKeys[String(keyId)];
    await saveVault();
  }
  async loadSignedPreKey(keyId) {
    const value = state.devices[state.currentDeviceId]?.signedPreKeys?.[String(keyId)];
    return value ? restoreKeyPair(value) : undefined;
  }
  async storeSignedPreKey(keyId, keyPair) {
    const device = state.devices[state.currentDeviceId] ||= { preKeys: {}, signedPreKeys: {} };
    device.signedPreKeys[String(keyId)] = cloneKeyPair(keyPair);
    await saveVault();
  }
  // libsignal distinguishes an absent session (undefined) from an invalid record (null).
  // Returning null here makes the first X3DH session look like a corrupt serialized record.
  async loadSession(identifier) { return state.sessions[identifier] || undefined; }
  async storeSession(identifier, record) { state.sessions[identifier] = record; await saveVault(); }
  async deleteSession(identifier) { delete state.sessions[identifier]; await saveVault(); }
  async deleteAllSessions(identifier) {
    for (const key of Object.keys(state.sessions)) if (key.startsWith(identifier)) delete state.sessions[key];
    await saveVault();
  }
  async removeSignedPreKey(keyId) {
    const device = state.devices[state.currentDeviceId];
    if (device) delete device.signedPreKeys[String(keyId)];
    await saveVault();
  }
  async storeIdentityKeyPair(pair) {
    if (state.currentDeviceId && state.devices[state.currentDeviceId]) {
      state.devices[state.currentDeviceId].identityKeyPair = pair;
    }
    state.identityKeyPair = pair;
    await saveVault();
  }
}

function currentStore(deviceId) {
  state.currentDeviceId = deviceId;
  return new VaultStore();
}

function deviceBundle(deviceId, device) {
  return {
    deviceId,
    identityPublicKey: bytesToBase64Url(device.identityKeyPair.pubKey),
    registrationId: device.registrationId,
    signedPreKey: {
      id: device.signedPreKeyId,
      publicKey: bytesToBase64Url(device.signedPreKey.publicKey),
      signature: bytesToBase64Url(device.signedPreKey.signature),
    },
    oneTimePreKeys: device.oneTimePreKeys.map((item) => ({
      id: item.id,
      publicKey: bytesToBase64Url(item.keyPair.pubKey),
    })),
  };
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
  await loadVault();
  const device = state.devices[deviceId];
  if (!device) throw new Error("Local chat device is not registered in this browser.");
  const store = currentStore(deviceId);
  const address = peerAddress(peerDeviceId, peerDeviceNumber);
  const cipher = new SessionCipher(store, address);
  const encrypted = await cipher.encrypt(new TextEncoder().encode(String(plaintext)).buffer);
  await saveVault();
  return { type: encrypted.type, body: binaryStringToBase64Url(encrypted.body), registrationId: encrypted.registrationId };
}

async function decryptMessage({ deviceId, peerDeviceId, peerDeviceNumber, ciphertext }) {
  await loadVault();
  if (!state.devices[deviceId]) throw new Error("Local chat device is not registered in this browser.");
  const store = currentStore(deviceId);
  const address = peerAddress(peerDeviceId, peerDeviceNumber);
  const cipher = new SessionCipher(store, address);
  const body = base64UrlToBinaryString(ciphertext.body);
  const bytes = ciphertext.type === 3
    ? await cipher.decryptPreKeyWhisperMessage(body, "binary")
    : await cipher.decryptWhisperMessage(body, "binary");
  await saveVault();
  return new TextDecoder().decode(toArrayBuffer(bytes));
}

async function processPreKeyBundle({ deviceId, peerDeviceId, peerDeviceNumber, bundle }) {
  await loadVault();
  if (!state.devices[deviceId]) throw new Error("Local chat device is not registered in this browser.");
  const store = currentStore(deviceId);
  const remoteNumber = Number(peerDeviceNumber || bundle.deviceNumber);
  if (!Number.isInteger(remoteNumber) || remoteNumber < 1) throw new Error("Remote device number is missing.");
  const address = peerAddress(peerDeviceId, remoteNumber);
  if (await store.loadSession(address.toString())) return { established: true, reused: true };
  const builder = new SessionBuilder(store, address);
  await builder.processPreKey(preKeyBundleForSession(bundle));
  await saveVault();
  return { established: true };
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

async function storeSentPlaintext({ clientMessageId, plaintext }) {
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

async function getSentPlaintext({ clientMessageId }) {
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

self.onmessage = async (event) => {
  const { id, action, payload = {} } = event.data || {};
  try {
    let result;
    if (action === "generateDeviceBundle") result = await generateDeviceBundle(payload);
    else if (action === "processPreKeyBundle") result = await processPreKeyBundle(payload);
    else if (action === "encryptMessage") result = await encryptMessage(payload);
    else if (action === "decryptMessage") result = await decryptMessage(payload);
    else if (action === "encryptAttachment") result = await encryptAttachment(payload);
    else if (action === "decryptAttachment") result = await decryptAttachment(payload);
    else if (action === "storeSentPlaintext") result = await storeSentPlaintext(payload);
    else if (action === "getSentPlaintext") result = await getSentPlaintext(payload);
    else throw new Error(`Unknown chat crypto action: ${action}`);
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};
