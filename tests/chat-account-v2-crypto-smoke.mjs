import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { build } from "esbuild";
import sodium from "libsodium-wrappers-sumo";

const bundle = (await build({
  entryPoints: ["scripts/chat-crypto-worker.js"],
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  target: "es2022",
})).outputFiles[0].text;

function b64(value) {
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString("base64url");
}

function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function createWorker(legacyVault = null) {
  const messages = [];
  const context = {
    self: { postMessage(message) { messages.push(message); } },
    crypto: webcrypto,
    TextEncoder,
    TextDecoder,
    Uint8Array,
    Uint16Array,
    ArrayBuffer,
    atob,
    btoa,
    console,
    setTimeout,
    clearTimeout,
  };
  if (legacyVault) context.indexedDB = {
    open() {
      const request = { result: { transaction: () => ({ objectStore: () => ({ get: () => {
        const getRequest = { result: legacyVault };
        queueMicrotask(() => getRequest.onsuccess());
        return getRequest;
      } }) }) } };
      queueMicrotask(() => request.onsuccess());
      return request;
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bundle, context, { filename: "chat-crypto-worker.js" });
  let id = 0;
  return {
    async call(action, payload = {}) {
      const requestId = ++id;
      await context.self.onmessage({ data: { id: requestId, action, payload } });
      const messageIndex = messages.findIndex((item) => item.id === requestId);
      const message = messageIndex >= 0 ? messages.splice(messageIndex, 1)[0] : null;
      assert.ok(message, `worker did not answer ${action}`);
      if (!message.ok) {
        const error = new Error(message.error);
        error.code = message.code;
        throw error;
      }
      return message.result;
    },
  };
}

await sodium.ready;
const prf = b64(sodium.randombytes_buf(32));
const alice = createWorker();
const bob = createWorker();
const aliceVault = await alice.call("generateAccountV2Vault", { userId: "alice", keyVersion: "1", prfOutput: prf });
assert.equal(Object.hasOwn(aliceVault, "vaultRootKey"), false);
assert.equal(Object.hasOwn(aliceVault, "encryptionPrivateKey"), false);
assert.equal(Object.hasOwn(aliceVault, "signingPrivateKey"), false);

const bobVault = await bob.call("generateAccountV2Vault", { userId: "bob", keyVersion: "1", prfOutput: prf });
const bobUnlocked = createWorker();
const bobState = await bobUnlocked.call("unlockAccountV2Vault", {
  userId: "bob", keyVersion: "1", prfOutput: prf, nonce: bobVault.nonce, ciphertext: bobVault.ciphertext,
});
assert.equal(bobState.fingerprint, bobVault.fingerprint);
await assert.rejects(
  () => bobUnlocked.call("unlockAccountV2Vault", { userId: "bob", keyVersion: "2", prfOutput: prf, nonce: bobVault.nonce, ciphertext: bobVault.ciphertext }),
  (error) => error.code === "ACCOUNT_VAULT_UNLOCK_FAILED",
);
await assert.rejects(
  () => bobUnlocked.call("unlockAccountV2Vault", { userId: "bob", keyVersion: "1", prfOutput: b64(sodium.randombytes_buf(32)), nonce: bobVault.nonce, ciphertext: bobVault.ciphertext }),
  (error) => error.code === "ACCOUNT_VAULT_UNLOCK_FAILED",
);

const recipients = [
  { userId: "alice", keyVersion: aliceVault.keyVersion, encryptionPublicKey: aliceVault.encryptionPublicKey },
  { userId: "bob", keyVersion: bobVault.keyVersion, encryptionPublicKey: bobVault.encryptionPublicKey },
];
await assert.rejects(
  () => alice.call("createAccountV2Envelope", { conversationId: "group-1", epoch: 1, recipient: { ...recipients[1], encryptionPublicKey: "AA" }, contentKey: b64(sodium.randombytes_buf(32)) }),
  (error) => error.code === "INVALID_ACCOUNT_V2_INPUT",
);
const epoch = await alice.call("createAccountV2Epoch", { conversationId: "group-1", epoch: 1, recipients });
const bobEnvelope = epoch.recipients.find((item) => item.userId === "bob");
await bobUnlocked.call("openAccountV2Envelope", { conversationId: "group-1", epoch: 1, envelope: bobEnvelope });
await assert.rejects(
  () => bobUnlocked.call("openAccountV2Envelope", { conversationId: "group-1", epoch: 1, envelope: { ...bobEnvelope, userId: "mallory" } }),
  (error) => error.code === "ACCOUNT_V2_ENVELOPE_INVALID",
);
await assert.rejects(
  () => bobUnlocked.call("openAccountV2Envelope", { conversationId: "group-1", epoch: 1, envelope: { ...bobEnvelope, ephemeralPublicKey: b64(new Uint8Array(32)) } }),
  (error) => error.code === "ACCOUNT_V2_ENVELOPE_INVALID",
);
await assert.rejects(
  () => alice.call("createAccountV2Envelope", { conversationId: "group-1", epoch: 1, recipient: { ...recipients[1], encryptionPublicKey: b64(new Uint8Array(32)) }, contentKey: b64(sodium.randombytes_buf(32)) }),
  (error) => error.code === "INVALID_ACCOUNT_V2_INPUT",
);

const message1 = await alice.call("encryptAccountV2Message", { conversationId: "group-1", clientMessageId: "m1", epoch: 1, plaintext: "hello" });
const opened1 = await bobUnlocked.call("decryptAccountV2Message", { message: message1, signingPublicKey: aliceVault.signingPublicKey });
assert.equal(opened1.plaintext, "hello");

// Another account Passkey must wrap the same identity, including old versions,
// rather than creating a fresh chat identity or losing already-open epoch keys.
const secondPrf = b64(sodium.randombytes_buf(32));
const credentialId = "second-bob-passkey";
const bobWrapped = await bobUnlocked.call("wrapAccountV2Vault", { userId: "bob", keyVersion: "1", credentialId, prfOutput: secondPrf });
assert.equal(bobWrapped.fingerprint, bobVault.fingerprint);
assert.equal(bobWrapped.encryptionPublicKey, bobVault.encryptionPublicKey);
assert.equal(bobWrapped.signingPublicKey, bobVault.signingPublicKey);
for (const field of ["vaultRootKey", "encryptionPrivateKey", "signingPrivateKey", "prfOutput"]) assert.equal(Object.hasOwn(bobWrapped, field), false);
const signedWrapper = { version: "account-v2", action: "wrap-vault", senderUserId: "bob", senderKeyId: "1",
  credentialId, nonce: bobWrapped.nonce, ciphertext: bobWrapped.ciphertext };
assert.equal(sodium.crypto_sign_verify_detached(Buffer.from(bobWrapped.signature, "base64url"),
  new TextEncoder().encode(canonical(signedWrapper)), Buffer.from(bobVault.signingPublicKey, "base64url")), true);
assert.equal((await bobUnlocked.call("decryptAccountV2Message", { message: message1, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "hello",
  "rewrapping must keep the active conversation epoch key");
await assert.rejects(() => bobUnlocked.call("wrapAccountV2Vault", { userId: "mallory", keyVersion: "1", credentialId, prfOutput: secondPrf }),
  (error) => error.code === "INVALID_ACCOUNT_V2_INPUT");
const differentBob = createWorker();
const differentIdentity = await differentBob.call("generateAccountV2Vault", { userId: "bob", keyVersion: "1", prfOutput: prf });
await assert.rejects(() => bobUnlocked.call("unlockAccountV2Vault", { userId: "bob", keyVersion: "1", prfOutput: prf,
  nonce: differentIdentity.nonce, ciphertext: differentIdentity.ciphertext, expectedFingerprint: bobVault.fingerprint,
  expectedEncryptionPublicKey: bobVault.encryptionPublicKey, expectedSigningPublicKey: bobVault.signingPublicKey }),
  (error) => error.code === "ACCOUNT_IDENTITY_CHANGED");
assert.equal((await bobUnlocked.call("getAccountV2State")).fingerprint, bobVault.fingerprint,
  "a valid ciphertext for different private keys must not replace the existing identity");
assert.equal((await bobUnlocked.call("decryptAccountV2Message", { message: message1, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "hello");

const bobOld = createWorker();
const oldVault = await bobOld.call("generateAccountV2Vault", { userId: "bob", keyVersion: "old", prfOutput: prf });
const oldEpoch = await alice.call("createAccountV2Epoch", { conversationId: "historical-chat", epoch: 1,
  recipients: [{ userId: "bob", keyVersion: "old", encryptionPublicKey: oldVault.encryptionPublicKey }] });
const oldMessage = await alice.call("encryptAccountV2Message", { conversationId: "historical-chat", clientMessageId: "historical-message",
  epoch: 1, plaintext: "Keep this historical chat" });
await assert.rejects(() => bobUnlocked.call("unlockAccountV2Vault", { userId: "bob", keyVersion: "old", prfOutput: prf,
  nonce: oldVault.nonce, ciphertext: oldVault.ciphertext, retainOnly: true, expectedFingerprint: bobVault.fingerprint }),
  (error) => error.code === "ACCOUNT_IDENTITY_CHANGED");
assert.equal((await bobUnlocked.call("getAccountV2State")).fingerprint, bobVault.fingerprint,
  "rejecting an inconsistent historical vault must preserve the active identity");
assert.deepEqual([...(await bobUnlocked.call("getAccountV2State")).retainedKeyVersions], []);
await bobUnlocked.call("unlockAccountV2Vault", { userId: "bob", keyVersion: "old", prfOutput: prf,
  nonce: oldVault.nonce, ciphertext: oldVault.ciphertext, retainOnly: true });
const afterHistoricalUnlock = await bobUnlocked.call("getAccountV2State");
assert.equal(afterHistoricalUnlock.fingerprint, bobVault.fingerprint, "historical unlock must not replace the active identity");
assert.deepEqual([...afterHistoricalUnlock.retainedKeyVersions], ["old"]);
assert.equal((await bobUnlocked.call("decryptAccountV2Message", { message: message1, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "hello");
const oldWrapped = await bobUnlocked.call("wrapAccountV2Vault", { userId: "bob", keyVersion: "old", credentialId, prfOutput: secondPrf });
assert.equal(oldWrapped.fingerprint, oldVault.fingerprint);
assert.equal((await bobUnlocked.call("getAccountV2State")).fingerprint, bobVault.fingerprint);

const freshBob = createWorker();
await freshBob.call("unlockAccountV2Vault", { userId: "bob", keyVersion: "1", prfOutput: secondPrf,
  nonce: bobWrapped.nonce, ciphertext: bobWrapped.ciphertext });
await freshBob.call("unlockAccountV2Vault", { userId: "bob", keyVersion: "old", prfOutput: secondPrf,
  nonce: oldWrapped.nonce, ciphertext: oldWrapped.ciphertext, retainOnly: true });
await freshBob.call("openAccountV2Envelope", { conversationId: "group-1", epoch: 1, envelope: bobEnvelope });
await freshBob.call("openAccountV2Envelope", { conversationId: "historical-chat", epoch: 1, envelope: oldEpoch.recipients[0] });
assert.equal((await freshBob.call("decryptAccountV2Message", { message: message1, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "hello");
assert.equal((await freshBob.call("decryptAccountV2Message", { message: oldMessage, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "Keep this historical chat");

// Drafts and queued inputs use a worker-derived key, and authenticate their full
// account/conversation/purpose scope. Another Passkey or refreshed worker can
// reopen them without storing either text or encryption keys in localStorage.
const localScope = { userId: "bob", conversationId: "group-1", purpose: "draft", recordId: "" };
const draftText = "private unsent revision 重新整理笔记";
const sealedDraft = await bobUnlocked.call("sealChatLocalState", { ...localScope, plaintext: draftText });
assert.equal(Object.hasOwn(sealedDraft, "key"), false);
assert.equal(JSON.stringify(sealedDraft).includes(draftText), false);
assert.equal((await freshBob.call("openChatLocalState", { ...localScope, sealed: sealedDraft })).plaintext, draftText,
  "a refreshed worker unlocked with a different Passkey reopens the original encrypted draft");
for (const scopeOverride of [{ userId: "alice" }, { conversationId: "group-2" }, { purpose: "outbox" }, { recordId: "other" }]) {
  await assert.rejects(() => freshBob.call("openChatLocalState", { ...localScope, ...scopeOverride, sealed: sealedDraft }),
    (error) => error.code === "INVALID_LOCAL_STATE");
}
for (const sealedOverride of [{ keyVersion: null }, { deviceId: "different" }, { protocolVersion: "unknown" },
  { ciphertext: b64(new Uint8Array(32)) }, { nonce: b64(new Uint8Array(12)) }]) {
  await assert.rejects(() => freshBob.call("openChatLocalState", { ...localScope, sealed: { ...sealedDraft, ...sealedOverride } }),
    (error) => ["INVALID_LOCAL_STATE", "LOCAL_STATE_DECRYPT_FAILED"].includes(error.code));
}
const historicalDraft = await bobOld.call("sealChatLocalState", { ...localScope, plaintext: "An older identity's draft" });
assert.equal((await freshBob.call("openChatLocalState", { ...localScope, sealed: historicalDraft })).plaintext, "An older identity's draft");
await assert.rejects(() => bobUnlocked.call("sealChatLocalState", { ...localScope, userId: "alice", plaintext: draftText }),
  (error) => error.code === "INVALID_LOCAL_STATE");

const legacyVault = { devices: { "legacy-device": { identityKeyPair: { privKey: sodium.randombytes_buf(32).buffer } } } };
const legacyScope = { ...localScope, protocolVersion: "signal-v1", deviceId: "legacy-device" };
const legacyDraft = await createWorker(legacyVault).call("sealChatLocalState", { ...legacyScope, plaintext: draftText });
assert.equal((await createWorker(legacyVault).call("openChatLocalState", { ...legacyScope, sealed: legacyDraft })).plaintext, draftText);
await assert.rejects(() => createWorker(legacyVault).call("openChatLocalState", { ...legacyScope, deviceId: "other", sealed: legacyDraft }),
  (error) => error.code === "INVALID_LOCAL_STATE");

const localValues = new Map();
const storage = { get length() { return localValues.size; }, key: (index) => [...localValues.keys()][index],
  getItem: (key) => localValues.get(key) || null, setItem: (key, value) => localValues.set(key, String(value)),
  removeItem: (key) => localValues.delete(key) };
const helperContext = vm.createContext({ window: {}, localStorage: storage });
vm.runInContext(await readFile("scripts/chat-local-state.js", "utf8"), helperContext);
const localHelper = helperContext.window.ExpChatLocalState.create({ userId: "bob", cryptoCall: (...args) => bobUnlocked.call(...args) });
const draftValue = { text: draftText, replyTo: { id: "message-to-reply" } };
await localHelper.saveDraft("group-1", draftValue);
assert.equal(JSON.stringify([...localValues.values()]).includes(draftText), false);
const refreshedHelper = helperContext.window.ExpChatLocalState.create({ userId: "bob", cryptoCall: (...args) => freshBob.call(...args) });
assert.equal(JSON.stringify(await refreshedHelper.loadDraft("group-1")), JSON.stringify(draftValue));
const otherHelper = helperContext.window.ExpChatLocalState.create({ userId: "alice", cryptoCall: (...args) => alice.call(...args) });
assert.equal(await otherHelper.loadDraft("group-1"), null, "local record paths isolate accounts");
assert.equal(localHelper.setPinned("group-1", true), true);
assert.equal(refreshedHelper.isPinned("group-1"), true);
assert.equal(otherHelper.isPinned("group-1"), false);
await localHelper.saveEncrypted("group-1", "outbox", { text: draftText }, "client-queued-1");
assert.equal(JSON.stringify(localHelper.listEncrypted("outbox")), JSON.stringify([{ conversationId: "group-1", recordId: "client-queued-1" }]));
await Promise.all([localHelper.saveDraft("group-1", { text: "Racing autosave" }), localHelper.clearDraft("group-1")]);
assert.equal(await localHelper.loadDraft("group-1"), null, "sending must clear an earlier asynchronous autosave");

// A login-bound cache transfers only authenticated ciphertext and a browser
// CryptoKey. It restores every retained identity without replaying PRF output.
const sessionKey = await webcrypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
await assert.rejects(() => webcrypto.subtle.exportKey("raw", sessionKey));
const sessionInput = { userId: "bob", sessionBinding: "login-token-sha256", expiresAt: Date.now() + 60000, wrappingKey: sessionKey };
const sealed = await freshBob.call("sealAccountV2Session", { ...sessionInput, credentialId });
assert.deepEqual(Object.keys(sealed).sort(), ["ciphertext", "nonce"]);
const accountKeys = [{ ...bobVault, credentialIds: [credentialId] }, { ...oldVault, credentialIds: [credentialId] }];
const resumedBob = createWorker();
const resumed = await resumedBob.call("restoreAccountV2Session", { ...sessionInput, ...sealed, accountKeys });
assert.equal(resumed.fingerprint, bobVault.fingerprint);
assert.deepEqual([...resumed.retainedKeyVersions], ["old"]);
assert.equal(resumed.credentialId, credentialId);
assert.equal((await resumedBob.call("decryptAccountV2Message", { message: message1, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "hello");
assert.equal((await resumedBob.call("decryptAccountV2Message", { message: oldMessage, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "Keep this historical chat");
for (const override of [
  { userId: "mallory" }, { sessionBinding: "another-login-token" }, { expiresAt: Date.now() - 1 },
  { ciphertext: b64(new Uint8Array(32)) }, { accountKeys: [{ ...bobVault, credentialIds: [] }, accountKeys[1]] },
  { accountKeys: [accountKeys[0], { ...oldVault, credentialIds: [] }] },
  { accountKeys: [{ ...differentIdentity, credentialIds: [credentialId] }, accountKeys[1]] },
  { accountKeys: [{ ...bobVault, keyVersion: "new-head", credentialIds: [credentialId] }, accountKeys[1]] },
]) {
  await assert.rejects(() => resumedBob.call("restoreAccountV2Session", { ...sessionInput, ...sealed, accountKeys, ...override }),
    (error) => ["CHAT_SESSION_INVALID", "ACCOUNT_IDENTITY_CHANGED"].includes(error.code));
  assert.equal((await resumedBob.call("getAccountV2State")).fingerprint, bobVault.fingerprint,
    "rejecting a stale, revoked, mismatched or tampered session must preserve the previously unlocked identity");
  assert.equal((await resumedBob.call("decryptAccountV2Message", { message: oldMessage, signingPublicKey: aliceVault.signingPublicKey })).plaintext, "Keep this historical chat");
}
await resumedBob.call("lockAccountV2Vault");
assert.equal((await resumedBob.call("getAccountV2State")).unlocked, false);
await assert.rejects(() => resumedBob.call("sealAccountV2Session", { ...sessionInput, credentialId }), (error) => error.code === "ACCOUNT_VAULT_LOCKED");
await freshBob.call("lockAccountV2Vault");
await assert.rejects(() => freshBob.call("wrapAccountV2Vault", { userId: "bob", keyVersion: "old", credentialId, prfOutput: secondPrf }),
  (error) => error.code === "ACCOUNT_VAULT_LOCKED");
await assert.rejects(() => freshBob.call("openChatLocalState", { ...localScope, sealed: sealedDraft }),
  (error) => error.code === "ACCOUNT_VAULT_LOCKED");
await assert.rejects(() => freshBob.call("sealChatLocalState", { ...localScope, plaintext: draftText }),
  (error) => error.code === "ACCOUNT_VAULT_LOCKED");
const message2 = await alice.call("encryptAccountV2Message", { conversationId: "group-1", clientMessageId: "m2", epoch: 1, plaintext: "hello" });
assert.notEqual(message1.nonce, message2.nonce);
const tamperedMessage = { ...message1, conversationId: "other" };
await assert.rejects(
  () => bobUnlocked.call("decryptAccountV2Message", { message: tamperedMessage, signingPublicKey: aliceVault.signingPublicKey }),
  (error) => error.code === "SIGNATURE_INVALID",
);

const groupProfile = { name: "Team", announcement: { text: "Review chapter 4 by Friday.", updatedBy: "alice", updatedAt: "2026-10-05T08:00:00Z" } };
const metadata = await alice.call("encryptAccountV2Metadata", { conversationId: "group-1", epoch: 1, version: "3", plaintext: JSON.stringify(groupProfile) });
const openedMetadata = await bobUnlocked.call("decryptAccountV2Metadata", { conversationId: "group-1", epoch: 1, version: "3", ...metadata });
assert.equal(openedMetadata.plaintext, JSON.stringify(groupProfile));
await assert.rejects(
  () => bobUnlocked.call("decryptAccountV2Metadata", { ...metadata, conversationId: "group-1", epoch: 1, version: "4" }),
  (error) => error.code === "ACCOUNT_V2_DECRYPT_FAILED",
);

const createControl = await alice.call("signAccountV2Control", { conversationId: "group-1", expectedEpoch: 0, action: "create", payload: { kind: "group" } });
assert.equal(createControl.expectedEpoch, 0);
const control = await alice.call("signAccountV2Control", { conversationId: "group-1", expectedEpoch: 1, action: "member.add", payload: { z: 2, a: 1 } });
const controlReordered = await alice.call("signAccountV2Control", { conversationId: "group-1", expectedEpoch: 1, action: "member.add", payload: { a: 1, z: 2 } });
assert.equal(control.signature, controlReordered.signature);
const { signature: controlSignature, ...controlUnsigned } = control;
assert.equal(await sodium.crypto_sign_verify_detached(Buffer.from(controlSignature, "base64url"), new TextEncoder().encode(canonical(controlUnsigned)), Buffer.from(aliceVault.signingPublicKey, "base64url")), true);

await alice.call("lockAccountV2Vault");
assert.equal((await alice.call("getAccountV2State")).unlocked, false);
await assert.rejects(() => alice.call("encryptAccountV2Message", { conversationId: "group-1", clientMessageId: "locked", epoch: 1, plaintext: "nope" }), (error) => error.code === "ACCOUNT_VAULT_LOCKED");
const racingWorker = createWorker();
await Promise.all([
  racingWorker.call("generateAccountV2Vault", { userId: "alice", keyVersion: "1", prfOutput: prf }),
  racingWorker.call("lockAccountV2Vault"),
]);
assert.equal((await racingWorker.call("getAccountV2State")).unlocked, false, "locking must wait for earlier vault operations and wipe their result");
console.log("account-v2 crypto smoke passed");
