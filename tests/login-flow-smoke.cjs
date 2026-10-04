const assert = require("node:assert/strict");
const { generateKeyPairSync } = require("node:crypto");
const { existsSync } = require("node:fs");
const fs = require("node:fs/promises");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

// Browser plugin not available. This isolated browser suite uses the real login
// page and scripts; auth routes are fixtures and no real email is sent.
async function main() {
  const root = path.resolve(__dirname, "..");
  const errors = [];
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const filename = path.resolve(root, `.${url.pathname}`);
      if (!filename.startsWith(`${root}${path.sep}`)) {
        response.writeHead(403); response.end(); return;
      }
      const contents = await fs.readFile(filename);
      const mime = filename.endsWith(".html") ? "text/html" : filename.endsWith(".js") ? "text/javascript" : filename.endsWith(".css") ? "text/css" : filename.endsWith(".svg") ? "image/svg+xml" : "application/octet-stream";
      response.writeHead(200, { "Content-Type": mime });
      response.end(contents);
    } catch (_error) {
      response.writeHead(404); response.end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://localhost:${server.address().port}`;
  let browser;
  try {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) {
      const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
      if (!existsSync(edge)) throw error;
      browser = await chromium.launch({ headless: true, executablePath: edge });
    }
    async function open({ language = "en", unsupported = false, mockedCredential = false, mobile = false } = {}) {
      const context = await browser.newContext({ locale: language === "en" ? "en-US" : "zh-CN", viewport: { width: mobile ? 390 : 1440, height: mobile ? 844 : 980 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("https://fonts.googleapis.com/**", (route) => route.fulfill({ status: 200, contentType: "text/css", body: "" }));
      await page.route("https://fonts.gstatic.com/**", (route) => route.abort());
      await page.route("**/index.html", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><html><body>Signed in</body></html>" }));
      await page.route("**/api/**", (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "UNEXPECTED_FIXTURE_CALL", message: "Unconfigured fixture route." } }) }));
      await page.addInitScript(({ language, unsupported, mockedCredential }) => {
        if (!sessionStorage.getItem("loginFlowFixtureSeeded")) {
          localStorage.clear();
          localStorage.setItem("alevel.language", language);
          sessionStorage.setItem("loginFlowFixtureSeeded", "1");
        }
        if (unsupported) Object.defineProperty(window, "PublicKeyCredential", { configurable: true, value: undefined });
        if (mockedCredential) {
          window.__passkeyCalls = [];
          window.__passkeyMode = "cancel";
          Object.defineProperty(navigator, "credentials", {
            configurable: true,
            value: { get: async ({ publicKey }) => {
              window.__passkeyCalls.push({ challenge: [...publicKey.challenge], credentialId: [...publicKey.allowCredentials[0].id] });
              if (window.__passkeyMode === "cancel") throw new DOMException("Cancelled by fixture.", "NotAllowedError");
              const bytes = (...values) => new Uint8Array(values).buffer;
              return { id: "AQID", rawId: bytes(1, 2, 3), type: "public-key", response: { clientDataJSON: bytes(4, 5), authenticatorData: bytes(6, 7), signature: bytes(8, 9) }, getClientExtensionResults: () => ({}) };
            } },
          });
        }
      }, { language, unsupported, mockedCredential });
      return { context, page };
    }
    function json(route, data, status = 200) {
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(status < 400 ? { ok: true, data } : { ok: false, error: data }) });
    }
    async function screenshot(page, name) {
      if (!process.env.LOGIN_FLOW_SCREENSHOT_DIR) return;
      await fs.mkdir(process.env.LOGIN_FLOW_SCREENSHOT_DIR, { recursive: true });
      await page.evaluate(() => Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => {}))));
      await page.screenshot({ path: path.join(process.env.LOGIN_FLOW_SCREENSHOT_DIR, name), fullPage: true });
    }

    for (const language of ["en", "zh-CN"]) {
      const { context, page } = await open({ language, mobile: language === "zh-CN" });
      let checks = 0;
      let options = 0;
      let sends = 0;
      await page.route("**/api/auth/email/check", (route) => {
        checks += 1;
        return json(route, { exists: true, hasPasskey: true });
      });
      await page.route("**/api/auth/passkey/options", (route) => { options += 1; return json(route, {}); });
      await page.route("**/api/auth/email/otp", (route) => {
        sends += 1;
        assert.equal(route.request().postDataJSON().email, "google.student@example.test");
        return json(route, { sent: true, retryAfterSeconds: 60 });
      });
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
      assert.match(await page.title(), language === "en" ? /Log in/ : /登录/);
      await page.locator("#emailOtpAddress").fill("Google.Student@Example.Test");
      await page.locator("#emailOtpRequestBtn").click();
      await page.locator("#otpStep").waitFor({ state: "visible" });
      assert.equal(sends, 1, "The first email click must send a code even when the Google account has a Passkey");
      assert.equal(checks, 0, "The email path must not be diverted to account/Passkey discovery");
      assert.equal(options, 0);
      assert.equal(await page.locator("#emailOtpCode").evaluate((input) => input === document.activeElement), true);
      assert.equal(await page.locator("#otpAccountEmail").textContent(), "google.student@example.test");
      assert.equal(await page.locator("body").evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1), true);
      await screenshot(page, `email-one-click-${language}.png`);
      await context.close();
    }

    {
      const { context, page } = await open({ mockedCredential: true });
      const emails = [];
      const verifications = [];
      let releaseOptions;
      let verifyFails = true;
      await page.route("**/api/auth/passkey/options", async (route) => {
        emails.push(route.request().postDataJSON().email);
        if (emails.length === 1) await new Promise((resolve) => { releaseOptions = resolve; });
        return json(route, { publicKey: { challenge: emails.length === 1 ? "AQID" : emails.length === 2 ? "BAUG" : "BwgJ", rpId: "127.0.0.1", allowCredentials: [{ type: "public-key", id: "AQID" }] } });
      });
      await page.route("**/api/auth/passkey/verify", (route) => {
        verifications.push(route.request().postDataJSON());
        return verifyFails
          ? json(route, { code: "INVALID_WEBAUTHN_CHALLENGE", message: "Expired fixture challenge." }, 400)
          : json(route, { token: "passkey-login-token", user: { id: "google-student", displayName: "Student", email: route.request().postDataJSON().email } });
      });
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("#passkeyLoginBtn").isVisible(), true);
      await page.locator("#passkeyLoginBtn").click();
      assert.equal(emails.length, 0, "Invalid email must not start a credential request");
      assert.equal(await page.locator("#emailOtpAddress").getAttribute("aria-invalid"), "true");
      await page.locator("#emailOtpAddress").fill("First@Example.Test");
      await page.locator("#passkeyLoginBtn").click();
      await page.waitForFunction(() => document.getElementById("authStatus").textContent === "Starting Passkey sign-in…");
      assert.equal(await page.locator("#passkeyLoginBtn").isDisabled(), true);
      assert.equal(await page.locator("#emailOtpRequestBtn").isDisabled(), true);
      assert.equal(await page.locator("#emailOtpAddress").evaluate((input) => input.readOnly), true);
      await screenshot(page, "passkey-starting-desktop-en.png");
      assert.ok(releaseOptions);
      releaseOptions();
      await page.waitForFunction(() => document.getElementById("authStatus").classList.contains("bad"));
      assert.equal(await page.locator("#passkeyLoginBtn").isVisible(), true, "Cancellation must leave an actionable retry control");
      assert.equal(await page.locator("#passkeyLoginBtn").isDisabled(), false);
      assert.equal(await page.locator("#emailOtpRequestBtn").isDisabled(), false);
      assert.equal(verifications.length, 0);
      await screenshot(page, "passkey-cancelled-desktop-en.png");
      await page.locator("#emailOtpAddress").fill("Second@Example.Test");
      await page.evaluate(() => { window.__passkeyMode = "success"; });
      await page.locator("#passkeyLoginBtn").click();
      await page.waitForFunction(() => document.getElementById("authStatus").classList.contains("bad") && !document.getElementById("passkeyLoginBtn").disabled);
      assert.equal(verifications.length, 1);
      assert.equal(verifications[0].email, "second@example.test");
      assert.equal(verifications[0].challenge, "BAUG");
      verifyFails = false;
      await page.locator("#passkeyLoginBtn").click();
      await page.waitForURL(`${baseUrl}/index.html`);
      assert.equal(await page.evaluate(() => localStorage.getItem("alevel.authToken")), "passkey-login-token");
      assert.deepEqual(emails, ["first@example.test", "second@example.test", "second@example.test"]);
      assert.equal(verifications[1].challenge, "BwgJ", "Retry must request a new challenge instead of reusing the failed one");
      await context.close();
    }

    // Real Chromium WebAuthn ceremony proves the click reaches the credential
    // API after options arrive; only the authenticator hardware is virtual.
    {
      const { context, page } = await open();
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      await cdp.send("WebAuthn.addCredential", { authenticatorId, credential: { credentialId: Buffer.from([1, 2, 3]).toString("base64"), isResidentCredential: true, rpId: "localhost", privateKey: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"), userHandle: Buffer.from("google-student").toString("base64"), signCount: 0 } });
      let verified = false;
      await page.route("**/api/auth/passkey/options", (route) => json(route, { publicKey: { challenge: "AQID", rpId: "localhost", timeout: 10000, userVerification: "required", allowCredentials: [{ type: "public-key", id: "AQID", transports: ["internal"] }] } }));
      await page.route("**/api/auth/passkey/verify", (route) => {
        const body = route.request().postDataJSON();
        const clientData = JSON.parse(Buffer.from(body.credential.response.clientDataJSON, "base64url").toString());
        assert.equal(body.email, "native@example.test");
        assert.equal(clientData.type, "webauthn.get");
        assert.equal(clientData.origin, baseUrl);
        assert.equal(clientData.challenge, "AQID");
        assert.ok(body.credential.response.authenticatorData && body.credential.response.signature);
        verified = true;
        return json(route, { token: "native-passkey-token", user: { id: "google-student", displayName: "Native", email: body.email } });
      });
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
      await page.locator("#emailOtpAddress").fill("Native@Example.Test");
      await page.locator("#passkeyLoginBtn").click();
      await page.waitForURL(`${baseUrl}/index.html`);
      assert.equal(verified, true);
      assert.equal(await page.evaluate(() => localStorage.getItem("alevel.authToken")), "native-passkey-token");
      await context.close();
    }

    {
      const { context, page } = await open({ language: "zh-CN", unsupported: true, mobile: true });
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("#passkeyLoginBtn").evaluate((button) => button.hidden), true);
      assert.equal(await page.locator("#passkeyLoginBtn").isHidden(), true, "Auth CSS must respect hidden on an unavailable Passkey button");
      assert.equal(await page.locator("#emailOtpRequestBtn").isVisible(), true);
      await screenshot(page, "passkey-unavailable-mobile-zh.png");
      await context.close();
    }
    assert.deepEqual(errors, [], "Login flows must not fail with uncaught browser exceptions");
    console.log("Login flow smoke passed: one-click email, independent native Passkey, cancellation/fresh-challenge retry, and unsupported-browser visibility.");
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
