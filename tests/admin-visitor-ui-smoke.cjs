const assert = require("node:assert/strict");
const { chromium } = require("playwright");

const baseUrl = process.env.STUDENT_UI_BASE_URL || "http://127.0.0.1:8091";
const now = "2026-07-31T12:00:00.000Z";
const subjects = [{
  code: "0610",
  name: "Biology",
  nameZh: "生物",
  qualification: "IGCSE",
  board: "CIE",
  paperCount: 1,
  questionCount: 40,
  active: true,
}];
const thread = {
  id: "thread-1",
  questionKey: "CIE-IGCSE-0610-0610_s23_qp_22-01",
  title: "How does diffusion explain this result?",
  subject: "IGCSE Biology",
  subjectCode: "0610",
  paper: "MCQ",
  topic: "Movement in and out of cells",
  tags: ["question"],
  status: "open",
  sticky: false,
  authorId: "student-1",
  authorName: "Test Student",
  postCount: 1,
  likeCount: 0,
  followerCount: 0,
  followed: false,
  lastPostAt: now,
};

function json(route, data, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(status >= 400 ? data : { ok: true, data }),
  });
}

async function routeVisitorApi(context) {
  await context.route("**/api/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/catalog/subjects") return json(route, subjects);
    if (url.pathname === "/api/meta/storage") return json(route, { mode: "d1" });
    if (url.pathname === "/api/catalog/subjects/0610/papers") return json(route, [{
      slug: "0610_s23_qp_22",
      subjectCode: "0610",
      year: 2023,
      season: "s",
      paperNumber: 2,
      variant: 2,
      status: "published",
    }]);
    if (url.pathname === "/api/discussions") return json(route, [thread]);
    if (url.pathname === "/api/discussions/thread-1") return json(route, {
      thread,
      posts: [{
        id: "post-1",
        threadId: thread.id,
        authorId: "student-1",
        authorName: "Test Student",
        body: "I compared the concentration on both sides of the membrane.",
        liked: false,
        likeCount: 0,
        flagCount: 0,
        createdAt: now,
      }],
    });
    if (url.pathname.startsWith("/api/questions/")) return json(route, null, 404);
    return json(route, { error: { code: "NOT_FOUND", message: `Unhandled ${url.pathname}` } }, 404);
  });
}

async function verifyVisitor(browser) {
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  await context.addInitScript(() => {
    if (sessionStorage.getItem("adminVisitorSmokeSeeded")) return;
    localStorage.clear();
    sessionStorage.setItem("adminVisitorSmokeSeeded", "1");
  });
  await routeVisitorApi(context);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${baseUrl}/pages/login.html`, { waitUntil: "networkidle" });
    await page.locator("#visitorModeBtn").click();
    await page.waitForURL(`${baseUrl}/index.html`);
    try {
      await page.locator(".course-card--biology").waitFor({ timeout: 8000 });
    } catch (error) {
      const diagnostic = await page.evaluate(() => ({
        url: location.href,
        visitorMode: localStorage.getItem("alevel.visitorMode"),
        busy: document.querySelector("#subjectCourses")?.getAttribute("aria-busy"),
        courses: document.querySelector("#subjectCourses")?.textContent,
        backend: document.querySelector("#backendStatus")?.textContent,
      }));
      throw new Error(`Visitor homepage did not render: ${JSON.stringify({ diagnostic, pageErrors })}`, { cause: error });
    }
    assert.equal(await page.evaluate(() => localStorage.getItem("alevel.visitorMode")), "1");
    assert.equal(await page.locator("#goNotebook").isHidden(), true);
    assert.equal(await page.locator("#openProfile").isHidden(), true);
    assert.equal(await page.locator("#goAdmin").isHidden(), true);
    assert.equal(await page.locator("#logoutHome").textContent(), "Log In");
    assert.equal(await page.locator("#openPdfDownload").isEnabled(), true);

    await page.locator(".course-card--biology").click();
    await page.waitForURL(`${baseUrl}/pages/login.html`);
    assert.equal(await page.evaluate(() => localStorage.getItem("alevel.visitorMode")), "1");

    await page.goto(`${baseUrl}/pages/community.html`, { waitUntil: "networkidle" });
    await page.locator(".discussion-thread").waitFor();
    assert.equal(await page.locator("#communityNewThread").isHidden(), true);
    assert.equal(await page.locator("#communityFollowedToggle").isHidden(), true);
    assert.equal(await page.locator("#communityLogout").textContent(), "Log In");
    await page.locator("[data-open-thread='thread-1']").click();
    await page.locator(".discussion-post").waitFor();
    assert.equal(await page.locator("#communityReplyComposer").isHidden(), true);
    assert.equal(await page.locator("#communityFollowToggle").count(), 0);
    assert.equal(await page.locator("[data-like-post], [data-flag-post], [data-delete-post]").count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await context.close();
  }
}

function adminFixture() {
  return {
    user: {
      id: "admin-1",
      email: "admin@example.test",
      displayName: "Admin User",
      role: "admin",
      language: "en",
      isDisabled: false,
      pet: { enabled: false, skin: "codex-glass", position: { x: 0.9, y: 0.8 } },
    },
    subject: subjects[0],
    importJob: {
      id: "job-1",
      subjectCode: "0610",
      subjectName: "Biology",
      status: "validated",
      summary: { validatedPaperCount: 1, validQuestionCount: 40 },
      fileCount: 2,
      createdAt: now,
      files: [],
      issues: [],
      cancelledAt: null,
      hiddenAt: null,
    },
  };
}

async function routeAdminApi(context, actions) {
  const fixture = adminFixture();
  await context.route("**/api/**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    if (path === "/api/auth/me") return json(route, fixture.user);
    if (path === "/api/admin/records") return json(route, {
      summary: { usersCount: 1, practiceCount: 0, submittedCount: 0 },
      latestUsers: [fixture.user],
      latestPractices: [],
    });
    if (path === "/api/admin/subjects") return json(route, [fixture.subject]);
    if (path === "/api/admin/imports") return json(route, [fixture.importJob]);
    if (path === "/api/admin/settings/ai-hints") return json(route, {
      enabled: false, configured: false, modelConfigured: false,
    });
    if (path === "/api/admin/question-hints/sample-status") return json(route, {
      version: "biology-hint-sample-v1",
      expected: 24,
      approved: 0,
      pendingReview: 0,
      rejected: 0,
      missing: 24,
      ready: false,
    });
    if (path === "/api/admin/question-hints") return json(route, []);
    if (path === "/api/admin/community/threads" && method === "GET") return json(route, {
      threads: [{
        id: thread.id,
        title: thread.title,
        status: "open",
        sticky: 0,
        author_id: "student-1",
        author_name: "Test Student",
        post_count: 1,
        pending_report_count: 1,
        last_post_at: now,
      }],
      total: 1,
      limit: 200,
      offset: 0,
    });
    if (path === "/api/admin/community/reports" && method === "GET") return json(route, [{
      id: "report-1",
      post_id: "post-1",
      post_hidden: 0,
      body: "Reported post",
      reason: "Needs review",
      status: "pending",
      created_at: now,
      reporter_name: "Reporter",
      author_id: "student-1",
      author_name: "Test Student",
      thread_id: thread.id,
      thread_title: thread.title,
      thread_status: "open",
      thread_sticky: 0,
    }]);
    if (path === `/api/admin/community/threads/${thread.id}/posts`) return json(route, {
      thread: { id: thread.id, title: thread.title, status: "open", sticky: 0 },
      posts: [{
        id: "post-1",
        thread_id: thread.id,
        author_id: "student-1",
        author_name: "Test Student",
        body: "Reported post",
        hidden: 0,
        created_at: now,
      }],
    });
    if (path === `/api/admin/community/threads/${thread.id}` && method === "PATCH") {
      actions.push({ path, method, body: request.postDataJSON() });
      return json(route, { id: thread.id, status: "locked", sticky: false });
    }
    if (path === "/api/admin/community/posts/post-1/visibility" && method === "PATCH") {
      actions.push({ path, method, body: request.postDataJSON() });
      return json(route, { id: "post-1", hidden: true });
    }
    if (path === "/api/admin/audit-logs") return json(route, [{
      id: "audit-1",
      actor_name: "Admin User",
      action: "community.thread.update",
      target_type: "discussion_thread",
      target_id: thread.id,
      details: { status: "locked" },
      created_at: now,
    }]);
    return json(route, { error: { code: "NOT_FOUND", message: `Unhandled ${method} ${path}` } }, 404);
  });
}

async function verifyAdmin(browser, viewport, name) {
  const context = await browser.newContext({ locale: "en-US", viewport });
  const actions = [];
  await context.addInitScript(() => {
    if (sessionStorage.getItem("adminPlatformSmokeSeeded")) return;
    localStorage.clear();
    localStorage.setItem("alevel.authToken", "admin-test-token");
    localStorage.setItem("alevel.language", "en");
    sessionStorage.setItem("adminPlatformSmokeSeeded", "1");
  });
  await routeAdminApi(context, actions);
  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await page.goto(`${baseUrl}/pages/admin.html`, { waitUntil: "networkidle" });
    await page.locator("#adminThreadsBody tr").waitFor();
    assert.equal(await page.locator("#adminThreadsBody tr").count(), 1);
    assert.equal(await page.locator("#adminReportsBody tr").count(), 1);
    assert.equal(await page.locator("#adminAuditBody tr").count(), 1);
    assert.equal(await page.locator("#adminExportJson").isVisible(), true);
    assert.equal(await page.locator("#adminExportCsv").isVisible(), true);
    assert.equal(await page.locator("#adminHintLiveToggle").isChecked(), false);
    assert.equal(await page.locator("#adminProcessImport").isDisabled(), true);
    assert.equal(await page.locator("#adminPublishImport").isDisabled(), true);

    await page.locator("#adminThreadsBody [data-report-lock]").click();
    await page.waitForFunction(() => document.querySelector("#adminThreadsBody tr"));
    await page.locator("#adminReportsBody [data-report-post]").click();
    assert.ok(actions.some((action) => action.path.endsWith("/threads/thread-1") && action.body.status === "locked"));
    assert.ok(actions.some((action) => action.path.endsWith("/posts/post-1/visibility") && action.body.hidden === true));

    const geometry = await page.evaluate(() => ({
      bodyWidth: document.body.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      grids: [...document.querySelectorAll(".admin-action-grid")].map((grid) => ({
        width: grid.getBoundingClientRect().width,
        parentWidth: grid.parentElement.getBoundingClientRect().width,
      })),
    }));
    assert.ok(geometry.bodyWidth <= geometry.viewportWidth + 1, `${name}: horizontal page overflow ${JSON.stringify(geometry)}`);
    assert.ok(geometry.grids.every((grid) => grid.width <= grid.parentWidth + 1), `${name}: action grid overflow ${JSON.stringify(geometry.grids)}`);
    assert.deepEqual(pageErrors, []);

    if (name === "desktop") {
      await page.locator("[data-language-toggle]").click();
      await page.waitForLoadState("networkidle");
      await page.locator("#adminThreadsBody tr").waitFor();
      assert.equal(await page.locator("html").getAttribute("lang"), "zh-CN");
      assert.equal(await page.locator("[data-i18n='adminCommunityTitle']").textContent(), "社区审核");
      assert.equal(await page.getByText("Community Moderation", { exact: true }).count(), 0);
    }
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await verifyVisitor(browser);
    await verifyAdmin(browser, { width: 1440, height: 900 }, "desktop");
    await verifyAdmin(browser, { width: 390, height: 844 }, "mobile");
    console.log("Admin platform and Visitor Mode UI smoke checks passed.");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
