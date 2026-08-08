import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { KeyHelper, SignalProtocolAddress, SessionBuilder, SessionCipher } from "@privacyresearch/libsignal-protocol-typescript";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function createStore(identityKeyPair, registrationId) {
  const preKeys = new Map();
  const signedPreKeys = new Map();
  const sessions = new Map();
  const identities = new Map();
  return {
    async getIdentityKeyPair() { return identityKeyPair; },
    async getLocalRegistrationId() { return registrationId; },
    async isTrustedIdentity(identifier, identityKey) {
      const encoded = Buffer.from(new Uint8Array(identityKey)).toString("base64");
      return !identities.has(identifier) || identities.get(identifier) === encoded;
    },
    async saveIdentity(identifier, identityKey) {
      identities.set(identifier, Buffer.from(new Uint8Array(identityKey)).toString("base64"));
      return true;
    },
    async loadPreKey(id) { return preKeys.get(Number(id)); },
    async storePreKey(id, pair) { preKeys.set(Number(id), pair); },
    async removePreKey(id) { preKeys.delete(Number(id)); },
    async loadSignedPreKey(id) { return signedPreKeys.get(Number(id)); },
    async storeSignedPreKey(id, pair) { signedPreKeys.set(Number(id), pair); },
    async removeSignedPreKey(id) { signedPreKeys.delete(Number(id)); },
    async loadSession(identifier) { return sessions.get(identifier); },
    async storeSession(identifier, record) { sessions.set(identifier, record); },
    async deleteSession(identifier) { sessions.delete(identifier); },
    async deleteAllSessions(identifier) { for (const key of sessions.keys()) if (key.startsWith(identifier)) sessions.delete(key); },
  };
}

function b64(value) {
  return Buffer.from(value instanceof ArrayBuffer ? new Uint8Array(value) : value).toString("base64url");
}

const aliceIdentity = await KeyHelper.generateIdentityKeyPair();
const bobIdentity = await KeyHelper.generateIdentityKeyPair();
const alice = createStore(aliceIdentity, KeyHelper.generateRegistrationId());
const bob = createStore(bobIdentity, KeyHelper.generateRegistrationId());
const bobSigned = await KeyHelper.generateSignedPreKey(bobIdentity, 1);
const bobPre = await KeyHelper.generatePreKey(1);
await bob.storeSignedPreKey(1, bobSigned.keyPair);
await bob.storePreKey(1, bobPre.keyPair);

const aliceAddress = new SignalProtocolAddress("bob-device", 7);
const bobAddress = new SignalProtocolAddress("alice-device", 4);
const aliceBuilder = new SessionBuilder(alice, aliceAddress);
await aliceBuilder.processPreKey({
  identityKey: bobIdentity.pubKey,
  registrationId: await bob.getLocalRegistrationId(),
  signedPreKey: { keyId: bobSigned.keyId, publicKey: bobSigned.keyPair.pubKey, signature: bobSigned.signature },
  preKey: { keyId: bobPre.keyId, publicKey: bobPre.keyPair.pubKey },
});
const encrypted = await new SessionCipher(alice, aliceAddress).encrypt(new TextEncoder().encode("encrypted hello").buffer);
const encoded = b64(encrypted.body);
const decrypted = await new SessionCipher(bob, bobAddress).decryptPreKeyWhisperMessage(
  Buffer.from(encrypted.body, "binary").toString("binary"),
  "binary"
);
assert.equal(new TextDecoder().decode(decrypted), "encrypted hello");
assert.notEqual(encoded, Buffer.from("encrypted hello").toString("base64url"));
console.log("chat crypto smoke passed");
