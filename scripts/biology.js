(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const { t, applyPage, getLanguage } = window.ALevelI18n;
  const subjectCode = new URLSearchParams(location.search).get("subject") || "0610";
  const subjectInfo = subjectCode === "0625"
    ? { nameEn: "Physics", nameZh: "物理" }
    : { nameEn: "Biology", nameZh: "生物" };
  const state = {
    token: "",
    catalog: null,
    sessionId: "",
    section: null,
    questions: [],
    currentIndex: 0,
    selectedAnswers: [],
    hintsUsed: [],
    hintIndexes: [],
    questionOpenedAt: [],
    elapsedSeconds: [],
    result: null,
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function localized(item, field) {
    const suffix = getLanguage() === "en" ? "En" : "Zh";
    return item?.[`${field}${suffix}`] || item?.[`${field}En`] || "";
  }

  function setStatus(message, isBad = false) {
    const element = byId("chapterStatus");
    element.textContent = message || "";
    element.className = isBad ? "chapter-status bad" : "chapter-status";
  }

  function accuracyText(value) {
    return value == null ? "-" : `${Number(value).toFixed(1)}%`;
  }

  function renderChapters() {
    const list = byId("chapterList");
    list.innerHTML = "";
    state.catalog.chapters.forEach((chapter) => {
      const section = document.createElement("section");
      section.className = "chapter-band";
      section.innerHTML = `
        <div class="chapter-band__heading">
          <span class="chapter-number">${chapter.chapterNo}</span>
          <div>
            <h2>${safeText(localized(chapter, "title"))}</h2>
            <p>${safeText(chapter.titleEn)}</p>
          </div>
        </div>
        <div class="chapter-section-list"></div>
      `;
      const sectionList = section.querySelector(".chapter-section-list");
      chapter.sections.forEach((bookSection) => {
        const progress = bookSection.progress;
        const row = document.createElement("article");
        row.className = "chapter-section-row";
        row.innerHTML = `
          <div class="chapter-section-main">
            <strong>${safeText(bookSection.sectionCode)} · ${safeText(localized(bookSection, "title"))}</strong>
            <span>${safeText(bookSection.titleEn)}</span>
          </div>
          <dl class="chapter-metrics">
            <div><dt>${safeText(t("availableQuestions"))}</dt><dd>${progress.availableQuestions}</dd></div>
            <div><dt>${safeText(t("unseenQuestions"))}</dt><dd>${progress.unseenQuestions}</dd></div>
            <div><dt>${safeText(t("firstAccuracy"))}</dt><dd>${accuracyText(progress.firstAccuracy)}</dd></div>
            <div><dt>${safeText(t("reviewAccuracy"))}</dt><dd>${accuracyText(progress.reviewAccuracy)}</dd></div>
            <div><dt>${safeText(t("needsReview"))}</dt><dd>${progress.needsReview}</dd></div>
          </dl>
          <button class="btn-primary chapter-start" type="button" ${progress.availableQuestions ? "" : "disabled"}>
            ${safeText(t(progress.availableQuestions ? "startSectionPractice" : "awaitingQuestionReview"))}
          </button>
        `;
        row.querySelector("button").addEventListener("click", () => startPractice(bookSection));
        sectionList.appendChild(row);
      });
      list.appendChild(section);
    });
  }

  function imageSource(image) {
    const raw = typeof image === "string" ? image : image?.detailUrl || image?.url || image?.src || "";
    if (raw.startsWith("/assets/") && location.pathname.startsWith("/alevel/")) {
      return `/alevel${raw}`;
    }
    return raw;
  }

  function captureElapsed() {
    const openedAt = state.questionOpenedAt[state.currentIndex];
    if (!openedAt) return;
    state.elapsedSeconds[state.currentIndex] += Math.max(0, Math.round((Date.now() - openedAt) / 1000));
    state.questionOpenedAt[state.currentIndex] = 0;
  }

  function renderQuestion() {
    const question = state.questions[state.currentIndex];
    const resultDetail = state.result?.details?.[state.currentIndex];
    const images = (question.images || []).map(imageSource).filter(Boolean);
    const hasImages = images.length > 0;
    const selected = state.selectedAnswers[state.currentIndex];
    const questionEl = byId("chapterQuestion");
    const options = (question.options || []).map((option, index) => {
      const statusClass = resultDetail
        ? index === resultDetail.answer
          ? "is-correct"
          : index === resultDetail.selectedIndex
            ? "is-wrong"
            : ""
        : "";
      const text = hasImages ? String.fromCharCode(65 + index) : `${String.fromCharCode(65 + index)}. ${option}`;
      return `
        <label class="option-item ${statusClass}">
          <input type="radio" name="chapterAnswer" value="${index}" ${selected === index ? "checked" : ""} ${state.result ? "disabled" : ""} />
          <span>${safeText(text)}</span>
        </label>
      `;
    }).join("");
    const imageHtml = images.map((src, index) => `
      <figure class="question-image">
        <img src="${safeText(src)}" alt="${safeText(t("questionImageAlt", { number: state.currentIndex + 1 }))}" ${index === 0 ? 'fetchpriority="high"' : ""} />
      </figure>
    `).join("");
    const feedback = resultDetail
      ? `<p class="${resultDetail.correct ? "good" : "bad"}">${safeText(
        resultDetail.correct
          ? t("answeredCorrect")
          : t("answeredWrong", { answer: String.fromCharCode(65 + resultDetail.answer) })
      )}</p>`
      : "";
    questionEl.innerHTML = `
      <div class="chapter-question-meta">
        <span>${safeText(question.paperSlug || question.year)}</span>
        <span>${safeText(t("syllabusStatement", { code: question.syllabusCode }))}</span>
      </div>
      <h3>${hasImages ? safeText(t("questionNumber", { number: state.currentIndex + 1 })) : safeText(question.stem)}</h3>
      ${imageHtml ? `<div class="question-images-wrap">${imageHtml}</div>` : ""}
      <div class="options-wrap">${options}</div>
      ${feedback}
    `;
    if (!state.result) {
      questionEl.querySelectorAll('input[name="chapterAnswer"]').forEach((radio) => {
        radio.addEventListener("change", () => {
          state.selectedAnswers[state.currentIndex] = Number(radio.value);
        });
      });
      state.questionOpenedAt[state.currentIndex] = Date.now();
    }
    byId("questionProgress").textContent = t("chapterQuestionProgress", {
      current: state.currentIndex + 1,
      total: state.questions.length,
    });
    byId("previousQuestion").disabled = state.currentIndex === 0;
    byId("nextQuestion").disabled = state.currentIndex === state.questions.length - 1;
    byId("submitChapterPractice").hidden = Boolean(state.result);
    window.ALevelPet?.notifyQuestionChanged?.();
  }

  async function ensureChapterHints() {
    const question = state.questions[state.currentIndex];
    if (!question) return [];
    const language = getLanguage();
    if (Array.isArray(question.hints) && question.hints.length
      && (!question.aiHintLanguage || question.aiHintLanguage === language)) return question.hints;
    const result = await window.ALevelApi.getQuestionHints(state.token, question.id, language);
    question.hints = Array.isArray(result?.hints) ? result.hints : [];
    question.aiHintLanguage = language;
    return question.hints;
  }

  async function showChapterHint(direction) {
    if (state.result) return null;
    const hints = await ensureChapterHints();
    if (!hints.length) return null;
    const currentIndex = Number.isInteger(state.hintIndexes[state.currentIndex])
      ? state.hintIndexes[state.currentIndex]
      : -1;
    const nextIndex = Math.max(0, Math.min(hints.length - 1, currentIndex + direction));
    state.hintIndexes[state.currentIndex] = nextIndex;
    state.hintsUsed[state.currentIndex] = Math.max(state.hintsUsed[state.currentIndex] || 0, nextIndex + 1);
    return {
      index: nextIndex,
      total: hints.length,
      hint: hints[nextIndex],
      hasPrevious: nextIndex > 0,
      hasNext: nextIndex < hints.length - 1,
    };
  }

  async function startPractice(bookSection) {
    setStatus(t("loadingChapterPractice"));
    try {
      const data = await window.ALevelApi.createChapterPractice(state.token, {
        curriculumVersion: state.catalog.version.id,
        coursebookSectionId: bookSection.id,
        count: 10,
      });
      state.sessionId = data.sessionId;
      state.section = data.section;
      state.questions = data.questions;
      state.currentIndex = 0;
      state.selectedAnswers = data.questions.map(() => -1);
      state.hintsUsed = data.questions.map(() => 0);
      state.hintIndexes = data.questions.map(() => -1);
      state.questionOpenedAt = data.questions.map(() => 0);
      state.elapsedSeconds = data.questions.map(() => 0);
      state.result = null;
      byId("chapterList").hidden = true;
      byId("practicePanel").hidden = false;
      byId("chapterResult").hidden = true;
      byId("practiceBreadcrumb").textContent = `${t("chapterLabel", { number: data.section.chapterNo })} · ${bookSection.sectionCode}`;
      byId("practiceTitle").textContent = localized(bookSection, "title");
      setStatus("");
      renderQuestion();
      scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setStatus(t("chapterPracticeLoadFailed", { message: error.message }), true);
    }
  }

  async function submitPractice() {
    captureElapsed();
    const answered = state.selectedAnswers.filter((answer) => answer >= 0).length;
    if (answered < state.questions.length && !window.confirm(t("confirmIncompleteSubmit", {
      answered,
      total: state.questions.length,
      unanswered: state.questions.length - answered,
    }))) return;

    const button = byId("submitChapterPractice");
    button.disabled = true;
    setStatus(t("submittingAndScoring"));
    try {
      state.result = await window.ALevelApi.submitChapterPractice(
        state.token,
        state.sessionId,
        state.selectedAnswers.map((selectedIndex, index) => ({
          selectedIndex,
          elapsedSeconds: state.elapsedSeconds[index],
          hintsUsed: state.hintsUsed[index],
        }))
      );
      const first = state.result.details.filter((detail) => detail.firstExposure);
      const review = state.result.details.filter((detail) => !detail.firstExposure);
      const firstCorrect = first.filter((detail) => detail.correct).length;
      const reviewCorrect = review.filter((detail) => detail.correct).length;
      const resultEl = byId("chapterResult");
      resultEl.innerHTML = `
        <h3>${safeText(t("chapterResultTitle"))}</h3>
        <div class="chapter-result-grid">
          <div><span>${safeText(t("accuracyLabel"))}</span><strong>${state.result.accuracy.toFixed(1)}%</strong></div>
          <div><span>${safeText(t("firstAccuracy"))}</span><strong>${first.length ? `${((firstCorrect / first.length) * 100).toFixed(1)}%` : "-"}</strong></div>
          <div><span>${safeText(t("reviewAccuracy"))}</span><strong>${review.length ? `${((reviewCorrect / review.length) * 100).toFixed(1)}%` : "-"}</strong></div>
        </div>
      `;
      resultEl.hidden = false;
      setStatus(t("chapterPracticeSubmitted"));
      renderQuestion();
    } catch (error) {
      setStatus(t("chapterPracticeSubmitFailed", { message: error.message }), true);
      button.disabled = false;
    }
  }

  function changeQuestion(offset) {
    captureElapsed();
    state.currentIndex = Math.max(0, Math.min(state.questions.length - 1, state.currentIndex + offset));
    renderQuestion();
  }

  async function returnToChapters() {
    captureElapsed();
    byId("practicePanel").hidden = true;
    byId("chapterList").hidden = false;
    if (state.result) await loadCatalog();
  }

  async function loadCatalog() {
    setStatus(t("loadingChapterCatalog"));
    state.catalog = await window.ALevelApi.getChapterCatalog(state.token, subjectCode);
    byId("curriculumVersion").textContent = t("curriculumVersionLabel", {
      start: state.catalog.version.examYearStart,
      end: state.catalog.version.examYearEnd,
      version: state.catalog.version.version,
    });
    renderChapters();
    setStatus("");
  }

  async function init() {
    applyPage();
    byId("chapterSubjectLabel").textContent = `Cambridge IGCSE · ${subjectCode}`;
    byId("chapterSubjectHeading").textContent = getLanguage() === "zh-CN" ? subjectInfo.nameZh : subjectInfo.nameEn;
    state.token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!state.token) {
      location.href = "./login.html";
      return;
    }
    byId("backHome").addEventListener("click", () => { location.href = "../index.html"; });
    byId("paperMode").addEventListener("click", () => {
      localStorage.setItem("alevel.selection", JSON.stringify({
        grade: "IGCSE",
        board: "CIE",
        subject: `IGCSE ${subjectInfo.nameEn}`,
        subjectCode,
        paper: "MCQ",
      }));
      location.href = "./generate.html";
    });
    byId("previousQuestion").addEventListener("click", () => changeQuestion(-1));
    byId("nextQuestion").addEventListener("click", () => changeQuestion(1));
    byId("submitChapterPractice").addEventListener("click", submitPractice);
    byId("closePractice").addEventListener("click", returnToChapters);
    try {
      await window.ALevelApi.getCurrentUser(state.token);
      await loadCatalog();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        location.href = "./login.html";
        return;
      }
      setStatus(t("chapterCatalogLoadFailed", { message: error.message }), true);
    }
  }

  window.ALevelPet?.registerHintProvider?.({
    getQuestionKey() {
      return state.result ? "" : state.questions[state.currentIndex]?.id || "";
    },
    hasUnseenHint() {
      const question = state.questions[state.currentIndex];
      const index = state.hintIndexes[state.currentIndex] ?? -1;
      return Boolean(!state.result && question && (!question.hints?.length || index < question.hints.length - 1));
    },
    showNextHint: () => showChapterHint(1),
    showPreviousHint: () => showChapterHint(-1),
  });

  init();
})();
