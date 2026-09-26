const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const { chromium } = require("playwright");

async function main() {
  const chatScript = await fs.readFile("scripts/chat.js", "utf8");
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<!doctype html><html><body></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  let browser;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      const edgePath = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
      if (!existsSync(edgePath)) throw error;
      browser = await chromium.launch({ headless: true, executablePath: edgePath });
    }
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.evaluate(() => {
      document.body.innerHTML = `
        <p id="chatStatus"></p>
        <section id="chatSetupPanel">
          <button id="enableAccountSync" type="button">Enable secure chat</button>
          <button id="unlockAccountSync" type="button"></button>
        </section>
        <section id="chatUnsupportedPanel" hidden></section>
        <section id="legacyDevicePanel"></section>
        <section id="chatApp" hidden></section>`;
      localStorage.setItem("alevel.authToken", "test-token");
      window.__calls = { registrationOptions: 0, create: 0, authenticationOptions: 0, authenticate: 0, initialize: 0 };
      window.PublicKeyCredential = function PublicKeyCredential() {};
      Object.defineProperty(navigator, "credentials", {
        configurable: true,
        value: {
          create: async () => {
            window.__calls.create += 1;
            throw new DOMException("A registration prompt should not be shown.", "InvalidStateError");
          },
          get: async () => {
            const rawId = new Uint8Array([1, 2, 3]).buffer;
            const challenge = new Uint8Array(32).fill(7).buffer;
            const clientDataJSON = new TextEncoder().encode(JSON.stringify({
              type: "webauthn.get",
              challenge: btoa(String.fromCharCode(...new Uint8Array(challenge))).replace(/=+$/g, ""),
              origin: location.origin,
            })).buffer;
            const prf = new Uint8Array(32).fill(9).buffer;
            return {
              id: "AQID",
              type: "public-key",
              rawId,
              response: { clientDataJSON, authenticatorData: new ArrayBuffer(0), signature: new ArrayBuffer(0) },
              getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: prf } } }),
            };
          },
        },
      });
      window.Worker = class {
        postMessage(message) {
          const result = {
            userId: "user-1",
            keyVersion: "1",
            encryptionPublicKey: "AQ",
            signingPublicKey: "Ag",
            fingerprint: "test-fingerprint",
            kdfVersion: "hkdf-sha256-v1",
            nonce: "Aw",
            ciphertext: "BA",
          };
          queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true, result } }));
        }
      };
      window.ALevelApi = {
        getChatProfile: async () => ({ id: "user-1" }),
        getChatAccountKeyBundle: async () => ({ enabled: false, passkeyReady: true }),
        getChatAccountVault: async () => null,
        getChatPasskeyRegistrationOptions: async () => {
          window.__calls.registrationOptions += 1;
          throw new Error("Registration options should not be requested.");
        },
        getChatPasskeyAuthenticationOptions: async () => {
          window.__calls.authenticationOptions += 1;
          return { publicKey: { challenge: "BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc" } };
        },
        verifyChatPasskey: async (kind) => {
          if (kind === "authenticate") window.__calls.authenticate += 1;
          return { proof: "write-proof" };
        },
        initializeChatAccount: async () => {
          window.__calls.initialize += 1;
          throw new Error("TEST_STOP_AFTER_INITIALIZE");
        },
      };
    });
    await page.addScriptTag({ content: chatScript });
    await page.click("#enableAccountSync");
    await page.waitForFunction(() => window.__calls.initialize === 1);
    const calls = await page.evaluate(() => window.__calls);
    assert.deepEqual(calls, {
      registrationOptions: 0,
      create: 0,
      authenticationOptions: 1,
      authenticate: 1,
      initialize: 1,
    });
    console.log("chat Passkey retry smoke passed");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
