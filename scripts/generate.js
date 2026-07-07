(function () {
  const PRACTICE_MODE_KEY = "alevel.practiceMode";
  const PAPER_SET_KEY = "alevel.selectedPaperSet";
  const USER_ID_KEY = "alevel.userId";
  const { t, applyPage } = window.ALevelI18n;
  const PAPER_SETS = readPaperSets();

  function parseSelection() {
    const raw = localStorage.getItem("alevel.selection");
    return raw ? JSON.parse(raw) : null;
  }

  function getChemistrySelection() {
    return {
      grade: "IGCSE",
      board: "CIE",
      subject: "IGCSE Chemistry",
      paper: "MCQ",
    };
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function currentUserScope() {
    return localStorage.getItem(USER_ID_KEY) || "guest";
  }

  function scopedKey(base) {
    return `${base}:${currentUserScope()}`;
  }

  function readScopedJson(base, fallback) {
    try {
      const raw = localStorage.getItem(scopedKey(base));
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function writeScopedJson(base, value) {
    localStorage.setItem(scopedKey(base), JSON.stringify(value));
  }

  function readPracticeMode() {
    const saved = localStorage.getItem(PRACTICE_MODE_KEY);
    return saved === "timed" ? "timed" : "practice";
  }

  function writePracticeMode(mode) {
    const next = mode === "timed" ? "timed" : "practice";
    localStorage.setItem(PRACTICE_MODE_KEY, next);
    return next;
  }

  function parsePaperSeed() {
    const seedEl = byId("paperSetSeed");
    if (!seedEl?.textContent) return [];
    try {
      const parsed = JSON.parse(seedEl.textContent);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_err) {
      return [];
    }
  }

  function buildPaperTitleFromSlug(slug) {
    const match = String(slug || "").match(/^0620_([sw])(\d{2})_qp_(\d+)$/i);
    if (!match) {
      return {
        title: slug || "Unknown Paper",
        seasonLabel: "Unknown",
        paperCode: "",
      };
    }

    const seasonType = match[1].toLowerCase();
    const year = `20${match[2]}`;
    const qpCode = match[3];
    const seasonLabel = seasonType === "s" ? `May/Jun ${year}` : `Oct/Nov ${year}`;
    const displayCode = `0620/${qpCode.slice(0, 2)}`;
    return {
      title: `${seasonLabel} Chemistry Question Paper - ${displayCode}`,
      seasonLabel,
      paperCode: displayCode,
    };
  }

  function readPaperSets() {
    return parsePaperSeed().map((item, index) => {
      const info = buildPaperTitleFromSlug(item.slug);
      return {
        id: item.slug,
        slug: item.slug,
        pdf: item.pdf || "",
        title: info.title,
        minutes: 45,
        questions: Number(item.rowCount || item.anchorCount || 40),
        seasonLabel: info.seasonLabel,
        paperCode: info.paperCode,
        done: index === 0,
        structuredOk: Number(item.structuredOk || 0),
        structuredNeedsReview: Number(item.structuredNeedsReview || 0),
      };
    });
  }

  function readSelectedPaperSet() {
    const savedId = localStorage.getItem(PAPER_SET_KEY);
    return PAPER_SETS.find((item) => item.id === savedId) || PAPER_SETS[1] || PAPER_SETS[0] || null;
  }

  function writeSelectedPaperSet(id) {
    const next = PAPER_SETS.find((item) => item.id === id) || PAPER_SETS[0] || null;
    if (next) {
      localStorage.setItem(PAPER_SET_KEY, next.id);
    }
    return next;
  }

  function setRunMode(text, isBad) {
    const runMode = byId("runMode");
    if (!runMode) return;
    runMode.textContent = text;
    runMode.className = isBad ? "tip bad" : "tip good";
  }

  function shuffle(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  function formatElapsed(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  const SUB_MAP = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
  const SUP_MAP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻" };

  function toSubscriptDigits(numText) {
    return String(numText || "")
      .split("")
      .map((ch) => SUB_MAP[ch] || ch)
      .join("");
  }

  function toSuperscript(text) {
    return String(text || "")
      .split("")
      .map((ch) => SUP_MAP[ch] || ch)
      .join("");
  }

  function formatChemText(raw) {
    let s = String(raw || "");
    // Remove invisible control chars that often come from PDF extraction.
    s = s.replace(/[\u0000-\u001F\u007F-\u009F]/g, " ");
    s = s
      .replace(/|->|=>/g, " → ")
      .replace(/[□▯▢]/g, " → ")
      .replace(/–|—/g, "-")
      .replace(/\s+/g, " ")
      .trim();

    // Heuristic: if a boxed/unknown separator sat between two formula parts,
    // normalize around plus-joined terms into a reaction arrow.
    s = s.replace(/(\b[A-Za-z0-9₂₃₄₅₆₇₈₉₀⁺⁻+\-\s]+)\s+→\s+([A-Za-z0-9₂₃₄₅₆₇₈₉₀⁺⁻+\-\s]+\b)/g, "$1 → $2");

    // H 2 O -> H₂ O, Cr 2 -> Cr₂
    s = s.replace(/\b([A-Z][a-z]?)\s+(\d+)\b/g, (_m, el, n) => `${el}${toSubscriptDigits(n)}`);

    // Cr2 O7 -> Cr₂O₇
    s = s.replace(/\b([A-Z][a-z]?)(\d+)\b/g, (_m, el, n) => `${el}${toSubscriptDigits(n)}`);

    // 3+ / 2- charge -> ³⁺ / ²⁻
    s = s.replace(/(\d+)\s*([+-])\b/g, (_m, n, sign) => `${toSuperscript(n)}${toSuperscript(sign)}`);

    return s;
  }

  function resolveImageUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
    if (raw.startsWith("/alevel/")) return raw;
    if (raw.startsWith("/assets/")) {
      const pathName = window.location.pathname || "";
      if (pathName.startsWith("/alevel/")) {
        return `/alevel${raw}`;
      }
      return raw;
    }
    return raw;
  }

  function toPositiveInt(value) {
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
  }

  function listQuestionImageSources(source) {
    if (Array.isArray(source?.images) && source.images.length) {
      return source.images.filter(Boolean);
    }
    if (source?.imageUrl) {
      return [{ url: source.imageUrl, position: "stem", order: 1 }];
    }
    return [];
  }

  function normalizeQuestionImageEntry(image, questionIndex, imageIndex) {
    if (!image) return null;

    let detailUrl = "";
    let thumbnailUrl = "";
    let width = null;
    let height = null;

    if (typeof image === "string") {
      detailUrl = image;
    } else if (typeof image === "object") {
      detailUrl = image.detailUrl || image.url || "";
      thumbnailUrl = image.thumbnailUrl || "";
      width = toPositiveInt(image.width);
      height = toPositiveInt(image.height);
    } else {
      return null;
    }

    const src = resolveImageUrl(detailUrl);
    if (!src) return null;

    const thumbnailSrc = resolveImageUrl(thumbnailUrl);
    return {
      src,
      thumbnailSrc: thumbnailSrc || "",
      width,
      height,
      alt: `Q${questionIndex + 1} figure ${imageIndex + 1}`,
    };
  }

  function normalizeQuestionImages(question, questionIndex) {
    return listQuestionImageSources(question)
      .map((image, imageIndex) => normalizeQuestionImageEntry(image, questionIndex, imageIndex))
      .filter(Boolean);
  }

  function getRenderableImages(question, questionIndex) {
    if (Array.isArray(question?.normalizedImages)) {
      return question.normalizedImages.filter((image) => image?.src);
    }
    return normalizeQuestionImages(question, questionIndex);
  }

  function prefetchImageUrl(url) {
    const src = resolveImageUrl(url);
    if (!src || state.prefetchedImageUrls.has(src)) return;
    state.prefetchedImageUrls.add(src);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }

  function prefetchQuestionImages(question, questionIndex) {
    getRenderableImages(question, questionIndex).forEach((image) => {
      if (image?.src) {
        prefetchImageUrl(image.src);
      }
    });
  }

  function prefetchAdjacentQuestionImages(questions, activeIndex) {
    if (!Array.isArray(questions) || !questions.length) return;
    window.setTimeout(() => {
      const nextIndex = activeIndex + 1;
      const prevIndex = activeIndex - 1;
      if (questions[nextIndex]) {
        prefetchQuestionImages(questions[nextIndex], nextIndex);
      }
      if (questions[prevIndex]) {
        prefetchQuestionImages(questions[prevIndex], prevIndex);
      }
    }, 0);
  }

  function buildSubmitPayload(answers, hintUsageMap) {
    return answers.map((selectedIndex, idx) => ({
      selectedIndex: Number.isInteger(selectedIndex) ? selectedIndex : -1,
      hintsUsed: Number(hintUsageMap?.[idx]?.used || 0),
    }));
  }

  function applyFeedback(details) {
    details.forEach((row, idx) => {
      const feedback = byId(`feedback_${idx}`);
      if (!feedback) return;

      if (row.selectedIndex === -1) {
        feedback.innerHTML = `<span class='bad'>${t("notAnsweredCorrectAnswer", { answer: String.fromCharCode(65 + row.answer) })}</span>`;
        return;
      }

      if (row.correct) {
        feedback.innerHTML = `<span class='good'>${t("answeredCorrect")}</span>`;
      } else {
        feedback.innerHTML = `<span class='bad'>${t("answeredWrong", { answer: String.fromCharCode(65 + row.answer) })}</span>`;
      }
    });
  }

  function initHintState(questions) {
    const map = {};
    (questions || []).forEach((q, idx) => {
      map[idx] = {
        used: 0,
        total: Array.isArray(q.hints) ? q.hints.length : 0,
      };
    });
    return map;
  }

  function buildWrongLog(details) {
    const logs = {};
    details.forEach((d) => {
      if (!logs[d.topic]) {
        logs[d.topic] = { topic: d.topic, mistake: d.mistakeType, correct: 0, wrong: 0 };
      }
      if (d.correct) logs[d.topic].correct += 1;
      else logs[d.topic].wrong += 1;
    });
    return Object.values(logs);
  }

  function evaluateLocal(questions, answers, hintUsageMap) {
    let correct = 0;
    const details = [];

    for (let idx = 0; idx < questions.length; idx += 1) {
      const q = questions[idx];
      const selectedIndex = answers[idx] ?? -1;
      const ok = selectedIndex === q.answer;
      if (ok) correct += 1;

      details.push({
        id: q.id,
        topic: q.topic,
        skills: Array.isArray(q.skills) ? q.skills : [],
        mistakeType: q.mistakeType || "concept",
        correct: ok,
        selectedIndex,
        answer: q.answer,
        hintsUsed: Number(hintUsageMap?.[idx]?.used || 0),
        hintTotal: Array.isArray(q.hints) ? q.hints.length : 0,
      });
    }

    const hintRows = Object.values(hintUsageMap || {});
    const hintUsedQuestions = hintRows.filter((x) => x.used > 0).length;
    const totalHintClicks = hintRows.reduce((sum, x) => sum + (x.used || 0), 0);

    return {
      total: questions.length,
      correct,
      wrong: questions.length - correct,
      accuracy: questions.length ? (correct / questions.length) * 100 : 0,
      hintUsedQuestions,
      totalHintClicks,
      details,
      submittedAt: new Date().toISOString(),
      elapsedSeconds: 0,
    };
  }

  function persistResult(result, wrongLog) {
    writeScopedJson("alevel.lastResult", result);
    writeScopedJson("alevel.wrongLog", wrongLog);
  }

  function persistWrongNotebook(questions, details, selection) {
    const key = scopedKey("alevel.wrongNotebook");
    let rows = [];
    try {
      rows = JSON.parse(localStorage.getItem(key) || "[]");
      if (!Array.isArray(rows)) rows = [];
    } catch (_e) {
      rows = [];
    }

    const now = new Date().toISOString();
    const byIdMap = new Map(rows.map((r) => [r.id, r]));

    (details || []).forEach((d, idx) => {
      if (d.correct) return;
      const q = questions[idx] || {};
      const optionText = (optIdx) =>
        Number.isInteger(optIdx) && optIdx >= 0
          ? `${String.fromCharCode(65 + optIdx)}. ${q.options?.[optIdx] || ""}`
          : t("unanswered");

      const id = q.id || `tmp-${selection?.subject || "unknown"}-${idx + 1}`;
      const prev = byIdMap.get(id);
      const next = {
        id,
        board: q.board || selection?.board || "",
        subject: q.subject || selection?.subject || "",
        paper: q.paper || selection?.paper || "",
        topic: q.topic || "",
        year: q.year || "",
        stem: q.stem || "",
        answer: d.answer,
        answerText: optionText(d.answer),
        lastSelected: d.selectedIndex,
        lastSelectedText: optionText(d.selectedIndex),
        wrongCount: (prev?.wrongCount || 0) + 1,
        firstWrongAt: prev?.firstWrongAt || now,
        lastWrongAt: now,
      };
      byIdMap.set(id, next);
    });

    const merged = Array.from(byIdMap.values()).sort(
      (a, b) => new Date(b.lastWrongAt || 0) - new Date(a.lastWrongAt || 0)
    );
    localStorage.setItem(key, JSON.stringify(merged));
  }

  function goReviewPage() {
    const target = `${window.location.origin}/alevel/pages/review.html`;
    window.location.assign(target);
    // Fallback in case assign is blocked/interrupted by browser state.
    setTimeout(() => {
      if (!window.location.pathname.endsWith("/pages/review.html")) {
        window.location.href = target;
      }
    }, 120);
  }

  function toErrText(err) {
    const status = err?.status ? `HTTP ${err.status}` : "";
    const code = err?.payload?.error?.code || "";
    const msg = err?.message || t("unknownError");
    return [status, code, msg].filter(Boolean).join(" | ");
  }

  function savePendingSubmit(payload) {
    writeScopedJson("alevel.pendingSubmit", payload);
  }

  function hasPracticeHistory() {
    return Array.isArray(state.userPracticeHistory) && state.userPracticeHistory.length > 0;
  }

  function hasCompletedPaper(paper) {
    if (!paper) return false;
    return (state.userPracticeHistory || []).some((row) => {
      const paperName = String(row.paper || "");
      return row.status === "submitted" && paperName.includes(paper.paperCode || "");
    });
  }

  async function loadUserPracticeHistory() {
    const userId = localStorage.getItem(USER_ID_KEY) || "";
    if (!userId || !window.ALevelApi?.getUserPractices) {
      return [];
    }
    try {
      const rows = await window.ALevelApi.getUserPractices(userId, { limit: 100 });
      return Array.isArray(rows) ? rows : [];
    } catch (_err) {
      return [];
    }
  }

  function hasPracticeHistory() {
    const result = readScopedJson("alevel.lastResult", null);
    return Boolean(result && Array.isArray(result.details) && result.details.length);
  }

  function getStructuredPaperSlug() {
    return state.selectedPaperSet?.slug || PAPER_SETS[1]?.slug || PAPER_SETS[0]?.slug || "0620_s23_qp_21";
  }

  async function loadStructuredPaperSet() {
    const base = window.location.pathname.startsWith("/alevel/") ? "/alevel" : "..";
    const slug = getStructuredPaperSlug();
    const [paperRes, answerRes] = await Promise.all([
      fetch(`${base}/backend/src/data/pymupdf-batch/${slug}.structured.json`),
      fetch(`${base}/backend/src/data/pymupdf-batch/answer-keys.json`),
    ]);
    if (!paperRes.ok) {
      throw new Error(`Load paper set failed: ${paperRes.status}`);
    }
    const payload = await paperRes.json();
    const answerKeys = answerRes.ok ? await answerRes.json() : {};
    const answerMap = answerKeys?.[slug] || {};
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    return rows
      .filter((row) => row.options && row.options.A && row.options.B && row.options.C && row.options.D)
      .map((row, index) => {
        const question = {
          id: `CIE-IGCHEM-SET-${slug}-${String(row.questionNo).padStart(2, "0")}`,
          board: "CIE",
          subject: "IGCSE Chemistry",
          paper: "MCQ",
          difficulty: row.questionNo <= 14 ? "Basic" : row.questionNo <= 28 ? "Medium" : "Challenge",
          topic: slug.includes("_w23_") ? "Past Paper Winter" : "Past Paper Summer",
          year: state.selectedPaperSet?.seasonLabel || "2023",
          stem: row.stem || row.rawText || "",
          options: [row.options?.A || "", row.options?.B || "", row.options?.C || "", row.options?.D || ""],
          answer: Number.isInteger(answerMap?.[row.questionNo]) ? answerMap[row.questionNo] : 0,
          mistakeType: "unknown",
          templateId: `${slug}-${row.questionNo}`,
          skills: [],
          hints: [],
          imageUrl: row.imageUrl || "",
          images: listQuestionImageSources(row),
        };

        return {
          ...question,
          normalizedImages: normalizeQuestionImages(question, index),
        };
      });
  }

  function renderScore(result) {
    const box = byId("scoreBox");
    const level = result.accuracy >= 80 ? "good" : "bad";
    box.innerHTML = `
      <h3>${t("currentScore")}</h3>
      <p>${t("scoreText", { correct: result.correct, total: result.total })}</p>
      <p>${t("accuracyLabel")}：<strong class='${level}'>${result.accuracy.toFixed(1)}%</strong></p>
      <p>${t("hintUsageText", { questions: result.hintUsedQuestions || 0, clicks: result.totalHintClicks || 0 })}</p>
      <p class='tip'>${t("submittedAt", { time: new Date(result.submittedAt).toLocaleString() })}</p>
    `;
  }

  function renderPaper(picked, state) {
    const wrap = byId("paperResult");
    wrap.innerHTML = "";

    if (!picked.length) {
      wrap.innerHTML = `<p class='bad'>${t("noMatchedQuestions")}</p>`;
      return;
    }

    const hint = document.createElement("p");
    hint.className = "tip";
    hint.textContent = t("answerHint");
    wrap.appendChild(hint);

    const nav = document.createElement("div");
    nav.className = "actions";
    nav.innerHTML = `
      <button class='btn-secondary' id='prevPage'>${t("prevPage")}</button>
      <p class='tip' id='questionProgress' style='margin:0;align-self:center;'></p>
      <label class='tip' style='margin:0;display:flex;align-items:center;gap:0.35rem;'>
        ${t("jumpTo")}
        <input id='jumpPageInput' type='number' min='1' style='width:84px;padding:0.35rem 0.45rem;' />
        ${t("pageUnit")}
      </label>
      <button class='btn-secondary' id='jumpPageBtn'>${t("jumpBtn")}</button>
      <button class='btn-secondary' id='nextPage'>${t("nextPage")}</button>
    `;
    wrap.appendChild(nav);

    const questionSlot = document.createElement("div");
    questionSlot.id = "questionSlot";
    questionSlot.className = "question-main";

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "question-body-layout";
    bodyWrap.innerHTML = `
      <div id="questionMainWrap"></div>
      <aside class="question-side">
        <div class="question-side-title" id="questionSideTitle">${t("questionPanelTitle")}</div>
        <div id="questionJumpPanel" class="question-jump-panel"></div>
      </aside>
    `;
    wrap.appendChild(bodyWrap);
    const mainWrap = byId("questionMainWrap");
    if (mainWrap) mainWrap.appendChild(questionSlot);

    const navBottom = document.createElement("div");
    navBottom.className = "actions";
    navBottom.innerHTML = `
      <button class='btn-secondary' id='prevPageBottom'>${t("prevPage")}</button>
      <label class='tip' style='margin:0;display:flex;align-items:center;gap:0.35rem;'>
        ${t("jumpTo")}
        <input id='jumpPageInputBottom' type='number' min='1' style='width:84px;padding:0.35rem 0.45rem;' />
        ${t("pageUnit")}
      </label>
      <button class='btn-secondary' id='jumpPageBtnBottom'>${t("jumpBtn")}</button>
      <button class='btn-secondary' id='nextPageBottom'>${t("nextPage")}</button>
    `;
    wrap.appendChild(navBottom);

    const action = document.createElement("div");
    action.className = "actions";
    action.innerHTML = `
      <button class='btn-primary' id='submitPaper'>${t("submitAndReview")}</button>
      <button class='btn-secondary' id='toAnalysis'>${t("goToAnalysis")}</button>
    `;
    wrap.appendChild(action);

    const scoreBox = document.createElement("div");
    scoreBox.id = "scoreBox";
    scoreBox.className = "panel";
    scoreBox.style.marginTop = "0.8rem";
    scoreBox.innerHTML = `<p class='tip'>${t("notSubmittedYet")}</p>`;
    wrap.appendChild(scoreBox);

    renderJumpPanel(picked, state);
    renderCurrentPage(picked, state);
  }

  function renderJumpPanel(picked, state) {
    const panel = byId("questionJumpPanel");
    if (!panel) return;
    const unanswered = picked.reduce((count, _q, idx) => {
      const answered = Number.isInteger(state.selectedAnswers?.[idx]) && state.selectedAnswers[idx] >= 0;
      return answered ? count : count + 1;
    }, 0);
    const title = byId("questionSideTitle");
    if (title) title.textContent = t("unansweredPanel", { count: unanswered });

    panel.innerHTML = picked
      .map((_, idx) => {
        const pageStart = state.currentPageIndex * state.pageSize;
        const pageEnd = Math.min(picked.length, pageStart + state.pageSize) - 1;
        const active = idx >= pageStart && idx <= pageEnd ? "active" : "";
        const answered = Number.isInteger(state.selectedAnswers?.[idx]) && state.selectedAnswers[idx] >= 0 ? "answered" : "";
        return `<button type="button" class="jump-btn ${active} ${answered}" data-jump-index="${idx}">${idx + 1}</button>`;
      })
      .join("");

    const buttons = panel.querySelectorAll("[data-jump-index]");
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const qIdx = Number(btn.getAttribute("data-jump-index"));
        if (!Number.isInteger(qIdx)) return;
        state.currentPageIndex = Math.floor(qIdx / state.pageSize);
        renderJumpPanel(picked, state);
        renderCurrentPage(picked, state);
        bindQuestionInteractions();
      });
    });
  }

  function renderCurrentPage(picked, state) {
    const totalPages = Math.max(1, Math.ceil(picked.length / state.pageSize));
    const pageIndex = Math.max(0, Math.min(state.currentPageIndex, totalPages - 1));
    state.currentPageIndex = pageIndex;
    const slot = byId("questionSlot");
    if (!slot) return;

    const start = pageIndex * state.pageSize;
    const end = Math.min(picked.length, start + state.pageSize);
    const pageQuestions = picked.slice(start, end);

    slot.innerHTML = pageQuestions
      .map((q, localIdx) => {
        const idx = start + localIdx;
        const selectedAnswer = Number.isInteger(state.selectedAnswers?.[idx]) ? state.selectedAnswers[idx] : -1;
        const renderableImages = getRenderableImages(q, idx);
        const hasImages = renderableImages.length > 0;
        const optionsHtml = (q.options || [])
          .map(
            (opt, optIdx) => `
          <label class="option-item">
            <input type="radio" name="q_${idx}" value="${optIdx}" ${selectedAnswer === optIdx ? "checked" : ""} />
            <span class="chem-text">${String.fromCharCode(65 + optIdx)}. ${hasImages ? String.fromCharCode(65 + optIdx) : formatChemText(opt)}</span>
          </label>
        `
          )
          .join("");

        const imagesHtml = renderableImages
          .map((image, imageIdx) => {
            const ratioStyle =
              image.width && image.height ? ` style="--question-image-ratio:${image.width} / ${image.height};"` : "";
            const widthAttr = image.width ? ` width="${image.width}"` : "";
            const heightAttr = image.height ? ` height="${image.height}"` : "";
            const priorityAttr = imageIdx === 0 ? ' fetchpriority="high"' : "";
            const sizingClass = image.width && image.height ? "has-ratio" : "no-ratio";
            return `
              <figure class="question-image ${sizingClass}"${ratioStyle}>
                <img src="${image.src}" alt="${image.alt}"${widthAttr}${heightAttr}${priorityAttr} decoding="async" />
              </figure>
            `;
          })
          .join("");

        const textViewId = `textView_${idx}`;
        return `
          <div class="question">
            <h4 class="chem-text">Q${idx + 1}. ${hasImages ? "" : formatChemText(q.stem)}</h4>
            ${
              hasImages
                ? `
                  <div class="text-toggle-row">
                    <button class='btn-secondary' data-toggle-text='${textViewId}'>${t("showText")}</button>
                  </div>
                `
                : ""
            }
            <div class="tag-row">
              <span class="tag">${q.id}</span>
              <span class="tag">${q.topic}</span>
              <span class="tag">${q.difficulty}</span>
            </div>
            ${
              hasImages
                ? `<div id='${textViewId}' class='tip text-view-box' style='display:none; white-space:pre-wrap;'>${formatChemText(q.stem)}</div>`
                : ""
            }
            ${imagesHtml ? `<div class="question-images-wrap">${imagesHtml}</div>` : ""}
            <div class="options-wrap">${optionsHtml}</div>
            <div class="actions">
              <button class='btn-secondary' id='hintBtn_${idx}'>${t("showHint")}</button>
            </div>
            <div id="hint_${idx}" class="tip"></div>
            <div id="feedback_${idx}" class="tip"></div>
          </div>
        `;
      })
      .join("");

    const progress = byId("questionProgress");
    if (progress) {
      progress.textContent = t("reviewPageProgress", {
        page: pageIndex + 1,
        total: totalPages,
        size: state.pageSize,
      });
    }
    const jumpInput = byId("jumpPageInput");
    if (jumpInput) jumpInput.value = String(pageIndex + 1);
    const jumpInputBottom = byId("jumpPageInputBottom");
    if (jumpInputBottom) jumpInputBottom.value = String(pageIndex + 1);
    const prev = byId("prevPage");
    const next = byId("nextPage");
    const prevBottom = byId("prevPageBottom");
    const nextBottom = byId("nextPageBottom");
    if (prev) prev.disabled = pageIndex === 0;
    if (next) next.disabled = pageIndex === totalPages - 1;
    if (prevBottom) prevBottom.disabled = pageIndex === 0;
    if (nextBottom) nextBottom.disabled = pageIndex === totalPages - 1;
    if (pageQuestions.length) {
      prefetchAdjacentQuestionImages(picked, start);
    }
  }

  function bindQuestionInteractions() {
    const start = state.currentPageIndex * state.pageSize;
    const end = Math.min(state.questions.length, start + state.pageSize);
    for (let idx = start; idx < end; idx += 1) {
      const q = state.questions[idx];
      const hintBtn = byId(`hintBtn_${idx}`);
      const hintEl = byId(`hint_${idx}`);
      if (hintBtn && hintEl && q) {
        hintBtn.onclick = () => {
          const hints = Array.isArray(q.hints) ? q.hints : [];
          if (!hints.length) {
            hintEl.textContent = t("noHintAvailable");
            return;
          }
          const row = state.hintUsageMap[idx];
          const nextIndex = Math.min(row.used, hints.length - 1);
          hintEl.textContent = t("hintProgress", {
            index: nextIndex + 1,
            total: hints.length,
            hint: hints[nextIndex],
          });
          row.used += 1;
          hintBtn.textContent = row.used >= hints.length ? t("allHintsShown") : t("nextHint");
        };
      }
    }

    const toggleButtons = document.querySelectorAll("[data-toggle-text]");
    toggleButtons.forEach((btn) => {
      btn.addEventListener("click", () => {
        const targetId = btn.getAttribute("data-toggle-text");
        const textView = targetId ? byId(targetId) : null;
        if (!textView) return;
        const hidden = textView.style.display === "none";
        textView.style.display = hidden ? "block" : "none";
        btn.textContent = hidden ? t("hideText") : t("showText");
      });
    });

    const radios = document.querySelectorAll('input[name^="q_"]');
    radios.forEach((radio) => {
      radio.addEventListener("change", () => {
        const name = radio.getAttribute("name") || "";
        const m = name.match(/^q_(\d+)$/);
        if (!m) return;
        const idx = Number(m[1]);
        state.selectedAnswers[idx] = Number(radio.value);
        renderJumpPanel(state.questions, state);
      });
    });
  }

  const selection = getChemistrySelection();
  localStorage.setItem("alevel.selection", JSON.stringify(selection));
  const state = {
    mode: "backend",
    practiceMode: readPracticeMode(),
    selectedPaperSet: readSelectedPaperSet(),
    userPracticeHistory: [],
    paperId: null,
    questions: [],
    hintUsageMap: {},
    selectedAnswers: [],
    currentPageIndex: 0,
    pageSize: 1,
    prefetchedImageUrls: new Set(),
    timerStartedAt: 0,
    timerElapsedSeconds: 0,
    timerIntervalId: null,
  };

  function updateTimerDisplay() {
    const timerEl = byId("timerDisplay");
    if (!timerEl) return;
    if (state.practiceMode === "timed") {
      timerEl.textContent = t("timedTestLabel", { time: formatElapsed(state.timerElapsedSeconds) });
      timerEl.style.display = "";
      return;
    }
    timerEl.textContent = t("practiceUntimed");
    timerEl.style.display = "";
  }

  function stopTimer() {
    if (state.timerIntervalId) {
      clearInterval(state.timerIntervalId);
      state.timerIntervalId = null;
    }
  }

  function startTimer() {
    stopTimer();
    state.timerStartedAt = Date.now();
    state.timerElapsedSeconds = 0;
    updateTimerDisplay();
    if (state.practiceMode !== "timed") {
      return;
    }
    state.timerIntervalId = window.setInterval(() => {
      state.timerElapsedSeconds = Math.floor((Date.now() - state.timerStartedAt) / 1000);
      updateTimerDisplay();
    }, 1000);
  }

  function updateModeCardSelection(mode) {
    const cards = document.querySelectorAll("[data-mode-card]");
    cards.forEach((card) => {
      card.classList.toggle("selected", card.getAttribute("data-mode-card") === mode);
    });
    const radios = document.querySelectorAll('input[name="practiceMode"]');
    radios.forEach((radio) => {
      radio.checked = radio.value === mode;
    });
  }

  function syncModeSummary() {
    const subjectValue = byId("modeSubjectValue");
    const paperValue = byId("modePaperValue");
    const countValue = byId("modeQuestionCountValue");
    if (subjectValue) subjectValue.textContent = "Chemistry (0620)";
    if (paperValue) paperValue.textContent = state.selectedPaperSet?.title || t("selectPaperFirst");
    if (countValue) countValue.textContent = String(state.selectedPaperSet?.questions || 40);
  }

  function renderPaperSetList() {
    const wrap = byId("paperSetList");
    if (!wrap) return;
    wrap.innerHTML = PAPER_SETS.map((paper) => `
      <div class="paper-set-item">
        <div class="paper-set-icon ${paper.done ? "done" : "idle"}">${paper.done ? "✓" : "?"}</div>
        <div class="paper-set-main">
          <p class="paper-set-title">${paper.title}</p>
          <div class="paper-set-meta">${paper.minutes} minutes  •  ${paper.questions} questions  •  ${paper.structuredOk} parsed ok / ${paper.structuredNeedsReview} needs review</div>
        </div>
        <div class="paper-set-actions">
          ${hasPracticeHistory() ? '<a class="paper-set-history" href="./review.html">View My History</a>' : ""}
          <button class="paper-set-btn ${hasCompletedPaper(paper) ? "retry" : "start"}" type="button" data-paper-id="${paper.id}">
            ${hasCompletedPaper(paper) ? "Retry Test" : "Start Test"}
          </button>
        </div>
      </div>
    `).join("");

    const buttons = wrap.querySelectorAll("[data-paper-id]");
    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const paper = writeSelectedPaperSet(button.getAttribute("data-paper-id"));
        if (!paper) return;
        state.selectedPaperSet = paper;
        syncModeSummary();
        showModeLanding();
      });
    });
  }

  function showPaperPicker() {
    const picker = byId("paperPickerPage");
    const landing = byId("modeLanding");
    const hero = byId("generateHero");
    const result = byId("resultPanel");
    if (picker) picker.style.display = "block";
    if (landing) landing.style.display = "none";
    if (hero) hero.style.display = "none";
    if (result) result.style.display = "none";
    renderPaperSetList();
  }

  function showModeLanding() {
    const picker = byId("paperPickerPage");
    const landing = byId("modeLanding");
    const hero = byId("generateHero");
    const result = byId("resultPanel");
    if (picker) picker.style.display = "none";
    if (landing) landing.style.display = "block";
    if (hero) hero.style.display = "none";
    if (result) result.style.display = "none";
    updateModeCardSelection(state.practiceMode);
    syncModeSummary();
  }

  function showGenerateFlow() {
    const picker = byId("paperPickerPage");
    const landing = byId("modeLanding");
    const hero = byId("generateHero");
    const result = byId("resultPanel");
    if (picker) picker.style.display = "none";
    if (landing) landing.style.display = "none";
    if (hero) hero.style.display = "block";
    if (result) result.style.display = "block";
    updateTimerDisplay();
  }

  const summaryEl = byId("selectionSummary");
  if (summaryEl) {
    summaryEl.textContent = t("fixedPathChemistry", selection);
  }
  updateTimerDisplay();
  setRunMode(t("chemistryOnlyGenerate"), false);
  (async function initHistoryState() {
    state.userPracticeHistory = await loadUserPracticeHistory();
    showPaperPicker();
  })();

  const modeRadios = document.querySelectorAll('input[name="practiceMode"]');
  modeRadios.forEach((radio) => {
    radio.addEventListener("change", () => {
      state.practiceMode = writePracticeMode(radio.value);
      updateModeCardSelection(state.practiceMode);
      updateTimerDisplay();
    });
  });

  const modeCards = document.querySelectorAll("[data-mode-card]");
  modeCards.forEach((card) => {
    card.addEventListener("click", () => {
      const mode = card.getAttribute("data-mode-card") === "timed" ? "timed" : "practice";
      state.practiceMode = writePracticeMode(mode);
      updateModeCardSelection(state.practiceMode);
      updateTimerDisplay();
    });
  });

  const startModePageBtn = byId("startModePageBtn");
  if (startModePageBtn) {
    startModePageBtn.addEventListener("click", async () => {
      if (!state.selectedPaperSet) return;
      state.practiceMode = writePracticeMode(readPracticeMode());
      showGenerateFlow();
      try {
        const questions = await loadStructuredPaperSet();
        state.mode = "local";
        state.paperId = null;
        state.questions = questions;
        state.prefetchedImageUrls = new Set();
        state.hintUsageMap = initHintState(state.questions);
        writeScopedJson("alevel.generatedPaper", state.questions);
        state.selectedAnswers = new Array(state.questions.length).fill(-1);
        state.currentPageIndex = 0;
        startTimer();
        renderPaper(state.questions, state);
        bindPaperActions();
        const modeLabel = state.practiceMode === "timed" ? t("timedModeTitle") : t("practiceModeTitle");
        setRunMode(t("paperOpened", { title: state.selectedPaperSet.title, mode: modeLabel }), false);
      } catch (err) {
        setRunMode(t("failedToOpenPaper", { message: toErrText(err) }), true);
      }
    });
  }

  const backToPaperPickerBtn = byId("backToPaperPickerBtn");
  if (backToPaperPickerBtn) {
    backToPaperPickerBtn.addEventListener("click", () => {
      showPaperPicker();
    });
  }

  const goHomeFromPickerBtn = byId("goHomeFromPickerBtn");
  if (goHomeFromPickerBtn) {
    goHomeFromPickerBtn.addEventListener("click", () => {
      location.href = "../index.html";
    });
  }

  const goHistoryBtn = byId("goHistoryBtn");
  if (goHistoryBtn) {
    goHistoryBtn.addEventListener("click", () => {
      location.href = "./review.html";
    });
  }

  function bindPaperActions() {
    const submitBtn = byId("submitPaper");
    const toAnalysis = byId("toAnalysis");
    if (!submitBtn || !toAnalysis) return;

    const prevBtn = byId("prevPage");
    const nextBtn = byId("nextPage");
    const prevBtnBottom = byId("prevPageBottom");
    const nextBtnBottom = byId("nextPageBottom");
    const jumpBtn = byId("jumpPageBtn");
    const jumpInput = byId("jumpPageInput");
    const jumpBtnBottom = byId("jumpPageBtnBottom");
    const jumpInputBottom = byId("jumpPageInputBottom");
    const totalPages = Math.max(1, Math.ceil(state.questions.length / state.pageSize));
    const goPrev = () => {
        if (state.currentPageIndex > 0) {
          state.currentPageIndex -= 1;
          renderJumpPanel(state.questions, state);
          renderCurrentPage(state.questions, state);
          bindQuestionInteractions();
        }
      };
    const goNext = () => {
        if (state.currentPageIndex < totalPages - 1) {
          state.currentPageIndex += 1;
          renderJumpPanel(state.questions, state);
          renderCurrentPage(state.questions, state);
          bindQuestionInteractions();
        }
      };
    if (prevBtn) prevBtn.onclick = goPrev;
    if (prevBtnBottom) prevBtnBottom.onclick = goPrev;
    if (nextBtn) nextBtn.onclick = goNext;
    if (nextBtnBottom) nextBtnBottom.onclick = goNext;

    function jumpToPage(fromBottom = false) {
      const sourceInput = fromBottom ? jumpInputBottom : jumpInput;
      if (!sourceInput) return;
      const raw = Number(sourceInput.value || 1);
      const page = Math.max(1, Math.min(totalPages, Math.round(raw || 1)));
      state.currentPageIndex = page - 1;
      renderJumpPanel(state.questions, state);
      renderCurrentPage(state.questions, state);
      bindQuestionInteractions();
    }

    if (jumpBtn) jumpBtn.onclick = () => jumpToPage(false);
    if (jumpBtnBottom) jumpBtnBottom.onclick = () => jumpToPage(true);
    if (jumpInput) {
      jumpInput.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          jumpToPage(false);
        }
      });
    }
    if (jumpInputBottom) {
      jumpInputBottom.addEventListener("keydown", (evt) => {
        if (evt.key === "Enter") {
          evt.preventDefault();
          jumpToPage(true);
        }
      });
    }

    bindQuestionInteractions();

    submitBtn.onclick = async () => {
      if (!state.questions.length) return;
      state.timerElapsedSeconds = state.timerStartedAt
        ? Math.floor((Date.now() - state.timerStartedAt) / 1000)
        : 0;
      stopTimer();
      updateTimerDisplay();
      const answers = [...state.selectedAnswers];
      savePendingSubmit({
        mode: state.mode,
        paperId: state.paperId || null,
        questions: state.questions || [],
        answers,
        hintUsageMap: state.hintUsageMap || {},
        selection: selection || null,
        submittedAt: new Date().toISOString(),
        elapsedSeconds: state.timerElapsedSeconds,
      });
      goReviewPage();
    };

    toAnalysis.onclick = () => {
      location.href = "analysis.html";
    };
  }

  applyPage();
})();
