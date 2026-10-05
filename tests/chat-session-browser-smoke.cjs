const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

// Real Chat page, IndexedDB and crypto Worker. The isolated API and authenticator
// fixtures avoid sending emails or touching production accounts/credentials.
async function main() {
  const root = path.resolve(__dirname, "..");
  const makeToken = (sub, exp = Math.floor(Date.now() / 1000) + 3600, iat = 1) => `${Buffer.from(JSON.stringify({ sub, exp, iat })).toString("base64url")}.fixture-signature`;
  const token = makeToken("alice");
  const newToken = makeToken("alice", Math.floor(Date.now() / 1000) + 3600, 2);
  const otherToken = makeToken("other");
  let fixtures;
  let rejectProfile = false;
  let revokeCredential = false;
  let wrongHead = false;
  const errors = [];
  const calls = [];
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        calls.push(url.pathname);
        const provided = String(req.headers.authorization || "").replace(/^Bearer /, "");
        let identity;
        try { identity = JSON.parse(Buffer.from(provided.split(".")[0], "base64url").toString()); } catch (_error) {}
        if (!identity || identity.exp * 1000 <= Date.now() || rejectProfile) {
          res.writeHead(401, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: false, error: { code: "UNAUTHORIZED", message: "Fixture session expired" } })); return;
        }
        let data;
        if (url.pathname === "/api/auth/me") data = { id: identity.sub, displayName: "Alice", role: "student" };
        else if (url.pathname === "/api/chat/profile") data = { id: identity.sub, alias: "Alice", chatUserId: "alice-chat" };
        else if (url.pathname === "/api/chat/account/keys") data = { enabled: true, passkeyReady: true,
          accountKey: { ...fixtures.current, ...(wrongHead ? { keyVersion: "replacement" } : {}) }, credentialIds: revokeCredential ? [] : ["AQID"] };
        else if (url.pathname === "/api/chat/account/vault") data = fixtures.vaults[0];
        else if (url.pathname === "/api/chat/account/vaults") data = { vaults: fixtures.vaults };
        else if (url.pathname.endsWith("/authenticate/options")) data = { publicKey: { challenge: "AQID", allowCredentials: [{ id: "AQID", type: "public-key" }], extensions: { prf: { eval: { first: "AQID" } } } } };
        else if (url.pathname.endsWith("/authenticate/verify")) data = { verified: true, credentialId: "AQID", proof: "fixture-proof", keyVersion: "1" };
        else if (["/api/chat/contacts", "/api/chat/conversations"].includes(url.pathname)) data = [];
        else data = null;
        res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ ok: true, data })); return;
      }
      if (url.pathname === "/seed.html") { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><title>Session fixture setup</title>"); return; }
      const filename = path.resolve(root, `.${url.pathname}`);
      if (!filename.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end(); return; }
      const contents = await fs.readFile(filename);
      res.writeHead(200, { "Content-Type": filename.endsWith(".html") ? "text/html" : filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : filename.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream" });
      res.end(contents);
    } catch (_error) { res.writeHead(404); res.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
      if (!existsSync(edge)) throw error;
      browser = await chromium.launch({ headless: true, executablePath: edge });
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, reducedMotion: "reduce" });
    await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, body: "" }));
    await context.addInitScript(({ token }) => {
      if (!localStorage.getItem("alevel.authToken")) localStorage.setItem("alevel.authToken", token);
      window.__assertions = 0;
      window.PublicKeyCredential = function PublicKeyCredential() {};
      Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: async () => { throw new Error("Existing accounts must not create another Passkey."); }, get: async () => {
        window.__assertions += 1;
        return { id: "AQID", type: "public-key", rawId: new Uint8Array([1, 2, 3]).buffer,
          response: { clientDataJSON: new TextEncoder().encode("{}").buffer, authenticatorData: new ArrayBuffer(0), signature: new ArrayBuffer(0) },
          getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(9).buffer } } }),
        };
      } } });
      const RealWorker = window.Worker;
      window.Worker = class extends RealWorker {
        constructor(...args) { super(...args); window.__worker = this; }
      };
      window.__cryptoCall = (action, payload = {}) => new Promise((resolve, reject) => {
        const id = crypto.randomUUID();
        const handler = (event) => {
          if (event.data.id !== id) return;
          window.__worker.removeEventListener("message", handler);
          if (event.data.ok) resolve(event.data.result); else reject(new Error(event.data.error));
        };
        window.__worker.addEventListener("message", handler);
        window.__worker.postMessage({ id, action, payload });
      });
      window.__sessionRecord = () => new Promise((resolve, reject) => {
        const request = indexedDB.open("expassway-chat-login-session-v1", 1);
        request.onupgradeneeded = () => request.result.createObjectStore("session");
        request.onsuccess = () => {
          const read = request.result.transaction("session").objectStore("session").get("unlocked-account");
          read.onsuccess = () => resolve(read.result || null); read.onerror = () => reject(read.error);
        };
      });
    }, { token });
    const seed = await context.newPage();
    await seed.goto(`${base}/seed.html`);
    fixtures = await seed.evaluate(async () => {
      const prfOutput = btoa(String.fromCharCode(...new Uint8Array(32).fill(9))).replace(/=+$/, "");
      new Worker("/assets/vendor/chat-crypto-worker.js");
      const current = await window.__cryptoCall("generateAccountV2Vault", { userId: "alice", keyVersion: "1", prfOutput });
      const currentEpoch = await window.__cryptoCall("createAccountV2Epoch", { conversationId: "current", epoch: 1,
        recipients: [{ userId: "alice", keyVersion: "1", encryptionPublicKey: current.encryptionPublicKey }] });
      const currentMessage = await window.__cryptoCall("encryptAccountV2Message", { conversationId: "current", epoch: 1, clientMessageId: "current-message", plaintext: "Current history preserved" });
      new Worker("/assets/vendor/chat-crypto-worker.js");
      const old = await window.__cryptoCall("generateAccountV2Vault", { userId: "alice", keyVersion: "old", prfOutput });
      const oldEpoch = await window.__cryptoCall("createAccountV2Epoch", { conversationId: "older", epoch: 1,
        recipients: [{ userId: "alice", keyVersion: "old", encryptionPublicKey: old.encryptionPublicKey }] });
      const oldMessage = await window.__cryptoCall("encryptAccountV2Message", { conversationId: "older", epoch: 1, clientMessageId: "older-message", plaintext: "Older history preserved" });
      return { current, old, currentEpoch, oldEpoch, currentMessage, oldMessage,
        vaults: [current, old].map((vault) => ({ ...vault, credentialId: "AQID", accountKey: vault,
          wrappers: [{ ...vault, credentialId: "AQID" }] })) };
    });
    await seed.close();
    const openChat = async () => {
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${base}/pages/chat.html`);
      assert.match(await page.title(), /ExPassway/);
      return page;
    };
    const waitCached = (page) => page.waitForFunction(async () => Boolean((await window.__sessionRecord())?.ciphertext));
    const first = await openChat();
    try { await first.waitForFunction(() => !document.querySelector("#unlockAccountSync").hidden || Boolean(document.querySelector("#chatStatus").textContent), null, { timeout: 3000 }); }
    catch (error) { throw new Error(`${error.message}; errors=${errors.join(";")}; calls=${calls.join(",")}; state=${JSON.stringify(await first.evaluate(() => ({ url: location.href, token: localStorage.getItem("alevel.authToken"), api: typeof window.ALevelApi, session: typeof window.ALevelChatSession, scripts: [...document.scripts].map((script) => script.src) })))}`); }
    if (await first.locator("#unlockAccountSync").isHidden()) throw new Error(`Chat fixture failed to initialize: ${await first.locator("#chatStatus").textContent()}; errors=${errors.join(";")}; calls=${calls.join(",")}`);
    await first.click("#unlockAccountSync");
    await first.locator("#chatApp").waitFor({ state: "visible" });
    await waitCached(first);
    assert.equal(await first.evaluate(() => window.__assertions), 1);
    assert.equal(await first.locator("#addAccountPasskey").count(), 0);
    assert.equal(await first.locator("#inviteToken").count(), 0);
    assert.ok(!calls.some((name) => name.includes("/invites")));
    const decryptHistory = async (page) => page.evaluate(async (fixtures) => {
      await window.__cryptoCall("openAccountV2Envelope", { conversationId: "current", epoch: 1, envelope: fixtures.currentEpoch.recipients[0] });
      await window.__cryptoCall("openAccountV2Envelope", { conversationId: "older", epoch: 1, envelope: fixtures.oldEpoch.recipients[0] });
      return [(await window.__cryptoCall("decryptAccountV2Message", { message: fixtures.currentMessage, signingPublicKey: fixtures.current.signingPublicKey })).plaintext,
        (await window.__cryptoCall("decryptAccountV2Message", { message: fixtures.oldMessage, signingPublicKey: fixtures.old.signingPublicKey })).plaintext];
    }, fixtures);
    assert.deepEqual(await decryptHistory(first), ["Current history preserved", "Older history preserved"]);
    await first.reload();
    await first.locator("#chatApp").waitFor({ state: "visible" });
    assert.equal(await first.evaluate(() => window.__assertions), 0, "reload must not prompt the authenticator");
    assert.deepEqual(await decryptHistory(first), ["Current history preserved", "Older history preserved"]);
    const second = await openChat();
    await second.locator("#chatApp").waitFor({ state: "visible" });
    assert.equal(await second.evaluate(() => window.__assertions), 0, "another Chat tab in the same login must restore without Passkey");
    assert.deepEqual(await decryptHistory(second), ["Current history preserved", "Older history preserved"]);
    const storage = await first.evaluate(async () => {
      const record = await window.__sessionRecord();
      let exportRejected = false;
      try { await crypto.subtle.exportKey("raw", record.key); } catch (_error) { exportRejected = true; }
      return { fields: Object.keys(record), nonextractable: record.key.extractable === false, exportRejected, json: JSON.stringify(record) };
    });
    assert.ok(storage.nonextractable && storage.exportRejected);
    for (const secret of ["vaultRootKey", "encryptionPrivateKey", "signingPrivateKey", "prfOutput", token]) assert.ok(!storage.json.includes(secret));
    assert.ok(storage.fields.includes("ciphertext"));
    if (process.env.CHAT_SESSION_QA_DIR) {
      await first.waitForFunction(() => [...document.querySelectorAll('img[src*="chat-icon"]')].every((image) => image.complete && image.naturalWidth > 0));
      await fs.mkdir(process.env.CHAT_SESSION_QA_DIR, { recursive: true });
      await first.screenshot({ path: path.join(process.env.CHAT_SESSION_QA_DIR, "chat-restored-desktop.png"), fullPage: true });
      await first.setViewportSize({ width: 390, height: 844 });
      await first.screenshot({ path: path.join(process.env.CHAT_SESSION_QA_DIR, "chat-restored-mobile.png"), fullPage: true });
    }
    console.log("Session browser: real Chat reload/new tab restores current and historical keys without additional assertions");

    for (const mode of ["wrong-head", "revoked", "tamper", "new-token", "other-user"]) {
      if (mode === "wrong-head") wrongHead = true;
      if (mode === "revoked") revokeCredential = true;
      if (mode === "tamper") await first.evaluate(async () => {
        const record = await window.__sessionRecord(); record.ciphertext = "AQID";
        const request = indexedDB.open("expassway-chat-login-session-v1", 1);
        await new Promise((resolve) => { request.onsuccess = () => {
          const transaction = request.result.transaction("session", "readwrite");
          transaction.objectStore("session").put(record, "unlocked-account"); transaction.oncomplete = resolve;
        }; });
      });
      if (mode === "new-token" || mode === "other-user") await first.evaluate((next) => localStorage.setItem("alevel.authToken", next), mode === "new-token" ? newToken : otherToken);
      const attempt = await openChat();
      await attempt.locator("#chatSetupPanel").waitFor({ state: "visible" });
      assert.equal(await attempt.locator("#chatApp").isVisible(), false, `${mode}: stale cache must not display decrypted Chat`);
      assert.equal(await attempt.evaluate(() => window.__assertions), 0);
      await attempt.close();
      wrongHead = false; revokeCredential = false;
      await first.evaluate((original) => localStorage.setItem("alevel.authToken", original), token);
      await first.reload();
      await first.click("#unlockAccountSync");
      await first.locator("#chatApp").waitFor({ state: "visible" });
      await waitCached(first);
    }
    console.log("Session browser: current identity change, credential revocation, tamper, new login and account switch fail closed");
    // Clear from one tab wipes decrypted UI and drafts in every open Chat tab.
    await second.reload(); await second.locator("#chatApp").waitFor({ state: "visible" });
    await second.evaluate(() => { document.querySelector("#messageInput").value = "Discard this unlocked draft"; });
    await first.evaluate(() => window.ALevelChatSession.clear());
    await second.locator("#chatApp").waitFor({ state: "hidden" });
    assert.equal(await second.locator("#messageInput").inputValue(), "");
    assert.equal(await first.evaluate(() => window.__sessionRecord()), null);
    await first.reload(); await first.locator("#chatSetupPanel").waitFor({ state: "visible" });
    // A delayed encryption completion cannot recreate the cache after locking.
    await first.click("#unlockAccountSync"); await waitCached(first);
    await first.evaluate(async () => {
      const record = await window.__sessionRecord() || { nonce: "never-written", ciphertext: "never-written" };
      window.__saveStarted = false;
      window.__pendingSave = window.ALevelChatSession.save(async () => {
        window.__saveStarted = true;
        await new Promise((resolve) => { window.__releaseSave = resolve; });
        return { nonce: record.nonce, ciphertext: record.ciphertext };
      }, { userId: "alice", credentialId: "AQID" });
    });
    await first.waitForFunction(() => window.__saveStarted);
    await first.evaluate(async () => { await window.ALevelChatSession.clear(); window.__releaseSave(); });
    assert.equal(await first.evaluate(() => window.__pendingSave), false);
    assert.equal(await first.evaluate(() => window.__sessionRecord()), null);
    await first.reload(); await first.locator("#chatSetupPanel").waitFor({ state: "visible" });
    // Server rejection also clears cached access without a native prompt.
    await first.click("#unlockAccountSync"); await waitCached(first);
    rejectProfile = true;
    await first.reload(); await first.locator("#chatApp").waitFor({ state: "hidden" });
    await first.waitForFunction(async () => (await window.__sessionRecord()) === null);
    rejectProfile = false;
    const blocked = await context.newPage();
    blocked.on("pageerror", (error) => errors.push(error.message));
    await blocked.addInitScript(() => {
      Object.defineProperty(window, "indexedDB", { configurable: true, get() { throw new DOMException("Fixture IndexedDB blocked", "SecurityError"); } });
    });
    await blocked.goto(`${base}/pages/chat.html`);
    await blocked.locator("#chatSetupPanel").waitFor({ state: "visible" });
    await blocked.click("#unlockAccountSync");
    await blocked.locator("#chatApp").waitFor({ state: "visible" });
    assert.equal(await blocked.evaluate(() => window.__assertions), 1, "blocked local cache must allow the original Passkey path");
    assert.deepEqual(await decryptHistory(blocked), ["Current history preserved", "Older history preserved"]);
    await blocked.close();
    const expiringToken = makeToken("alice", Math.floor(Date.now() / 1000) + 4, 3);
    await first.evaluate((next) => localStorage.setItem("alevel.authToken", next), expiringToken);
    await first.reload(); await first.click("#unlockAccountSync"); await first.locator("#chatApp").waitFor({ state: "visible" });
    await first.locator("#chatApp").waitFor({ state: "hidden", timeout: 10000 });
    await first.waitForFunction(async () => (await window.__sessionRecord()) === null);
    console.log("Session browser: cross-tab lock, in-flight save, server-invalid session, blocked IndexedDB fallback and token expiry passed");
    assert.deepEqual(errors, []);
    await context.close();
    console.log("chat encrypted login session browser smoke passed");
  } finally {
    await browser?.close(); await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
