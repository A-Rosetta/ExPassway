(function () {
  const USER_ID_KEY = "alevel.userId";
  const { t, applyPage } = window.ALevelI18n;
  const state = {
    pageSize: 8,
    pageIndex: 0,
    allRows: [],
    questions: [],
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

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(scopedKey(key));
      return raw ? JSON.parse(raw) : fallback;
    } catch (_e) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(scopedKey(key), JSON.stringify(value));
  }

  function optLabel(idx) {
    return Number.isInteger(idx) && idx >= 0 ? String.fromCharCode(65 + idx) : t("unanswered");
  }

  function buildOptionText(_question, idx) {
    if (!Number.isInteger(idx) || idx < 0) {
      return "-";
    }
    return optLabel(idx);
  }

  function formatElapsed(seconds) {
    const total = Math.max(0, Number(seconds || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function buildSubmitPayload(answers, hintUsageMap) {
    return answers.map((selectedIndex, idx) => ({
      selectedIndex: Number.isInteger(selectedIndex) ? selectedIndex : -1,
      hintsUsed: Number(hintUsageMap?.[idx]?.used || 0),
    }));
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
        mastered: prev?.mastered || false,
      };
      byIdMap.set(id, next);
    });

    const merged = Array.from(byIdMap.values()).sort(
      (a, b) => new Date(b.lastWrongAt || 0) - new Date(a.lastWrongAt || 0)
    );
    localStorage.setItem(key, JSON.stringify(merged));
  }

  function toErrText(err) {
    const status = err?.status ? `HTTP ${err.status}` : "";
    const code = err?.payload?.error?.code || "";
    const msg = err?.message || t("unknownError");
    return [status, code, msg].filter(Boolean).join(" | ");
  }

  function buildAnalysisText(question, detail) {
    const hints = Array.isArray(question?.hints) ? question.hints.filter(Boolean) : [];
    const skills = Array.isArray(question?.skills) ? question.skills.filter(Boolean) : [];
    const mistakeType = detail?.mistakeType || question?.mistakeType || "unknown";

    if (hints.length) {
      return t("reviewAnalysisHint", { hint: hints[0] });
    }

    if (skills.length) {
      return t("reviewAnalysisSkills", { skills: skills.slice(0, 2).join(" / ") });
    }

    if (mistakeType === "calculation") {
      return t("reviewAnalysisCalculation");
    }

    if (mistakeType === "question_reading") {
      return t("reviewAnalysisReading");
    }

    if (mistakeType === "concept") {
      return t("reviewAnalysisConcept");
    }

    return t("reviewAnalysisGeneric");
  }

  function buildCommunityUrl(question, detail, idx) {
    const params = new URLSearchParams();
    const questionKey = question?.id || detail?.id || "";
    if (questionKey) params.set("questionKey", questionKey);
    if (question?.board) params.set("board", question.board);
    if (question?.subject) params.set("subject", question.subject);
    if (question?.paper) params.set("paper", question.paper);
    if (question?.topic) params.set("topic", question.topic);
    const stem = question?.stem ? String(question.stem).slice(0, 220) : "";
    if (stem) params.set("stem", stem);
    if (!questionKey) params.set("topic", question?.topic || detail?.topic || `Q${idx + 1}`);
    return `./community.html?${params.toString()}`;
  }

  function buildImproveText(question, detail) {
    const skills = Array.isArray(question?.skills) ? question.skills.filter(Boolean) : [];
    const hintTotal = Number(detail?.hintTotal || 0);
    const hintsUsed = Number(detail?.hintsUsed || 0);
    const mistakeType = detail?.mistakeType || question?.mistakeType || "unknown";

    if (skills.length) {
      return t("reviewImproveSkills", { skills: skills.slice(0, 2).join(" / ") });
    }

    if (hintsUsed > 0 || hintTotal > 0) {
      return t("reviewImproveHint");
    }

    if (mistakeType === "calculation") {
      return t("reviewImproveCalculation");
    }

    if (mistakeType === "question_reading") {
      return t("reviewImproveReading");
    }

    if (mistakeType === "concept") {
      return t("reviewImproveConcept");
    }

    return t("reviewImproveGeneric");
  }

  function renderPager() {
    const totalPages = Math.max(1, Math.ceil(state.allRows.length / state.pageSize));
    const html = `
      <div class="actions">
        <button class='btn-secondary' id='reviewPrevPage'>${t("prevPage")}</button>
        <p class='tip' id='reviewProgress' style='margin:0;align-self:center;'></p>
        <label class='tip' style='margin:0;display:flex;align-items:center;gap:0.35rem;'>
          ${t("jumpTo")}
          <input id='reviewJumpInput' type='number' min='1' style='width:84px;padding:0.35rem 0.45rem;' />
          ${t("pageUnit")}
        </label>
        <button class='btn-secondary' id='reviewJumpBtn'>${t("jumpBtn")}</button>
        <button class='btn-secondary' id='reviewNextPage'>${t("nextPage")}</button>
      </div>
    `;
    byId("reviewNavTop").innerHTML = html;
    byId("reviewNavBottom").innerHTML = html
      .replace(/reviewPrevPage/g, "reviewPrevPageBottom")
      .replace(/reviewProgress/g, "reviewProgressBottom")
      .replace(/reviewJumpInput/g, "reviewJumpInputBottom")
      .replace(/reviewJumpBtn/g, "reviewJumpBtnBottom")
      .replace(/reviewNextPage/g, "reviewNextPageBottom");

    const progressText = t("reviewPageProgress", {
      page: state.pageIndex + 1,
      total: totalPages,
      size: state.pageSize,
    });
    const progress = byId("reviewProgress");
    const progressBottom = byId("reviewProgressBottom");
    const jumpInput = byId("reviewJumpInput");
    const jumpInputBottom = byId("reviewJumpInputBottom");
    if (progress) progress.textContent = progressText;
    if (progressBottom) progressBottom.textContent = progressText;
    if (jumpInput) jumpInput.value = String(state.pageIndex + 1);
    if (jumpInputBottom) jumpInputBottom.value = String(state.pageIndex + 1);

    const bind = (prevId, nextId, jumpBtnId, jumpInputId) => {
      const prev = byId(prevId);
      const next = byId(nextId);
      const jumpBtn = byId(jumpBtnId);
      const input = byId(jumpInputId);
      if (prev) {
        prev.disabled = state.pageIndex === 0;
        prev.onclick = () => {
          if (state.pageIndex > 0) {
            state.pageIndex -= 1;
            renderQuestionPage();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        };
      }
      if (next) {
        next.disabled = state.pageIndex >= totalPages - 1;
        next.onclick = () => {
          if (state.pageIndex < totalPages - 1) {
            state.pageIndex += 1;
            renderQuestionPage();
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        };
      }
      if (jumpBtn && input) {
        jumpBtn.onclick = () => {
          const raw = Number(input.value || 1);
          const nextPage = Math.max(1, Math.min(totalPages, Math.round(raw || 1)));
          state.pageIndex = nextPage - 1;
          renderQuestionPage();
          window.scrollTo({ top: 0, behavior: "smooth" });
        };
        input.onkeydown = (evt) => {
          if (evt.key === "Enter") {
            evt.preventDefault();
            jumpBtn.click();
          }
        };
      }
    };

    bind("reviewPrevPage", "reviewNextPage", "reviewJumpBtn", "reviewJumpInput");
    bind("reviewPrevPageBottom", "reviewNextPageBottom", "reviewJumpBtnBottom", "reviewJumpInputBottom");
  }

  function renderQuestionPage() {
    const wrongWrap = byId("wrongQuestions");
    if (!state.allRows.length) {
      byId("reviewNavTop").innerHTML = "";
      byId("reviewNavBottom").innerHTML = "";
      wrongWrap.innerHTML = `<p class='tip'>${t("noQuestionRecords")}</p>`;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(state.allRows.length / state.pageSize));
    state.pageIndex = Math.max(0, Math.min(state.pageIndex, totalPages - 1));
    const start = state.pageIndex * state.pageSize;
    const end = Math.min(state.allRows.length, start + state.pageSize);
    const currentRows = state.allRows.slice(start, end);

    wrongWrap.innerHTML = currentRows
      .map(({ d, idx }) => {
        const q = state.questions[idx] || {};
        const stem = q.stem || t("stemMissing");
        const yourText = Number.isInteger(d.selectedIndex) && d.selectedIndex >= 0
          ? `${optLabel(d.selectedIndex)}. ${q.options?.[d.selectedIndex] || ""}`
          : t("unanswered");
        const rightText = `${optLabel(d.answer)}. ${q.options?.[d.answer] || ""}`;
        const analysisText = buildAnalysisText(q, d);
        const improveText = buildImproveText(q, d);
        return `
          <article class="question">
            <h4>${t("questionNumber", { number: idx + 1 })}</h4>
            <p class="chem-text">${stem}</p>
            <p class="${d.correct ? "good" : "bad"}">${d.correct ? t("correctStatus") : t("incorrectStatus")}</p>
            <p class="bad">${t("yourAnswer", { answer: yourText })}</p>
            <p class="good">${t("correctAnswer", { answer: rightText })}</p>
            <div class="text-view-box">
              <p><strong>${t("analysisLabel")}</strong> ${analysisText}</p>
              <p><strong>${t("improvementLabel")}</strong> ${improveText}</p>
            </div>
            <div class="actions compact-actions">
              <a class="btn-link" href="${buildCommunityUrl(q, d, idx)}">${t("discussQuestion")}</a>
            </div>
          </article>
        `;
      })
      .join("");

    renderPager();
  }

  function renderResult(result, questions) {
    const summary = byId("reviewSummary");
    const accuracy = Number(result.accuracy || 0).toFixed(1);
    const total = Number(result.total || 0);
    const details = Array.isArray(result.details) ? result.details : [];
    const correct = details.filter((detail) => detail.correct).length;
    const unanswered = details.filter((detail) => detail.selectedIndex === -1).length;
    const wrong = Math.max(0, total - correct - unanswered);
    const pieStops = [];
    let offset = 0;
    const slices = [
      { value: correct, color: "#19b7a6" },
      { value: wrong, color: "#ff6b73" },
      { value: unanswered, color: "#c9cfde" },
    ];
    slices.forEach((slice) => {
      if (!slice.value || !total) return;
      const start = offset;
      offset += (slice.value / total) * 360;
      pieStops.push(`${slice.color} ${start}deg ${offset}deg`);
    });
    const pieBackground = pieStops.length ? `conic-gradient(${pieStops.join(", ")})` : "#c9cfde";
    const answerRows = details
      .map((detail, idx) => {
        const question = questions?.[idx] || {};
        const answerClass = detail.correct ? "good" : (detail.selectedIndex === -1 ? "tip-text" : "bad");
        return `
          <tr>
            <td>${idx + 1}</td>
            <td class="${answerClass}">${buildOptionText(question, detail.selectedIndex)}</td>
            <td class="good">${buildOptionText(question, detail.answer)}</td>
          </tr>
        `;
      })
      .join("");

    summary.innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">${t("totalQuestions")}</div><div class="stat-value">${total}</div></div>
        <div class="stat-card"><div class="stat-label">${t("correctQuestions")}</div><div class="stat-value">${correct}</div></div>
        <div class="stat-card"><div class="stat-label">${t("accuracyLabel")}</div><div class="stat-value">${accuracy}%</div></div>
      </div>
      <p class="tip">${t("submittedAt", { time: result.submittedAt ? new Date(result.submittedAt).toLocaleString() : "-" })}</p>
      <p class="tip">${t("timeSpent", { time: formatElapsed(result.elapsedSeconds || 0) })}</p>
      <div class="review-answer-overview">
        <div class="review-answer-table-card">
          <h3>${t("answerStatusTitle")}</h3>
          <div class="table-wrap">
            <table class="data-table answer-status-table">
              <thead>
                <tr>
                  <th>${t("questionNo")}</th>
                  <th>${t("myAnswer")}</th>
                  <th>${t("correctAnswer", { answer: "" }).replace(/[:：]\s*$/, "")}</th>
                </tr>
              </thead>
              <tbody>${answerRows}</tbody>
            </table>
          </div>
        </div>
        <div class="review-chart-card">
          <h3>${t("resultDistribution")}</h3>
          <div class="review-pie-wrap">
            <div class="review-pie-chart" style="background:${pieBackground};"></div>
          </div>
          <div class="review-chart-legend">
            <div class="review-legend-row">
              <span class="review-legend-dot is-correct"></span>
              <span>${t("correctCount", { count: correct })}</span>
              <strong>${total ? ((correct / total) * 100).toFixed(0) : 0}%</strong>
            </div>
            <div class="review-legend-row">
              <span class="review-legend-dot is-wrong"></span>
              <span>${t("wrongCountText", { count: wrong })}</span>
              <strong>${total ? ((wrong / total) * 100).toFixed(0) : 0}%</strong>
            </div>
            <div class="review-legend-row">
              <span class="review-legend-dot is-unanswered"></span>
              <span>${t("unansweredCount", { count: unanswered })}</span>
              <strong>${total ? ((unanswered / total) * 100).toFixed(0) : 0}%</strong>
            </div>
          </div>
        </div>
      </div>
    `;

    state.questions = questions || [];
    state.allRows = result.details.map((d, idx) => ({ d, idx }));
    state.pageIndex = 0;
    renderQuestionPage();
  }

  async function runSubmitInReview() {
    const pending = readJson("alevel.pendingSubmit", null);
    if (!pending || !Array.isArray(pending.questions) || !Array.isArray(pending.answers)) {
      return null;
    }

    const questions = pending.questions || [];
    const answers = pending.answers || [];
    const hintUsageMap = pending.hintUsageMap || {};
    const selection = pending.selection || null;
    const elapsedSeconds = Number(pending.elapsedSeconds || 0);
    const userId = localStorage.getItem(USER_ID_KEY) || "";

    if (pending.mode !== "backend" || !pending.paperId) {
      try {
        if (userId && window.ALevelApi?.submitLocalPaper) {
          const data = await window.ALevelApi.submitLocalPaper({
            userId,
            selection,
            questions,
            answers: buildSubmitPayload(answers, hintUsageMap),
          });
          const result = data.result;
          const wrongLog = data.wrongLog || buildWrongLog(result.details || []);
          result.elapsedSeconds = elapsedSeconds;
          writeJson("alevel.lastResult", result);
          writeJson("alevel.wrongLog", wrongLog);
          persistWrongNotebook(questions, result.details || [], selection);
          localStorage.removeItem(scopedKey("alevel.pendingSubmit"));
          return { result, questions, modeText: t("localPaperSynced") };
        }
      } catch (_err) {
      }

      const result = evaluateLocal(questions, answers, hintUsageMap);
      result.elapsedSeconds = elapsedSeconds;
      const wrongLog = buildWrongLog(result.details || []);
      writeJson("alevel.lastResult", result);
      writeJson("alevel.wrongLog", wrongLog);
      persistWrongNotebook(questions, result.details || [], selection);
      localStorage.removeItem(scopedKey("alevel.pendingSubmit"));
      return { result, questions, modeText: t("localScoringUsed") };
    }

    try {
      if (!window.ALevelApi) {
        throw new Error("API client not loaded");
      }
      const data = await window.ALevelApi.submitPaper({
        paperId: pending.paperId,
        answers: buildSubmitPayload(answers, hintUsageMap),
      });
      const result = data.result;
      const wrongLog = data.wrongLog || buildWrongLog(result.details || []);
      result.hintUsedQuestions = Object.values(hintUsageMap).filter((x) => x.used > 0).length;
      result.totalHintClicks = Object.values(hintUsageMap).reduce((sum, x) => sum + (x.used || 0), 0);
      result.elapsedSeconds = elapsedSeconds;
      writeJson("alevel.lastResult", result);
      writeJson("alevel.wrongLog", wrongLog);
      persistWrongNotebook(questions, result.details || [], selection);
      localStorage.removeItem(scopedKey("alevel.pendingSubmit"));
      return { result, questions, modeText: t("backendScoringDone") };
    } catch (err) {
      const result = evaluateLocal(questions, answers, hintUsageMap);
      result.elapsedSeconds = elapsedSeconds;
      const wrongLog = buildWrongLog(result.details || []);
      writeJson("alevel.lastResult", result);
      writeJson("alevel.wrongLog", wrongLog);
      persistWrongNotebook(questions, result.details || [], selection);
      localStorage.removeItem(scopedKey("alevel.pendingSubmit"));
      return { result, questions, modeText: t("backendSubmitFallback", { message: toErrText(err) }) };
    }
  }

  applyPage();

  (async function init() {
    const summary = byId("reviewSummary");
    summary.innerHTML = `<p class='tip'>${t("submittingAndScoring")}</p>`;

    const justSubmitted = await runSubmitInReview();
    if (justSubmitted) {
      renderResult(justSubmitted.result, justSubmitted.questions || []);
      const tips = document.createElement("p");
      tips.className = "tip";
      tips.textContent = justSubmitted.modeText;
      byId("reviewSummary").appendChild(tips);
    } else {
      const result = readJson("alevel.lastResult", null);
      const questions = readJson("alevel.generatedPaper", []);
      if (!result || !Array.isArray(result.details)) {
        byId("reviewSummary").innerHTML = `<p class='bad'>${t("noRecentSubmission")}</p>`;
        byId("wrongQuestions").innerHTML = "";
      } else {
        renderResult(result, questions);
      }
    }

    byId("backGenerate").addEventListener("click", function () {
      location.href = "./generate.html";
    });
    byId("goAnalysis").addEventListener("click", function () {
      location.href = "./analysis.html";
    });
  })();
})();
