import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const timers = [];
let currentToken = "";
let sessionClears = 0;
let fetchRequest = async () => ({ ok: true, json: async () => ({ data: { ready: true } }) });
const context = vm.createContext({
  window: { location: { protocol: "https:", port: "", hostname: "expassway.test", pathname: "/pages/chat.html" }, ALevelChatSession: { clear: () => { sessionClears += 1; } } },
  localStorage: { getItem: key => key === "alevel.authToken" ? currentToken : "", removeItem: () => {} },
  URL, URLSearchParams, AbortController,
  setTimeout: (callback, milliseconds) => { timers.push({ callback, milliseconds }); return timers.length; },
  clearTimeout: () => {}, fetch: (...args) => fetchRequest(...args),
});
vm.runInContext(await readFile(new URL("../scripts/api.js", import.meta.url), "utf8"), context);
const api = context.window.ALevelApi;
for (const method of ["listChatInvites", "createChatInvite", "revokeChatInvite", "acceptChatInvite"]) assert.equal(api[method], undefined, "Invite links must not remain available in the client API.");
assert.equal((await api.getChatProfile()).ready, true);
assert.equal(timers.at(-1).milliseconds, 30000, "chat membership/vault requests need the same deadline as message sync");
await api.getCatalogSubjects();
assert.equal(timers.at(-1).milliseconds, 8000);
fetchRequest = (_url, options) => new Promise((_resolve, reject) => {
  options.signal.addEventListener("abort", () => reject(new Error("signal is aborted without reason")));
});
const pending = api.getChatConversationEpochs("test-conversation");
timers.at(-1).callback();
await assert.rejects(pending, (error) => error.code === "REQUEST_TIMEOUT" && /Refresh the chat/.test(error.message));
fetchRequest = async () => ({ ok: false, status: 409, json: async () => ({ error: { code: "ACCOUNT_KEY_CHANGED", message: "Identity changed" } }) });
await assert.rejects(api.getChatProfile(), (error) => error.code === "ACCOUNT_KEY_CHANGED" && error.status === 409);
const requests = [];
fetchRequest = async (url, options) => {
  requests.push({ url, options });
  return { ok: true, json: async () => ({ data: { ready: true } }) };
};
await api.getChatAccountVault({ credentialId: "credential+/=", keyVersion: "old&version" });
const vaultUrl = new URL(requests.at(-1).url, "https://expassway.test");
assert.equal(vaultUrl.searchParams.get("credentialId"), "credential+/=");
assert.equal(vaultUrl.searchParams.get("keyVersion"), "old&version", "A selected historical vault must not become extra query parameters.");
await api.getChatPasskeyAuthenticationOptions({ credentialId: "chosen", keyVersion: "2", purpose: "account-wrap" });
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { credentialId: "chosen", keyVersion: "2", purpose: "account-wrap" }, "Credential-specific enrollment must reach the scoped WebAuthn challenge.");
await api.getChatAccountVaults();
assert.equal(new URL(requests.at(-1).url, "https://expassway.test").pathname, "/api/chat/account/vaults");
await api.saveChatAccountVaultWrapper({ credentialId: "chosen", keyVersion: "2", nonce: "nonce", ciphertext: "encrypted", proof: "proof", signature: "signature" });
assert.equal(requests.at(-1).options.method, "PUT");
assert.equal(new URL(requests.at(-1).url, "https://expassway.test").pathname, "/api/chat/account/vault/wrappers");
assert.equal(JSON.parse(requests.at(-1).options.body).ciphertext, "encrypted");
await api.deleteChatContact("contact&/id");
assert.equal(requests.at(-1).options.method, "DELETE");
assert.equal(new URL(requests.at(-1).url, "https://expassway.test").pathname, "/api/chat/contacts/contact%26%2Fid");
await api.getChatBlocks();
assert.equal(new URL(requests.at(-1).url, "https://expassway.test").pathname, "/api/chat/blocks");
await api.blockChatUser("  learner_bob  ");
assert.equal(requests.at(-1).options.method, "POST");
assert.deepEqual(JSON.parse(requests.at(-1).options.body), { chatUserId: "learner_bob" });
await api.unblockChatUser("learner+bob");
assert.equal(requests.at(-1).options.method, "DELETE");
assert.equal(new URL(requests.at(-1).url, "https://expassway.test").pathname, "/api/chat/blocks/learner%2Bbob");
await api.reportChatContact({ chatUserId: "learner_bob", reason: "spam", details: "Please review" });
assert.equal(new URL(requests.at(-1).url, "https://expassway.test").pathname, "/api/chat/contact-reports");
assert.equal(JSON.parse(requests.at(-1).options.body).details, "Please review");
fetchRequest = async () => ({ ok: true, json: async () => ({ ok: true, data: null }) });
assert.equal(await api.getChatAccountVault(), null, "A missing vault must stay null so setup cannot mistake the response envelope for encrypted key material.");
currentToken = "active-login";
fetchRequest = async () => ({ ok: false, status: 401, json: async () => ({ error: { code: "UNAUTHORIZED" } }) });
await assert.rejects(api.getCurrentUser("old-login"));
assert.equal(sessionClears, 0, "An old request must not clear a newer login's chat cache.");
await assert.rejects(api.getCurrentUser("active-login"));
assert.equal(sessionClears, 1, "Expired authentication must clear the unlocked chat cache.");
fetchRequest = async () => ({ ok: false, status: 403, json: async () => ({ error: { code: "FORBIDDEN" } }) });
await assert.rejects(api.getCurrentUser("active-login"));
assert.equal(sessionClears, 1, "An unrelated forbidden operation is not a logout.");
fetchRequest = async () => ({ ok: false, status: 403, json: async () => ({ error: { code: "ACCOUNT_DISABLED" } }) });
await assert.rejects(api.getCurrentUser("active-login"));
assert.equal(sessionClears, 2, "A disabled account must lose its cached chat unlock.");
console.log("Chat API client timeout and error checks passed.");
