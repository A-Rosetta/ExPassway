const assert = require("node:assert/strict");
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
      { id: "post-1", threadId: thread.id, authorId: "author-1", authorName: "Alice", body: "我先列出了 $n=m/M_r$，但不确定下一步。", liked: false, likeCount: 2, flagCount: 0, createdAt: now },
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

async function mockApi(page) {
  let petPreferences = structuredClone(user.pet);
  let hintReviewStatus = "pending_review";
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (path === "/api/auth/me") return json(route, { ...user, pet: petPreferences });
    if (path === "/api/auth/me/pet" && method === "PATCH") {
      const body = request.postDataJSON();
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
        latestUsers: [user],
        latestPractices: [],
      });
    }
    if (path === "/api/admin/subjects") return json(route, subjects);
    if (path === "/api/admin/imports") return json(route, []);
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
      return json(route, { url: "../assets/question-images/0620_s23_qp_21/q01_full.png" }, 201);
    }
    if (/^\/api\/discussions\//.test(path) && method !== "GET") return json(route, { ok: true });
    if (/^\/api\/users\//.test(path)) return json(route, []);

    return json(route, { ok: false, error: { message: `Unhandled mock route: ${method} ${path}` } }, 501);
  });
}

async function seedStorage(page, pathname, language = "en") {
  await page.addInitScript(({ path, currentUser, result, questions, selectedLanguage }) => {
    localStorage.clear();
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
    currentUser: user,
    result: practiceResult,
    questions: reviewQuestions,
    selectedLanguage: language,
  });
}

async function assertPageGeometry(page, label) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const clippedButtons = [...document.querySelectorAll("button, .btn-link")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length;
      })
      .filter((element) => element.scrollWidth > element.clientWidth + 2 || element.scrollHeight > element.clientHeight + 2)
      .map((element) => element.id || element.textContent.trim().slice(0, 40));
    return {
      scrollWidth: root.scrollWidth,
      clientWidth: root.clientWidth,
      clippedButtons,
      studentUi: document.body.classList.contains("student-ui"),
    };
  });
  assert.equal(geometry.studentUi, true, `${label}: student UI scope missing`);
  assert.ok(geometry.scrollWidth <= geometry.clientWidth + 1, `${label}: horizontal overflow ${JSON.stringify(geometry)}`);
  assert.deepEqual(geometry.clippedButtons, [], `${label}: clipped controls`);
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
            .filter((rule) => rule.selectorText?.includes(".student-ui input:focus-visible"))
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
    focus.focusRules.some((rule) => /solid 3px/.test(rule)),
    `${label}: project focus indicator rule is missing ${JSON.stringify(focus)}`
  );
  const durations = focus.transitionDuration.split(",").map((value) => Number.parseFloat(value) || 0);
  assert.ok(durations.every((value) => value <= 0.01), `${label}: reduced motion was not applied ${JSON.stringify(focus)}`);
}

async function assertGlass(page, label) {
  const glass = await page.locator(".card, .community-surface, .course-card, .chapter-band").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      radii: [
        style.borderTopLeftRadius,
        style.borderTopRightRadius,
        style.borderBottomRightRadius,
        style.borderBottomLeftRadius,
      ],
      background: style.backgroundColor,
      backdrop: style.backdropFilter || style.webkitBackdropFilter || "none",
    };
  });
  assert.ok(
    glass.radii.every((radius) => Number.parseFloat(radius) <= 8),
    `${label}: surface radius exceeds 8px ${JSON.stringify(glass)}`
  );
  assert.notEqual(glass.background, "rgba(0, 0, 0, 0)", `${label}: transparent surface has no fallback`);
  const blur = glass.backdrop.match(/blur\((\d+(?:\.\d+)?)px\)/);
  assert.ok(blur && Number(blur[1]) >= 24, `${label}: glass blur is missing ${JSON.stringify(glass)}`);
}

async function openPage(browser, config, pathname, options = {}) {
  const context = await browser.newContext({
    viewport: config.viewport,
    reducedMotion: "reduce",
  });
  const page = await context.newPage();
  if (options.clock) await page.clock.install();
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("requestfailed", (request) => failedRequests.push(`${request.method()} ${request.url()}`));
  await seedStorage(page, pathname, options.language);
  await mockApi(page);
  await page.goto(`${baseUrl}${pathname}`, { waitUntil: "networkidle" });
  return { context, page, errors, failedRequests };
}

async function verifyStandardPage(browser, config, pageSpec) {
  const run = await openPage(browser, config, pageSpec.path);
  try {
    await run.page.locator(pageSpec.ready).first().waitFor({ state: "visible" });
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
    await assertPageGeometry(run.page, `${config.name}-${pageSpec.name}`);
    if (pageSpec.glass !== false) await assertGlass(run.page, `${config.name}-${pageSpec.name}`);
    await assertAccessibleMotion(run.page, `${config.name}-${pageSpec.name}`);
    assert.deepEqual(run.errors, [], `${config.name}-${pageSpec.name}: page errors`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-${pageSpec.name}: failed requests`);
    await run.page.screenshot({
      path: `/var/tmp/student-ui-${config.name}-${pageSpec.name}.png`,
      fullPage: true,
    });
  } finally {
    await run.context.close();
  }
}

async function verifyGeneratedPaper(browser, config) {
  const run = await openPage(browser, config, "/pages/generate.html", { clock: true });
  const { page } = run;
  try {
    await page.locator(".paper-set-btn.start").click();
    await page.locator("[data-mode-card='timed']").click();
    assert.equal(await page.locator("input[name='practiceMode'][value='timed']").isChecked(), true);
    await page.locator("#startModePageBtn").click();
    await page.locator(".question").first().waitFor({ state: "visible" });
    await page.locator("#timerDisplay").waitFor({ state: "visible" });
    const questionImage = page.locator(".question-image img").first();
    await questionImage.waitFor({ state: "visible" });
    assert.equal(await page.locator(".option-item").count(), 4);
    await page.locator("[id^='hintBtn_']").first().click();
    await page.waitForFunction(() => /提示 1\/3|Hint 1\/3/.test(
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
    await page.waitForFunction(() => /提示 2\/3|Hint 2\/3/.test(
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
    const overlaps = await page.evaluate(() => {
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
    });
    assert.deepEqual(overlaps, [], `${config.name}: timer overlaps page content ${JSON.stringify(overlaps)}`);
    await assertPageGeometry(page, `${config.name}-generated-paper`);
    await assertAccessibleMotion(page, `${config.name}-generated-paper`);
    assert.deepEqual(run.errors, [], `${config.name}-generated-paper: page errors`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-generated-paper: failed requests`);
    await questionImage.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-generated-question.png` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-generated-paper.png`, fullPage: true });
  } finally {
    await run.context.close();
  }
}

async function verifyPetControls(browser, config) {
  const run = await openPage(browser, config, "/index.html");
  const { page } = run;
  try {
    const pet = page.locator(".site-pet");
    const character = page.locator(".site-pet__character");
    await pet.waitFor({ state: "visible" });
    await character.hover();
    assert.equal(await page.locator(".site-pet__close").evaluate((button) => getComputedStyle(button).pointerEvents), "auto");

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
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-pet-tip.png` });
    await page.locator(".site-pet__bubble-message").click();
    await page.locator(".site-pet__bubble").waitFor({ state: "hidden" });

    const beforeTop = Number.parseFloat(await pet.evaluate((element) => element.style.top));
    const keyboardResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/auth/me/pet")
      && response.request().method() === "PATCH"
    ));
    await character.press("ArrowUp");
    await page.waitForFunction((top) => (
      Number.parseFloat(document.querySelector(".site-pet")?.style.top || "0") < top
    ), beforeTop);
    await keyboardResponse;

    if (!config.mobile) {
      const dragStart = await character.boundingBox();
      await page.mouse.move(dragStart.x + dragStart.width / 2, dragStart.y + dragStart.height / 2);
      await page.mouse.down();
      await page.mouse.move(120, 180, { steps: 8 });
      await page.mouse.up();
      await page.waitForFunction(() => window.ALevelPet.getPreferences().position.x < 0.2);
      const afterDrag = await pet.boundingBox();
      assert.ok(
        afterDrag.x >= 0 && afterDrag.y >= 0 && afterDrag.x < 180,
        `${config.name}: pet drag did not persist in the viewport ${JSON.stringify(afterDrag)}`
      );
    }

    await character.hover();
    const closeResponse = page.waitForResponse((response) => (
      response.url().endsWith("/api/auth/me/pet")
      && response.request().method() === "PATCH"
    ));
    await page.locator(".site-pet__close").click();
    await closeResponse;
    await pet.waitFor({ state: "hidden" });
    await page.locator("#openProfile").click();
    await page.locator(".setting-toggle").click();
    await pet.waitFor({ state: "visible" });
    assert.equal(await page.locator("#petSkin").inputValue(), "codex-glass");
    assert.deepEqual(run.errors, [], `${config.name}-pet-controls: page errors ${JSON.stringify(run.errors)}`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-pet-controls: failed requests`);
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-pet-controls.png` });
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
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-admin-hints.png`, fullPage: true });
  } finally {
    await run.context.close();
  }
}

async function closeMathKeyboard(page) {
  await page.waitForTimeout(50);
  const close = page.locator("#communityMathKeyboardClose");
  if (await close.isVisible()) await close.click();
  await page.locator("#communityMathKeyboard").waitFor({ state: "hidden" });
}

async function verifyCommunity(browser, config) {
  const run = await openPage(browser, config, "/pages/community.html");
  const { page } = run;
  const dialogs = [];
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
    await page.waitForFunction(() => document.querySelectorAll(".discussion-thread").length === 1);
    assert.equal(await page.locator(".discussion-thread").count(), 1);
    await page.locator("#communityFollowedToggle").click();
    await page.waitForFunction(() => document.querySelectorAll(".discussion-thread").length === 2);

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
    await page.locator("[data-format-command='link']").click();
    await page.locator("#communityComposerError").waitFor({ state: "visible" });
    assert.match(await page.locator("#communityComposerError").textContent(), /链接|link|URL/i);
    await page.locator("#communityBodyEditor").fill("");

    await page.locator("#communityInsertFormula").click();
    await page.locator(".rich-editor-math").waitFor({ state: "visible" });
    const mathCloseRect = await page.locator("#communityMathKeyboardClose").boundingBox();
    assert.ok(
      mathCloseRect && mathCloseRect.y >= 0 && mathCloseRect.y < config.viewport.height,
      `${config.name}: math keyboard close control is outside viewport`
    );
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
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-community-composer.png`, fullPage: true });

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
    await page.waitForFunction(() => document.querySelector(".discussion-question-reference img")?.naturalWidth > 0);
    assert.ok(await page.locator(".discussion-post .katex").count() > 0);
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-community-detail.png`, fullPage: true });

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
    await page.waitForFunction(() => (
      document.querySelector("#communityToastMessage")?.textContent.includes("Simulated follow failure")
    ));
    assert.match(await page.locator("#communityToastMessage").textContent(), /Simulated follow failure/);
    const toastRect = await page.locator("#communityToast").boundingBox();
    assert.ok(toastRect && toastRect.y >= 0 && toastRect.y < config.viewport.height, `${config.name}: toast is outside viewport`);
    await page.locator("#communityToastClose").click();
    assert.equal(await page.locator("#communityToast").isHidden(), true);
    assert.ok(dialogs.some((dialog) => dialog.type === "prompt"), `${config.name}: flag prompt was not shown`);
    assert.ok(dialogs.some((dialog) => dialog.type === "confirm"), `${config.name}: delete confirmation was not shown`);

    await page.locator("#communityCloseDetail").click();
    await page.locator("#communityListPanel").waitFor({ state: "visible" });
    await assertPageGeometry(page, `${config.name}-community`);
    await assertGlass(page, `${config.name}-community`);
    assert.deepEqual(run.errors, [], `${config.name}-community: page errors`);
    assert.deepEqual(run.failedRequests, [], `${config.name}-community: failed requests`);
    await page.screenshot({ path: `/var/tmp/student-ui-${config.name}-community.png`, fullPage: true });
  } finally {
    await run.context.close();
  }
}

const pageSpecs = [
  {
    name: "login",
    path: "/pages/login.html",
    ready: "#emailContinueBtn",
    pet: false,
    glass: false,
    verify: async (page) => {
      await page.locator("#userEmail").fill("ui-test@example.test");
      await page.locator("#emailContinueBtn").click();
      await page.locator("#loginBtn").waitFor({ state: "visible" });
    },
  },
  {
    name: "home",
    path: "/index.html",
    ready: ".course-card--biology",
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
];

async function runConfig(config) {
  const browser = await config.browser.launch({
    headless: true,
    ...(config.executablePath ? { executablePath: config.executablePath } : {}),
  });
  try {
    for (const pageSpec of pageSpecs) {
      await verifyStandardPage(browser, config, pageSpec);
      console.log(JSON.stringify({ viewport: config.name, page: pageSpec.name, ok: true }));
    }
    await verifyGeneratedPaper(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "generated-paper", ok: true }));
    await verifyCommunity(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "community", ok: true }));
    await verifyPetControls(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "pet-controls", ok: true }));
    await verifyAdminHintReview(browser, config);
    console.log(JSON.stringify({ viewport: config.name, page: "admin-hints", ok: true }));
  } finally {
    await browser.close();
  }
}

(async () => {
  await runConfig({ name: "desktop-chromium", browser: chromium, viewport: { width: 1440, height: 900 }, mobile: false });
  await runConfig({
    name: "mobile-webkit",
    browser: webkit,
    viewport: { width: 390, height: 844 },
    mobile: true,
    executablePath: process.env.WEBKIT_EXECUTABLE_PATH,
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
