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

      await page.locator("#googleLoginBtn").click();
      await page.locator("#authStatus").waitFor({ state: "visible" });
      assert.equal(await page.locator("#authStatus").textContent(), "Google login has not been configured yet.");
      assert.equal(await page.locator("#googleLoginBtn img").count(), 1);
      await context.close();
    }

    {
      const { context, page } = await newPage(browser, "zh-CN");
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      assert.equal(await page.locator(".auth-brand").textContent(), "ExPassway");
      assert.equal(await page.locator("#loginTitle").textContent(), "登录或注册");
      assert.equal(await page.locator("[data-language-toggle]").textContent(), "EN");
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

    console.log("Login and language smoke checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
