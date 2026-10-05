const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { chromium } = require("playwright");

// Real chat handlers and DOM; deterministic crypto/API fixtures exercise delivery
// failures without connecting production accounts or native notification services.
async function main() {
  const root = path.resolve(__dirname, "..");
  const [markup, chat, notifications, mediaQueue, messageTools, localState, i18n, styles] = await Promise.all([
    fs.readFile(path.join(root, "pages/chat.html"), "utf8"),
    fs.readFile(path.join(root, "scripts/chat.js"), "utf8"),
    fs.readFile(path.join(root, "scripts/chat-notifications.js"), "utf8"),
    fs.readFile(path.join(root, "scripts/chat-media-queue.js"), "utf8"),
    fs.readFile(path.join(root, "scripts/chat-message-tools.js"), "utf8"),
    fs.readFile(path.join(root, "scripts/chat-local-state.js"), "utf8"),
    fs.readFile(path.join(root, "scripts/i18n.js"), "utf8"),
    Promise.all(["assets/styles.css", "assets/site-design.css", "assets/chat.css"].map((file) => fs.readFile(path.join(root, file), "utf8"))).then((contents) => contents.join("\n")),
  ]);
  // Exercise the production retry decision and payload builder directly. A
  // definite rejection permits a new epoch; an uncertain network response must
  // preserve the original idempotent ciphertext, because the server may have it.
  const functionSource = (name) => {
    const start = chat.indexOf(`  async function ${name}(`);
    assert.ok(start >= 0, `Missing chat handler ${name}`);
    const end = chat.indexOf("\n  async function ", start + 1);
    assert.ok(end > start, `Cannot extract chat handler ${name}`);
    return chat.slice(start, end);
  };
  for (const scenario of ["EPOCH_CONFLICT", "ROTATION_REQUIRED", "REQUEST_TIMEOUT", "TypeError", "image-EPOCH_CONFLICT"]) {
    const media = scenario.startsWith("image-");
    const error = scenario.replace("image-", "");
    const originalPayload = { conversationId: "account-chat", clientMessageId: "same-client-id", contentEpoch: 1,
      ciphertext: "original-ciphertext", nonce: "original-nonce", attachmentRefs: media ? ["old-attachment"] : [] };
    const item = { mode: "account-v2", conversationId: "account-chat", clientMessageId: "same-client-id", error: `Fixture failed (${error})`, hasMedia: media,
      payload: { ...originalPayload }, localCiphertext: { ciphertext: "sealed-original" } };
    const effects = { refresh: 0, encryption: [], persisted: 0, sent: [], resealed: [] };
    const conversation = { id: "account-chat", canSend: true, rotationRequired: false, currentEpoch: 2 };
    const environment = {
      state: { outbox: [item], accountSessionGeneration: 7, profile: { id: "alice" }, conversations: [conversation] },
      navigator: { onLine: true },
      refreshData: async () => { effects.refresh += 1; },
      assertAccountSession: (generation) => assert.equal(generation, 7),
      isHistoricalConversation: () => false,
      currentAccountEpoch: async () => 2,
      cryptoCall: async (action, payload) => {
        if (action === "openChatLocalState") return { plaintext: media
          ? JSON.stringify({ kind: "image", attachmentId: "old-attachment", name: "private-notes.png", key: "image-key", nonce: "image-nonce" }) : "Keep this queued text" };
        if (action === "encryptAccountV2Message") {
          effects.encryption.push(payload);
          return { epoch: payload.epoch, ciphertext: "epoch-two-ciphertext", nonce: "epoch-two-nonce", senderKeyId: "key-1", signature: "new-signature", attachmentRefs: payload.attachmentRefs };
        }
        if (action === "sealChatLocalState") { effects.resealed.push(payload); return { ciphertext: "sealed-refreshed" }; }
        throw new Error(`Unexpected retry crypto action ${action}`);
      },
      persistOutbox: () => { effects.persisted += 1; return true; },
      dispatchQueuedMessage: async (queued) => { effects.sent.push(JSON.parse(JSON.stringify(queued.payload))); },
      syncConversation: async () => {}, renderMessages: () => {}, setDeliveryState: () => {},
      setStatus: (message) => { throw new Error(message); }, formatActionError: (failure) => failure.message,
      t: (_key, fallback) => fallback,
    };
    vm.runInNewContext(`${functionSource("retryMessage")}\n${functionSource("refreshQueuedAccountPayload")}\nglobalThis.retry = retryMessage;`, environment);
    await environment.retry(item.clientMessageId);
    assert.equal(effects.sent.length, 1);
    if (["REQUEST_TIMEOUT", "TypeError"].includes(error)) {
      assert.equal(effects.refresh, 0, "uncertain network failures must not refresh and reencrypt an idempotent message");
      assert.deepEqual(effects.sent[0], originalPayload);
    } else if (media) {
      assert.equal(effects.refresh, 1);
      assert.deepEqual(effects.sent[0], { stagedImage: true });
      const metadata = JSON.parse(effects.resealed[0].plaintext);
      assert.equal(metadata.attachmentId, undefined);
      assert.equal(metadata.name, "private-notes.png");
      assert.equal(metadata.key, "image-key");
    } else {
      assert.equal(effects.refresh, 1);
      assert.equal(effects.encryption.length, 1);
      assert.equal(effects.encryption[0].clientMessageId, item.clientMessageId);
      assert.equal(effects.encryption[0].plaintext, "Keep this queued text");
      assert.equal(effects.sent[0].contentEpoch, 2);
      assert.equal(effects.sent[0].clientMessageId, originalPayload.clientMessageId);
      assert.equal(effects.sent[0].ciphertext, "epoch-two-ciphertext");
      assert.equal(effects.persisted, 1);
    }
  }
  console.log("Account queue retries refresh a rejected epoch with the same message ID and preserve ciphertext after network uncertainty");
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/assets/")) {
      const filename = path.resolve(root, `.${url.pathname}`);
      if (filename.startsWith(`${root}${path.sep}`)) {
        try {
          response.writeHead(200, { "Content-Type": filename.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream" });
          response.end(await fs.readFile(filename)); return;
        } catch (_error) { response.end(); return; }
      }
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end('<!doctype html><title>Chat delivery fixture</title><body class="student-ui site-ui"><header class="site-header-controls"></header></body>');
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
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${base}/pages/notifications.html`);
    await page.evaluate(() => {
      const token = `${btoa(JSON.stringify({ sub: "alice" }))}.signature`;
      localStorage.setItem("alevel.authToken", token);
      window.__unread = [{ id: "one", unreadCount: 2, latestMessage: { id: "existing-1", senderUserId: "bob" } },
        { id: "two", unreadCount: 3, latestMessage: { id: "existing-2", senderUserId: "bob" } }];
      window.ALevelApi = { listChatConversations: async () => window.__unread };
      window.__notifications = [];
      window.Notification = class {
        static permission = "granted";
        static requestPermission = async () => window.Notification.permission;
        constructor(title, options) { window.__notifications.push({ title, ...options }); }
        close() {}
      };
    });
    await page.addScriptTag({ content: notifications });
    await page.waitForFunction(() => document.querySelector("[data-chat-unread]")?.textContent === "5");
    assert.equal(await page.locator("[data-chat-entry]").getAttribute("href"), "chat.html");
    assert.equal(await page.locator("[data-chat-entry]").getAttribute("aria-label"), "Chat (5)");
    assert.equal(await page.evaluate(async () => window.ALevelChatNotifications.setEnabled(true)), true);
    await page.evaluate(() => {
      window.ALevelChatNotifications.setMuted("two", true);
      window.ALevelChatNotifications.updateUnread([{ unreadCount: 101 }, { unreadCount: -1 }]);
    });
    assert.equal(await page.locator("[data-chat-unread]").textContent(), "99+");
    const outcomes = await page.evaluate(() => {
      const api = window.ALevelChatNotifications;
      const message = { conversationId: "one", conversationTitle: "Revision group", messageId: "new-1", preview: "Biology notes" };
      return [api.notify({ ...message, isOwn: true }), api.notify({ ...message, conversationId: "two" }),
        api.notify(message), api.notify(message), api.notify({ ...message, messageId: "new-2", mention: true }), api.notify(message)];
    });
    assert.deepEqual(outcomes, [false, false, true, false, true, false]);
    assert.deepEqual(await page.evaluate(() => window.__notifications.map((notification) => [notification.title, notification.body])),
      [["Revision group", "Biology notes"], ["Revision group · @", "Biology notes"]]);
    await page.evaluate(async () => {
      window.__unread[0].latestMessage.id = "poll-new-1";
      window.__unread[1].latestMessage.id = "poll-muted-1";
      await window.ALevelChatNotifications.refreshUnread();
      await window.ALevelChatNotifications.refreshUnread();
    });
    assert.equal(await page.evaluate(() => window.__notifications.length), 3, "polling should notify only the new unmuted message, without replaying old history");
    const visibleActiveNotification = await page.evaluate(() => {
      const original = document.hasFocus;
      document.hasFocus = () => true;
      window.ALevelChatNotifications.setActiveConversation("one");
      const sent = window.ALevelChatNotifications.notify({ conversationId: "one", messageId: "visible-active", preview: "Already on screen" });
      document.hasFocus = original;
      window.ALevelChatNotifications.setActiveConversation("");
      return sent;
    });
    assert.equal(visibleActiveNotification, false);
    await page.evaluate(async () => {
      const original = window.ALevelApi.listChatConversations;
      let finish;
      window.ALevelApi.listChatConversations = () => new Promise((resolve) => { finish = resolve; });
      const pending = window.ALevelChatNotifications.refreshUnread();
      window.ALevelChatNotifications.updateUnread([]);
      finish([{ id: "one", unreadCount: 100 }]);
      await pending;
      window.ALevelApi.listChatConversations = original;
    });
    assert.equal(await page.locator("[data-chat-unread]").isHidden(), true, "a read marker must not be overwritten by an older badge request");
    await page.evaluate(() => {
      window.ALevelChatNotifications.setUser("bob");
      window.__bobPreferences = window.ALevelChatNotifications.getPreferences();
      window.ALevelChatNotifications.setUser("alice");
    });
    assert.deepEqual(await page.evaluate(() => window.__bobPreferences), { enabled: false, mutedConversationIds: [] });
    assert.deepEqual(await page.evaluate(() => window.ALevelChatNotifications.getPreferences()), { enabled: true, mutedConversationIds: ["two"] });
    assert.equal(await page.evaluate(async () => { window.Notification.permission = "denied"; return window.ALevelChatNotifications.setEnabled(true); }), false);
    await page.evaluate(() => {
      window.__finishUnread = null;
      window.ALevelApi.listChatConversations = () => new Promise((resolve) => { window.__finishUnread = resolve; });
      window.__refresh = window.ALevelChatNotifications.refreshUnread();
    });
    await page.evaluate(async () => {
      localStorage.removeItem("alevel.authToken");
      window.dispatchEvent(new StorageEvent("storage", { key: "alevel.authToken" }));
      window.__finishUnread([{ unreadCount: 50 }]);
      await window.__refresh;
    });
    assert.equal(await page.locator("[data-chat-entry]").count(), 0, "a late unread response must not revive a signed-out account badge");
    assert.equal(await page.evaluate(() => window.ALevelChatNotifications.getPreferences().enabled), false);
    assert.deepEqual(errors, []);
    console.log("Chat unread badge, per-user mute preferences, notification suppression and auth race passed");
    await page.addScriptTag({ content: mediaQueue });
    const mediaChecks = await page.evaluate(async () => {
      const api = window.ALevelChatMediaQueue;
      const supplied = new Uint8Array([9, 8, 7, 6]);
      await api.put("alice", "image-one", supplied.subarray(1, 3));
      await api.put("bob", "image-one", new Uint8Array([5, 4]));
      supplied.fill(0);
      const stored = [...new Uint8Array(await api.get("alice", "image-one"))];
      const before = await api.list("alice");
      const unavailable = await api.get("other", "image-one");
      const db = await new Promise((resolve) => { const request = indexedDB.open("expassway-chat-encrypted-media-queue-v1", 1); request.onsuccess = () => resolve(request.result); });
      const raw = await new Promise((resolve) => { const request = db.transaction("encrypted-media").objectStore("encrypted-media").getAll(); request.onsuccess = () => resolve(request.result); });
      db.close();
      await api.clear("alice");
      const aliceAfter = await api.list("alice");
      const bobAfter = [...new Uint8Array(await api.get("bob", "image-one"))];
      await api.remove("bob", "image-one");
      return { stored, before, unavailable, fields: Object.keys(raw[0]).sort(), aliceAfter, bobAfter, final: await api.list("bob") };
    });
    assert.deepEqual(mediaChecks.stored, [8, 7], "durable bytes must copy only the supplied encrypted view");
    assert.deepEqual(mediaChecks.before.map(({ id, sizeBytes }) => ({ id, sizeBytes })), [{ id: "image-one", sizeBytes: 2 }]);
    assert.equal(mediaChecks.unavailable, null);
    assert.deepEqual(mediaChecks.fields, ["bytes", "createdAt", "id", "key", "sizeBytes", "userId"], "the image queue must never persist plaintext filenames, captions or encryption keys");
    assert.deepEqual(mediaChecks.aliceAfter, []);
    assert.deepEqual(mediaChecks.bobAfter, [5, 4], "clearing one user's media must preserve another user's encrypted queue");
    assert.deepEqual(mediaChecks.final, []);
    await page.evaluate(() => window.ALevelChatMediaQueue.put("alice", "reload-proof", new Uint8Array([7, 3, 1])));
    const restoredMedia = await page.context().newPage();
    await restoredMedia.goto(`${base}/pages/notifications.html`);
    await restoredMedia.addScriptTag({ content: mediaQueue });
    assert.deepEqual(await restoredMedia.evaluate(async () => [...new Uint8Array(await window.ALevelChatMediaQueue.get("alice", "reload-proof"))]), [7, 3, 1], "a fresh page must restore encrypted bytes from IndexedDB");
    await restoredMedia.evaluate(() => window.ALevelChatMediaQueue.remove("alice", "reload-proof"));
    await restoredMedia.close();
    console.log("Encrypted image IndexedDB staging, account isolation and metadata hygiene passed");
    await page.close();

    if (process.env.CHAT_NOTIFICATION_ONLY === "1") return;
    const delivery = await context.newPage();
    delivery.on("pageerror", (error) => errors.push(error.message));
    await delivery.goto(`${base}/pages/chat.html`);
    const setupFixture = ({ markup, offline = false }) => {
      const parsed = new DOMParser().parseFromString(markup, "text/html");
      parsed.querySelectorAll("script").forEach((script) => script.remove());
      document.body.innerHTML = parsed.body.innerHTML;
      document.body.className = parsed.body.className;
      localStorage.setItem("alevel.authToken", `${btoa(JSON.stringify({ sub: "alice" }))}.signature`);
      const device = { id: "alice-device", label: "Fixture browser", deviceNumber: 1, oneTimePreKeyCount: 20 };
      localStorage.setItem("expassway.chat.device.v1", JSON.stringify(device));
      const plaintexts = { incoming: "Physics revision notes" };
      const conversation = { id: "chat-one", kind: "direct", protocolVersion: "signal-v1", retentionSeconds: 0, unreadCount: 1,
        peer: { alias: "Bob", contactId: "contact-bob", deviceId: "bob-device", deviceNumber: 1 },
        latestMessage: { id: "incoming", clientMessageId: "incoming", senderUserId: "bob", createdAt: "2026-10-05T00:00:00.000Z" } };
      window.__messages = [{ ...conversation.latestMessage, conversationId: conversation.id, protocolVersion: "signal-v1", senderDeviceId: "bob-device" }];
      window.__sendMode = "success";
      window.__sentPayloads = [];
      window.__readCalls = [];
      window.__attachmentCalls = [];
      window.__attachmentSequence = 0;
      window.__attachmentMode = "success";
      window.__completedAttachments = new Set();
      window.__goneAttachments = new Set();
      window.__localSealed = {};
      window.__finishSend = null;
      window.__networkOnline = !offline;
      Object.defineProperty(navigator, "onLine", { configurable: true, get: () => window.__networkOnline });
      window.Worker = class {
        postMessage(message) {
          const { action, payload } = message;
          let result = {};
          if (action === "getLocalPlaintext") result = plaintexts[payload.clientMessageId] ?? null;
          if (action === "storeLocalPlaintext") plaintexts[payload.clientMessageId] = payload.plaintext;
          if (action === "safetyNumber") result = "12345 67890";
          if (["getSafetyNumberVerification", "getSafetyNumberChange"].includes(action)) result = null;
          if (action === "encryptMessage") result = { type: 1, body: "encrypted-fixture" };
          if (action === "encryptAttachment") result = { bytes: new Uint8Array([22, 33, 44, 55]).buffer, key: "secret-image-key", nonce: "image-nonce" };
          if (action === "sealChatLocalState") {
            const ciphertext = btoa(unescape(encodeURIComponent(payload.plaintext)));
            window.__localSealed[ciphertext] = payload.plaintext;
            result = { nonce: "sealed-nonce", ciphertext };
            if (payload.purpose === "outbox") plaintexts[payload.recordId] = payload.plaintext;
          }
          if (action === "openChatLocalState") result = { plaintext: window.__localSealed[payload.sealed?.ciphertext] || decodeURIComponent(escape(atob(payload.sealed?.ciphertext || "bnVsbA=="))) };
          if (action === "encryptLocalDraft") result = { nonce: "AQ", ciphertext: "encrypted-draft" };
          queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ok: true, result } }));
        }
      };
      const unavailable = () => Object.assign(new Error("Account encryption disabled for fixture"), { status: 503, code: "CHAT_ACCOUNT_V2_DISABLED" });
      window.ALevelApi = {
        getChatProfile: async () => ({ id: "alice", alias: "Alice", chatUserId: "alice-chat" }),
        getChatAccountKeyBundle: async () => { throw unavailable(); },
        getChatAccountVault: async () => null,
        listChatDevices: async () => [device],
        getChatKeyBackup: async () => null,
        listChatContacts: async () => [],
        listChatConversations: async () => [{ ...conversation, latestMessage: { ...conversation.latestMessage } }],
        getChatContactBundle: async () => ({ devices: [{ deviceId: "bob-device", deviceNumber: 1 }] }),
        getChatOwnDeviceBundle: async () => ({ devices: [{ deviceId: "alice-device", deviceNumber: 1 }] }),
        createChatWebSocketTicket: async () => { throw new Error("No fixture realtime"); },
        markChatConversationRead: async (id, messageId) => { window.__readCalls.push({ id, messageId }); conversation.unreadCount = 0; return { unreadCount: 0, lastReadMessageId: messageId, lastReadAt: conversation.latestMessage.createdAt }; },
        syncChatMessages: async () => ({ messages: window.__messages, nextCursor: String(window.__messages.length) }),
        initChatAttachment: async (payload) => { window.__attachmentCalls.push({ action: "init", ...payload }); return { attachmentId: `image-attachment-${++window.__attachmentSequence}` }; },
        uploadChatAttachment: async (id, bytes) => {
          window.__attachmentCalls.push({ action: "upload", id, bytes: [...new Uint8Array(bytes)] });
          if (window.__completedAttachments.has(id) || window.__goneAttachments.has(id)) throw Object.assign(new Error("Attachment upload not found"), { status: 404, code: "ATTACHMENT_NOT_FOUND" });
          if (window.__attachmentMode === "upload-network-once") { window.__attachmentMode = "success"; throw Object.assign(new Error("Upload response lost"), { name: "TypeError" }); }
        },
        completeChatAttachment: async (id) => {
          window.__attachmentCalls.push({ action: "complete", id });
          if (window.__goneAttachments.has(id)) throw Object.assign(new Error("Attachment not found"), { status: 404, code: "ATTACHMENT_NOT_FOUND" });
          window.__completedAttachments.add(id);
          if (window.__attachmentMode === "complete-network-once") { window.__attachmentMode = "success"; throw Object.assign(new Error("Completion response lost"), { name: "TypeError" }); }
        },
        sendChatMessage: async (payload) => {
          window.__sentPayloads.push(payload);
          if (window.__sendMode === "hold") await new Promise((resolve) => { window.__finishSend = resolve; });
          if (window.__sendMode === "failure") throw Object.assign(new Error("Fixture denied"), { status: 403, code: "SEND_DENIED" });
          if (window.__sendMode === "network") throw Object.assign(new Error("Temporary network error"), { name: "TypeError" });
          const message = { ...payload, id: `server-${payload.clientMessageId}`, senderUserId: "alice", senderDeviceId: "alice-device", protocolVersion: "signal-v1", createdAt: new Date().toISOString() };
          if (!window.__messages.some((item) => item.clientMessageId === payload.clientMessageId)) window.__messages.push(message);
          conversation.latestMessage = message;
          return message;
        },
      };
    };
    const installChat = async (offline = false, target = delivery) => {
      await target.evaluate(setupFixture, { markup, offline });
      await target.addStyleTag({ content: styles });
      await target.addScriptTag({ content: i18n });
      await target.addScriptTag({ content: notifications });
      await target.addScriptTag({ content: mediaQueue });
      await target.addScriptTag({ content: messageTools });
      await target.addScriptTag({ content: localState });
      await target.addScriptTag({ content: chat });
      await target.locator("#chatApp").waitFor({ state: "visible" });
    };
    await installChat();
    await delivery.locator("#chatApp").waitFor({ state: "visible" });
    const contact = delivery.locator("#conversationList button").filter({ hasText: "Bob" });
    await contact.click();
    await delivery.waitForFunction(() => window.__readCalls.length >= 1);
    await delivery.locator(".chat-unread-badge:visible").waitFor({ state: "hidden" });
    assert.equal(await delivery.locator(".chat-unread-badge:visible").count(), 0);
    assert.match(await contact.textContent(), /Physics revision notes/);
    await delivery.evaluate(() => { window.__sendMode = "hold"; });
    await delivery.fill("#messageInput", "Send in progress");
    await delivery.click("#sendMessage");
    await delivery.waitForFunction(() => Boolean(window.__finishSend));
    assert.equal(await delivery.locator(".chat-message__delivery--sending").count(), 1);
    await delivery.evaluate(() => { window.__sendMode = "success"; window.__finishSend(); });
    await delivery.waitForFunction(() => document.querySelector(".chat-message__delivery--sent"));
    assert.equal(await delivery.locator("#messageInput").inputValue(), "");
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: "Send in progress" }).count(), 1, "sync must replace the optimistic bubble rather than duplicate it");
    await delivery.evaluate(() => { window.__sendMode = "failure"; });
    await delivery.fill("#messageInput", "Retry once");
    await delivery.click("#sendMessage");
    await delivery.locator(".chat-message__delivery--failed").waitFor();
    const failedId = await delivery.evaluate(() => window.__sentPayloads.at(-1).clientMessageId);
    await delivery.evaluate(() => { window.__sendMode = "success"; });
    await delivery.locator(".chat-message__delivery--failed button").click();
    await delivery.waitForFunction((id) => window.__sentPayloads.filter((payload) => payload.clientMessageId === id).length === 2
      && !document.querySelector(".chat-message__delivery--failed"), failedId);
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: "Retry once" }).count(), 1);
    await delivery.evaluate(() => { window.__networkOnline = false; window.dispatchEvent(new Event("offline")); });
    const sendsBeforeOffline = await delivery.evaluate(() => window.__sentPayloads.length);
    await delivery.fill("#messageInput", "Offline queue content");
    await delivery.click("#sendMessage");
    await delivery.locator(".chat-message__delivery--queued").waitFor();
    assert.equal(await delivery.locator("#messageInput").inputValue(), "");
    assert.equal(await delivery.evaluate(() => window.__sentPayloads.length), sendsBeforeOffline, "offline enqueue must not issue a network send");
    const stored = await delivery.evaluate(() => localStorage.getItem("expassway.chat.outbox.v1.alice"));
    assert.ok(JSON.parse(stored).length > 0);
    assert.ok(!stored.includes("Offline queue content"), "only encrypted transport may be persisted in the outbox");
    if (process.env.CHAT_QA_DIR) {
      await fs.mkdir(process.env.CHAT_QA_DIR, { recursive: true });
      await delivery.screenshot({ path: path.join(process.env.CHAT_QA_DIR, "chat-offline-desktop.png"), fullPage: false });
      await delivery.setViewportSize({ width: 390, height: 844 });
      await delivery.locator(".chat-message__delivery--queued").scrollIntoViewIfNeeded();
      await delivery.screenshot({ path: path.join(process.env.CHAT_QA_DIR, "chat-offline-mobile.png"), fullPage: false });
      await delivery.setViewportSize({ width: 1440, height: 960 });
    }
    await delivery.reload();
    await installChat(true);
    await delivery.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    await delivery.locator(".chat-message__delivery--queued").waitFor();
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: "Offline queue content" }).count(), 1, "reload must restore the encrypted queued text without reviving composer input");
    assert.equal(await delivery.locator("#messageInput").inputValue(), "");
    await delivery.evaluate(() => { window.__networkOnline = true; window.dispatchEvent(new Event("online")); });
    await delivery.waitForFunction(() => JSON.parse(localStorage.getItem("expassway.chat.outbox.v1.alice") || "[]").length === 0);
    await delivery.waitForFunction(() => !document.querySelector(".chat-message__delivery--queued"));
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: "Offline queue content" }).count(), 1);
    await delivery.evaluate(() => { window.__networkOnline = false; window.dispatchEvent(new Event("offline")); });
    const imageName = "private-diagram.png";
    await delivery.setInputFiles("#imageInput", { name: imageName, mimeType: "image/png", buffer: Buffer.from([137, 80, 78, 71, 1, 2, 3]) });
    await delivery.locator(".chat-message__delivery--queued").waitFor();
    const imageStorage = await delivery.evaluate(async () => ({ outbox: localStorage.getItem("expassway.chat.outbox.v1.alice"), media: await window.ALevelChatMediaQueue.list("alice"), calls: window.__attachmentCalls }));
    assert.equal(imageStorage.calls.length, 0, "offline image staging must not start network reservation or upload");
    assert.equal(imageStorage.media.length, 1);
    assert.ok(!imageStorage.outbox.includes(imageName) && !imageStorage.outbox.includes("secret-image-key"), "image names and encryption keys must be sealed separately from durable encrypted bytes");
    const imageId = imageStorage.media[0].id;
    assert.deepEqual(await delivery.evaluate(async (id) => [...new Uint8Array(await window.ALevelChatMediaQueue.get("alice", id))], imageId), [22, 33, 44, 55]);
    await delivery.reload();
    await installChat(true);
    await delivery.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    await delivery.locator(".chat-message__delivery--queued").waitFor();
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: imageName }).count(), 1, "a refreshed page must restore the sealed queued image caption");
    assert.deepEqual(await delivery.evaluate(async (id) => [...new Uint8Array(await window.ALevelChatMediaQueue.get("alice", id))], imageId), [22, 33, 44, 55], "refresh must preserve encrypted image bytes");
    await delivery.evaluate(() => { window.__sendMode = "failure"; window.__networkOnline = true; window.dispatchEvent(new Event("online")); });
    await delivery.locator(".chat-message__delivery--failed").waitFor();
    assert.equal(await delivery.evaluate(async () => (await window.ALevelChatMediaQueue.list("alice")).length), 1, "an uploaded image must stay staged until its message is acknowledged");
    const uploadCalls = await delivery.evaluate(() => window.__attachmentCalls);
    assert.deepEqual(uploadCalls.map((call) => call.action), ["init", "upload", "complete"]);
    assert.deepEqual(uploadCalls[1].bytes, [22, 33, 44, 55]);
    await delivery.evaluate(() => { window.__sendMode = "success"; });
    await delivery.locator(".chat-message__delivery--failed button").click();
    await delivery.waitForFunction(async () => (await window.ALevelChatMediaQueue.list("alice")).length === 0);
    await delivery.waitForFunction(() => !document.querySelector(".chat-message__delivery--failed"));
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: imageName }).count(), 1);
    assert.equal(await delivery.evaluate(() => window.__attachmentCalls.length), 3, "retrying a message with uploaded media must reuse the completed attachment");
    await delivery.evaluate(() => { window.__networkOnline = false; window.__attachmentMode = "complete-network-once"; });
    await delivery.setInputFiles("#imageInput", { name: "lost-completion.png", mimeType: "image/png", buffer: Buffer.from([1, 2, 3, 4]) });
    await delivery.locator(".chat-message__delivery--queued").waitFor();
    await delivery.evaluate(() => { window.__networkOnline = true; window.dispatchEvent(new Event("online")); });
    await delivery.waitForFunction(() => window.__completedAttachments.size === 2 && JSON.parse(localStorage.getItem("expassway.chat.outbox.v1.alice") || "[]")[0]?.status === "queued");
    await delivery.evaluate(() => window.dispatchEvent(new Event("online")));
    await delivery.waitForFunction(() => JSON.parse(localStorage.getItem("expassway.chat.outbox.v1.alice") || "[]").length === 0);
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: "lost-completion.png" }).count(), 1, "a lost complete response must recover the completed reservation and send one image");
    await delivery.evaluate(() => { window.__networkOnline = false; window.__attachmentMode = "upload-network-once"; });
    await delivery.setInputFiles("#imageInput", { name: "expired-reservation.png", mimeType: "image/png", buffer: Buffer.from([5, 6, 7, 8]) });
    await delivery.locator(".chat-message__delivery--queued").waitFor();
    await delivery.evaluate(() => { window.__networkOnline = true; window.dispatchEvent(new Event("online")); });
    await delivery.waitForFunction(() => window.__attachmentMode === "success" && JSON.parse(localStorage.getItem("expassway.chat.outbox.v1.alice") || "[]")[0]?.payload.attachmentId);
    await delivery.evaluate(() => {
      const id = JSON.parse(localStorage.getItem("expassway.chat.outbox.v1.alice"))[0].payload.attachmentId;
      window.__goneAttachments.add(id);
      window.dispatchEvent(new Event("online"));
    });
    await delivery.waitForFunction(() => JSON.parse(localStorage.getItem("expassway.chat.outbox.v1.alice") || "[]").length === 0);
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: "expired-reservation.png" }).count(), 1, "an expired reservation must be recreated using the durable encrypted bytes");
    await delivery.evaluate(() => {
      window.__networkOnline = false;
      window.__originalStorageWrite = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("expassway.chat.outbox.v1")) throw new DOMException("Fixture storage quota exceeded", "QuotaExceededError");
        return window.__originalStorageWrite.call(this, key, value);
      };
    });
    await delivery.fill("#messageInput", "Keep input when local queue storage is full");
    await delivery.click("#sendMessage");
    await delivery.waitForFunction(() => !document.querySelector("#sendMessage").disabled);
    assert.equal(await delivery.locator("#messageInput").inputValue(), "Keep input when local queue storage is full", "offline storage failure must retain composer content instead of promising a queue that a refresh will lose");
    assert.equal(await delivery.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("expassway.chat.outbox.v1.alice.item.")).length), 0, "quota fixture must reject durable per-message queue records");
    await delivery.evaluate(() => { Storage.prototype.setItem = window.__originalStorageWrite; });
    await delivery.evaluate(() => {
      window.__rejectedSealedItems = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith("expassway.chat.outbox.v1.alice.item.") && JSON.parse(value).localCiphertext) {
          window.__rejectedSealedItems += 1;
          throw new DOMException("Fixture full sealed-image record exceeds quota", "QuotaExceededError");
        }
        return window.__originalStorageWrite.call(this, key, value);
      };
    });
    await delivery.setInputFiles("#imageInput", { name: "quota-image-retry.png", mimeType: "image/png", buffer: Buffer.from([9, 10, 11, 12]) });
    await delivery.waitForFunction(() => window.__rejectedSealedItems === 1 && !document.querySelector("#imageInput").disabled);
    assert.equal(await delivery.locator("#imageInput").evaluate((input) => input.files[0]?.name), "quota-image-retry.png", "a failed complete image queue write must preserve the selected file for retry");
    assert.equal(await delivery.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("expassway.chat.outbox.v1.alice.item.")).length), 0, "a sealed-record quota failure must not leave an unsealed staged image item");
    assert.equal(await delivery.evaluate(async () => (await window.ALevelChatMediaQueue.list("alice")).length), 0, "an image that could not enter its durable outbox must clean up staged encrypted bytes");
    await delivery.evaluate(() => {
      Storage.prototype.setItem = window.__originalStorageWrite;
      document.querySelector("#imageInput").dispatchEvent(new Event("change", { bubbles: true }));
    });
    await delivery.locator(".chat-message__delivery--queued").waitFor();
    const restoredImage = await delivery.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("expassway.chat.outbox.v1.alice.item.")).map((key) => JSON.parse(localStorage.getItem(key))));
    assert.equal(restoredImage.length, 1);
    assert.ok(restoredImage[0].localCiphertext && restoredImage[0].hasMedia && restoredImage[0].payload.stagedImage, "the successful retry must persist all image recovery metadata in its initial queue record");
    await delivery.evaluate(() => { window.__networkOnline = true; window.dispatchEvent(new Event("online")); });
    await delivery.waitForFunction(() => !Object.keys(localStorage).some((key) => key.startsWith("expassway.chat.outbox.v1.alice.item.")));
    await delivery.waitForFunction(async () => (await window.ALevelChatMediaQueue.list("alice")).length === 0);
    assert.equal(await delivery.locator(".chat-message").filter({ hasText: "quota-image-retry.png" }).count(), 1);

    // Match the four group composer controls at the mobile width without changing
    // production handlers or account enrollment in this delivery fixture.
    await delivery.setViewportSize({ width: 390, height: 844 });
    await delivery.evaluate(() => {
      document.querySelector("#conversationTitle").textContent = "Revision group";
      document.querySelector("#contactManageButton").hidden = true;
      document.querySelector("#groupManageButton").hidden = false;
      document.querySelector("#mentionButton").hidden = false;
    });
    const groupToolbar = await delivery.locator(".chat-compose > .chat-compose__actions").evaluate((host) => ({
      width: host.getBoundingClientRect().width,
      clientWidth: host.clientWidth, scrollWidth: host.scrollWidth,
      buttons: [...host.children].filter((button) => !button.hidden && ["BUTTON", "LABEL"].includes(button.tagName)).map((button) => {
        const style = getComputedStyle(button);
        const rect = button.getBoundingClientRect();
        return { text: button.textContent, whiteSpace: style.whiteSpace, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap,
          left: rect.left, right: rect.right, clientWidth: button.clientWidth, scrollWidth: button.scrollWidth };
      }),
      pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth,
    }));
    assert.equal(groupToolbar.buttons.length, 4);
    assert.ok(groupToolbar.scrollWidth <= groupToolbar.clientWidth + 1, "group composer actions must not overflow their mobile container");
    assert.ok(groupToolbar.pageScrollWidth <= groupToolbar.pageWidth + 1, "group mode must not cause horizontal page overflow at 390px");
    for (const button of groupToolbar.buttons) {
      assert.ok(button.left >= 0 && button.right <= 390);
      assert.ok(button.scrollWidth <= button.clientWidth + 1, `${button.text} must fit its mobile button`);
      if (button.text.trim() !== "+") assert.equal(button.whiteSpace, "nowrap", `${button.text} must preserve complete words on mobile`);
    }
    if (process.env.CHAT_QA_DIR) {
      await delivery.locator(".chat-compose > .chat-compose__actions").scrollIntoViewIfNeeded();
      await delivery.screenshot({ path: path.join(process.env.CHAT_QA_DIR, "chat-group-mobile.png"), fullPage: false });
      await delivery.locator(".chat-message").filter({ hasText: "quota-image-retry.png" }).scrollIntoViewIfNeeded();
      await delivery.screenshot({ path: path.join(process.env.CHAT_QA_DIR, "chat-offline-mobile.png"), fullPage: false });
    }
    assert.deepEqual(errors, []);
    console.log("Chat read marker, preview, sending/sent/failed retry and encrypted text/image offline queues passed");
    await delivery.close();

    const firstTab = await context.newPage();
    const secondTab = await context.newPage();
    const sharedMessages = [];
    const sharedSends = [];
    const prepareSharedApi = async (target) => {
      await target.exposeFunction("__sharedSend", async (payload) => {
        sharedSends.push(payload.clientMessageId);
        const message = { ...payload, id: `server-${payload.clientMessageId}`, senderUserId: "alice", senderDeviceId: "alice-device", protocolVersion: "signal-v1", createdAt: new Date().toISOString() };
        if (!sharedMessages.some((entry) => entry.clientMessageId === payload.clientMessageId)) sharedMessages.push(message);
        return message;
      });
      await target.exposeFunction("__sharedSync", async () => ({ messages: sharedMessages, nextCursor: String(sharedMessages.length) }));
    };
    const installSharedTab = async (target) => {
      await installChat(true, target);
      await target.evaluate(() => {
        window.ALevelApi.sendChatMessage = (payload) => window.__sharedSend(payload);
        window.ALevelApi.syncChatMessages = () => window.__sharedSync();
      });
      await target.locator("#conversationList button").filter({ hasText: "Bob" }).click();
    };
    for (const target of [firstTab, secondTab]) {
      target.on("pageerror", (error) => errors.push(error.message));
      await target.goto(`${base}/pages/chat.html`);
      await prepareSharedApi(target);
      await installSharedTab(target);
    }
    assert.equal(await firstTab.evaluate(() => typeof navigator.locks?.request), "function", "the multi-tab scenario must use real browser Web Locks");
    await Promise.all([firstTab.fill("#messageInput", "Offline from first tab"), secondTab.fill("#messageInput", "Offline from second tab")]);
    await Promise.all([firstTab.click("#sendMessage"), secondTab.click("#sendMessage")]);
    for (const target of [firstTab, secondTab]) await target.waitForFunction(() => !document.querySelector("#sendMessage").disabled && document.querySelector("#messageInput").value === "");
    assert.equal(await firstTab.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("expassway.chat.outbox.v1.alice.item.")).length), 2, "concurrent tabs must preserve both queued message records");
    for (const target of [firstTab, secondTab]) {
      await target.reload();
      await installSharedTab(target);
      await target.waitForFunction(() => document.querySelectorAll(".chat-message__delivery--queued").length === 2);
      assert.equal(await target.locator(".chat-message").filter({ hasText: "Offline from first tab" }).count(), 1);
      assert.equal(await target.locator(".chat-message").filter({ hasText: "Offline from second tab" }).count(), 1);
    }
    await Promise.all([firstTab, secondTab].map((target) => target.evaluate(() => { window.__networkOnline = true; window.dispatchEvent(new Event("online")); })));
    for (const target of [firstTab, secondTab]) await target.waitForFunction(() => !Object.keys(localStorage).some((key) => key.startsWith("expassway.chat.outbox.v1.alice.item.")) && !document.querySelector(".chat-message__delivery--queued, .chat-message__delivery--sending"));
    assert.equal(sharedSends.length, 2, "Web Locks must drain two shared records with one network send each");
    assert.equal(new Set(sharedSends).size, 2);
    assert.equal(sharedMessages.length, 2);
    for (const target of [firstTab, secondTab]) {
      assert.equal(await target.locator(".chat-message").filter({ hasText: "Offline from first tab" }).count(), 1);
      assert.equal(await target.locator(".chat-message").filter({ hasText: "Offline from second tab" }).count(), 1);
      await target.close();
    }
    assert.deepEqual(errors, []);
    console.log("Concurrent offline tabs preserve both queue records, restore both after reload, and drain once with Web Locks");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
