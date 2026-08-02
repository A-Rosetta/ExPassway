(function () {
  const USER_ID_KEY = "alevel.userId";
  const PRACTICE_KEY = "alevel.notebookPractice";
  const { t, applyPage } = window.ALevelI18n;

  const state = {
    paperId: "",
    questions: [],
    answers: [],
    submitted: false,
    details: [],
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function currentUserScope() {
    return localStorage.getItem(USER_ID_KEY) || "guest";
  }

  function scopedKey(base) {
    return `${base}:${currentUserScope()}`;
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // Mirrors resolveImageUrl in generate.js so notebook papers render images the
  // same way the main practice page does.
  function resolveImageUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("data:")) return raw;
    if (raw.startsWith("/alevel/")) return raw;
    if (raw.startsWith("/assets/")) {
      const pathName = window.location.pathname || "";
      if (pathName.startsWith("/alevel/")) return `/alevel${raw}`;
      return raw;
    }
    return raw;
  }

  function questionImages(question) {
    const list = Array.isArray(question?.images) ? question.images.filter(Boolean) : [];
    return list
      .map((image) => {
        const url = typeof image === "string" ? image : (image.detailUrl || image.url || "");
        const src = resolveImageUrl(url);
        return src ? { src } : null;
      })
      .filter(Boolean);
  }

  function loadPractice() {
    try {
      const raw = sessionStorage.getItem(scopedKey(PRACTICE_KEY));
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || !parsed.paperId || !Array.isArray(parsed.questions) || !parsed.questions.length) {
        return null;
      }
      return parsed;
    } catch (_err) {
      return null;
    }
  }

  function renderQuestions() {
    const wrap = byId("practiceList");
    wrap.innerHTML = state.questions
      .map((question, idx) => {
        const images = questionImages(question);
        const imagesHtml = images
          .map((image) => `
            <figure class="question-image no-ratio">
              <img src="${escapeHtml(image.src)}" alt="" decoding="async" />
            </figure>
          `)
          .join("");
        const hasImages = images.length > 0;
        const detail = state.submitted ? state.details[idx] : null;
        const optionsHtml = (question.options || [])
          .map((opt, optIdx) => {
            const letter = String.fromCharCode(65 + optIdx);
            const checked = state.answers[idx] === optIdx ? "checked" : "";
            const disabled = state.submitted ? "disabled" : "";
            let mark = "";
            if (detail) {
              if (optIdx === detail.answer) mark = " option-correct";
              else if (optIdx === detail.selectedIndex) mark = " option-wrong";
            }
            return `
              <label class="option-item${mark}">
                <input type="radio" name="nbq_${idx}" value="${optIdx}" ${checked} ${disabled} />
                <span class="chem-text">${hasImages ? letter : `${letter}. ${escapeHtml(opt)}`}</span>
              </label>
            `;
          })
          .join("");
        const resultTag = detail
          ? `<span class="tag ${detail.correct ? "notebook-tag-correct" : "notebook-tag-wrong"}">${
            detail.correct ? t("notebookPracticeCorrectTag") : t("notebookPracticeWrongTag")
          }</span>`
          : "";
        return `
          <article class="question notebook-practice-question">
            <h3>${t("questionNumber", { number: idx + 1 })} ${resultTag}</h3>
            <p class="chem-text">${escapeHtml(question.stem)}</p>
            ${imagesHtml ? `<div class="question-images-wrap">${imagesHtml}</div>` : ""}
            <div class="options-wrap">${optionsHtml}</div>
          </article>
        `;
      })
      .join("");

    wrap.querySelectorAll('input[type="radio"]').forEach((input) => {
      input.addEventListener("change", function () {
        const match = /^nbq_(\d+)$/.exec(this.name || "");
        if (!match) return;
        state.answers[Number(match[1])] = Number(this.value);
      });
    });
  }

  // The question list can be long, so every piece of feedback has to appear at
  // the bottom too - next to the button the user actually pressed.
  function setFeedback(html) {
    byId("practiceStatus").innerHTML = html;
    const bottom = byId("practiceResult");
    bottom.innerHTML = html;
    bottom.hidden = false;
  }

  async function submitPractice() {
    if (state.submitted) return;
    const unanswered = state.answers.filter((a) => !Number.isInteger(a)).length;
    if (unanswered > 0 && !window.confirm(t("notebookPracticeUnansweredConfirm", { count: unanswered }))) {
      return;
    }
    const button = byId("submitPractice");
    button.disabled = true;
    setFeedback(escapeHtml(t("notebookPracticeSubmitting")));
    try {
      const payload = await window.ALevelApi.submitPaper({
        paperId: state.paperId,
        answers: state.answers.map((a) => (Number.isInteger(a) ? a : -1)),
        language: window.ALevelI18n.getLanguage(),
      });
      state.submitted = true;
      state.details = payload?.result?.details || [];
      const correct = state.details.filter((d) => d.correct).length;
      setFeedback(`
        <strong>${escapeHtml(t("notebookPracticeScore", { correct, total: state.questions.length }))}</strong>
        <br />${escapeHtml(t("notebookPracticeMasteredTip"))}
      `);
      // The notebook list is rebuilt from the API on its next load, so drop the
      // stale cached copy rather than trying to patch it here.
      localStorage.removeItem(scopedKey("alevel.wrongNotebook"));
      sessionStorage.removeItem(scopedKey(PRACTICE_KEY));
      renderQuestions();
      byId("practiceResult").scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (_err) {
      setFeedback(escapeHtml(t("notebookPracticeSubmitFailed")));
      button.disabled = false;
    }
  }

  function init() {
    const practice = loadPractice();
    if (!practice) {
      setFeedback(escapeHtml(t("notebookPracticeMissing")));
      byId("submitPractice").disabled = true;
      return;
    }
    state.paperId = practice.paperId;
    state.questions = practice.questions;
    state.answers = new Array(state.questions.length).fill(null);
    renderQuestions();
  }

  byId("backToNotebook").addEventListener("click", function () {
    location.href = "./notebook.html";
  });
  byId("submitPractice").addEventListener("click", submitPractice);

  applyPage();
  init();
})();
