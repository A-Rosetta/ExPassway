const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.BIOLOGY_TEST_BASE_URL || "http://127.0.0.1/alevel";
const token = process.env.BIOLOGY_TEST_TOKEN || "";
const adminToken = process.env.BIOLOGY_ADMIN_TEST_TOKEN || "";

async function runViewport(browser, viewport) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript((authToken) => {
    localStorage.setItem("alevel.authToken", authToken);
  }, token);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${baseUrl}/pages/biology.html`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".chapter-band").count(), 3);
  assert.equal(await page.locator(".chapter-section-row").count(), 13);

  const documentWidth = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(documentWidth.scroll <= documentWidth.client + 1, JSON.stringify(documentWidth));

  const overlaps = await page.locator(".chapter-section-row").evaluateAll((rows) => rows.flatMap((row) => {
    const children = [...row.children].filter((child) => {
      const style = getComputedStyle(child);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    return children.flatMap((left, index) => children.slice(index + 1).filter((right) => {
      const a = left.getBoundingClientRect();
      const b = right.getBoundingClientRect();
      return Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2
        && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2;
    }).map(() => row.querySelector("strong")?.textContent || "unknown"));
  }));
  assert.deepEqual(overlaps, []);

  await page.locator(".chapter-start:not(:disabled)").first().click();
  await page.locator("#practicePanel").waitFor({ state: "visible" });
  assert.equal(await page.locator("#chapterList").isVisible(), false);
  const questionImage = page.locator("#chapterQuestion img");
  await questionImage.waitFor({ state: "visible" });
  const imagePixels = await questionImage.evaluate((image) => ({
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));
  assert.ok(imagePixels.width > 10, JSON.stringify(imagePixels));
  assert.ok(imagePixels.height > 10, JSON.stringify(imagePixels));
  assert.deepEqual(pageErrors, []);

  const name = viewport.width > 700 ? "desktop" : "mobile";
  await page.screenshot({ path: `/var/tmp/biology-chapter-${name}.png`, fullPage: true });
  console.log(JSON.stringify({ name, documentWidth, imagePixels, pageErrors }));
  await context.close();
}

async function runHomepageEntry(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript((authToken) => {
    localStorage.setItem("alevel.authToken", authToken);
  }, token);
  const page = await context.newPage();
  await page.goto(`${baseUrl}/index.html`, { waitUntil: "networkidle" });
  const biologyCard = page.locator(".course-card--biology");
  assert.equal(await biologyCard.count(), 1);
  await biologyCard.click();
  await page.waitForURL(/\/pages\/biology\.html$/);
  assert.equal(await page.locator(".chapter-band").count(), 3);
  await page.locator("#paperMode").click();
  await page.waitForURL(/\/pages\/generate\.html$/);
  const selection = await page.evaluate(() => JSON.parse(localStorage.getItem("alevel.selection") || "{}"));
  assert.equal(selection.subjectCode, "0610");
  assert.equal(selection.subject, "IGCSE Biology");
  console.log(JSON.stringify({ name: "homepage-entry", selection }));
  await context.close();
}

async function runAdminViewport(browser, viewport) {
  if (!adminToken) return;
  const context = await browser.newContext({ viewport });
  await context.addInitScript((authToken) => {
    localStorage.setItem("alevel.authToken", authToken);
  }, adminToken);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${baseUrl}/pages/curriculum-review.html`, { waitUntil: "networkidle" });
  assert.equal(await page.locator(".curriculum-mapping-item").count(), 100);
  assert.equal(await page.locator(".curriculum-mapping-item").first().locator("[data-book-section]").count(), 1);
  assert.equal(await page.locator(".curriculum-mapping-item").first().locator("[data-curriculum-section]").count(), 1);
  const documentWidth = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  assert.ok(documentWidth.scroll <= documentWidth.client + 1, JSON.stringify(documentWidth));
  assert.deepEqual(pageErrors, []);
  const name = viewport.width > 700 ? "desktop" : "mobile";
  await page.screenshot({ path: `/var/tmp/biology-admin-${name}.png`, fullPage: false });
  console.log(JSON.stringify({ name: `admin-${name}`, documentWidth, pageErrors }));
  await context.close();
}

async function main() {
  if (!token) throw new Error("BIOLOGY_TEST_TOKEN is required.");
  const browser = await chromium.launch({ headless: true });
  try {
    await runViewport(browser, { width: 1440, height: 900 });
    await runViewport(browser, { width: 390, height: 844 });
    await runHomepageEntry(browser);
    await runAdminViewport(browser, { width: 1440, height: 900 });
    await runAdminViewport(browser, { width: 390, height: 844 });
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
