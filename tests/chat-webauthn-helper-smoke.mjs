import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { verifyAuthenticationResponse } from "../cloudflare/webauthn.js";

const crypto = webcrypto;
const encoder = new TextEncoder();
const rpId = "expassway.test";
const origin = `https://${rpId}`;
const challenge = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = JSON.stringify(await crypto.subtle.exportKey("jwk", keyPair.publicKey));

async function assertion(signCount, flags = 0x05) {
  const clientData = encoder.encode(JSON.stringify({ type: "webauthn.get", challenge, origin }));
  const authenticatorData = new Uint8Array(37);
  authenticatorData.set(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(rpId))));
  authenticatorData[32] = flags;
  new DataView(authenticatorData.buffer).setUint32(33, signCount);
  const signedData = new Uint8Array(69);
  signedData.set(authenticatorData);
  signedData.set(new Uint8Array(await crypto.subtle.digest("SHA-256", clientData)), 37);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keyPair.privateKey, signedData));
  return {
    type: "public-key",
    response: {
      clientDataJSON: Buffer.from(clientData).toString("base64url"),
      authenticatorData: Buffer.from(authenticatorData).toString("base64url"),
      signature: Buffer.from(signature).toString("base64url"),
    },
  };
}

async function verify(signCount, expectedSignCount, flags) {
  return verifyAuthenticationResponse({ credential: await assertion(signCount, flags), challenge, rpId, origins: [origin], publicKey, expectedSignCount });
}

assert.equal((await verify(0, 0)).signCount, 0, "authenticators without counters remain supported");
assert.equal((await verify(2, 1)).signCount, 2);
await assert.rejects(() => verify(1, 1), (error) => error.code === "WEBAUTHN_CLONED_CREDENTIAL");
await assert.rejects(() => verify(0, 1), (error) => error.code === "WEBAUTHN_CLONED_CREDENTIAL", "a previously nonzero counter cannot reset to zero");
await assert.rejects(() => verify(0, 0, 0x15), (error) => error.code === "INVALID_WEBAUTHN_AUTHENTICATOR_DATA", "backup state requires backup eligibility");
assert.equal((await verify(0, 0, 0x1d)).backupState, true);

const invalid = await assertion(0);
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const encoded = invalid.response.authenticatorData;
const last = alphabet.indexOf(encoded.at(-1));
invalid.response.authenticatorData = `${encoded.slice(0, -1)}${alphabet[last + 1]}`;
await assert.rejects(
  () => verifyAuthenticationResponse({ credential: invalid, challenge, rpId, origins: [origin], publicKey, expectedSignCount: 0 }),
  (error) => error.code === "INVALID_WEBAUTHN_CREDENTIAL",
  "noncanonical base64url must be rejected before signature verification",
);
console.log("WebAuthn helper smoke checks passed.");
