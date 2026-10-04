const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

// The real page handlers run in a browser. Crypto is deliberately controlled
// here to cover legacy data and a concurrent first-setup race; real wrapping
// and restored history are checked by the crypto and full API browser suites.
async function main() {
  const markup = await fs.readFile("pages/chat.html", "utf8");
  const source = await fs.readFile("scripts/chat.js", "utf8");
  const i18n = await fs.readFile("scripts/i18n.js", "utf8");
  const css = (await Promise.all(["assets/styles.css", "assets/site-design.css", "assets/chat.css"].map((file) => fs.readFile(file, "utf8")))).join("\n");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><html><body></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
      if (!existsSync(edge)) throw error;
      browser = await chromium.launch({ headless: true, executablePath: edge });
    }
    for (const scenario of ["setup-race", "legacy-history", "legacy-candidate-enroll"]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/${scenario === "legacy-candidate-enroll" ? "?passkey=AQID" : ""}`);
      await page.evaluate(({ markup, scenario }) => {
        const parsed = new DOMParser().parseFromString(markup, "text/html");
        parsed.querySelectorAll("script").forEach((script) => script.remove());
        document.body.innerHTML = parsed.body.innerHTML;
        document.body.className = parsed.body.className;
        localStorage.setItem("alevel.authToken", "test-token");
        const publicBundle = { userId: "user-1", keyVersion: "1", encryptionPublicKey: "AQ", signingPublicKey: "Ag", fingerprint: "existing-fingerprint" };
        const wrapper = { keyVersion: "1", credentialId: "AQID", nonce: "Aw", ciphertext: "BA" };
        if (scenario === "legacy-candidate-enroll") wrapper.legacyCandidate = true;
        const vault = { ...wrapper, wrappers: [wrapper], accountKey: publicBundle };
        const historical = { keyVersion: "old", credentialId: "AQID", nonce: "old-nonce", ciphertext: "old-ciphertext",
          legacyCandidate: true, wrappers: [{ keyVersion: "old", credentialId: "AQID", nonce: "old-nonce", ciphertext: "old-ciphertext", legacyCandidate: true }] };
        let raced = false;
        window.__calls = { generate: 0, initialize: 0, unlock: 0, locked: 0, wrap: 0, savedWrapper: 0 };
        window.PublicKeyCredential = function PublicKeyCredential() {};
        Object.defineProperty(navigator, "credentials", { configurable: true, value: {
          create: async () => { throw new Error("No replacement Passkey should be created."); },
          get: async ({ publicKey }) => {
            if (!(publicKey.extensions.prf.evalByCredential.AQID.first instanceof Uint8Array)) throw new Error("PRF salt not decoded");
            return { id: "AQID", type: "public-key", rawId: new Uint8Array([1, 2, 3]).buffer,
              response: { clientDataJSON: new TextEncoder().encode("{}").buffer, authenticatorData: new ArrayBuffer(0), signature: new ArrayBuffer(0) },
              getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(9).buffer } } }),
            };
          },
        } });
        window.Worker = class {
          postMessage(message) {
            let result = { ...publicBundle, unlocked: true, retainedKeyVersions: [], nonce: "Aw", ciphertext: "BA", signature: "BQ" };
            if (message.action === "generateAccountV2Vault") window.__calls.generate += 1;
            if (message.action === "unlockAccountV2Vault") {
              window.__calls.unlock += 1;
              if (message.payload.keyVersion === "old") {
                queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: false, code: "ACCOUNT_VAULT_UNLOCK_FAILED", error: "Wrong legacy PRF candidate" } }));
                return;
              }
            }
            if (message.action === "lockAccountV2Vault") window.__calls.locked += 1;
            if (message.action === "wrapAccountV2Vault") window.__calls.wrap += 1;
            queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true, result } }));
          }
        };
        window.ALevelApi = {
          getChatProfile: async () => ({ id: "user-1", alias: "History User", chatUserId: "history-user" }),
          getChatAccountKeyBundle: async () => scenario === "setup-race" && !raced
            ? { enabled: false, passkeyReady: true } : { enabled: true, passkeyReady: true, accountKey: publicBundle },
          getChatAccountVault: async () => scenario === "setup-race" && !raced ? null : vault,
          getChatAccountVaults: async () => scenario === "legacy-history" ? [vault, historical] : [vault],
          getChatPasskeyAuthenticationOptions: async (input) => ({ publicKey: { challenge: "AQID", allowCredentials: [{ id: "AQID", type: "public-key" }],
            extensions: { prf: { evalByCredential: { AQID: { first: "Bgc" } } } } }, input }),
          verifyChatPasskey: async () => { raced = true; return { proof: "test-proof", credentialId: "AQID", keyVersion: "1" }; },
          initializeChatAccount: async () => { window.__calls.initialize += 1; throw new Error("Existing identity must never be replaced"); },
          saveChatAccountVaultWrapper: async () => { window.__calls.savedWrapper += 1; return { saved: true }; },
          listChatInvites: async () => [], listChatContacts: async () => [], listChatConversations: async () => [],
          getGlobalChatDiscussion: async () => null,
        };
      }, { markup, scenario });
      await page.addStyleTag({ content: css });
      await page.addScriptTag({ content: i18n });
      await page.addScriptTag({ content: source });
      await page.locator("#chatSetupPanel").waitFor({ state: "visible" });
      await page.click(scenario === "setup-race" ? "#enableAccountSync" : "#unlockAccountSync");
      await page.locator("#chatApp").waitFor({ state: "visible" });
      if (scenario === "legacy-history") {
        await page.locator("#chatPasskeyHistoryStatus").waitFor({ state: "visible" });
        assert.match(await page.locator("#chatPasskeyHistoryStatus").textContent(), /older chat history/);
        await page.click("#restoreAccountHistory");
        await page.click("#continuePasskeyEnrollment");
        await page.waitForFunction(() => document.querySelector("#chatStatus").textContent.includes("Wrong legacy PRF candidate"));
        assert.equal(await page.locator("#chatApp").isVisible(), true, "a failed legacy-history candidate must keep current chat open");
        assert.equal((await page.evaluate(() => window.__calls)).savedWrapper, 0);
      } else if (scenario === "legacy-candidate-enroll") {
        await page.click("#continuePasskeyEnrollment");
        await page.locator("#chatPasskeySyncPanel").waitFor({ state: "hidden" });
        const calls = await page.evaluate(() => window.__calls);
        assert.equal(calls.wrap, 1, "an unproven legacy candidate must be rewrapped rather than skipped");
        assert.equal(calls.savedWrapper, 1);
      }
      const calls = await page.evaluate(() => window.__calls);
      assert.equal(calls.generate, 0, `${scenario}: never generate replacement identity keys`);
      assert.equal(calls.initialize, 0, `${scenario}: never initialize/reset an existing identity`);
      assert.equal(calls.locked, 0, `${scenario}: never erase a successfully unlocked current identity`);
      for (const width of [390, 1440]) for (const language of ["en", "zh-CN"]) for (const theme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 });
        await page.evaluate(({ language, theme }) => {
          window.ALevelI18n.setLanguage(language);
          window.ALevelI18n.applyPage();
          if (theme === "dark") document.documentElement.dataset.theme = "dark";
          else document.documentElement.removeAttribute("data-theme");
        }, { language, theme });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
          `${scenario} must fit ${width}px in ${language}/${theme}`);
      }
      if (process.env.CHAT_PASSKEY_QA_DIR) {
        await fs.mkdir(process.env.CHAT_PASSKEY_QA_DIR, { recursive: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(process.env.CHAT_PASSKEY_QA_DIR, `${scenario}-mobile-zh-dark.png`), fullPage: true });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("chat Passkey setup-race, legacy-history preservation and explicit-wrapper enrollment browser smoke passed");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
