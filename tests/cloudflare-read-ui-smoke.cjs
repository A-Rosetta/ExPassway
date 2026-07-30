const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.WORKER_UI_BASE_URL || "http://127.0.0.1:8787";
const user = {
  id: "00000000-0000-0000-0000-000000000001",
  email: "student@example.com",
  displayName: "Student",
  role: "student",
  grade: "IGCSE",
  targetScore: 80,
  language: "en",
  hasPassword: false,
  pet: {
    enabled: false,
    skin: "codex-glass",
    position: { x: 0.92, y: 0.84 },
  },
};

function json(route, data) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, data }),
  });
}

async function prepareContext(browser) {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await context.addInitScript((currentUser) => {
    localStorage.clear();
    localStorage.setItem("alevel.authToken", "worker-read-test-token");
    localStorage.setItem("alevel.userId", currentUser.id);
    localStorage.setItem("alevel.userProfile", JSON.stringify(currentUser));
    localStorage.setItem("alevel.language", "en");
  }, user);
  await context.route("**/api/auth/me", (route) => json(route, user));
  await context.route("**/api/users/*/practices?*", (route) => json(route, []));
  return context;
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    {
      const context = await prepareContext(browser);
      const page = await context.newPage();
      const failedCatalog = [];
      page.on("response", (response) => {
        const url = new URL(response.url());
        if (url.pathname.startsWith("/api/catalog/") && response.status() !== 200) {
          failedCatalog.push(`${response.status()} ${url.pathname}`);
        }
      });
      await page.goto(`${baseUrl}/`, { waitUntil: "networkidle" });
      await page.locator(".course-card:not(.course-card--loading)").first().waitFor();
      assert.equal(await page.locator(".course-card:not(.course-card--loading)").count(), 4);
      assert.match(await page.locator(".course-card--biology .course-card__stats").textContent(), /41.*1,?640/);
      assert.match(await page.locator("#backendStatus").textContent(), /d1/i);
      assert.deepEqual(failedCatalog, []);
      await context.close();
    }

    {
      const context = await prepareContext(browser);
      const page = await context.newPage();
      await page.addInitScript(() => {
        localStorage.setItem("alevel.selection", JSON.stringify({
          grade: "IGCSE",
          board: "CIE",
          subject: "IGCSE Biology",
          subjectCode: "0610",
          paper: "MCQ",
        }));
      });
      await page.goto(`${baseUrl}/pages/generate.html`, { waitUntil: "networkidle" });
      await page.locator(".paper-set-item").first().waitFor();
      assert.equal(await page.locator(".paper-set-item").count(), 41);
      assert.match(await page.locator("#paperYearResultCount").textContent(), /41/);

      await page.locator('[data-paper-id="0610_s23_qp_22"]').click();
      await page.locator("#startModePageBtn").click();
      await page.locator("#questionSlot .question").first().waitFor();
      assert.equal(await page.locator("#questionJumpPanel [data-jump-index]").count(), 40);
      assert.match(await page.locator("#questionSlot .question h4").first().textContent(), /Q1/);
      const image = page.locator("#questionSlot .question-image img").first();
      await image.waitFor();
      await page.waitForFunction(() => document.querySelector("#questionSlot .question-image img")?.naturalWidth > 10);
      assert.equal(await image.getAttribute("src"), "/assets/exam-question-images/cie-igcse-biology-0610/0610_s23_qp_22/q01.png");
      await context.close();
    }

    console.log("Cloudflare D1 read UI smoke checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
