const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.STUDENT_UI_BASE_URL || "http://127.0.0.1/alevel";

async function newPage(browser, locale, savedLanguage) {
  const context = await browser.newContext({ locale });
  const page = await context.newPage();
  await page.addInitScript((language) => {
    localStorage.clear();
    if (language) localStorage.setItem("alevel.language", language);
  }, savedLanguage);
  await page.route("**/api/auth/google/start", (route) => route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ error: { message: "Google login is not configured yet." } }),
  }));
  await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
  return { context, page };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    {
      const { context, page } = await newPage(browser, "en-US");
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(await page.locator(".auth-brand").textContent(), "ExPassway");
      assert.equal(await page.locator(".auth-brand").evaluate((element) => getComputedStyle(element).textTransform), "none");
      assert.equal(await page.locator("#loginTitle").textContent(), "Log in or sign up");
      assert.equal(await page.locator("[data-language-toggle]").textContent(), "中文");
      assert.equal(await page.locator("#emailOtpRequestBtn").textContent(), "Continue with email");

      await page.locator("#googleLoginBtn").click();
      await page.locator("#authStatus").waitFor({ state: "visible" });
      assert.equal(await page.locator("#authStatus").textContent(), "Google login has not been configured yet.");
      assert.equal(await page.locator("#googleLoginBtn img").count(), 1);
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      let otpRequested = false;
      await page.addInitScript(() => {
        if (sessionStorage.getItem("emailOtpSmokeSeeded")) return;
        localStorage.clear();
        sessionStorage.setItem("emailOtpSmokeSeeded", "1");
      });
      await page.route("**/api/auth/email/otp", (route) => {
        otpRequested = true;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: { sent: true } }),
        });
      });
      await page.route("**/api/auth/email/verify", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            token: "email-test-token",
            user: { id: "student-1", email: "student@example.com", displayName: "Student", role: "student" },
          },
        }),
      }));
      await page.route("**/api/auth/me", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { id: "student-1", email: "student@example.com", displayName: "Student", role: "student" },
        }),
      }));
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });

      await page.locator("#emailOtpAddress").fill("not-an-email");
      await page.locator("#emailOtpRequestBtn").click();
      assert.equal(otpRequested, false);
      assert.equal(await page.locator("#emailOtpAddressError").textContent(), "Enter a valid email address.");

      await page.locator("#emailOtpAddress").fill("Student@Example.com");
      await page.locator("#emailOtpRequestBtn").click();
      await page.locator("#otpStep").waitFor({ state: "visible" });
      assert.equal(otpRequested, true);
      assert.equal(await page.locator("#otpAccountEmail").textContent(), "student@example.com");
      assert.equal(await page.locator("#authStatus").textContent(), "Verification code sent. Check your email.");

      await page.locator("#emailOtpCode").fill("123456");
      await page.locator("#emailOtpVerifyBtn").click();
      await page.waitForURL(`${baseUrl}/index.html`);
      assert.equal(await page.evaluate(() => localStorage.getItem("alevel.authToken")), "email-test-token");
      await context.close();
    }

    {
      const { context, page } = await newPage(browser, "zh-CN");
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      assert.equal(await page.locator(".auth-brand").textContent(), "ExPassway");
      assert.equal(await page.locator("#loginTitle").textContent(), "登录或注册");
      assert.equal(await page.locator("[data-language-toggle]").textContent(), "EN");
      assert.equal(await page.locator("#emailOtpRequestBtn").textContent(), "使用邮箱继续");
      await context.close();
    }

    {
      const { context, page } = await newPage(browser, "zh-CN", "en");
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(await page.locator("#loginTitle").textContent(), "Log in or sign up");
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      let exchangeRequested = false;
      await page.addInitScript(() => localStorage.clear());
      await page.route("**/api/auth/google", (route) => {
        exchangeRequested = true;
        return route.abort();
      });
      await page.goto(`${baseUrl}/pages/login.html#access_token=unsolicited`, { waitUntil: "networkidle" });
      assert.equal(exchangeRequested, false);
      assert.match(await page.locator("#authStatus").textContent(), /could not be verified/);
      assert.equal(new URL(page.url()).hash, "");
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (sessionStorage.getItem("loginCallbackSmokeSeeded")) return;
        localStorage.clear();
        sessionStorage.setItem("loginCallbackSmokeSeeded", "1");
        sessionStorage.setItem("alevel.googleAuthPending", String(Date.now()));
      });
      await page.route("**/api/auth/google", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            token: "admin-test-token",
            user: { id: "admin-1", displayName: "Admin User", role: "admin" },
          },
        }),
      }));
      await page.route("**/api/auth/me", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { id: "admin-1", displayName: "Admin User", role: "admin" },
        }),
      }));
      await page.goto(`${baseUrl}/pages/login.html#access_token=verified-admin-token`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(`${baseUrl}/index.html`);
      assert.equal(await page.evaluate(() => localStorage.getItem("alevel.authToken")), "admin-test-token");
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.clear());
      await page.route("**/api/auth/google/start", (route) => route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Google login is not configured yet." } }),
      }));
      await page.goto(`${baseUrl}/pages/admin-login.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(await page.locator(".auth-brand").textContent(), "ExPassway");
      assert.equal(await page.locator("#adminLoginTitle").textContent(), "Administrator login");
      assert.equal(await page.locator("#adminGoogleLoginBtn img").count(), 1);
      await page.locator("#adminGoogleLoginBtn").click();
      await page.locator("#authStatus").waitFor({ state: "visible" });
      assert.equal(await page.locator("#authStatus").textContent(), "Google login has not been configured yet.");
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("alevel.authToken", "admin-test-token");
      });
      await page.route("**/api/auth/me", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { id: "admin-1", displayName: "Admin User", role: "admin" },
        }),
      }));
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(`${baseUrl}/index.html`);
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.clear();
        localStorage.setItem("alevel.authToken", "admin-test-token");
      });
      await page.route("**/api/auth/me", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { id: "admin-1", displayName: "Admin User", role: "admin" },
        }),
      }));
      await page.goto(`${baseUrl}/pages/admin-login.html`, { waitUntil: "domcontentloaded" });
      await page.waitForURL(`${baseUrl}/index.html`);
      await context.close();
    }

    console.log("Login and language smoke checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
