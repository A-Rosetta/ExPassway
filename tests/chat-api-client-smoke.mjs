import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const timers = [];
let fetchRequest = async () => ({ ok: true, json: async () => ({ data: { ready: true } }) });
const context = vm.createContext({
  window: { location: { protocol: "https:", port: "", hostname: "expassway.test", pathname: "/pages/chat.html" } },
  localStorage: { getItem: () => "", removeItem: () => {} },
  URL, URLSearchParams, AbortController,
  setTimeout: (callback, milliseconds) => { timers.push({ callback, milliseconds }); return timers.length; },
  clearTimeout: () => {}, fetch: (...args) => fetchRequest(...args),
});
vm.runInContext(await readFile(new URL("../scripts/api.js", import.meta.url), "utf8"), context);
const api = context.window.ALevelApi;
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
console.log("Chat API client timeout and error checks passed.");
