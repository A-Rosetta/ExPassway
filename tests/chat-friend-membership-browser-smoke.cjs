const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { existsSync } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { webcrypto, randomUUID, createHash } = require("node:crypto");
const { chromium } = require("playwright");

// Exercise the rendered chat with its real API, D1 database and crypto Worker.
// Only the OS Passkey ceremony is replaced, as in the account browser suite.
async function main() {
  if (!globalThis.crypto) globalThis.crypto = webcrypto;
  const { Miniflare } = await import("miniflare");
  const { unstable_splitSqlQuery } = await import("wrangler");
  const { handleChatApiRequest } = await import("../cloudflare/chat-api.js");
  const root = path.resolve(__dirname, "..");
  const authSecret = "friend-membership-browser-test-secret-at-least-32-bytes";
  const users = ["Alice", "Bob", "Admin"].map((name, index) => ({
    id: `${index + 1}2222222-2222-4222-8222-222222222222`,
    name, email: `${name.toLowerCase()}@example.test`,
    role: name === "Admin" ? "admin" : "student", chatUserId: `${name.toLowerCase()}_secure`,
  }));
  const mf = new Miniflare({
    compatibilityDate: "2026-07-30", modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    d1Databases: { DB: "friend-membership-browser-test" },
  });
  const env = {
    AUTH_SECRET: authSecret, CHAT_ENABLED: "true", CHAT_ACCOUNT_V2_ENABLED: "true",
    CHAT_LEGACY_V1_READ_ENABLED: "true", CHAT_LEGACY_V1_SEND_ENABLED: "false",
    DB: await mf.getD1Database("DB"),
  };
  const tokens = new Map();
  for (const user of users) {
    const payload = Buffer.from(JSON.stringify({ sub: user.id, email: user.email, role: user.role, iat: 1, exp: 4102444800 })).toString("base64url");
    const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(authSecret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    user.token = `${payload}.${Buffer.from(await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
    tokens.set(user.token, user);
  }
  const calls = [];
  const activeRequests = new Set();
  const pages = [];
  const pageErrors = [];
  const consoleErrors = [];
  let realtimeGate;
  let releaseRealtime;
  let server;
  let browser;
  try {
    for (const name of (await fs.readdir(path.join(root, "migrations"))).filter((name) => name.endsWith(".sql")).sort()) {
      await env.DB.batch(unstable_splitSqlQuery(await fs.readFile(path.join(root, "migrations", name), "utf8")).map((sql) => env.DB.prepare(sql)));
    }
    const timestamp = new Date().toISOString();
    for (const user of users) {
      await env.DB.prepare("INSERT INTO users (id,email,display_name,role,supabase_user_id) VALUES (?,?,?,?,?)")
        .bind(user.id, user.email, user.name, user.role, `test-${user.name}`).run();
      await env.DB.prepare("INSERT INTO chat_profiles (user_id,chat_alias,chat_user_id,created_at,updated_at) VALUES (?,?,?,?,?)")
        .bind(user.id, user.name, user.chatUserId, timestamp, timestamp).run();
    }
    server = http.createServer(async (req, res) => {
      let finishRequest;
      const pendingRequest = new Promise((resolve) => { finishRequest = resolve; });
      activeRequests.add(pendingRequest);
      try {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const buffers = [];
        for await (const buffer of req) buffers.push(buffer);
        const body = Buffer.concat(buffers);
        if (url.pathname.startsWith("/api/chat/") || /^\/api\/auth\/me\/passkeys\/(options|verify)$/.test(url.pathname)) {
          const user = tokens.get(String(req.headers.authorization || "").replace(/^Bearer /, ""));
          const registrationOptions = url.pathname === "/api/auth/me/passkeys/options";
          const registrationVerify = url.pathname === "/api/auth/me/passkeys/verify";
          if (registrationOptions || registrationVerify || /\/passkeys\/(register|authenticate)\/(options|verify)$/.test(url.pathname)) {
            if (!user) throw new Error("Passkey fixture requires authenticated user");
            const json = body.length ? JSON.parse(body.toString()) : {};
            const credentialId = json.credential?.id || Buffer.from(user.id).toString("base64url");
            let data;
            if (url.pathname.endsWith("/options") || registrationOptions) {
              const optionsUrl = registrationOptions ? new URL("/api/chat/account/passkeys/register/options", url) : url;
              const response = await handleChatApiRequest(new Request(optionsUrl, { method: req.method, headers: req.headers,
                ...(body.length ? { body } : {}) }), env);
              const payload = await response.json();
              if (!response.ok) throw new Error(`Passkey options fixture: ${JSON.stringify(payload)}`);
              data = payload.data;
            } else if (url.pathname.includes("/register/") || registrationVerify) {
              const challenge = await env.DB.prepare("SELECT prf_salt FROM chat_webauthn_challenges WHERE user_id=? AND challenge=?")
                .bind(user.id, json.challenge).first();
              await env.DB.prepare("INSERT INTO chat_passkeys (id,user_id,credential_id,public_key,prf_salt,created_at) VALUES (?,?,?,?,?,?)")
                .bind(randomUUID(), user.id, credentialId, "test-public-key", challenge?.prf_salt || Buffer.alloc(32, 8).toString("base64url"), timestamp).run();
              data = { verified: true, credentialId };
            } else {
              const proof = randomUUID();
              const identity = await env.DB.prepare("SELECT key_version FROM chat_account_identity_heads WHERE user_id=?").bind(user.id).first();
              const challenge = await env.DB.prepare("SELECT reserved_key_version,purpose FROM chat_webauthn_challenges WHERE user_id=? AND challenge=?")
                .bind(user.id, json.challenge).first();
              await env.DB.prepare("INSERT INTO chat_account_write_proofs (id,token_hash,user_id,uses_remaining,expires_at,created_at,credential_id,purpose,key_version) VALUES (?,?,?,5,?,?,?,?,?)")
                .bind(randomUUID(), createHash("sha256").update(proof).digest("base64url"), user.id, new Date(Date.now() + 300000).toISOString(), timestamp,
                  credentialId, challenge?.purpose || "account-write", challenge?.reserved_key_version || identity?.key_version || null).run();
              data = { verified: true, proof, credentialId, keyVersion: challenge?.reserved_key_version || identity?.key_version || null };
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, data }));
            return;
          }
          const json = body.length && req.headers["content-type"]?.includes("application/json") ? JSON.parse(body.toString()) : null;
          const call = { user: user?.name, method: req.method, path: url.pathname, body: json };
          calls.push(call);
          if (user?.name === "Alice" && url.pathname === "/api/chat/ws-ticket" && realtimeGate) await realtimeGate;
          const response = await handleChatApiRequest(new Request(url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), env);
          call.status = response.status;
          const responseBody = Buffer.from(await response.arrayBuffer());
          if (response.status >= 400) console.error(`${req.method} ${url.pathname}: ${response.status} ${responseBody}`);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(responseBody);
          return;
        }
        const filename = path.resolve(root, `.${url.pathname}`);
        if (!filename.startsWith(`${root}${path.sep}`)) { res.writeHead(403); res.end(); return; }
        const contents = await fs.readFile(filename);
        const mime = filename.endsWith(".html") ? "text/html" : filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : filename.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(contents);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: { code: "TEST_SERVER_ERROR", message: error.message } }));
      } finally {
        activeRequests.delete(pendingRequest);
        finishRequest();
      }
    });
    // No Durable Object in this fixture: the rendered app uses real cursor polling.
    server.on("upgrade", (_req, socket) => socket.destroy());
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
      if (!existsSync(edge)) throw error;
      browser = await chromium.launch({ headless: true, executablePath: edge });
    }
    async function openUser(user) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      page.setDefaultTimeout(60000);
      pages.push({ user: user.name, page });
      page.on("pageerror", (error) => pageErrors.push(`${user.name}: ${error.message}`));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("WebSocket connection to")) consoleErrors.push(`${user.name}: ${message.text()}`);
      });
      await context.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, body: "" }));
      await context.addInitScript(({ token, userId }) => {
        localStorage.setItem("alevel.authToken", token);
        localStorage.setItem("app-theme", "light");
        localStorage.setItem("alevel.language", "en");
        const id = btoa(userId).replace(/=+$/, "");
        const makeCredential = () => ({
          id, type: "public-key",
          rawId: Uint8Array.from(atob(id), (character) => character.charCodeAt(0)).buffer,
          response: { clientDataJSON: new TextEncoder().encode("{}").buffer, attestationObject: new ArrayBuffer(0), authenticatorData: new ArrayBuffer(0), signature: new ArrayBuffer(0), getTransports: () => ["internal"] },
          getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: new Uint8Array(32).fill(9).buffer } } }),
        });
        Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: async () => makeCredential(), get: async () => makeCredential() } });
      }, { token: user.token, userId: user.id });
      await page.goto(`${baseUrl}/pages/chat.html`);
      assert.equal(new URL(page.url()).pathname, "/pages/chat.html");
      assert.match(await page.title(), /ExPassway/);
      await page.click("#enableAccountSync");
      await page.locator("#chatApp").waitFor({ state: "visible" });
      await page.locator("#chatFriendRequestsPanel").waitFor({ state: "visible" });
      assert.equal(await page.locator("#legacyDevicePanel").isVisible(), false);
      assert.ok((await page.locator("main").textContent()).includes("Global Discussion"));
      assert.equal(await page.locator("vite-error-overlay, nextjs-portal").count(), 0);
      return page;
    }
    async function refresh(page) {
      const response = page.waitForResponse((response) => response.url().endsWith("/api/chat/contact-requests") && response.request().method() === "GET");
      await page.click("#refreshChat");
      await response;
    }
    async function composeRequest(page, peer) {
      await page.fill("#chatUserSearchInput", peer.chatUserId);
      await page.click("#chatUserSearchButton");
      const result = page.locator("#chatUserSearchResults .chat-user-search-result").filter({ hasText: peer.chatUserId });
      await result.getByRole("button", { name: "Send request", exact: true }).click();
      await page.locator("#chatFriendRequestForm").waitFor({ state: "visible" });
    }
    async function sendRequest(page, peer, introduction = "") {
      await composeRequest(page, peer);
      await page.fill("#chatFriendIntroduction", introduction);
      const response = page.waitForResponse((response) => response.url().endsWith("/api/chat/contacts/by-user-id") && response.request().method() === "POST");
      await page.click("#sendChatFriendRequest");
      assert.equal((await response).status(), 201);
      await page.locator("#chatFriendRequestForm").waitFor({ state: "hidden" });
      const row = page.locator('[data-request-direction="outgoing"]').filter({ hasText: peer.chatUserId });
      await row.waitFor();
      return row.getAttribute("data-request-id");
    }
    const requestRow = (page, id) => page.locator(`[data-request-id="${id}"]`);
    const contacts = (page) => page.evaluate(() => window.ALevelApi.listChatContacts());
    async function screenshotAtTop(page, filename, fullPage = false) {
      await page.evaluate(async () => {
        window.scrollTo(0, 0);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      assert.equal(await page.evaluate(() => window.scrollY), 0);
      await page.screenshot({ path: filename, fullPage, animations: "disabled" });
    }
    const alice = await openUser(users[0]);
    const bob = await openUser(users[1]);
    const admin = await openUser(users[2]);
    await admin.locator("#openGlobalDiscussion").waitFor({ state: "visible" });
    await refresh(alice);
    await refresh(bob);
    await alice.locator("#openGlobalDiscussion").waitFor({ state: "visible" });
    await bob.locator("#openGlobalDiscussion").waitFor({ state: "visible" });

    // Cancelling the composer must never create a request.
    const sendCount = calls.filter((call) => call.path === "/api/chat/contacts/by-user-id" && call.method === "POST").length;
    await composeRequest(alice, users[2]);
    await alice.fill("#chatFriendIntroduction", "Unsaved introduction");
    await alice.click("#cancelChatFriendRequest");
    await alice.locator("#chatFriendRequestForm").waitFor({ state: "hidden" });
    assert.equal(calls.filter((call) => call.path === "/api/chat/contacts/by-user-id" && call.method === "POST").length, sendCount);
    const cancelledId = await sendRequest(alice, users[2]);
    assert.equal(calls.find((call) => call.path === "/api/chat/contacts/by-user-id" && call.method === "POST").body.introduction, "");
    await requestRow(alice, cancelledId).locator('[data-request-action="cancel"]').click();
    await requestRow(alice, cancelledId).waitFor({ state: "detached" });
    await refresh(admin);
    assert.equal(await requestRow(admin, cancelledId).count(), 0);
    assert.equal((await contacts(alice)).length, 0);
    console.log("Browser: optional introduction, composer cancellation and outgoing request cancellation passed");

    // Rejecting a request keeps both accounts unpaired.
    const rejectedId = await sendRequest(bob, users[2], "Please add me for revision planning.");
    await refresh(admin);
    await requestRow(admin, rejectedId).getByText("Please add me for revision planning.", { exact: true }).waitFor();
    await requestRow(admin, rejectedId).locator('[data-request-action="reject"]').click();
    await requestRow(admin, rejectedId).waitFor({ state: "detached" });
    await refresh(bob);
    await requestRow(bob, rejectedId).waitFor({ state: "detached" });
    assert.equal((await contacts(bob)).length, 0);
    assert.equal((await contacts(admin)).length, 0);
    console.log("Browser: incoming friend request rejection preserves contact isolation");

    // A pending request exposes its introduction, and becomes usable only on acceptance.
    const introduction = "Hi Bob, I am Alice from the Chemistry study group.";
    const acceptedId = await sendRequest(alice, users[1], introduction);
    assert.equal((await contacts(alice)).length, 0);
    assert.equal((await contacts(bob)).length, 0);
    await refresh(bob);
    await requestRow(bob, acceptedId).getByText(introduction, { exact: true }).waitFor();
    if (process.env.CHAT_QA_SCREENSHOT) {
      const directory = path.dirname(path.resolve(process.env.CHAT_QA_SCREENSHOT));
      await fs.mkdir(directory, { recursive: true });
      await screenshotAtTop(bob, path.join(directory, "chat-friend-request.png"), true);
      await screenshotAtTop(bob, path.join(directory, "chat-desktop-light.png"));
      await bob.setViewportSize({ width: 390, height: 844 });
      await bob.click("#themeToggle");
      await bob.evaluate(() => { window.ALevelI18n.setLanguage("zh-CN"); window.ALevelI18n.applyPage(); });
      await screenshotAtTop(bob, path.join(directory, "chat-friend-request-mobile.png"));
      await bob.locator("#chatFriendRequestsPanel").screenshot({ path: path.join(directory, "chat-friend-request-mobile-card.png"), animations: "disabled" });
      assert.ok(await bob.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "friend requests must fit the mobile viewport");
      await bob.setViewportSize({ width: 1440, height: 980 });
      await bob.click("#themeToggle");
      await bob.evaluate(() => { window.ALevelI18n.setLanguage("en"); window.ALevelI18n.applyPage(); });
    }
    await requestRow(bob, acceptedId).locator('[data-request-action="accept"]').click();
    await requestRow(bob, acceptedId).waitFor({ state: "detached" });
    await refresh(alice);
    await requestRow(alice, acceptedId).waitFor({ state: "detached" });
    assert.equal((await contacts(alice)).length, 1);
    assert.equal((await contacts(bob)).length, 1);
    await alice.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    await alice.fill("#messageInput", "Accepted friends can exchange encrypted messages.");
    await alice.click("#sendMessage");
    await alice.locator("#messageList").getByText("Accepted friends can exchange encrypted messages.", { exact: true }).waitFor();
    await refresh(bob);
    await bob.locator("#conversationList button[data-conversation-id]").filter({ hasText: "Alice" }).click();
    await bob.locator("#messageList").getByText("Accepted friends can exchange encrypted messages.", { exact: true }).waitFor();
    console.log("Browser: explicit friend acceptance creates reciprocal contacts and encrypted direct messaging");

    // An ordinary group owner is presented as Admin and can remove members.
    const adminRequestId = await sendRequest(admin, users[0]);
    await refresh(alice);
    await requestRow(alice, adminRequestId).locator('[data-request-action="accept"]').click();
    await requestRow(alice, adminRequestId).waitFor({ state: "detached" });
    await refresh(admin);
    await admin.click("#createGroup");
    const groupContact = admin.locator("#groupContactList label").filter({ hasText: "Alice" }).locator("input");
    await groupContact.waitFor({ state: "visible" });
    await admin.waitForFunction(() => [...document.querySelectorAll("#groupContactList label")].some((label) => label.textContent.includes("Alice") && !label.querySelector("input").disabled));
    await groupContact.check();
    await admin.click("#confirmCreateGroup");
    await admin.locator("#conversationActive").waitFor({ state: "visible" });
    await admin.click("#groupManageButton");
    const selfMember = admin.locator("#groupMemberList .chat-device-item").filter({ hasText: "(You)" });
    assert.equal(await selfMember.locator(".chat-role-badge").textContent(), "Admin");
    const ordinaryRemove = admin.locator(`#groupMemberList [data-member-action="remove"][data-user-id="${users[0].id}"]`);
    await ordinaryRemove.waitFor();
    admin.once("dialog", (dialog) => dialog.accept());
    await ordinaryRemove.click();
    await ordinaryRemove.waitFor({ state: "detached" });
    assert.equal(await admin.locator("#groupMemberList .chat-device-item").count(), 1);
    console.log("Browser: ordinary group owner displays Admin and member removal rotates its epoch");

    // Global Discussion remains first in the sidebar after voluntary leave.
    const globalId = await alice.locator("#conversationList button").filter({ hasText: "Global Discussion" }).getAttribute("data-conversation-id");
    const beforeLeave = (await alice.evaluate(() => window.ALevelApi.getGlobalChatDiscussion())).conversation.currentEpoch;
    realtimeGate = new Promise((resolve) => { releaseRealtime = resolve; });
    const ticketStarted = alice.waitForRequest((request) => request.url().endsWith("/api/chat/ws-ticket") && request.postDataJSON()?.conversationId === globalId);
    await alice.click("#openGlobalDiscussion");
    await ticketStarted;
    const leavePath = `/api/chat/conversations/${globalId}/leave`;
    const leaveWrites = calls.filter((call) => call.user === "Alice" && call.path === leavePath).length;
    alice.once("dialog", (dialog) => dialog.accept());
    await alice.click("#leaveGlobalDiscussion");
    assert.equal(calls.filter((call) => call.user === "Alice" && call.path === leavePath).length, leaveWrites, "leaving must wait for the pending realtime ticket before removing membership");
    releaseRealtime();
    realtimeGate = null;
    await alice.locator("#joinGlobalDiscussion").waitFor({ state: "visible" });
    assert.equal(await alice.locator("#globalDiscussionPanel").isVisible(), true);
    assert.equal(await alice.locator(".chat-sidebar > section").first().getAttribute("id"), "globalDiscussionPanel");
    assert.equal(await alice.locator(`#conversationList button[data-conversation-id="${globalId}"]`).count(), 0);
    if (process.env.CHAT_QA_SCREENSHOT) {
      const directory = path.dirname(path.resolve(process.env.CHAT_QA_SCREENSHOT));
      await screenshotAtTop(alice, path.join(directory, "chat-global-left.png"), true);
      await alice.locator("#globalDiscussionPanel").screenshot({ path: path.join(directory, "chat-global-left-panel.png"), animations: "disabled" });
    }
    // Voluntary rejoin is queued until an administrator publishes a fresh epoch.
    await alice.click("#joinGlobalDiscussion");
    await alice.locator("#joinGlobalDiscussion").waitFor({ state: "hidden" });
    await refresh(admin);
    await admin.waitForFunction(async () => !(await window.ALevelApi.getGlobalChatDiscussion()).rotationRequired && (await window.ALevelApi.getGlobalChatDiscussion()).pendingCount === 0);
    await refresh(alice);
    await alice.locator("#openGlobalDiscussion").waitFor({ state: "visible" });
    await alice.click("#openGlobalDiscussion");
    const afterRejoin = (await alice.evaluate(() => window.ALevelApi.getGlobalChatDiscussion())).conversation.currentEpoch;
    assert.ok(afterRejoin > beforeLeave, "rejoin must use a new encryption epoch");
    assert.equal((await alice.evaluate(() => window.ALevelApi.getGlobalChatDiscussion())).membershipStatus, "active");
    await alice.fill("#messageInput", "Back in Global Discussion after choosing to rejoin.");
    await alice.click("#sendMessage");
    await alice.locator("#messageList").getByText("Back in Global Discussion after choosing to rejoin.", { exact: true }).waitFor();
    console.log("Browser: persistent Global Discussion panel, voluntary leave and encrypted rejoin passed");

    // Admin moderation is distinct from voluntary leave: removed members cannot self join.
    await admin.click("#openGlobalDiscussion");
    await admin.locator("#messageList").getByText("Back in Global Discussion after choosing to rejoin.", { exact: true }).waitFor();
    await admin.click("#groupManageButton");
    assert.equal(await admin.locator("#groupMemberList .chat-device-item").filter({ hasText: "(You)" }).locator(".chat-role-badge").textContent(), "Admin");
    const globalRemove = admin.locator(`#groupMemberList [data-member-action="remove"][data-user-id="${users[0].id}"]`);
    await globalRemove.waitFor();
    if (process.env.CHAT_QA_SCREENSHOT) {
      const directory = path.dirname(path.resolve(process.env.CHAT_QA_SCREENSHOT));
      await screenshotAtTop(admin, path.join(directory, "chat-global-admin.png"), true);
      await screenshotAtTop(admin, path.join(directory, "chat-global-admin-desktop.png"));
    }
    admin.once("dialog", (dialog) => dialog.dismiss());
    await globalRemove.click();
    assert.equal((await alice.evaluate(() => window.ALevelApi.getGlobalChatDiscussion())).membershipStatus, "active", "cancelled removal must keep membership");
    admin.once("dialog", (dialog) => dialog.accept());
    await globalRemove.click();
    await globalRemove.waitFor({ state: "detached" });
    await refresh(alice);
    const removed = await alice.evaluate(() => window.ALevelApi.getGlobalChatDiscussion());
    assert.equal(removed.removed, true);
    assert.equal(removed.canJoin, false);
    assert.equal(await alice.locator("#globalDiscussionPanel").isVisible(), true);
    assert.equal(await alice.locator("#joinGlobalDiscussion").isVisible(), false);
    assert.equal(await alice.locator("#openGlobalDiscussion").isVisible(), false);
    const removeCall = calls.findLast((call) => call.path === "/api/chat/global-discussion/remove" && call.method === "POST");
    assert.equal(removeCall.user, "Admin");
    assert.equal(removeCall.body.action, "remove");
    assert.equal(removeCall.body.payload.userId, users[0].id);
    assert.equal(removeCall.status, 200);
    await refresh(admin);
    await admin.waitForFunction(async () => !(await window.ALevelApi.getGlobalChatDiscussion()).rotationRequired);
    const current = await admin.evaluate(() => window.ALevelApi.getGlobalChatDiscussion());
    const epochRecipients = (await env.DB.prepare("SELECT user_id FROM chat_epoch_recipients WHERE conversation_id=? AND epoch=?").bind(globalId, current.conversation.currentEpoch).all()).results;
    assert.equal(epochRecipients.some((recipient) => recipient.user_id === users[0].id), false, "removed users cannot receive the new group key");
    await bob.click("#openGlobalDiscussion");
    await bob.click("#groupManageButton");
    assert.equal(await bob.locator('#groupMemberList [data-member-action="remove"]').count(), 0);
    assert.equal(await bob.locator("#groupMemberList .chat-role-badge").filter({ hasText: "Admin" }).count(), 1);
    console.log("Browser: admin removal, cancellation, rejoin restriction and revoked epoch access passed");
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleErrors, []);
    console.log(`friend and membership browser smoke passed (${baseUrl}; real Worker + API; mocked Passkey ceremony)`);
  } catch (error) {
    for (const { user, page } of pages) {
      if (!page.isClosed()) console.error(`${user} browser state:`, await page.locator("#chatStatus").textContent(), "requests:", await page.locator("#chatFriendRequestsPanel").textContent(), "global:", await page.locator("#globalDiscussionPanel").textContent(), "members:", await page.locator("#groupMemberList").textContent());
    }
    console.error("API writes:", calls.filter((call) => call.method !== "GET").slice(-15).map(({ user, method, path, body, status }) => ({ user, method, path, status, action: body?.action, conversationId: body?.conversationId })));
    console.error("API failures:", calls.filter((call) => call.status >= 400).map(({ user, method, path, body, status }) => ({ user, method, path, status, conversationId: body?.conversationId })));
    throw error;
  } finally {
    releaseRealtime?.();
    await browser?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
    await Promise.allSettled([...activeRequests]);
    await mf.dispose();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
