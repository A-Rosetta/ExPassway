import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const context = vm.createContext({ window: {}, Uint8Array, atob, btoa });
vm.runInContext(await readFile(new URL("../scripts/passkey-utils.js", import.meta.url), "utf8"), context);
const { publicKeyOptions, serialiseCredential } = context.window.ALevelPasskeys;
const raw = { publicKey: {
  challenge: "AQID", user: { id: "BAU" },
  allowCredentials: [{ id: "Bgc", type: "public-key" }],
  extensions: { prf: { evalByCredential: { Bgc: { first: "CAk", second: "Cgs" } } } },
} };
const options = publicKeyOptions(raw);
assert.deepEqual([...options.challenge], [1, 2, 3]);
assert.deepEqual([...options.user.id], [4, 5]);
assert.deepEqual([...options.allowCredentials[0].id], [6, 7]);
assert.deepEqual([...options.extensions.prf.evalByCredential.Bgc.first], [8, 9]);
assert.deepEqual([...options.extensions.prf.evalByCredential.Bgc.second], [10, 11]);
assert.equal(raw.publicKey.challenge, "AQID", "Decoding must not mutate retryable server options");
assert.equal(raw.publicKey.extensions.prf.evalByCredential.Bgc.first, "CAk");
const bytes = (...values) => new Uint8Array(values).buffer;
const assertion = serialiseCredential({
  id: "AQID", rawId: bytes(1, 2, 3), type: "public-key",
  response: { clientDataJSON: bytes(4, 5), authenticatorData: bytes(6, 7), signature: bytes(8, 9), userHandle: bytes(10, 11) },
  getClientExtensionResults: () => ({ prf: { results: { first: bytes(12, 13) } } }),
});
assert.equal(assertion.response.authenticatorData, "Bgc");
assert.equal(assertion.response.signature, "CAk");
assert.equal(assertion.response.userHandle, "Cgs");
assert.equal(assertion.clientExtensionResults.prf.enabled, true);
assert.equal(assertion.clientExtensionResults.prf.results, undefined, "PRF encryption secret must stay on device");
const registration = serialiseCredential({
  id: "AQID", rawId: bytes(1, 2, 3), type: "public-key",
  response: { clientDataJSON: bytes(4, 5), attestationObject: bytes(6, 7), getTransports: () => ["internal"] },
  getClientExtensionResults: () => ({ prf: { enabled: true } }),
});
assert.equal(registration.response.attestationObject, "Bgc");
assert.deepEqual(registration.response.transports, ["internal"]);
assert.equal(registration.response.signature, undefined);

const home = await readFile(new URL("../index.html", import.meta.url), "utf8");
for (const script of home.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
  assert.equal(script[1].trim(), "", "Home scripts must be external for the existing CSP");
}
assert.match(home, /src="scripts\/passkey-settings\.js\?v=/);
const login = await readFile(new URL("../pages/login.html", import.meta.url), "utf8");
assert.ok(login.indexOf("scripts/passkey-utils.js") < login.indexOf("scripts/login.js"));
console.log("Passkey assertion/registration serialization, PRF privacy and CSP asset contracts passed.");
