const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

// Browser plugin not available. Real homepage/settings scripts run against
// local API fixtures; registration and chat navigation never reach production.
async function main() {
  const root = path.resolve(__dirname, "..");
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const filename = path.resolve(root, `.${url.pathname}`);
      if (!filename.startsWith(`${root}${path.sep}`)) { response.writeHead(403); response.end(); return; }
      const contents = await fs.readFile(filename);
      const mime = filename.endsWith(".html") ? "text/html" : filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : filename.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime }); response.end(contents);
    } catch (_error) { response.writeHead(404); response.end(); }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  const createdAt = "2026-10-01T00:00:00.000Z";
  const original = { id: "original", credentialId: "original-shared-credential", createdAt, revoked: false, chatUnlock: true, chatSyncRequired: false, canRevoke: false, revokeBlockedReason: "LAST_CHAT_PASSKEY" };
  const legacy = { id: "legacy", credentialId: "legacy-credential/+", createdAt, revoked: false, chatUnlock: false, chatSyncRequired: true, canRevoke: false, revokeBlockedReason: "LAST_CHAT_PASSKEY" };
  const shared = { id: "shared", credentialId: "another-shared-credential", createdAt, revoked: false, chatUnlock: true, chatSyncRequired: false, canRevoke: true };
  let browser;
  const pageErrors = [];
  try {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
      if (!existsSync(edge)) throw error;
      browser = await chromium.launch({ headless: true, executablePath: edge });
    }
    async function open({ language, mobile, rows }) {
      const context = await browser.newContext({ locale: language === "en" ? "en-US" : "zh-CN", viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 980 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const calls = { registrations: 0, creates: 0, revocations: 0, vaultReads: 0 };
      const svgResponses = new Map();
      page.on("pageerror", (error) => pageErrors.push(error.message));
      page.on("response", (response) => {
        if (new URL(response.url()).pathname.endsWith(".svg")) svgResponses.set(response.url(), response);
      });
      await page.exposeFunction("__recordUnexpectedCreate", () => { calls.creates += 1; });
      await page.addInitScript((language) => {
        localStorage.clear();
        localStorage.setItem("alevel.authToken", "settings-fixture-token");
        localStorage.setItem("alevel.language", language);
        localStorage.setItem("alevel.pet.enabled", "0");
        Object.defineProperty(navigator, "credentials", { configurable: true, value: { create: async () => { await window.__recordUnexpectedCreate(); throw new Error("This existing chat must be unlocked before registering another key."); } } });
      }, language);
      await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
      await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
      await page.route("**/api/**", async (route) => {
        const url = new URL(route.request().url());
        const method = route.request().method();
        let data;
        if (url.pathname === "/api/auth/me" && method === "GET") data = { id: "chat-owner", email: "student@example.test", displayName: "History Owner", role: "student", language, hasPassword: false, pet: { enabled: false, skin: "codex-glass", position: { x: 0.9, y: 0.8 } } };
        else if (url.pathname === "/api/catalog/subjects") data = [];
        else if (url.pathname === "/api/chat/conversations" && method === "GET") data = [];
        else if (url.pathname === "/api/auth/me/passkeys" && method === "GET") data = rows;
        else if (url.pathname === "/api/chat/account/vault") { calls.vaultReads += 1; data = { userId: "chat-owner", keyVersion: "1", credentialId: original.credentialId, ciphertext: "retained-fixture-vault" }; }
        else if (url.pathname.startsWith("/api/auth/me/passkeys/") && method === "DELETE") { calls.revocations += 1; data = { revoked: true }; }
        else if (url.pathname === "/api/auth/me/passkeys/options" || url.pathname === "/api/auth/me/passkeys/verify") { calls.registrations += 1; data = {}; }
        else throw new Error(`Unexpected settings fixture API: ${method} ${url.pathname}`);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, data }) });
      });
      await page.route("**/pages/chat.html?**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body>Existing chat unlock destination</body></html>" }));
      await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
      await page.locator("[data-chat-entry]").waitFor({ state: "visible" });
      const chatIcon = page.locator(".chat-entry__icon");
      assert.equal(await chatIcon.isVisible(), true, "The chat icon must be visible on both desktop and mobile.");
      const iconAppearance = await chatIcon.evaluate((icon) => {
        const rect = icon.getBoundingClientRect();
        const style = getComputedStyle(icon);
        const background = style.backgroundColor.match(/^rgba?\(([^)]+)\)$/);
        const colorParts = background?.[1].split(",").map(Number) || [];
        return { width: rect.width, height: rect.height, opacity: Number(style.opacity),
          backgroundAlpha: colorParts.length === 3 ? 1 : colorParts[3] || 0,
          maskImage: style.maskImage === "none" ? style.webkitMaskImage : style.maskImage };
      });
      assert(iconAppearance.width > 0 && iconAppearance.height > 0 && iconAppearance.opacity > 0,
        "The chat icon must occupy visible space.");
      assert(iconAppearance.backgroundAlpha > 0, "The mask needs a nontransparent foreground color.");
      const maskUrl = iconAppearance.maskImage.match(/^url\(["']?([^"')]+)["']?\)$/)?.[1];
      assert(maskUrl, "The chat icon must resolve a mask image URL.");
      const maskResponse = svgResponses.get(maskUrl);
      assert(maskResponse?.ok(), "The browser must successfully load the actual SVG used by the icon mask.");
      assert.match(maskResponse.headers()["content-type"], /image\/svg\+xml/);
      const maskBytes = await maskResponse.body();
      assert(maskBytes.length > 0, "The mask response must contain SVG bytes.");
      const usableSvg = await page.evaluate((source) => {
        const svg = new DOMParser().parseFromString(source, "image/svg+xml");
        return !svg.querySelector("parsererror") && svg.documentElement.localName === "svg"
          && Boolean(svg.querySelector("path, rect, circle, ellipse, polygon, polyline, text, use"));
      }, maskBytes.toString("utf8"));
      assert(usableSvg, "The loaded icon mask must be a valid SVG with drawable content.");
      assert.equal(await page.locator("[data-chat-entry]").getAttribute("href"), "pages/chat.html");
      assert.equal(await page.locator("[data-chat-entry]").getAttribute("aria-label"), language === "en" ? "Chat" : "聊天");
      if (process.env.LOGIN_FLOW_SCREENSHOT_DIR) {
        await fs.mkdir(process.env.LOGIN_FLOW_SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(process.env.LOGIN_FLOW_SCREENSHOT_DIR, `chat-icon-home-${language}.png`), fullPage: false });
      }
      if (mobile) await page.locator("#homeMenuToggle").click();
      await page.locator("#openProfile").click();
      await page.locator("#profileDialog").waitFor({ state: "visible" });
      await page.waitForFunction((length) => document.querySelectorAll(".profile-passkey-row").length === length, rows.length);
      assert.equal(await page.title(), "ExPassway");
      assert.equal(await page.locator("#passkeySettings").isVisible(), true);
      return { page, context, calls };
    }
    async function screenshot(page, filename) {
      if (!process.env.LOGIN_FLOW_SCREENSHOT_DIR) return;
      await fs.mkdir(process.env.LOGIN_FLOW_SCREENSHOT_DIR, { recursive: true });
      await page.locator("#passkeySettings").scrollIntoViewIfNeeded();
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      await page.screenshot({ path: path.join(process.env.LOGIN_FLOW_SCREENSHOT_DIR, filename), fullPage: true });
    }
    for (const language of ["en", "zh-CN"]) {
      const { page, context, calls } = await open({ language, mobile: language === "zh-CN", rows: [original, legacy, shared] });
      const rowElements = page.locator(".profile-passkey-row");
      const labels = await rowElements.allTextContents();
      assert.ok(labels.every((text) => !text.includes("Account sign-in") && !text.includes("Unlocks Secure Chat") && !text.includes("账号登录") && !text.includes("可解锁安全聊天")), "The account Passkey list must not split credentials into login/chat purposes");
      assert.equal(await rowElements.nth(0).locator("button").isDisabled(), true);
      assert.equal(await rowElements.nth(1).locator("button").last().isDisabled(), true);
      assert.equal(await rowElements.nth(2).locator("button").isDisabled(), false);
      await rowElements.nth(0).locator("button").evaluate((button) => button.click());
      assert.equal(calls.revocations, 0, "A protected history key must not issue a revoke request");
      assert.match(await rowElements.nth(0).locator("button").getAttribute("title"), language === "en" ? /existing encrypted chats/ : /已有的加密聊天/);
      assert.equal(await rowElements.nth(1).locator("button").first().textContent(), language === "en" ? "Sync chat access" : "同步聊天访问");
      await screenshot(page, `shared-passkey-settings-${language}.png`);
      await rowElements.nth(1).locator("button").first().click();
      await page.waitForURL(`${baseUrl}/pages/chat.html?passkey=${encodeURIComponent(legacy.credentialId)}`);
      assert.equal(calls.registrations, 0);
      assert.equal(calls.creates, 0);
      assert.equal(calls.revocations, 0);
      await context.close();
    }
    for (const rows of [[original, legacy, shared], [{ ...legacy, chatSyncRequired: false, chatUnlock: false }]]) {
      const { page, context, calls } = await open({ language: "en", mobile: false, rows });
      await page.locator("#addPasskeyBtn").click();
      await page.waitForURL(`${baseUrl}/pages/chat.html?passkeys=add`);
      assert.equal(calls.registrations, 0, "Adding a Passkey to an existing vault must begin at chat unlock, never login-only registration");
      assert.equal(calls.creates, 0);
      assert.equal(calls.revocations, 0);
      if (!rows.some((row) => row.chatUnlock || row.chatSyncRequired)) assert.equal(calls.vaultReads, 1, "Existing-vault protection must also work without row capability flags");
      await context.close();
    }
    assert.deepEqual(pageErrors, []);
    console.log("Passkey settings browser smoke passed: one credential list, protected history keys, Sync chat access, and Add Passkey through existing-chat unlock.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
