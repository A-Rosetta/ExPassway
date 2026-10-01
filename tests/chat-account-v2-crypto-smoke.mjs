import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
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

function createWorker() {
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
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(bundle, context, { filename: "chat-crypto-worker.js" });
  let id = 0;
  return {
    async call(action, payload = {}) {
      const requestId = ++id;
      await context.self.onmessage({ data: { id: requestId, action, payload } });
      const message = messages.splice(0).find((item) => item.id === requestId);
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

const message1 = await alice.call("encryptAccountV2Message", { conversationId: "group-1", clientMessageId: "m1", epoch: 1, plaintext: "hello" });
const opened1 = await bobUnlocked.call("decryptAccountV2Message", { message: message1, signingPublicKey: aliceVault.signingPublicKey });
assert.equal(opened1.plaintext, "hello");
const message2 = await alice.call("encryptAccountV2Message", { conversationId: "group-1", clientMessageId: "m2", epoch: 1, plaintext: "hello" });
assert.notEqual(message1.nonce, message2.nonce);
const tamperedMessage = { ...message1, conversationId: "other" };
await assert.rejects(
  () => bobUnlocked.call("decryptAccountV2Message", { message: tamperedMessage, signingPublicKey: aliceVault.signingPublicKey }),
  (error) => error.code === "SIGNATURE_INVALID" || error.code === "ACCOUNT_VAULT_LOCKED" || error.code === "EPOCH_KEY_UNAVAILABLE" || error.code === "ACCOUNT_V2_DECRYPT_FAILED",
);

const metadata = await alice.call("encryptAccountV2Metadata", { conversationId: "group-1", epoch: 1, version: "3", plaintext: JSON.stringify({ name: "Team" }) });
const openedMetadata = await bobUnlocked.call("decryptAccountV2Metadata", { conversationId: "group-1", epoch: 1, version: "3", ...metadata });
assert.equal(openedMetadata.plaintext, JSON.stringify({ name: "Team" }));
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
console.log("account-v2 crypto smoke passed");
