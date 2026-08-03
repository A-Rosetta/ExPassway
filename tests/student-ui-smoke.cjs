const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium, webkit } = require("playwright");

const baseUrl = process.env.STUDENT_UI_BASE_URL || "http://127.0.0.1/alevel";
const now = "2026-07-28T12:00:00.000Z";
const user = {
  id: "user-1",
  displayName: "UI Test Student",
  email: "ui-test@example.test",
  grade: "IGCSE",
  targetScore: 90,
  language: "en",
  hasPassword: true,
  role: "admin",
  pet: {
    enabled: true,
    skin: "codex-glass",
    position: { x: 0.9, y: 0.82 },
  },
};
const subjects = [
  { code: "0610", name: "Biology", nameZh: "生物", qualification: "IGCSE", board: "CIE", paperCount: 2, questionCount: 80, active: true },
  { code: "0620", name: "Chemistry", nameZh: "化学", qualification: "IGCSE", board: "CIE", paperCount: 2, questionCount: 80, active: true },
  { code: "0654", name: "Co-ordinated Sciences", nameZh: "协调科学", qualification: "IGCSE", board: "CIE", paperCount: 1, questionCount: 40, active: true },
  { code: "0455", name: "Economics", nameZh: "经济", qualification: "IGCSE", board: "CIE", paperCount: 1, questionCount: 30, active: true },
];

function papersFor(code) {
  return [
    {
      slug: `${code}_s23_qp_22`,
      subjectCode: code,
      year: 2023,
      season: "s",
      paperNumber: 2,
      variant: 2,
      durationMinutes: 45,
      validQuestionCount: 40,
    },
    {
      slug: `${code}_w22_qp_21`,
      subjectCode: code,
      year: 2022,
      season: "w",
      paperNumber: 2,
      variant: 1,
      durationMinutes: 45,
      validQuestionCount: 40,
    },
  ];
}

function chapterCatalog() {
  return {
    version: {
      id: "curriculum-1",
      subjectCode: "0610",
      qualification: "IGCSE",
      examYearStart: 2026,
      examYearEnd: 2028,
      version: "2026-2028",
    },
    chapters: Array.from({ length: 20 }, (_, index) => ({
      id: `chapter-${index + 1}`,
      chapterNo: index + 1,
      titleEn: `Biology chapter ${index + 1}`,
      titleZh: `生物章节 ${index + 1}`,
      sections: [{
        id: `section-${index + 1}`,
        sectionCode: `${index + 1}.1`,
        titleEn: `Section ${index + 1}.1`,
        titleZh: `小节 ${index + 1}.1`,
        progress: {
          availableQuestions: 4,
          unseenQuestions: 3,
          firstAccuracy: 75,
          reviewAccuracy: 80,
          needsReview: 1,
        },
      }],
    })),
  };
}

const notebookRows = Array.from({ length: 12 }, (_, index) => ({
  id: `CIE-IGCHEM-2023-S-22-${String(index + 1).padStart(2, "0")}`,
  questionKey: `CIE-IGCHEM-2023-S-22-${String(index + 1).padStart(2, "0")}`,
  board: "CIE",
  subject: "IGCSE Chemistry",
  paper: "MCQ",
  topic: index % 2 ? "Stoichiometry" : "Atomic structure",
  stem: `Representative question ${index + 1}`,
  answerText: "B",
  lastSelected: index % 4,
  lastSelectedText: "A",
  wrongCount: index + 1,
  lastWrongAt: new Date(Date.parse(now) - index * 86400000).toISOString(),
  mastered: index % 5 === 0,
}));

const practiceResult = {
  total: 4,
  correct: 2,
  wrong: 2,
  accuracy: 50,
  hintUsedQuestions: 1,
  submittedAt: now,
  elapsedSeconds: 128,
  details: Array.from({ length: 4 }, (_, index) => ({
    id: `CIE-IGCHEM-SET-0620_s23_qp_22-${String(index + 1).padStart(2, "0")}`,
    topic: index % 2 ? "Bonding" : "Stoichiometry",
    mistakeType: "concept",
    correct: index < 2,
    starred: index === 2,
    selectedIndex: index % 4,
    answer: index < 2 ? index % 4 : (index + 1) % 4,
  })),
};

const reviewQuestions = practiceResult.details.map((detail, index) => ({
  id: detail.id,
  board: "CIE",
  subject: "IGCSE Chemistry",
  subjectCode: "0620",
  paper: "MCQ",
  paperSlug: "0620_s23_qp_22",
  questionNo: index + 1,
  stem: `Review question ${index + 1}`,
  options: ["A", "B", "C", "D"],
  images: [{ url: `/assets/question-images/0620_s23_qp_21/q${String(index + 1).padStart(2, "0")}_full.png` }],
}));

const generatedQuestions = Array.from({ length: 4 }, (_, index) => ({
  id: `CIE-IGCHEM-SET-0620_w22_qp_21-${String(index + 1).padStart(2, "0")}`,
  board: "CIE",
  subject: "IGCSE Chemistry",
  subjectCode: "0620",
  paper: "MCQ",
  paperSlug: "0620_w22_qp_21",
  questionNo: index + 1,
  stem: `Generated question ${index + 1}`,
  options: ["A", "B", "C", "D"],
  answer: index % 4,
  topic: index % 2 ? "Bonding" : "Stoichiometry",
  difficulty: "medium",
  hints: [],
  images: [{ url: `/assets/question-images/0620_s23_qp_21/q${String(index + 1).padStart(2, "0")}_full.png` }],
}));
const adminHintSet = {
  id: "00000000-0000-4000-8000-000000000001",
  questionId: generatedQuestions[0].id,
  language: "zh-CN",
  promptVersion: "igcse-progressive-v1",
  hints: ["先找出图中的关键变化。", "比较变化前后的粒子分布。", "用扩散概念判断每一项。"],
  status: "pending_review",
  model: "test-vision-model",
  question: {
    paperSlug: generatedQuestions[0].paperSlug,
    questionNo: 1,
    subjectCode: "0610",
    stem: generatedQuestions[0].stem,
    options: generatedQuestions[0].options,
    images: generatedQuestions[0].images,
  },
};

const threads = [
  {
    id: "thread-1",
    questionKey: "CIE-IGCHEM-2023-S-22-01",
    title: "关于题目 CIE-IGCHEM-2023-S-22-01 的疑问",
    subject: "IGCSE Chemistry",
    subjectCode: "0620",
    paper: "MCQ",
    topic: "Stoichiometry",
    tags: ["question"],
    status: "open",
    sticky: true,
    authorId: "author-1",
    authorName: "Alice",
    postCount: 3,
    likeCount: 12,
    followerCount: 4,
    followed: false,
    lastPostAt: now,
  },
  {
    id: "thread-2",
    questionKey: "CIE-IGCHEM-2023-S-22-02",
    title: "离子方程式中旁观离子如何快速判断？",
    subject: "IGCSE Chemistry",
    subjectCode: "0620",
    paper: "MCQ",
    topic: "Ions",
    tags: ["topic"],
    status: "solved",
    sticky: false,
    authorId: "author-2",
    authorName: "Ben",
    postCount: 2,
    likeCount: 7,
    followerCount: 2,
    followed: true,
    lastPostAt: now,
  },
];

function discussionPayload(threadId = "thread-1") {
  const thread = threads.find((row) => row.id === threadId) || threads[0];
  return {
    thread,
    posts: [
      { id: "post-1", threadId: thread.id, authorId: "author-1", authorName: "Alice", body: "我先列出了 $n=m/M_r$，但不确定下一步。\n\n![站内上传](/api/community-images/00000000-0000-4000-8000-000000000001.png)\n\n![外链图片](https://external.invalid/tracker.png)\n\n[External reference](https://example.com/reference)", liked: false, likeCount: 2, flagCount: 0, createdAt: now },
      { id: "post-2", threadId: thread.id, authorId: "user-1", authorName: "UI Test Student", body: "比较各反应物的物质的量与系数之比即可。", liked: true, likeCount: 5, flagCount: 0, createdAt: now },
      { id: "post-3", threadId: thread.id, authorId: "author-3", authorName: "Chen", body: "也可以先假设其中一种完全反应，再检查另一种是否过量。", liked: false, likeCount: 1, flagCount: 0, createdAt: now },
    ],
  };
}

function json(route, data, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(status >= 400 ? data : { ok: true, data }),
  });
}

async function mockApi(page, currentUser = user, authDelayMs = 0) {
  let petPreferences = structuredClone(user.pet);
  let hintReviewStatus = "pending_review";
  const controls = { failNextPetSave: false };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/me") {
      if (authDelayMs) await new Promise((resolve) => setTimeout(resolve, authDelayMs));
      return json(route, { ...currentUser, pet: petPreferences });
    }
    if (path === "/api/auth/me/pet" && method === "PATCH") {
      const body = request.postDataJSON();
      if (controls.failNextPetSave) {
        controls.failNextPetSave = false;
        return json(route, { ok: false, error: { message: "Simulated pet save failure" } }, 500);
      }
      petPreferences = body;
      return json(route, body);
    }
    if (/^\/api\/question-hints\//.test(path) && method === "POST") {
      const language = request.postDataJSON()?.language;
      return json(route, {
        questionKey: decodeURIComponent(path.split("/").at(-1)),
        language,
        hints: language === "en"
          ? ["Find the relevant evidence.", "Compare each case.", "Apply the concept once more."]
          : ["先找出题图中的关键证据。", "逐项比较题目给出的情况。", "再应用一次相关概念。"],
        source: "cache",
        promptVersion: "igcse-progressive-v1",
      });
    }
    if (path === "/api/meta/storage") return json(route, { mode: "postgresql" });
    if (path === "/api/admin/records") {
      return json(route, {
        summary: { usersCount: 1, practiceCount: 1, submittedCount: 1 },
        latestUsers: [currentUser],
        latestPractices: [],
      });
    }
    if (path === "/api/admin/subjects") return json(route, subjects);
    if (path === "/api/admin/imports") return json(route, []);
    if (path === "/api/admin/settings/ai-hints") {
      return json(route, { enabled: false, configured: false, modelConfigured: false });
    }
    if (path === "/api/admin/community/threads") {
      return json(route, { threads: [], total: 0, limit: 200, offset: 0 });
    }
    if (path === "/api/admin/community/reports") return json(route, []);
    if (path === "/api/admin/audit-logs") return json(route, []);
    if (path === "/api/admin/question-hints/sample-status") {
      return json(route, {
        version: "biology-hint-sample-v1",
        expected: 24,
        approved: hintReviewStatus === "approved" ? 1 : 0,
        pendingReview: hintReviewStatus === "pending_review" ? 1 : 0,
        rejected: hintReviewStatus === "rejected" ? 1 : 0,
        missing: 23,
        ready: false,
      });
    }
    if (path === "/api/admin/question-hints" && method === "GET") {
      return json(route, url.searchParams.get("status") === hintReviewStatus
        ? [{ ...adminHintSet, status: hintReviewStatus }]
        : []);
    }
    if (/^\/api\/admin\/question-hints\/[^/]+$/.test(path) && method === "PATCH") {
      hintReviewStatus = request.postDataJSON().status;
      return json(route, { ...adminHintSet, status: hintReviewStatus });
    }
    if (path === "/api/catalog/subjects") return json(route, subjects);
    if (/^\/api\/catalog\/subjects\/\d{4}\/papers$/.test(path)) {
      return json(route, papersFor(path.split("/")[4]));
    }
    if (/^\/api\/catalog\/papers\/[^/]+\/questions$/.test(path)) return json(route, generatedQuestions);
    if (path === "/api/curriculum/0610/chapters") return json(route, chapterCatalog());
    if (/^\/api\/users\/[^/]+\/notebook$/.test(path)) return json(route, notebookRows);
    if (/^\/api\/users\/[^/]+\/practices$/.test(path)) return json(route, []);
    if (path === "/api/analysis") {
      return json(route, {
        bars: [
          { topic: "Stoichiometry", mistake: "concept", wrongRate: 72.5 },
          { topic: "Bonding", mistake: "calculation", wrongRate: 45 },
        ],
        advices: ["先重做同类题，再完成一道迁移题。", "三天后进行一次延迟复测。"],
        hintRate: 25,
      });
    }
    if (path === "/api/discussions" && method === "GET") {
      const followed = url.searchParams.get("followedOnly") === "1";
      return json(route, followed ? threads.filter((thread) => thread.followed) : threads);
    }
    if (path === "/api/discussions" && method === "POST") {
      return json(route, { ...threads[0], id: "thread-new", title: "新讨论" }, 201);
    }
    if (path === "/api/discussions/thread-new") return json(route, discussionPayload());
    if (/^\/api\/discussions\/thread-[12]$/.test(path)) {
      return json(route, discussionPayload(path.split("/").at(-1)));
    }
    if (/^\/api\/questions\//.test(path)) {
      return json(route, {
        questionKey: decodeURIComponent(path.split("/").at(-1)),
        paperSlug: "0620_s23_qp_22",
        questionNo: 1,
        imageUrl: "/assets/question-images/0620_s23_qp_21/q01_full.png",
      });
    }
    if (path === "/api/discussions/thread-1/follow") {
      return json(route, { ok: false, error: { message: "Simulated follow failure" } }, 500);
    }
    if (/^\/api\/discussions\/[^/]+\/posts$/.test(path) && method === "POST") {
      return json(route, { id: "post-new" }, 201);
    }
    if (path === "/api/discussions/images" && method === "POST") {
      return json(route, { url: "/api/community-images/00000000-0000-4000-8000-000000000001.png" }, 201);
    }
    if (path === "/api/community-images/00000000-0000-4000-8000-000000000001.png") {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        path: path.resolve(__dirname, "../assets/question-images/0620_s23_qp_21/q01_full.png"),
      });
    }
    if (/^\/api\/discussions\//.test(path) && method !== "GET") return json(route, { ok: true });
    if (/^\/api\/users\//.test(path)) return json(route, []);

    return json(route, { ok: false, error: { message: `Unhandled mock route: ${method} ${path}` } }, 501);
  });
  return controls;
}

async function seedStorage(page, pathname, language = "en", currentUser = user) {
  await page.addInitScript(({ path, currentUser, result, questions, selectedLanguage }) => {
    const theme = localStorage.getItem("app-theme");
    localStorage.clear();
    if (theme) localStorage.setItem("app-theme", theme);
    localStorage.setItem("alevel.language", selectedLanguage);
    localStorage.setItem("alevel.userProfile", JSON.stringify(currentUser));
    localStorage.setItem("alevel.selection", JSON.stringify({
      grade: "IGCSE",
      board: "CIE",
      subject: "IGCSE Chemistry",
      subjectCode: "0620",
      paper: "MCQ",
    }));
    if (!path.endsWith("/login.html")) {
      localStorage.setItem("alevel.authToken", "mock-token");
      localStorage.setItem("alevel.userId", currentUser.id);
    }
    localStorage.setItem(`alevel.lastResult:${currentUser.id}`, JSON.stringify(result));
    localStorage.setItem(`alevel.generatedPaper:${currentUser.id}`, JSON.stringify(questions));
    localStorage.setItem(`alevel.wrongLog:${currentUser.id}`, JSON.stringify([
      { topic: "Stoichiometry", mistake: "concept", correct: 1, wrong: 3 },
      { topic: "Bonding", mistake: "calculation", correct: 2, wrong: 1 },
    ]));
  }, {
    path: pathname,
    currentUser,
    result: practiceResult,
    questions: reviewQuestions,
    selectedLanguage: language,
  });
}

async function assertPageGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const visibleElements = [...document.querySelectorAll("button, .btn-link, h1, h2, h3, h4, p, label")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length;
      });
    const clippedText = visibleElements
      .filter((element) => (
        element.scrollWidth > element.clientWidth + 2
        || (element.matches("button, .btn-link") && element.scrollHeight > element.clientHeight + 2)
      ))
      .map((element) => ({
        name: element.id || element.textContent.trim().slice(0, 40),
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        scrollHeight: element.scrollHeight,
        clientHeight: element.clientHeight,
        overflow: getComputedStyle(element).overflow,
        lineHeight: getComputedStyle(element).lineHeight,
      }));
    const header = document.querySelector(".home-topbar, .site-topbar, .chapter-topbar, .community-topbar");
    const headerInner = document.querySelector(".home-topbar__inner, .site-topbar__inner, .chapter-topbar__inner, .community-topbar__inner");
    const homeCommand = document.querySelector("#goHomeFromPickerBtn, #backHome, #communityBackHome");
    const headerRect = header?.getBoundingClientRect();
    const headerInnerRect = headerInner?.getBoundingClientRect();
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      clippedText,
      siteUi: document.body.classList.contains("site-ui"),
      header: headerRect ? { width: headerRect.width, height: headerRect.height } : null,
      headerInner: headerInnerRect ? { width: headerInnerRect.width, height: headerInnerRect.height } : null,
      homeCommandInHeader: !homeCommand || Boolean(homeCommand.closest("header")),
    };
  });
  assert.equal(geometry.siteUi, true, `${label}: site UI scope missing`);
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `${label}: horizontal overflow ${JSON.stringify(geometry)}`);
  assert.deepEqual(geometry.clippedText, [], `${label}: clipped visible text ${JSON.stringify(geometry.clippedText)}`);
  assert.equal(geometry.homeCommandInHeader, true, `${label}: home command is outside the title bar`);
  assert.ok(geometry.header, `${label}: title bar missing`);
  assert.ok(Math.abs(geometry.header.width - geometry.clientWidth) <= 1, `${label}: title bar width is inconsistent`);
  const compact = geometry.clientWidth <= 767;
  assert.ok(Math.abs(geometry.header.height - (compact ? 72 : 82)) <= 1, `${label}: title bar height is inconsistent ${JSON.stringify(geometry.header)}`);
  assert.ok(geometry.headerInner, `${label}: title bar inner container missing`);
  assert.ok(Math.abs(geometry.headerInner.height - (compact ? 58 : 64)) <= 1, `${label}: title bar inner height is inconsistent`);
  assert.ok(Math.abs(geometry.headerInner.width - (compact ? geometry.clientWidth - 16 : Math.min(1180, geometry.clientWidth - 32))) <= 1, `${label}: title bar inner width is inconsistent`);
}

async function assertAccessibleMotion(page, label) {
  await page.evaluate(() => document.activeElement?.blur?.());
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.matches?.(":focus-visible"))) break;
  }
  await page.waitForTimeout(20);
  const focus = await page.evaluate(() => {
    const element = document.activeElement;
    const style = element ? getComputedStyle(element) : null;
    return {
      id: element?.id || "",
      tagName: element?.tagName || "",
      focusVisible: Boolean(element?.matches?.(":focus-visible")),
      outline: style?.outline || "none",
      outlineStyle: style?.outlineStyle || "none",
      outlineWidth: style?.outlineWidth || "0px",
      transitionDuration: style?.transitionDuration || "",
      focusRules: [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .filter((rule) => rule.selectorText?.includes(".site-ui input:focus-visible"))
            .map((rule) => `${sheet.href || "inline"}: ${rule.cssText}`);
        } catch (_error) {
          return [];
        }
      }),
    };
  });
  assert.ok(focus.tagName, `${label}: no keyboard-focusable control`);
  assert.equal(focus.focusVisible, true, `${label}: keyboard focus is not visible ${JSON.stringify(focus)}`);
  assert.ok(
    focus.focusRules.some((rule) => /(?:solid 2px|2px solid)/.test(rule) && /box-shadow/.test(rule)),
    `${label}: project focus indicator rule is missing ${JSON.stringify(focus)}`
  );
  const durations = focus.transitionDuration.split(",").map((value) => Number.parseFloat(value) || 0);
  assert.ok(durations.every((value) => value <= 0.01), `${label}: reduced motion was not applied ${JSON.stringify(focus)}`);
}

async function assertThemeSurface(page, label, theme) {
  const surface = await page.locator(".card, .community-surface, .course-card, .chapter-band").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      border: style.borderTopColor,
      radius: style.borderTopLeftRadius,
      shadow: style.boxShadow,
      backdrop: style.backdropFilter || style.webkitBackdropFilter || "none",
    };
  });
  assert.ok(Number.parseFloat(surface.radius) > 0, `${label}: surface radius is missing ${JSON.stringify(surface)}`);
  if (theme === "light") {
    assert.equal(surface.background, "rgb(230, 234, 227)", `${label}: light surface is not sage ${JSON.stringify(surface)}`);
    assert.equal(surface.border, "rgba(0, 0, 0, 0)", `${label}: light surface has a visible border ${JSON.stringify(surface)}`);
    assert.match(surface.shadow, /9px 9px 16px/);
    assert.match(surface.shadow, /-9px -9px 16px/);
    assert.equal(surface.backdrop, "none", `${label}: light surface must not use backdrop blur`);
    return;
  }
  assert.equal(surface.background, "rgba(255, 255, 255, 0.07)", `${label}: dark surface is not transparent glass ${JSON.stringify(surface)}`);
  assert.equal(surface.border, "rgba(255, 255, 255, 0.14)", `${label}: dark glass edge is missing ${JSON.stringify(surface)}`);
  assert.match(surface.backdrop, /blur\(20px\)/, `${label}: dark glass blur is missing ${JSON.stringify(surface)}`);
  assert.doesNotMatch(surface.shadow, /-9px -9px/, `${label}: dark surface contains light neumorphic shadow`);
}

async function assertElevatedSurface(page, selector, label) {
  const surface = await page.locator(selector).evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      shadow: style.boxShadow,
      overflowX: style.overflowX,
    };
  });
  assert.notEqual(surface.shadow, "none", `${label}: secondary surface has no independent shadow`);
  assert.notEqual(surface.overflowX, "auto", `${label}: secondary surface allows horizontal scrolling`);
  assert.notEqual(surface.overflowX, "scroll", `${label}: secondary surface allows horizontal scrolling`);
}

async function waitForPageCondition(page, predicate, argument, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!(await page.evaluate(predicate, argument))) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for page condition");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function captureScreenshot(page, options) {
  if (process.env.STUDENT_UI_SKIP_SCREENSHOTS === "1") return;
  await page.screenshot(options);
}

async function openPage(browser, config, pathname, options = {}) {
  const context = await browser.newContext({
    viewport: config.viewport,
    reducedMotion: "reduce",
    ignoreHTTPSErrors: /^https:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(new URL(baseUrl).origin),
    ...(options.colorScheme ? { colorScheme: options.colorScheme } : {}),
  });
  const page = await context.newPage();
  if (options.clock) await page.clock.install();
  if (options.theme) {
    await page.addInitScript((theme) => {
      if (!localStorage.getItem("app-theme")) localStorage.setItem("app-theme", theme);
    }, options.theme);
  }
  const errors = [];
  const failedRequests = [];
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      console.error([
        `[CSP] ${event.effectiveDirective} blocked ${event.blockedURI}`,
        event.sourceFile ? `at ${event.sourceFile}:${event.lineNumber}:${event.columnNumber}` : "",
        event.sample ? `sample ${event.sample}` : "",
      ].filter(Boolean).join(" "));
    });
  });
  page.on("console", (message) => {
    if (message.type() === "error" && message.text().startsWith("[CSP]")) errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  await seedStorage(page, pathname, options.language);
  const apiMock = await mockApi(page);
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: "networkidle" });
  return { context, page, errors, failedRequests, apiMock };
}

async function homeSurfaceState(page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const body = getComputedStyle(document.body);
    const card = getComputedStyle(document.querySelector(".course-card"));
    const pet = getComputedStyle(document.querySelector(".site-pet__head"));
    return {
      theme: root.getAttribute("data-theme") || "light",
      storedTheme: localStorage.getItem("app-theme"),
      bodyBackground: body.backgroundColor,
      cardBackground: card.backgroundColor,
      cardBorder: card.borderTopColor,
      cardRadius: card.borderTopLeftRadius,
      cardShadow: card.boxShadow,
      cardBackdrop: card.backdropFilter || card.webkitBackdropFilter || "none",
      petBackground: pet.backgroundColor,
      petBackdrop: pet.backdropFilter || pet.webkitBackdropFilter || "none",
    };
  });
}

async function verifyHomeThemes(browser, config) {
  const systemRun = await openPage(browser, config, "/index.html", { colorScheme: "light" });
  try {
    await systemRun.page.locator(".course-card--biology").waitFor({ state: "visible" });
    assert.equal(
      await systemRun.page.locator("html").getAttribute("data-theme"),
      "dark",
      `${config.name}-home: dark default was not applied`
    );
    assert.equal(
      await systemRun.page.evaluate(() => localStorage.getItem("app-theme")),
      null,
      `${config.name}-home: default theme must not create a manual theme setting`
    );
  } finally {
    await systemRun.context.close();
  }

  const run = await openPage(browser, config, "/index.html", { colorScheme: "light", theme: "light" });
  const { page } = run;
  try {
    await page.locator(".course-card--biology").waitFor({ state: "visible" });
    const light = await homeSurfaceState(page);
    assert.equal(light.theme, "light");
    assert.equal(light.storedTheme, "light");
    assert.equal(light.bodyBackground, "rgb(230, 234, 227)");
    assert.equal(light.cardBackground, "rgb(230, 234, 227)");
    assert.equal(light.cardBorder, "rgba(0, 0, 0, 0)");
    assert.equal(light.cardRadius, "32px");
    assert.match(light.cardShadow, /9px 9px 16px/);
    assert.match(light.cardShadow, /-9px -9px 16px/);
    assert.equal(light.cardBackdrop, "none");
    assert.equal(light.petBackdrop, "none");
    assert.match(await page.locator("#themeToggle").getAttribute("aria-label"), /dark mode/i);

    if (config.mobile) {
      assert.equal(await page.locator(".home-mobile-shortcuts").isVisible(), true);
      assert.equal(await page.locator("#mobileNotebookShortcut").isVisible(), true);
      assert.equal(await page.locator("#mobileForumShortcut").isVisible(), true);
      const shortcutGeometry = await page.locator(".home-mobile-shortcuts").evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, viewportWidth: document.documentElement.clientWidth };
      });
      assert.ok(shortcutGeometry.left >= 0 && shortcutGeometry.right <= shortcutGeometry.viewportWidth);
      const menu = page.locator("#homeMenuToggle");
      await menu.click();
      assert.equal(await menu.getAttribute("aria-expanded"), "true");
      await waitForPageCondition(page, () => {
        const style = getComputedStyle(document.querySelector("#homeNav"));
        return style.visibility === "visible" && Number.parseFloat(style.opacity) === 1;
      });
      assert.equal(await page.locator("#homeNav").isVisible(), true);
      assert.match(await menu.getAttribute("aria-label"), /close home menu/i);
      await page.keyboard.press("Escape");
      assert.equal(await menu.getAttribute("aria-expanded"), "false");
      assert.equal(await menu.evaluate((element) => document.activeElement === element), true);
    } else {
      assert.equal(await page.locator(".home-mobile-shortcuts").isVisible(), false);
      assert.equal(await page.locator("#homeMenuToggle").isVisible(), false);
      assert.equal(await page.locator("#homeNav").isVisible(), true);
    }

    await assertPageGeometry(page, `${config.name}-home-light`);
    await captureScreenshot(page, {
      path: `/var/tmp/student-ui-${config.name}-home-light.png`,
      fullPage: true,
    });

    await page.locator("#themeToggle").click();
    await waitForPageCondition(page, () => (
      getComputedStyle(document.body).backgroundColor === "rgb(20, 23, 28)"
      && getComputedStyle(document.querySelector(".course-card")).backgroundColor === "rgba(255, 255, 255, 0.07)"
    ));
    const dark = await homeSurfaceState(page);
    assert.equal(dark.theme, "dark");
    assert.equal(dark.storedTheme, "dark");
    assert.equal(dark.bodyBackground, "rgb(20, 23, 28)");
    assert.equal(dark.cardBackground, "rgba(255, 255, 255, 0.07)");
    assert.equal(dark.cardBorder, "rgba(255, 255, 255, 0.14)");
    assert.equal(dark.cardRadius, "32px");
    assert.match(dark.cardBackdrop, /blur\(20px\)/);
    assert.doesNotMatch(dark.cardShadow, /-9px -9px/);
    assert.match(dark.petBackdrop, /blur\(20px\)/);
    assert.match(await page.locator("#themeToggle").getAttribute("aria-label"), /light mode/i);

    await page.reload({ waitUntil: "networkidle" });
    await page.locator(".course-card--biology").waitFor({ state: "visible" });
    assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
    assert.equal(await page.evaluate(() => localStorage.getItem("app-theme")), "dark");

    if (config.mobile) {
      await page.locator("#homeMenuToggle").click();
      await page.locator("#homeNav").waitFor({ state: "visible" });
    }
    await page.locator("#openProfile").click();
    await page.locator("#profileDialog").waitFor({ state: "visible" });
    const profileSurface = await page.locator("#profileDialog").evaluate((dialog) => {
      const style = getComputedStyle(dialog);
      return {
        radius: style.borderTopLeftRadius,
        background: style.backgroundColor,
        backdrop: style.backdropFilter || style.webkitBackdropFilter || "none",
      };
    });
    assert.equal(profileSurface.radius, "32px");
    assert.equal(profileSurface.background, "rgba(255, 255, 255, 0.13)");
    assert.match(profileSurface.backdrop, /blur\(20px\)/);
    await page.locator("#closeProfile").click();

    await page.locator("#openPdfDownload").click();
    await page.locator("#pdfDownloadDialog").waitFor({ state: "visible" });
    assert.equal(await page.locator("#pdfDownloadSubject option").count(), 4);
    await page.locator("#closePdfDownload").click();

    await assertPageGeometry(page, `${config.name}-home-dark`);
    assert.deepEqual(run.errors, [], `${config.name}-home-themes: page errors`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-home-themes: failed requests`);
    await captureScreenshot(page, {
      path: `/var/tmp/student-ui-${config.name}-home-dark.png`,
      fullPage: true,
    });
  } finally {
    await run.context.close();
  }
}

async function verifyStandardPage(browser, config, pageSpec) {
  const run = await openPage(browser, config, pageSpec.path, { colorScheme: "light", theme: "light" });
  try {
    await run.page.locator(pageSpec.ready).first().waitFor({ state: "visible" });
    await run.page.locator("#themeToggle").waitFor({ state: "visible" });
    await run.page.locator("[data-language-toggle]").waitFor({ state: "visible" });
    assert.match(await run.page.locator("#themeToggle").getAttribute("aria-label"), /dark mode/i);
    const languageParent = await run.page.locator("[data-language-toggle]").evaluate((element) => (
      element.parentElement?.className || ""
    ));
    assert.match(languageParent, /header-controls|topbar__actions|chapter-topbar/);
    if (pageSpec.pet === false) {
      assert.equal(await run.page.locator(".site-pet").count(), 0, `${config.name}-${pageSpec.name}: pet must be absent`);
    } else {
      await run.page.locator(".site-pet").waitFor({ state: "visible" });
      const petRect = await run.page.locator(".site-pet").boundingBox();
      assert.ok(
        petRect && petRect.x >= 0 && petRect.y >= 0
          && petRect.x + petRect.width <= config.viewport.width
          && petRect.y + petRect.height <= config.viewport.height,
        `${config.name}-${pageSpec.name}: pet is outside the viewport ${JSON.stringify(petRect)}`
      );
    }
    if (pageSpec.verify) await pageSpec.verify(run.page);
    await assertPageGeometry(run.page, `${config.name}-${pageSpec.name}-light`);
    await assertThemeSurface(run.page, `${config.name}-${pageSpec.name}-light`, "light");
    await captureScreenshot(run.page, {
      path: `/var/tmp/student-ui-${config.name}-${pageSpec.name}-light.png`,
      fullPage: true,
    });

    await run.page.locator("#themeToggle").click();
    await waitForPageCondition(run.page, () => {
      if (document.documentElement.dataset.theme !== "dark") return false;
      const surface = document.querySelector(".card, .community-surface, .course-card, .chapter-band");
      const style = getComputedStyle(surface);
      const backdrop = style.backdropFilter || style.webkitBackdropFilter || "none";
      return style.backgroundColor === "rgba(255, 255, 255, 0.07)" && backdrop.includes("blur(20px)");
    });
    assert.equal(await run.page.evaluate(() => localStorage.getItem("app-theme")), "dark");
    assert.match(await run.page.locator("#themeToggle").getAttribute("aria-label"), /light mode/i);
    await assertThemeSurface(run.page, `${config.name}-${pageSpec.name}-dark`, "dark");
    await assertPageGeometry(run.page, `${config.name}-${pageSpec.name}-dark`);
    await assertAccessibleMotion(run.page, `${config.name}-${pageSpec.name}`);
    assert.deepEqual(run.errors, [], `${config.name}-${pageSpec.name}: page errors`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-${pageSpec.name}: failed requests`);
    await captureScreenshot(run.page, {
      path: `/var/tmp/student-ui-${config.name}-${pageSpec.name}-dark.png`,
      fullPage: true,
    });
  } finally {
    await run.context.close();
  }
}

async function verifyGeneratedPaper(browser, config, { layoutChecks = true } = {}) {
  const run = await openPage(browser, config, "/pages/generate.html", { clock: true, theme: "dark" });
  const { page } = run;
  try {
    await page.locator(".paper-set-btn.start").click();
    await page.locator("[data-mode-card='timed']").click();
    assert.equal(await page.locator("input[name='practiceMode'][value='timed']").isChecked(), true);
    await page.locator("#startModePageBtn").click();
    await page.locator(".question").first().waitFor({ state: "visible" });
    await page.locator("#timerDisplay").waitFor({ state: "visible" });
    const darkSurfaces = await page.evaluate(() => Object.fromEntries(
      [".question-side", ".jump-btn", ".question-star-btn", ".tag"].map((selector) => (
        [selector, getComputedStyle(document.querySelector(selector)).backgroundColor]
      ))
    ));
    assert.notEqual(darkSurfaces[".question-side"], "rgb(255, 255, 255)");
    assert.notEqual(darkSurfaces[".jump-btn"], "rgb(243, 247, 255)");
    assert.notEqual(darkSurfaces[".question-star-btn"], "rgb(255, 255, 255)");
    assert.notEqual(darkSurfaces[".tag"], "rgb(237, 243, 255)");
    const questionImage = page.locator(".question-image img").first();
    await questionImage.waitFor({ state: "visible" });
    assert.equal(await page.locator(".option-item").count(), 4);
    await page.locator("[id^='hintBtn_']").first().click();
    await waitForPageCondition(page, () => /提示 1\/3|Hint 1\/3/.test(
      document.querySelector("[id^='hint_']")?.textContent || ""
    ));
    assert.match(await page.locator("[id^='hint_']").first().textContent(), /提示 1\/3|Hint 1\/3/);

    await page.clock.fastForward(60000);
    await page.locator(".site-pet__bubble").waitFor({ state: "visible" });
    assert.match(await page.locator(".site-pet__bubble").textContent(), /线索|clue/i);
    await page.clock.resume();
    if (config.mobile) {
      await page.locator(".site-pet__bubble-close").click();
      await page.locator(".site-pet__bubble").waitFor({ state: "hidden" });
      assert.match(await page.locator("[id^='hint_']").first().textContent(), /提示 1\/3|Hint 1\/3/);
      await page.locator("[id^='hintBtn_']").first().click();
    } else {
      await page.locator(".site-pet__bubble-message").click();
    }
    await waitForPageCondition(page, () => /提示 2\/3|Hint 2\/3/.test(
      document.querySelector("[id^='hint_']")?.textContent || ""
    ));
    assert.match(await page.locator("[id^='hint_']").first().textContent(), /提示 2\/3|Hint 2\/3/);
    const imagePixels = await questionImage.evaluate(async (image) => {
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let nonWhite = 0;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index] < 245 || pixels[index + 1] < 245 || pixels[index + 2] < 245) nonWhite += 1;
      }
      return { naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight, nonWhite };
    });
    assert.ok(imagePixels.naturalWidth > 0 && imagePixels.naturalHeight > 0, `${config.name}: question image is not decoded`);
    assert.ok(imagePixels.nonWhite > 100, `${config.name}: question image is visually blank ${JSON.stringify(imagePixels)}`);
    const overlaps = layoutChecks ? await page.evaluate(() => {
      const timer = document.querySelector("#timerDisplay")?.getBoundingClientRect();
      if (!timer) return null;
      const intersects = (element) => {
        const rect = element.getBoundingClientRect();
        return timer.left < rect.right
          && timer.right > rect.left
          && timer.top < rect.bottom
          && timer.bottom > rect.top;
      };
      const intersectsText = (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...range.getClientRects()].some((rect) => (
          timer.left < rect.right
          && timer.right > rect.left
          && timer.top < rect.bottom
          && timer.bottom > rect.top
        ));
      };
      const textOverlaps = [...document.querySelectorAll(
        "#generateHero h1, #generateHero #selectionSummary, #generateHero #runMode"
      )].filter(intersectsText);
      const elementOverlaps = [...document.querySelectorAll(
        ".question, #paperResult > .actions button"
      )].filter(intersects);
      return [...textOverlaps, ...elementOverlaps]
        .map((element) => element.id || element.className || element.tagName);
    }) : [];
    if (layoutChecks) {
      assert.deepEqual(overlaps, [], `${config.name}: timer overlaps page content ${JSON.stringify(overlaps)}`);
      await assertPageGeometry(page, `${config.name}-generated-paper`);
    }
    await assertAccessibleMotion(page, `${config.name}-generated-paper`);
    assert.deepEqual(run.errors, [], `${config.name}-generated-paper: page errors`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-generated-paper: failed requests`);
    await questionImage.scrollIntoViewIfNeeded();
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-generated-question.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-generated-paper.png`, fullPage: true });
  } finally {
    await run.context.close();
  }
}

async function verifyPetControls(browser, config) {
  const run = await openPage(browser, config, "/index.html");
  const { page, apiMock } = run;
  try {
    const pet = page.locator(".site-pet");
    const character = page.locator(".site-pet__character");
    await pet.waitFor({ state: "visible" });
    assert.equal(await page.locator(".site-pet__close").count(), 0);
    const bubbleCloseStyle = await page.locator(".site-pet__bubble-close").evaluate((button) => {
      const style = getComputedStyle(button);
      return {
        width: style.width,
        height: style.height,
        borderTopLeftRadius: style.borderTopLeftRadius,
        borderTopRightRadius: style.borderTopRightRadius,
        borderBottomRightRadius: style.borderBottomRightRadius,
        borderBottomLeftRadius: style.borderBottomLeftRadius,
      };
    });
    assert.equal(bubbleCloseStyle.width, "44px");
    assert.equal(bubbleCloseStyle.height, "44px");
    assert.deepEqual(
      Object.values(bubbleCloseStyle).slice(2),
      ["0px", "18px", "0px", "44px"]
    );

    await character.evaluate((button) => button.click());
    const firstTip = await page.locator(".site-pet__bubble-message").textContent();
    assert.match(firstTip, /PDF|question papers/i);
    await character.evaluate((button) => button.click());
    const secondTip = await page.locator(".site-pet__bubble-message").textContent();
    assert.match(secondTip, /错题本|Notebook/i);
    assert.notEqual(secondTip, firstTip, `${config.name}: pet tips did not rotate`);
    await character.evaluate((button) => button.click());
    assert.match(await page.locator(".site-pet__bubble-message").textContent(), /论坛|Forum/i);
    if (config.mobile) {
      const [bubbleRect, topbarRect] = await Promise.all([
        page.locator(".site-pet__bubble").boundingBox(),
        page.locator(".home-topbar").boundingBox(),
      ]);
      assert.ok(
        bubbleRect && topbarRect && bubbleRect.y >= topbarRect.y + topbarRect.height,
        `${config.name}: pet tip overlaps the home navigation`
      );
    }
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-pet-tip.png` });
    await page.locator(".site-pet__bubble-message").click();
    await page.locator(".site-pet__bubble").waitFor({ state: "hidden" });

    const beforeTop = Number.parseFloat(await pet.evaluate((element) => element.style.top));
    const keyboardResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/auth/me/pet")
      && response.request().method() === "PATCH"
    ));
    await character.press("ArrowUp");
    await waitForPageCondition(page, (top) => (
      Number.parseFloat(document.querySelector(".site-pet")?.style.top || "0") < top
    ), beforeTop);
    await keyboardResponse;

    async function dragPet(targetX, targetY, expectSave = true) {
      const dragStart = await character.boundingBox();
      assert.ok(dragStart, `${config.name}: pet character has no drag bounds`);
      const response = expectSave ? page.waitForResponse((candidate) => (
        candidate.url().endsWith("/api/auth/me/pet")
        && candidate.request().method() === "PATCH"
      )) : null;
      await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2);
      await page.mouse.down();
      await page.mouse.move(targetX, targetY, { steps: 32 });
      await page.mouse.up();
      if (response) await response;
    }

    async function waitForDock(side) {
      await waitForPageCondition(page, ({ dockSide, viewportWidth }) => {
        const element = document.querySelector(".site-pet");
        if (element?.dataset.dockSide !== dockSide) return false;
        const bounds = element.getBoundingClientRect();
        return dockSide === "left"
          ? Math.round(bounds.left) === 0
          : Math.round(bounds.right) === viewportWidth;
      }, { dockSide: side, viewportWidth: config.viewport.width });
    }

    const freeStart = await character.boundingBox();
    await dragPet(2, freeStart.y + freeStart.height / 2);
    await waitForDock("left");
    const firstDockState = await page.evaluate(() => {
      const element = document.querySelector(".site-pet");
      const bounds = element.getBoundingClientRect();
      return {
        dockSide: element.dataset.dockSide || "",
        inlineLeft: element.style.left,
        left: bounds.left,
        right: bounds.right,
        preferences: window.ALevelPet.getPreferences(),
      };
    });
    assert.equal(firstDockState.dockSide, "left", `${config.name}: first dock failed ${JSON.stringify(firstDockState)}`);
    assert.equal((await pet.boundingBox()).x, 0);
    assert.equal((await page.evaluate(() => window.ALevelPet.getPreferences())).position.x, 0);
    await page.locator(".site-pet__bubble").waitFor({ state: "visible" });
    assert.match(await page.locator(".site-pet__bubble-message").textContent(), /向外拖出屏幕|outward again/i);

    const shortOutward = await character.boundingBox();
    await dragPet(20, shortOutward.y + shortOutward.height / 2, false);
    await waitForDock("left");
    assert.equal((await pet.boundingBox()).x, 0, `${config.name}: short outward drag did not rebound`);
    assert.equal(await pet.getAttribute("data-dock-side"), "left");

    const releaseLeft = await character.boundingBox();
    await dragPet(90, releaseLeft.y + releaseLeft.height / 2);
    await waitForPageCondition(page, () => !document.querySelector(".site-pet")?.dataset.dockSide);
    assert.equal(await pet.getAttribute("data-dock-side"), null);
    assert.ok((await pet.boundingBox()).x >= 12, `${config.name}: inward drag did not release left dock`);

    const crossToRight = await character.boundingBox();
    await dragPet(config.viewport.width - 2, crossToRight.y + crossToRight.height / 2);
    await waitForDock("right");
    assert.equal((await page.evaluate(() => window.ALevelPet.getPreferences())).position.x, 1);
    const rightRect = await pet.boundingBox();
    assert.equal(Math.round(rightRect.x + rightRect.width), config.viewport.width);

    const releaseRight = await character.boundingBox();
    await dragPet(config.viewport.width - 100, releaseRight.y + releaseRight.height / 2);
    await waitForPageCondition(page, () => !document.querySelector(".site-pet")?.dataset.dockSide);
    assert.equal(await pet.getAttribute("data-dock-side"), null);

    const redockLeft = await character.boundingBox();
    await dragPet(2, redockLeft.y + redockLeft.height / 2);
    await waitForDock("left");
    assert.equal(await pet.getAttribute("data-dock-side"), "left");

    apiMock.failNextPetSave = true;
    const failedClose = await character.boundingBox();
    await dragPet(-70, failedClose.y + failedClose.height / 2);
    await pet.waitFor({ state: "visible" });
    await waitForDock("left");
    assert.equal(await pet.getAttribute("data-dock-side"), "left");
    assert.equal((await pet.boundingBox()).x, 0);
    await page.locator(".site-pet__bubble").waitFor({ state: "visible" });
    assert.match(await page.locator(".site-pet__bubble-message").textContent(), /向外拖出屏幕|outward again/i);

    const successfulClose = await character.boundingBox();
    await dragPet(-70, successfulClose.y + successfulClose.height / 2);
    await pet.waitFor({ state: "hidden" });
    if (config.mobile) {
      await page.locator("#homeMenuToggle").click();
      await page.locator("#homeNav").waitFor({ state: "visible" });
    }
    await page.locator("#openProfile").click();
    await page.locator(".setting-toggle").click();
    await pet.waitFor({ state: "visible" });
    assert.equal(await page.locator("#petSkin").inputValue(), "codex-glass");
    const profileOverflow = await page.locator("#profileDialog").evaluate((dialog) => ({
      scrollWidth: dialog.scrollWidth,
      clientWidth: dialog.clientWidth,
      overflowX: getComputedStyle(dialog).overflowX,
    }));
    assert.ok(
      profileOverflow.scrollWidth <= profileOverflow.clientWidth,
      `${config.name}: profile dialog has horizontal overflow ${JSON.stringify(profileOverflow)}`
    );
    assert.equal(profileOverflow.overflowX, "hidden");
    assert.deepEqual(run.errors, [], `${config.name}-pet-controls: page errors ${JSON.stringify(run.errors)}`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-pet-controls: failed requests`);
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-pet-controls.png` });
  } finally {
    await run.context.close();
  }
}

async function verifyAdminHintReview(browser, config) {
  const run = await openPage(browser, config, "/pages/admin.html");
  const { page } = run;
  try {
    await page.locator(".admin-hint-card").waitFor({ state: "visible" });
    assert.equal(await page.locator(".site-pet").count(), 0, `${config.name}: pet must be absent from admin`);
    await page.locator(".admin-hint-question img").waitFor({ state: "visible" });
    assert.equal(await page.locator(".admin-hint-steps li").count(), 3);
    await page.locator("[data-hint-review='approved']").click();
    await page.locator(".admin-hint-card").waitFor({ state: "detached" });
    assert.match(await page.locator("#adminHintReviewStatus").textContent(), /1\/24/);
    assert.deepEqual(run.errors, [], `${config.name}-admin-hints: page errors ${JSON.stringify(run.errors)}`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-admin-hints: failed requests`);
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-admin-hints.png`, fullPage: true });
  } finally {
    await run.context.close();
  }
}

async function verifyStudentAdminBoundary(browser, config) {
  const context = await browser.newContext({
    viewport: config.viewport,
    ignoreHTTPSErrors: /^https:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(new URL(baseUrl).origin),
  });
  const page = await context.newPage();
  const student = { ...user, role: "student" };
  const adminRequests = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/admin/")) adminRequests.push(request.url());
  });
  try {
    await seedStorage(page, "/pages/admin.html", "en", student);
    await mockApi(page, student, 300);
    await page.goto(`${baseUrl}/pages/admin.html`, { waitUntil: "domcontentloaded" });
    assert.equal(await page.locator("#adminContent").isHidden(), true, `${config.name}: admin content was visible before role verification`);
    await page.waitForURL(/\/pages\/admin-login\.html$/);
    await page.locator("#adminLoginTitle").waitFor({ state: "visible" });
    assert.deepEqual(adminRequests, [], `${config.name}: student session called an admin API`);
  } finally {
    await context.close();
  }
}

async function closeMathKeyboard(page) {
  await page.waitForTimeout(50);
  const close = page.locator("#communityMathKeyboardClose");
  if (await close.isVisible()) await close.click();
  await page.locator("#communityMathKeyboard").waitFor({ state: "hidden" });
}

async function verifyCommunity(browser, config) {
  const run = await openPage(browser, config, "/pages/community.html", { theme: "light" });
  const { page } = run;
  const dialogs = [];
  const externalImageRequests = [];
  page.on("request", (request) => {
    if (request.url().startsWith("https://external.invalid/")) externalImageRequests.push(request.url());
  });
  page.on("dialog", async (dialog) => {
    dialogs.push({ type: dialog.type(), message: dialog.message() });
    if (dialog.type() === "prompt") await dialog.accept("UI smoke report");
    else await dialog.accept();
  });
  try {
    await page.locator(".discussion-thread").first().waitFor({ state: "visible" });
    assert.equal(await page.locator(".discussion-thread").count(), 2);
    assert.equal(await page.locator(".community-filter-card").getAttribute("open"), config.mobile ? null : "");
    assert.equal(
      await page.locator("#communitySyllabusCode option[value='0654']").textContent(),
      "0654 - Co-ordinated Sciences"
    );
    assert.equal(
      await page.locator(".discussion-thread").first().locator(".thread-title-button span").last().textContent(),
      "Question about CIE-IGCHEM-2023-S-22-01"
    );
    assert.equal(
      await page.locator(".discussion-thread").nth(1).locator(".thread-title-button span").last().textContent(),
      "离子方程式中旁观离子如何快速判断？"
    );

    const zhRun = await openPage(browser, config, "/pages/community.html", { language: "zh-CN" });
    try {
      await zhRun.page.locator(".discussion-thread").first().waitFor({ state: "visible" });
      assert.equal(
        await zhRun.page.locator("#communitySyllabusCode option[value='0654']").textContent(),
        "0654 - 协调科学"
      );
      assert.equal(
        await zhRun.page.locator(".discussion-thread").first().locator(".thread-title-button span").last().textContent(),
        "关于题目 CIE-IGCHEM-2023-S-22-01 的疑问"
      );
      assert.equal(
        await zhRun.page.locator(".discussion-thread").nth(1).locator(".thread-title-button span").last().textContent(),
        "离子方程式中旁观离子如何快速判断？"
      );
      assert.deepEqual(zhRun.errors, [], `${config.name}-community-zh: page errors`);
      assert.deepEqual(zhRun.failedRequests, [], `${config.name}-community-zh: failed requests`);
    } finally {
      await zhRun.context.close();
    }

    await page.locator("#communityFollowedToggle").click();
    await waitForPageCondition(page, () => document.querySelectorAll(".discussion-thread").length === 1);
    assert.equal(await page.locator(".discussion-thread").count(), 1);
    await page.locator("#communityFollowedToggle").click();
    await waitForPageCondition(page, () => document.querySelectorAll(".discussion-thread").length === 2);

    await page.locator("#communityNewThread").click();
    await page.locator("#communitySubmitThread").click();
    await page.locator("#communityComposerError").waitFor({ state: "visible" });
    assert.equal(await page.locator("#communityTitle").getAttribute("aria-invalid"), "true");

    await page.locator("#communityTitle").fill("测试讨论标题");
    assert.equal(await page.locator("#communityComposerError").isHidden(), true);
    await page.locator("#communitySubmitThread").click();
    assert.equal(await page.locator("#communityBodyEditor").getAttribute("aria-invalid"), "true");
    await page.locator("#communityComposerError").waitFor({ state: "visible" });
    await page.locator("#communityTitle").fill("正文错误不应被标题输入清除");
    assert.equal(await page.locator("#communityComposerError").isVisible(), true);

    await page.locator("#communityBodyEditor").fill("临时正文");
    assert.equal(await page.locator("#communityComposerError").isHidden(), true);
    await page.locator("#communityBodyEditor").evaluate((editor) => {
      const range = document.createRange();
      range.selectNodeContents(editor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.locator("#communityFormattingToolbar").waitFor({ state: "visible" });
    await assertElevatedSurface(page, "#communityFormattingToolbar", `${config.name}-formatting-toolbar`);
    await page.locator("[data-format-command='link']").click();
    await page.locator("#communityComposerError").waitFor({ state: "visible" });
    assert.match(await page.locator("#communityComposerError").textContent(), /链接|link|URL/i);
    await page.locator("#communityBodyEditor").fill("");

    await page.locator("#communityInsertFormula").click();
    await page.locator(".rich-editor-math").waitFor({ state: "visible" });
    await assertElevatedSurface(page, "#communityMathKeyboard", `${config.name}-math-keyboard`);
    const mathCloseRect = await page.locator("#communityMathKeyboardClose").boundingBox();
    assert.ok(
      mathCloseRect && mathCloseRect.y >= 0 && mathCloseRect.y < config.viewport.height,
      `${config.name}: math keyboard close control is outside viewport`
    );
    const closeStylesMatch = await page.evaluate(() => {
      const profileClose = document.createElement("button");
      profileClose.className = "profile-dialog__close";
      profileClose.textContent = "x";
      document.body.appendChild(profileClose);
      const mathClose = document.querySelector("#communityMathKeyboardClose");
      const properties = ["width", "height", "borderRadius", "padding", "fontSize", "fontWeight", "lineHeight", "backgroundColor", "boxShadow"];
      const read = (element) => {
        const style = getComputedStyle(element);
        return Object.fromEntries(properties.map((property) => [property, style[property]]));
      };
      const result = { profile: read(profileClose), math: read(mathClose) };
      profileClose.remove();
      return result;
    });
    assert.deepEqual(closeStylesMatch.math, closeStylesMatch.profile, `${config.name}: math and profile close controls differ`);
    await closeMathKeyboard(page);
    await page.locator("#communitySubmitThread").click();
    assert.equal(await page.locator(".rich-editor-math").getAttribute("aria-invalid"), "true");
    assert.match(await page.locator("#communityComposerError").textContent(), /公式|formula/i);
    await page.locator("math-field").evaluate((mathField) => {
      mathField.setValue("\\frac{\\placeholder{}}{2}");
      mathField.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.locator("#communityComposerError").isHidden(), true);
    await page.locator("#communityTitle").fill("公式错误不应被标题输入清除");
    await closeMathKeyboard(page);
    await page.locator("#communitySubmitThread").click();
    assert.match(await page.locator("#communityComposerError").textContent(), /公式|formula/i);
    await page.locator("#communityTitle").fill("标题输入仍不应清除公式错误");
    assert.equal(await page.locator("#communityComposerError").isVisible(), true);
    await page.locator("math-field").evaluate((mathField) => {
      mathField.setValue("x+1");
      mathField.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal(await page.locator("#communityComposerError").isHidden(), true);
    await closeMathKeyboard(page);
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-community-composer.png`, fullPage: true });

    await page.locator("math-field").click();
    await closeMathKeyboard(page);
    await page.locator("[data-delete-formula]").click();
    await page.locator("#communityBodyEditor").fill("x".repeat(4001));
    await page.locator("#communitySubmitThread").click();
    assert.equal(await page.locator("#communityComposerError").isVisible(), true);
    assert.match(await page.locator("#communityComposerError").textContent(), /长度|length/i);

    await page.locator("#communityPhotoInput").setInputFiles({
      name: "not-an-image.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not an image"),
    });
    assert.equal(await page.locator("#communityComposerError").isVisible(), true);
    assert.match(await page.locator("#communityComposerError").textContent(), /图片|照片|image|photo/i);

    await page.locator("#communityBodyEditor").fill("这是包含 **Markdown** 的测试正文。");
    const imageResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/discussions/images")
      && response.request().method() === "POST"
    ));
    await page.locator("#communityPhotoInput").setInputFiles({
      name: "question.png",
      mimeType: "image/png",
      buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    });
    await imageResponse;
    await page.locator("#communityBodyEditor img").waitFor({ state: "visible" });
    await page.locator("#communitySubmitThread").click();
    await page.locator("#communityDetailPanel").waitFor({ state: "visible" });
    await page.locator("#communityToast").waitFor({ state: "visible" });
    await waitForPageCondition(page, () => document.querySelector(".discussion-question-reference img")?.naturalWidth > 0);
    await waitForPageCondition(page, () => document.querySelector(".discussion-post .markdown-body img")?.naturalWidth > 0);
    assert.equal(await page.locator(".discussion-post .markdown-body img").count(), 1);
    assert.deepEqual(externalImageRequests, []);
    const externalLink = page.locator('.discussion-post .markdown-body a[href="https://example.com/reference"]');
    await externalLink.evaluate((element) => {
      element.addEventListener("click", (event) => {
        event.preventDefault();
        window.__externalLinkClicked = true;
      }, { once: true });
    });
    await externalLink.click();
    assert.equal(await page.evaluate(() => window.__externalLinkClicked), true);
    assert.ok(await page.locator(".discussion-post .katex").count() > 0);
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-community-detail.png`, fullPage: true });

    await page.locator("#communitySubmitReply").click();
    await page.locator("#communityReplyError").waitFor({ state: "visible" });
    const replyErrorRect = await page.locator("#communityReplyError").boundingBox();
    assert.ok(replyErrorRect && replyErrorRect.y < config.viewport.height, `${config.name}: reply error is outside the visible UI`);
    const replyResponse = page.waitForResponse((response) => (
      /\/api\/discussions\/[^/]+\/posts$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST"
    ));
    await page.locator("#communityReplyEditor").fill("这是一个测试回答。");
    await page.locator("#communitySubmitReply").click();
    await replyResponse;

    const likeResponse = page.waitForResponse((response) => (
      /\/api\/discussions\/posts\/[^/]+\/like$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST"
    ));
    await page.locator("[data-like-post][data-liked='0']").first().click();
    await likeResponse;

    const flagResponse = page.waitForResponse((response) => (
      /\/api\/discussions\/posts\/[^/]+\/flag$/.test(new URL(response.url()).pathname)
      && response.request().method() === "POST"
    ));
    await page.locator("[data-flag-post]").first().click();
    await flagResponse;

    const deleteResponse = page.waitForResponse((response) => (
      /\/api\/discussions\/posts\/[^/]+$/.test(new URL(response.url()).pathname)
      && response.request().method() === "DELETE"
    ));
    await page.locator("[data-delete-post]").first().click();
    await deleteResponse;

    const moderationResponse = page.waitForResponse((response) => (
      /\/api\/discussions\/[^/]+\/moderation$/.test(new URL(response.url()).pathname)
      && response.request().method() === "PATCH"
    ));
    await page.locator("#communitySaveModeration").click();
    await moderationResponse;

    await page.locator("#communityFollowToggle").click();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await waitForPageCondition(page, () => (
      document.querySelector("#communityToastMessage")?.textContent.includes("Simulated follow failure")
    ));
    assert.match(await page.locator("#communityToastMessage").textContent(), /Simulated follow failure/);
    const toastRect = await page.locator("#communityToast").boundingBox();
    assert.ok(toastRect && toastRect.y >= 0 && toastRect.y < config.viewport.height, `${config.name}: toast is outside viewport`);
    await assertElevatedSurface(page, "#communityToast", `${config.name}-toast`);
    await page.locator("#communityToastClose").click();
    assert.equal(await page.locator("#communityToast").isHidden(), true);
    assert.ok(dialogs.some((dialog) => dialog.type === "prompt"), `${config.name}: flag prompt was not shown`);
    assert.ok(dialogs.some((dialog) => dialog.type === "confirm"), `${config.name}: delete confirmation was not shown`);

    await page.locator("#communityCloseDetail").click();
    await page.locator("#communityListPanel").waitFor({ state: "visible" });
    await assertPageGeometry(page, `${config.name}-community-light`);
    await assertThemeSurface(page, `${config.name}-community-light`, "light");
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-community-light.png`, fullPage: true });
    await page.locator("#themeToggle").click();
    await waitForPageCondition(page, () => {
      if (document.documentElement.dataset.theme !== "dark") return false;
      const style = getComputedStyle(document.querySelector(".community-surface"));
      const backdrop = style.backdropFilter || style.webkitBackdropFilter || "none";
      return style.backgroundColor === "rgba(255, 255, 255, 0.07)" && backdrop.includes("blur(20px)");
    });
    await assertThemeSurface(page, `${config.name}-community-dark`, "dark");
    await assertPageGeometry(page, `${config.name}-community-dark`);
    assert.deepEqual(run.errors, [], `${config.name}-community: page errors`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-community: failed requests`);
    await captureScreenshot(page, { path: `/var/tmp/student-ui-${config.name}-community-dark.png`, fullPage: true });
  } finally {
    await run.context.close();
  }
}

const pageSpecs = [
  {
    name: "home",
    path: "/index.html",
    ready: ".course-card--biology",
    glass: false,
    verify: async (page) => {
      assert.equal(await page.locator(".home-brand__mark").textContent(), "E");
      assert.equal(await page.locator("[data-i18n='homeBrand']").textContent(), "ExPassway");
      assert.equal(await page.locator(".course-card").count(), 4);
    },
  },
  { name: "generate", path: "/pages/generate.html", ready: ".paper-set-item", verify: async (page) => assert.equal(await page.locator(".paper-set-item").count(), 2) },
  { name: "biology", path: "/pages/biology.html", ready: ".chapter-band", verify: async (page) => assert.equal(await page.locator(".chapter-band").count(), 20) },
  { name: "notebook", path: "/pages/notebook.html", ready: ".notebook-question", verify: async (page) => assert.equal(await page.locator(".notebook-question").count(), 10) },
  { name: "review", path: "/pages/review.html", ready: ".review-answer-overview", verify: async (page) => assert.equal(await page.locator(".review-question-card").count(), 2) },
  { name: "analysis", path: "/pages/analysis.html", ready: ".bar", verify: async (page) => assert.equal(await page.locator(".bar").count(), 2) },
  { name: "admin", path: "/pages/admin.html", ready: "#adminHintReviewPanel", pet: false },
  { name: "curriculum-review", path: "/pages/curriculum-review.html", ready: "#refreshMappings", pet: false },
  {
    name: "image-mapper",
    path: "/pages/image-mapper.html",
    ready: "#mappingInput",
    pet: false,
    verify: async (page) => {
      const externalRequests = [];
      page.on("request", (request) => {
        if (request.url().startsWith("https://external.invalid/")) externalRequests.push(request.url());
      });
      const sameOriginAbsolute = await page.evaluate(() => `${location.origin}/assets/question-images/0620_s23_qp_21/q01_full.png`);
      await page.locator("#basePrefix").fill("");
      await page.locator("#mappingInput").fill([
        "1 /assets/question-images/0620_s23_qp_21/q01_full.png",
        `2 ${sameOriginAbsolute}`,
        "3 https://external.invalid/tracker.png",
      ].join("\n"));
      await page.locator("#previewBtn").click();
      const output = JSON.parse(await page.locator("#jsonOutput").textContent());
      assert.deepEqual(Object.keys(output), ["1", "2"]);
      assert.equal(await page.locator("#previewWrap img").count(), 2);
      await page.locator("#previewWrap").scrollIntoViewIfNeeded();
      await waitForPageCondition(
        page,
        () => Array.from(document.querySelectorAll("#previewWrap img")).every((image) => image.naturalWidth > 0),
        undefined,
        15000,
      );
      assert.match(await page.locator("#mapperStatus").textContent(), /same origin|同源|站内/i);
      assert.deepEqual(externalRequests, []);
    },
  },
  { name: "pdf-cut-preview", path: "/pages/pdf-cut-preview.html", ready: ".hero h1", pet: false },
];

async function runConfig(config) {
  const browser = await config.browser.launch({
    headless: true,
    ...(config.executablePath ? { executablePath: config.executablePath } : {}),
  });
  try {
    if (process.env.STUDENT_UI_FOCUS === "practice") {
      await verifyHomeThemes(browser, config);
      await verifyGeneratedPaper(browser, config);
      return;
    }
    if (process.env.STUDENT_UI_FOCUS === "security") {
      for (const pageSpec of pageSpecs.filter(({ name }) => ["home", "generate", "review", "image-mapper"].includes(name))) {
        await verifyStandardPage(browser, config, pageSpec);
        console.log(JSON.stringify({ viewport: config.name, page: pageSpec.name, ok: true }));
      }
      await verifyHomeThemes(browser, config);
      console.log(JSON.stringify({ viewport: config.name, page: "home-themes", ok: true }));
      await verifyGeneratedPaper(browser, config, { layoutChecks: false });
      console.log(JSON.stringify({ viewport: config.name, page: "generated-paper", ok: true }));
      await verifyCommunity(browser, config);
      console.log(JSON.stringify({ viewport: config.name, page: "community", ok: true }));
      await verifyPetControls(browser, config);
      console.log(JSON.stringify({ viewport: config.name, page: "pet-controls", ok: true }));
      return;
    }
    for (const pageSpec of pageSpecs) {
      await verifyStandardPage(browser, config, pageSpec);
      console.log(JSON.stringify({ viewport: config.name, page: pageSpec.name, ok: true }));
    }
    await verifyHomeThemes(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "home-themes", ok: true }));
    await verifyGeneratedPaper(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "generated-paper", ok: true }));
    await verifyCommunity(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "community", ok: true }));
    await verifyPetControls(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "pet-controls", ok: true }));
    await verifyAdminHintReview(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "admin-hints", ok: true }));
    await verifyStudentAdminBoundary(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "admin-student-boundary", ok: true }));
  } finally {
    await browser.close();
  }
}

(async () => {
  const only = process.env.STUDENT_UI_ONLY || "";
  if (!only || only === "desktop") {
    await runConfig({ name: "desktop-chromium", browser: chromium, viewport: { width: 1440, height: 900 }, mobile: false });
  }
  if (!only || only === "mobile") {
    await runConfig({
      name: "mobile-webkit",
      browser: webkit,
      viewport: { width: 390, height: 844 },
      mobile: true,
      executablePath: process.env.WEBKIT_EXECUTABLE_PATH,
    });
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
