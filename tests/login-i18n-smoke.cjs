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
      assert.equal(await page.locator(".login-shell > .login-welcome").count(), 1);
      assert.equal(await page.locator(".login-shell > .login-form-panel").count(), 1);
      assert.equal(await page.locator(".login-welcome #visitorModeBtn").count(), 1);

      const lightMaterial = await page.evaluate(() => {
        document.documentElement.removeAttribute("data-theme");
        const body = getComputedStyle(document.body);
        const shell = getComputedStyle(document.querySelector(".login-shell"));
        const input = getComputedStyle(document.querySelector("#emailOtpAddress"));
        const themeToggle = getComputedStyle(document.querySelector("#themeToggle"));
        const languageToggle = getComputedStyle(document.querySelector("[data-language-toggle]"));
        const controls = getComputedStyle(document.querySelector(".auth-page-controls"));
        return {
          bodyBackground: body.backgroundColor,
          shellRadius: shell.borderRadius,
          shellBlur: shell.backdropFilter || shell.webkitBackdropFilter,
          shellShadow: shell.boxShadow,
          inputRadius: input.borderRadius,
          inputShadow: input.boxShadow,
          controlsGap: controls.gap,
          themeToggleHeight: themeToggle.height,
          themeToggleRadius: themeToggle.borderRadius,
          themeToggleShadow: themeToggle.boxShadow,
          languageToggleHeight: languageToggle.height,
          languageToggleRadius: languageToggle.borderRadius,
        };
      });
      assert.equal(lightMaterial.bodyBackground, "rgb(230, 234, 227)");
      assert.equal(lightMaterial.shellRadius, "32px");
      assert.equal(lightMaterial.shellBlur, "none");
      assert.match(lightMaterial.shellShadow, /-14px -14px 30px/);
      assert.equal(lightMaterial.inputRadius, "16px");
      assert.match(lightMaterial.inputShadow, /inset/);
      assert.equal(lightMaterial.controlsGap, "6px");
      assert.equal(lightMaterial.themeToggleHeight, "44px");
      assert.equal(lightMaterial.themeToggleRadius, "16px");
      assert.equal(lightMaterial.themeToggleShadow, "none");
      assert.equal(lightMaterial.languageToggleHeight, "44px");
      assert.equal(lightMaterial.languageToggleRadius, "16px");

      await page.locator("#emailOtpRequestBtn").evaluate((button) => {
        document.documentElement.setAttribute("data-theme", "dark");
        button.disabled = true;
      });
      await page.waitForTimeout(350);
      const darkMaterial = await page.evaluate(() => {
        const body = getComputedStyle(document.body);
        const shell = getComputedStyle(document.querySelector(".login-shell"));
        const input = getComputedStyle(document.querySelector("#emailOtpAddress"));
        const submit = document.querySelector("#emailOtpRequestBtn");
        const disabledSubmit = getComputedStyle(submit);
        return {
          bodyBackground: body.backgroundColor,
          bodyBackgroundImage: body.backgroundImage,
          shellBorder: shell.borderTopWidth,
          shellBlur: shell.backdropFilter || shell.webkitBackdropFilter,
          shellBackground: shell.backgroundColor,
          inputBackground: input.backgroundColor,
          disabledSubmitShadow: disabledSubmit.boxShadow,
        };
      });
      assert.equal(darkMaterial.bodyBackground, "rgb(20, 23, 28)");
      assert.match(darkMaterial.bodyBackgroundImage, /radial-gradient/);
      assert.doesNotMatch(darkMaterial.bodyBackgroundImage, /linear-gradient/);
      assert.equal(darkMaterial.shellBorder, "1px");
      assert.match(darkMaterial.shellBlur, /blur\(20px\).*saturate\(1\.6\)/);
      assert.equal(darkMaterial.shellBackground, "rgba(255, 255, 255, 0.07)");
      assert.equal(darkMaterial.inputBackground, "rgba(0, 0, 0, 0.3)");
      assert.equal(darkMaterial.disabledSubmitShadow, "none");

      await page.locator("#googleLoginBtn").click();
      await page.locator("#authStatus").waitFor({ state: "visible" });
      assert.equal(await page.locator("#authStatus").textContent(), "Google login has not been configured yet.");
      assert.equal(await page.locator("#googleLoginBtn img").count(), 1);
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      let otpRequestCount = 0;
      await page.addInitScript(() => {
        if (sessionStorage.getItem("emailOtpSmokeSeeded")) return;
        localStorage.clear();
        sessionStorage.setItem("emailOtpSmokeSeeded", "1");
      });
      await page.route("**/api/auth/email/otp", (route) => {
        otpRequestCount += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: { sent: true, retryAfterSeconds: 60 } }),
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
      assert.equal(otpRequestCount, 0);
      assert.equal(await page.locator("#emailOtpAddressError").textContent(), "Enter a valid email address.");

      await page.locator("#emailOtpAddress").fill("Student@Example.com");
      await page.locator("#emailOtpRequestBtn").click();
      await page.locator("#otpStep").waitFor({ state: "visible" });
      assert.equal(await page.locator("body").evaluate((element) => element.classList.contains("is-otp-step")), true);
      assert.equal(otpRequestCount, 1);
      assert.equal(await page.locator("#otpAccountEmail").textContent(), "student@example.com");
      assert.equal(await page.locator("#authStatus").textContent(), "Verification code sent. Check your email.");
      assert.equal(await page.locator(".auth-otp-field > #emailOtpResendBtn").count(), 1);
      assert.equal(await page.locator("#emailOtpResendBtn").isDisabled(), true);
      assert.equal(await page.locator("#emailOtpResendBtn").textContent(), "Resend in 60s");
      await page.locator("#emailOtpBackBtn").click();
      assert.equal(await page.locator("body").evaluate((element) => element.classList.contains("is-otp-step")), false);
      assert.equal(await page.locator("#emailStep").isVisible(), true);
      await page.locator("#emailOtpRequestBtn").click();
      await page.locator("#otpStep").waitFor({ state: "visible" });
      assert.equal(otpRequestCount, 2);

      await page.locator("#emailOtpCode").fill("123456");
      await page.locator("#emailOtpVerifyBtn").click();
      await page.waitForURL(`${baseUrl}/index.html`);
      assert.equal(await page.evaluate(() => localStorage.getItem("alevel.authToken")), "email-test-token");
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "zh-CN", viewport: { width: 390, height: 844 } });
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.clear());
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("#loginTitle").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
      assert.equal(await page.locator("body").evaluate(() => document.body.scrollWidth <= document.documentElement.clientWidth + 1), true);
      assert.equal(await page.locator("#googleLoginBtn").isVisible(), true);
      assert.equal(await page.locator("#emailOtpRequestBtn").isVisible(), true);
      assert.equal(await page.locator("#visitorModeBtn").isVisible(), true);
      assert.equal(await page.locator(".login-shell").evaluate((element) => getComputedStyle(element).borderRadius), "24px");
      assert.equal(await page.locator(".auth-page-controls").evaluate((element) => getComputedStyle(element).gap), "2px");
      assert.equal(await page.locator("#themeToggle").evaluate((element) => getComputedStyle(element).width), "40px");
      assert.equal(await page.locator("#themeToggle").evaluate((element) => getComputedStyle(element).height), "40px");
      assert.equal(await page.locator(".home-theme-lamp").evaluate((element) => getComputedStyle(element).width), "26px");
      assert.equal(await page.locator(".login-shell").evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length), 1);
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
      await page.addInitScript(() => {
        if (sessionStorage.getItem("adminEmailOtpSmokeSeeded")) return;
        localStorage.clear();
        sessionStorage.setItem("adminEmailOtpSmokeSeeded", "1");
      });
      await page.route("**/api/auth/google/start", (route) => route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: { message: "Google login is not configured yet." } }),
      }));
      await page.goto(`${baseUrl}/pages/admin-login.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("html").getAttribute("lang"), "en");
      assert.equal(await page.locator(".auth-brand").textContent(), "ExPassway");
      assert.equal(await page.locator("#adminLoginTitle").textContent(), "Administrator login");
      assert.equal(await page.locator("#adminLoginTitle").evaluate((element) => element.scrollWidth <= element.clientWidth + 1), true);
      assert.equal(await page.locator("#adminGoogleLoginBtn img").count(), 1);
      assert.equal(await page.locator("#adminEmailOtpRequestBtn").textContent(), "Continue with email as administrator");
      await page.locator("#adminGoogleLoginBtn").click();
      await page.locator("#authStatus").waitFor({ state: "visible" });
      assert.equal(await page.locator("#authStatus").textContent(), "Google login has not been configured yet.");
      await context.close();
    }

    for (const role of ["admin", "student"]) {
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (sessionStorage.getItem("adminEmailOtpRoleSmokeSeeded")) return;
        localStorage.clear();
        sessionStorage.setItem("adminEmailOtpRoleSmokeSeeded", "1");
      });
      let otpRequestCount = 0;
      await page.route("**/api/auth/email/otp", (route) => {
        otpRequestCount += 1;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, data: { sent: true, retryAfterSeconds: 60 } }),
        });
      });
      await page.route("**/api/auth/email/verify", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: {
            token: `${role}-email-token`,
            user: { id: `${role}-1`, email: `${role}@example.com`, displayName: role, role },
          },
        }),
      }));
      await page.route("**/api/auth/me", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          data: { id: `${role}-1`, email: `${role}@example.com`, displayName: role, role },
        }),
      }));
      await page.goto(`${baseUrl}/pages/admin-login.html`, { waitUntil: "networkidle" });
      await page.locator("#adminEmailOtpAddress").fill(`${role}@example.com`);
      await page.locator("#adminEmailOtpRequestBtn").click();
      await page.locator("#adminOtpStep").waitFor({ state: "visible" });
      assert.equal(otpRequestCount, 1);
      assert.equal(await page.locator(".auth-otp-field > #adminEmailOtpResendBtn").count(), 1);
      assert.equal(await page.locator("#adminEmailOtpResendBtn").isDisabled(), true);
      assert.equal(await page.locator("#adminEmailOtpResendBtn").textContent(), "Resend in 60s");
      await page.locator("#adminEmailOtpCode").fill("123456");
      await page.locator("#adminEmailOtpVerifyBtn").click();
      if (role === "admin") {
        await page.waitForURL(`${baseUrl}/index.html`);
        assert.equal(await page.evaluate(() => localStorage.getItem("alevel.authToken")), "admin-email-token");
      } else {
        await page.waitForFunction(() => (
          document.querySelector("#authStatus")?.textContent === "The current account is not an administrator."
        ));
        assert.equal(await page.locator("#authStatus").textContent(), "The current account is not an administrator.");
        assert.equal(await page.evaluate(() => localStorage.getItem("alevel.authToken")), null);
      }
      await context.close();
    }

    {
      const context = await browser.newContext({ locale: "en-US", colorScheme: "light" });
      const page = await context.newPage();
      await page.addInitScript(() => {
        if (sessionStorage.getItem("authThemeSmokeSeeded")) return;
        localStorage.clear();
        sessionStorage.setItem("authThemeSmokeSeeded", "1");
      });
      await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
      assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
      assert.equal(await page.evaluate(() => localStorage.getItem("app-theme")), null);
      assert.match(await page.locator("#themeToggle").getAttribute("aria-label"), /light mode/i);
      await page.locator("#themeToggle").click();
      assert.equal(await page.locator("html").getAttribute("data-theme"), null);
      assert.equal(await page.evaluate(() => localStorage.getItem("app-theme")), "light");
      assert.match(await page.locator("#themeToggle").getAttribute("aria-label"), /dark mode/i);
      await page.reload({ waitUntil: "networkidle" });
      assert.equal(await page.locator("html").getAttribute("data-theme"), null);
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
