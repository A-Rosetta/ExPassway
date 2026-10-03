const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { webcrypto, randomUUID, createHash } = require("node:crypto");
const { chromium } = require("playwright");

// Real browser, crypto Worker, D1 and chat routes. Only the OS Passkey ceremony
// is replaced so this regression suite can run without a fingerprint reader.
async function main() {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const { Miniflare } = await import("miniflare");
  const { unstable_splitSqlQuery } = await import("wrangler");
  const { handleChatApiRequest } = await import("../cloudflare/chat-api.js");
  const root = path.resolve(__dirname, "..");
  const authSecret = "browser-chat-test-secret-with-at-least-32-bytes";
  const users = ["Alice", "Bob", "Carol", "Unconfigured"].map((name, index) => ({
    id: `${index + 1}1111111-1111-4111-8111-111111111111`,
    name, email: `${name.toLowerCase()}@example.test`, role: "student",
  }));
  const mf = new Miniflare({
    compatibilityDate: "2026-07-30", modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    d1Databases: { DB: "chat-browser-test" },
    r2Buckets: { CHAT_MEDIA_BUCKET: "chat-browser-media" },
  });
  const env = {
    AUTH_SECRET: authSecret, CHAT_ENABLED: "true", CHAT_ACCOUNT_V2_ENABLED: "true",
    CHAT_LEGACY_V1_READ_ENABLED: "true", CHAT_LEGACY_V1_SEND_ENABLED: "false",
    DB: await mf.getD1Database("DB"), CHAT_MEDIA_BUCKET: await mf.getR2Bucket("CHAT_MEDIA_BUCKET"),
  };
  const tokens = new Map();
  for (const user of users) {
    const payload = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: 1, exp: 4102444800 })).toString("base64url");
    const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(authSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    user.token = `${payload}.${Buffer.from(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
    tokens.set(user.token, user);
  }
  const calls = [];
  let uploadGate;
  let uploadStarted;
  let releaseUpload;
  let server;
  let browser;
  const pageErrors = [];
  const consoleErrors = [];
  const pages = [];
  try {
    const migrations = (await fs.readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort();
    for (const name of migrations) {
      await env.DB.batch(unstable_splitSqlQuery(await fs.readFile(path.join(root, "migrations", name), "utf8")).map((sql) => env.DB.prepare(sql)));
    }
    const timestamp = new Date().toISOString();
    for (const user of users) {
      await env.DB.prepare("INSERT INTO users (id,email,display_name,role,supabase_user_id) VALUES (?,?,?,'student',?)").bind(user.id, user.email, user.name, `test-${user.name}`).run();
      await env.DB.prepare("INSERT INTO chat_profiles (user_id,chat_alias,created_at,updated_at) VALUES (?,?,?,?)").bind(user.id, user.name, timestamp, timestamp).run();
    }
    for (const user of users) for (const peer of users.filter((other) => other !== user)) {
      await env.DB.prepare("INSERT INTO chat_contacts (id,user_id,peer_user_id,created_at,accepted_at) VALUES (?,?,?,?,?)").bind(`contact-${user.name}-${peer.name}`, user.id, peer.id, timestamp, timestamp).run();
    }
    server = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const buffers = [];
        for await (const buffer of req) buffers.push(buffer);
        const body = Buffer.concat(buffers);
        if (url.pathname.startsWith("/api/chat/")) {
          const user = tokens.get(String(req.headers.authorization || "").replace(/^Bearer /, ""));
          if (/\/passkeys\/(register|authenticate)\/(options|verify)$/.test(url.pathname)) {
            if (!user) throw new Error("Passkey fixture requires authenticated user");
            let data;
            const credentialId = Buffer.from(user.id).toString("base64url");
            if (url.pathname.endsWith("/options")) {
              data = { publicKey: { challenge: Buffer.alloc(32, 7).toString("base64url"), rpId: url.hostname, extensions: { prf: { eval: { first: Buffer.alloc(32, 8).toString("base64url") } } } } };
            } else if (url.pathname.includes("/register/")) {
              await env.DB.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)").bind(randomUUID(), user.id, credentialId, "test-public-key", Buffer.alloc(32, 8).toString("base64url"), timestamp).run();
              data = { verified: true, credentialId };
            } else {
              const proof = randomUUID();
              const identity = await env.DB.prepare("SELECT key_version FROM chat_account_identity_heads WHERE user_id=?").bind(user.id).first();
              await env.DB.prepare("INSERT INTO chat_account_write_proofs (id,token_hash,user_id,uses_remaining,expires_at,created_at,credential_id,purpose,key_version) VALUES (?,?,?,5,?,?,?,'account-write',?)")
                .bind(randomUUID(), createHash("sha256").update(proof).digest("base64url"), user.id, new Date(Date.now() + 300000).toISOString(), timestamp, credentialId, identity?.key_version || null).run();
              data = { verified: true, proof };
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, data }));
            return;
          }
          const json = body.length && req.headers["content-type"]?.includes("application/json") ? JSON.parse(body.toString()) : null;
          const call = { user: user?.name, method: req.method, path: url.pathname, body: json };
          calls.push(call);
          if (req.method === "PUT" && /^\/api\/chat\/attachments\/[^/]+$/.test(url.pathname) && uploadGate) {
            uploadStarted?.();
            await uploadGate;
          }
          const response = await handleChatApiRequest(new Request(url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), env);
          const responseBody = Buffer.from(await response.arrayBuffer());
          call.status = response.status;
          if (response.status >= 400) console.error(`${req.method} ${url.pathname}: ${response.status} ${responseBody}`);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(responseBody);
          return;
        }
        const filename = path.resolve(root, `.${url.pathname}`);
        if (!filename.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end(); return; }
        const contents = await fs.readFile(filename);
        const mime = filename.endsWith(".html") ? "text/html" : filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(contents);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { code: "TEST_SERVER_ERROR", message: error.message } }));
      }
    });
    // This fixture deliberately has no Durable Object. Exercise cursor polling
    // after an unavailable realtime transport; the API suite checks real tickets.
    server.on("upgrade", (_req, socket) => socket.destroy());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
      if (!existsSync(edge)) throw error;
      browser = await chromium.launch({ headless: true, executablePath: edge });
    }
    async function openUser(user, { cancelUnlock = false, existing = false } = {}) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      pages.push({ user: user.name, page });
      page.on("pageerror", (error) => pageErrors.push(`${user.name}: ${error.message}`));
      page.on("console", (message) => {
        const expectedConflict = message.text().includes("status of 409") && /\/api\/chat\/(messages|conversations\/[^/]+\/members)$/.test(message.location().url);
        if (message.type() === "error" && !message.text().startsWith("WebSocket connection to") && !expectedConflict) consoleErrors.push(`${user.name}: ${message.text()}`);
      });
      await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, body: "" }));
      await context.addInitScript(({ token, userId, cancel }) => {
        localStorage.setItem("alevel.authToken", token);
        window.__cancelUnlock = cancel;
        const makeCredential = () => {
          const rawId = new TextEncoder().encode(userId).buffer;
          return {
            id: btoa(userId).replace(/=+$/, ""), type: "public-key", rawId,
            response: { clientDataJSON: new TextEncoder().encode("{}").buffer, attestationObject: new ArrayBuffer(0), authenticatorData: new ArrayBuffer(0), signature: new ArrayBuffer(0), getTransports: () => ["internal"] },
            getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(9).buffer } } }),
          };
        };
        Object.defineProperty(navigator, "credentials", { configurable: true, value: {
          create: async () => makeCredential(),
          get: async () => {
            if (window.__cancelUnlock) { window.__cancelUnlock = false; throw new DOMException("Canceled by test", "NotAllowedError"); }
            return makeCredential();
          },
        } });
      }, { token: user.token, userId: user.id, cancel: cancelUnlock });
      await page.goto(`${baseUrl}/pages/chat.html`);
      assert.match(await page.title(), /ExPassway/);
      const button = page.locator(existing ? "#unlockAccountSync" : "#enableAccountSync");
      await button.click();
      if (cancelUnlock) {
        await page.waitForFunction(() => document.querySelector("#chatStatus").textContent.includes("PASSKEY_ASSERTION_FAILED"));
        assert.equal(await button.isEnabled(), true);
        await button.click();
      }
      await page.locator("#chatApp").waitFor({ state: "visible" });
      await page.waitForFunction(() => document.querySelectorAll("#conversationList button").length > 0);
      assert.equal(await page.locator("#legacyDevicePanel").isVisible(), false);
      return page;
    }
    const alice = await openUser(users[0]);
    const bob = await openUser(users[1]);
    const carol = await openUser(users[2]);
    await alice.click("#refreshChat");
    await alice.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    await alice.fill("#messageInput", "Alice's encrypted hello");
    await alice.click("#sendMessage");
    await alice.locator("#messageList").getByText("Alice's encrypted hello", { exact: true }).waitFor();
    await bob.click("#refreshChat");
    await bob.locator("#conversationList button").filter({ has: bob.locator("strong", { hasText: "Alice" }) }).click();
    await bob.locator("#messageList").getByText("Alice's encrypted hello", { exact: true }).waitFor();
    assert.equal(await bob.locator("#messageList article.is-mine").count(), 0);
    await bob.fill("#messageInput", "Bob's encrypted reply");
    await bob.click("#sendMessage");
    await alice.locator("#messageList").getByText("Bob's encrypted reply", { exact: true }).waitFor();
    // A fresh browser unlocks the same opaque vault and reads both authors.
    const secondAlice = await openUser(users[0], { existing: true, cancelUnlock: true });
    await secondAlice.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    await secondAlice.locator("#messageList").getByText("Alice's encrypted hello", { exact: true }).waitFor();
    await secondAlice.locator("#messageList").getByText("Bob's encrypted reply", { exact: true }).waitFor();
    console.log("Browser: direct messages and second-browser vault unlock passed");
    // Retention must submit a signed control, and the peer applies its event.
    await alice.selectOption("#retentionSelect", "604800");
    await bob.waitForFunction(() => document.querySelector("#retentionSelect").value === "604800");
    assert.ok(calls.some((call) => call.user === "Alice" && call.body?.action === "retention" && call.body.signature));
    // Group members may only be selected once account readiness is known.
    await alice.click("#createGroup");
    await alice.waitForFunction(() => !document.querySelector('input[value="contact-Alice-Bob"]').disabled);
    await alice.check('input[value="contact-Alice-Bob"]');
    await alice.waitForFunction(() => !document.querySelector('input[value="contact-Alice-Carol"]').disabled);
    assert.equal(await alice.isChecked('input[value="contact-Alice-Bob"]'), true);
    assert.equal(await alice.isDisabled('input[value="contact-Alice-Unconfigured"]'), true);
    await alice.click("#confirmCreateGroup");
    await alice.waitForFunction(() => document.querySelector("#groupManageButton").hidden === false);
    await alice.fill("#messageInput", "Before Carol joined");
    await alice.click("#sendMessage");
    await alice.locator("#messageList").getByText("Before Carol joined", { exact: true }).waitFor();
    await bob.click("#refreshChat");
    await bob.locator("#conversationList button").filter({ hasText: /Group|Encrypted group|群聊/ }).click();
    await bob.locator("#messageList").getByText("Before Carol joined", { exact: true }).waitFor();
    assert.equal(await bob.locator("#messageList .chat-message__sender").first().textContent(), "Alice");
    assert.match(await bob.locator("#conversationList button.is-active small").textContent(), /2/);
    await alice.click("#groupManageButton");
    await alice.selectOption("#groupInviteContact", "contact-Alice-Carol");
    await alice.click("#inviteGroupMember");
    await alice.waitForFunction(() => document.querySelector("#groupMemberList").textContent.includes("Carol"));
    await alice.fill("#messageInput", "After Carol joined");
    await alice.click("#sendMessage");
    await bob.locator("#messageList").getByText("After Carol joined", { exact: true }).waitFor();
    await carol.click("#refreshChat");
    await carol.locator("#conversationList button").filter({ hasText: /Group|Encrypted group|群聊/ }).click();
    await carol.locator("#messageList").getByText("After Carol joined", { exact: true }).waitFor();
    assert.equal(await carol.locator("#messageList").getByText("Before Carol joined", { exact: true }).count(), 0);
    console.log("Browser: signed retention and group epoch changes passed");
    // Hold the upload while switching the sender to a different conversation.
    uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
    const uploading = new Promise((resolve) => { uploadStarted = resolve; });
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=", "base64");
    await alice.fill("#messageInput", "Unsent group draft");
    await alice.setInputFiles("#imageInput", { name: "pixel.png", mimeType: "image/png", buffer: png });
    let uploadTimeout;
    try {
      await Promise.race([uploading, new Promise((_resolve, reject) => {
        uploadTimeout = setTimeout(() => reject(new Error("The image upload did not begin within 15 seconds")), 15000);
      })]);
    } finally { clearTimeout(uploadTimeout); }
    const attachmentConversation = calls.findLast((call) => call.path === "/api/chat/attachments/init").body.conversationId;
    await alice.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    assert.equal(await alice.inputValue("#messageInput"), "", "a group draft must not leak into the direct chat");
    releaseUpload();
    await bob.waitForFunction(() => document.querySelector("#messageList").textContent.includes("pixel.png"));
    const fileMessage = calls.findLast((call) => call.path === "/api/chat/messages" && call.body?.attachmentRefs?.length);
    assert.equal(fileMessage.body.conversationId, attachmentConversation, "attachment keys must stay bound to the original conversation");
    uploadGate = null;
    const downloadPromise = bob.waitForEvent("download");
    await bob.locator("#messageList article").filter({ hasText: "pixel.png" }).locator("button").click();
    const downloaded = await downloadPromise;
    assert.deepEqual(await fs.readFile(await downloaded.path()), png, "the recipient must decrypt the original image bytes");
    await secondAlice.click("#refreshChat");
    await secondAlice.locator("#conversationList button").filter({ hasText: /Group|Encrypted group|群聊/ }).click();
    await secondAlice.locator("#messageList").getByText("pixel.png", { exact: true }).waitFor();
    const historyDownloadPromise = secondAlice.waitForEvent("download");
    await secondAlice.locator("#messageList article").filter({ hasText: "pixel.png" }).locator("button").click();
    assert.deepEqual(await fs.readFile(await (await historyDownloadPromise).path()), png, "the second browser must decrypt attachment history");
    console.log("Browser: attachment download, history and conversation binding passed");
    // The API stores opaque ciphertext. Neither message nor vault contains plaintext.
    const stored = await env.DB.prepare("SELECT ciphertext FROM chat_messages WHERE protocol_version='account-v2'").all();
    assert.ok(stored.results.length >= 5);
    assert.equal(stored.results.some((row) => /encrypted hello|encrypted reply|Carol joined|pixel\.png/.test(row.ciphertext)), false);
    assert.equal(calls.some((call) => call.path.includes("/devices") || call.path.includes("/key-backup")), false);
    const reply = await env.DB.prepare("SELECT id FROM chat_messages WHERE sender_user_id=? AND conversation_id=?")
      .bind(users[1].id, calls.find((call) => call.user === "Alice" && call.path === "/api/chat/messages").body.conversationId).first();
    await secondAlice.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    await secondAlice.locator("#messageList").getByText("Bob's encrypted reply", { exact: true }).waitFor();
    await bob.evaluate((id) => window.ALevelApi.deleteChatMessage(id), reply.id);
    await alice.waitForFunction(() => document.querySelector("#messageList").textContent.includes("[deleted]"));
    await secondAlice.waitForFunction(() => document.querySelector("#messageList").textContent.includes("[deleted]"));
    // Reset an identity using a real encrypted vault and the real initialize route.
    await bob.evaluate(async ({ userId }) => {
      const worker = new Worker("../assets/vendor/chat-crypto-worker.js?v=20261003-1");
      try {
        const vault = await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) => data.ok ? resolve(data.result) : reject(new Error(data.error));
          worker.onerror = (event) => reject(new Error(event.message));
          worker.postMessage({ id: 1, action: "generateAccountV2Vault", payload: {
            userId, keyVersion: "reset-key-2", prfOutput: btoa(String.fromCharCode(...new Uint8Array(32).fill(9))).replace(/=+$/, ""),
          } });
        });
        const verified = await window.ALevelApi.verifyChatPasskey("authenticate", {});
        await window.ALevelApi.initializeChatAccount({ ...vault, proof: verified.proof, reset: true });
      } finally { worker.terminate(); }
    }, { userId: users[1].id });
    await alice.fill("#messageInput", "Must block the changed identity");
    await alice.click("#sendMessage");
    await alice.locator("#startNewSecureChat").waitFor();
    assert.equal(await alice.isDisabled("#messageInput"), true);
    alice.once("dialog", (dialog) => dialog.dismiss());
    await alice.click("#startNewSecureChat");
    assert.equal(await alice.isDisabled("#messageInput"), true, "dismissing identity confirmation must keep the old chat blocked");
    alice.once("dialog", (dialog) => dialog.accept());
    await alice.click("#startNewSecureChat");
    await alice.waitForFunction(() => document.querySelector("#chatStatus").textContent.includes("New secure conversation created"));
    const resetBob = await openUser(users[1], { existing: true });
    await resetBob.locator("#conversationList button").filter({ has: resetBob.locator("strong", { hasText: "Alice" }) }).first().click();
    await alice.fill("#messageInput", "Confirmed new private identity");
    await alice.click("#sendMessage");
    await resetBob.locator("#messageList").getByText("Confirmed new private identity", { exact: true }).waitFor();
    // An unrelated group change cannot accept the reset member. Removal and
    // explicit re-invitation must recover the group and unblock its composer.
    await alice.locator("#conversationList button").filter({ hasText: /Group|Encrypted group|群聊/ }).click();
    await alice.click("#groupManageButton");
    alice.once("dialog", (dialog) => dialog.accept());
    await alice.locator("#groupMemberList > .chat-device-item").filter({ hasText: "Carol" }).getByRole("button", { name: "Remove", exact: true }).click();
    await alice.waitForFunction(() => document.querySelector("#chatStatus").textContent.includes("ACCOUNT_KEY_CHANGED"));
    assert.equal(await alice.isDisabled("#messageInput"), true);
    alice.once("dialog", (dialog) => dialog.accept());
    await alice.locator("#groupMemberList > .chat-device-item").filter({ hasText: "Bob" }).getByRole("button", { name: "Remove", exact: true }).click();
    await alice.waitForFunction(() => !document.querySelector("#groupMemberList").textContent.includes("Bob"));
    assert.equal(await alice.isDisabled("#messageInput"), false);
    await alice.waitForFunction(() => !!document.querySelector('#groupInviteContact option[value="contact-Alice-Bob"]'));
    await alice.selectOption("#groupInviteContact", "contact-Alice-Bob");
    await alice.click("#inviteGroupMember");
    await alice.waitForFunction(() => document.querySelector("#groupMemberList").textContent.includes("Bob"));
    await alice.fill("#messageInput", "Group restored after explicit identity replacement");
    await alice.click("#sendMessage");
    await resetBob.click("#refreshChat");
    await resetBob.locator("#conversationList button").filter({ hasText: /Group|Encrypted group|群聊/ }).click();
    await resetBob.locator("#messageList").getByText("Group restored after explicit identity replacement", { exact: true }).waitFor();
    assert.equal(await resetBob.locator("#messageList").getByText("Before Carol joined", { exact: true }).count(), 0);
    console.log("Browser: identity reset confirmation and group recovery passed");
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    if (process.env.CHAT_QA_SCREENSHOT) {
      const screenshot = path.resolve(process.env.CHAT_QA_SCREENSHOT);
      await fs.mkdir(path.dirname(screenshot), { recursive: true });
      await carol.locator("#messageList").getByText("Group restored after explicit identity replacement", { exact: true }).waitFor();
      await carol.screenshot({ path: screenshot });
      console.log(`Browser screenshot: ${screenshot}`);
      await carol.setViewportSize({ width: 390, height: 844 });
      await carol.screenshot({ path: path.join(path.dirname(screenshot), "chat-mobile.png") });
    }
    console.log("account-v2 browser smoke passed (real Worker + API; mocked Passkey ceremony)");
  } catch (error) {
    for (const { user, page } of pages) {
      if (!page.isClosed()) console.error(`${user} browser state:`, await page.locator("#chatStatus").textContent(), await page.locator("#conversationTitle").textContent(), await page.locator("#messageList").textContent(), "group panel:", await page.locator("#groupManagePanel").isVisible(), await page.locator("#groupMemberList").textContent());
    }
    console.error("API writes:", calls.filter((call) => call.method !== "GET").slice(-20).map(({ user, method, path, body, status }) => ({ user, method, path, status, action: body?.action, conversationId: body?.conversationId })));
    throw error;
  } finally {
    releaseUpload?.();
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await mf.dispose();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
