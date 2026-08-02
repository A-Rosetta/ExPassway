(function () {
  const USER_ID_KEY = "alevel.userId";
  const { t, applyPage, getLanguage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  function currentUserScope() {
    return localStorage.getItem(USER_ID_KEY) || "guest";
  }

  function scopedKey(base) {
    return `${base}:${currentUserScope()}`;
  }

  async function loadAnalysisSource() {
    const userId = localStorage.getItem(USER_ID_KEY) || "";
    if (userId && window.ALevelApi?.getUserPractices) {
      try {
        const practices = await window.ALevelApi.getUserPractices(userId, { limit: 20 });
        const latestSubmitted = (Array.isArray(practices) ? practices : []).find((row) => {
          return row?.status === "submitted" && Array.isArray(row?.wrongLog) && row?.wrongLog.length && row?.result;
        });
        if (latestSubmitted) {
          const result = latestSubmitted.result || null;
          const wrongLog = latestSubmitted.wrongLog || [];
          localStorage.setItem(scopedKey("alevel.lastResult"), JSON.stringify(result));
          return {
            logs: wrongLog,
            lastResult: result,
            source: "backend-practices",
          };
        }
      } catch (_err) {
      }
    }

    const localLogRaw = localStorage.getItem(scopedKey("alevel.wrongLog"));
    const logs = localLogRaw ? JSON.parse(localLogRaw) : [];
    const lastResultRaw = localStorage.getItem(scopedKey("alevel.lastResult"));
    const lastResult = lastResultRaw ? JSON.parse(lastResultRaw) : null;
    return {
      logs,
      lastResult,
      source: "local-storage",
    };
  }

  function setMode(text, isBad) {
    const el = byId("analysisMode");
    if (!el) return;
    el.textContent = text;
    el.className = isBad ? "tip bad" : "tip good";
  }

  function calcWrongRate(row) {
    const total = (row.correct || 0) + (row.wrong || 0);
    return total ? (row.wrong / total) * 100 : 0;
  }

  function buildLocalAnalysis(logs, lastResult) {
    const bars = logs.map((row) => ({
      topic: row.topic,
      mistake: row.mistake,
      wrongRate: Number(calcWrongRate(row).toFixed(1)),
    }));

    const sorted = [...logs].sort((a, b) => calcWrongRate(b) - calcWrongRate(a));
    const weakTopics = sorted
      .slice(0, 2)
      .map((x) => x.topic)
      .join(" / ") || t("weakTopicFallback");

    const advices = [
      t("adviceShortTerm", { topics: weakTopics }),
      t("adviceLongTerm"),
      t("adviceStrategy"),
    ];

    if (lastResult && typeof lastResult.accuracy === "number" && lastResult.accuracy < 60) {
      advices.unshift(t("adviceLowAccuracy"));
    }

    return {
      bars,
      advices,
    };
  }

  function renderBars(rows) {
    const bars = byId("bars");
    bars.innerHTML = "";

    if (!rows.length) {
      bars.innerHTML = `<p class='tip'>${t("noAnalysisData")}</p>`;
      return;
    }

    rows.forEach((row) => {
      const wrongRate = Number(row.wrongRate || 0);
      const block = document.createElement("div");
      block.innerHTML = `
        <div>${row.topic} (${row.mistake || "concept"})</div>
        <div class="bar">
          <span style="width:${wrongRate.toFixed(1)}%"></span>
          <em>${wrongRate.toFixed(1)}%</em>
        </div>
      `;
      bars.appendChild(block);
    });
  }

  function renderAdvices(lines) {
    const advice = byId("advice");
    advice.innerHTML = "";
    if (!(lines || []).length) {
      const li = document.createElement("li");
      li.textContent = t("noAdviceYet");
      advice.appendChild(li);
      return;
    }
    (lines || []).forEach((line) => {
      const li = document.createElement("li");
      li.textContent = line;
      advice.appendChild(li);
    });
  }

  function renderHintRate(rate) {
    if (rate == null) return;
    const summary = document.createElement("p");
    summary.className = "tip";
    summary.textContent = t("hintUsageRate", { rate: Number(rate).toFixed(1) });
    byId("analysisMode").after(summary);
  }

  // ---- Weekly study plan -------------------------------------------------
  // Scores topics straight from the wrong notebook rather than the last paper,
  // because wrongCount / lastWrongAt / mastered are the inputs the ranking
  // needs and the notebook endpoint already returns them.
  const PLAN_DAYS = 7;
  const PLAN_HALF_LIFE_DAYS = 14;
  const PLAN_DONE_KEY = "alevel.weeklyPlanDone";
  const DAY_MS = 24 * 60 * 60 * 1000;

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => (
      { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
    ));
  }

  // Recent mistakes matter more than old ones: half the weight every 14 days.
  function decayFactor(iso) {
    const then = new Date(iso || 0).getTime();
    if (!then) return 0.25;
    const days = Math.max(0, (Date.now() - then) / DAY_MS);
    return Math.pow(0.5, days / PLAN_HALF_LIFE_DAYS);
  }

  function scoreTopics(rows) {
    const byTopic = new Map();
    rows.forEach((row) => {
      if (row.mastered) return;
      const topic = String(row.topic || "").trim();
      if (!topic) return;
      const entry = byTopic.get(topic) || { topic, score: 0, questions: 0 };
      entry.score += Number(row.wrongCount || 1) * decayFactor(row.lastWrongAt);
      entry.questions += 1;
      byTopic.set(topic, entry);
    });
    return [...byTopic.values()].sort((a, b) => b.score - a.score || b.questions - a.questions);
  }

  function buildPlan(topics) {
    if (!topics.length) return [];
    const topScore = topics[0].score || 1;
    const plan = [];
    for (let i = 0; i < PLAN_DAYS; i += 1) {
      // Fewer topics than days is normal early on; wrapping round turns the
      // tail of the week into spaced repetition instead of padding it out.
      const topic = topics[i % topics.length];
      const ratio = topScore ? topic.score / topScore : 0;
      plan.push({
        offset: i,
        topic,
        count: Math.max(3, Math.min(10, Math.round(3 + ratio * 7))),
        repeat: i >= topics.length,
      });
    }
    return plan;
  }

  function planDayLabel(offset) {
    if (offset === 0) return t("weeklyPlanToday");
    if (offset === 1) return t("weeklyPlanTomorrow");
    const date = new Date(Date.now() + offset * DAY_MS);
    return date.toLocaleDateString(getLanguage() === "en" ? "en-US" : "zh-CN", {
      month: "short",
      day: "numeric",
      weekday: "short",
    });
  }

  function readPlanDone() {
    try {
      const raw = localStorage.getItem(scopedKey(PLAN_DONE_KEY));
      const list = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(list) ? list : []);
    } catch (_err) {
      return new Set();
    }
  }

  function writePlanDone(set) {
    localStorage.setItem(scopedKey(PLAN_DONE_KEY), JSON.stringify([...set]));
  }

  function planRowKey(row) {
    const date = new Date(Date.now() + row.offset * DAY_MS);
    return `${date.toISOString().slice(0, 10)}|${row.topic.topic}`;
  }

  function renderPlan(plan, topicCount) {
    const wrap = byId("weeklyPlan");
    if (!wrap) return;
    const done = readPlanDone();
    const doneCount = plan.filter((row) => done.has(planRowKey(row))).length;

    wrap.innerHTML = `
      <table class="weekly-plan-table">
        <thead>
          <tr>
            <th>${escapeHtml(t("weeklyPlanColDay"))}</th>
            <th>${escapeHtml(t("weeklyPlanColTopic"))}</th>
            <th>${escapeHtml(t("weeklyPlanColAmount"))}</th>
            <th>${escapeHtml(t("weeklyPlanColDone"))}</th>
          </tr>
        </thead>
        <tbody>
          ${plan.map((row) => {
            const key = planRowKey(row);
            const isDone = done.has(key);
            return `
              <tr class="${isDone ? "is-done" : ""} ${row.offset === 0 ? "is-today" : ""}">
                <td>${escapeHtml(planDayLabel(row.offset))}</td>
                <td>
                  <strong>${escapeHtml(row.topic.topic)}</strong>
                  <span class="tip weekly-plan-meta">${escapeHtml(
                    t("weeklyPlanWrongCount", { count: row.topic.questions })
                  )}${row.repeat ? " · ↻" : ""}</span>
                </td>
                <td>${escapeHtml(t("weeklyPlanAmount", { count: row.count }))}</td>
                <td><input type="checkbox" class="weekly-plan-check" data-plan-key="${escapeHtml(key)}" ${isDone ? "checked" : ""} /></td>
              </tr>
            `;
          }).join("")}
        </tbody>
      </table>
      <p class="tip">${escapeHtml(t("weeklyPlanProgress", { done: doneCount, total: plan.length }))}${
        topicCount < PLAN_DAYS ? ` · ${escapeHtml(t("weeklyPlanReviewNote"))}` : ""
      }</p>
      <div class="actions">
        <a class="btn-secondary" href="./notebook.html">${escapeHtml(t("weeklyPlanGoPractice"))}</a>
      </div>
    `;

    wrap.querySelectorAll("[data-plan-key]").forEach((input) => {
      input.addEventListener("change", function () {
        const set = readPlanDone();
        const key = this.getAttribute("data-plan-key");
        if (this.checked) set.add(key); else set.delete(key);
        writePlanDone(set);
        renderPlan(plan, topicCount);
      });
    });
  }

  async function initWeeklyPlan() {
    const wrap = byId("weeklyPlan");
    if (!wrap) return;
    const userId = localStorage.getItem(USER_ID_KEY) || "";
    let rows = [];
    if (userId && window.ALevelApi?.getUserNotebook) {
      try {
        const fetched = await window.ALevelApi.getUserNotebook(userId);
        if (Array.isArray(fetched)) rows = fetched;
      } catch (_err) {
      }
    }
    if (!rows.length) {
      wrap.innerHTML = `<p class="tip">${escapeHtml(t("weeklyPlanEmpty"))}</p>`;
      return;
    }
    const topics = scoreTopics(rows);
    if (!topics.length) {
      const allMastered = rows.every((row) => row.mastered);
      wrap.innerHTML = `<p class="tip">${escapeHtml(
        allMastered ? t("weeklyPlanAllMastered") : t("weeklyPlanEmpty")
      )}</p>`;
      return;
    }
    renderPlan(buildPlan(topics), topics.length);
  }

  const raw = localStorage.getItem("alevel.selection");
  const selection = raw ? JSON.parse(raw) : null;
  byId("selectionSummary").textContent = selection
    ? t("selectionSummary", selection)
    : t("selectionMissing");

  initWeeklyPlan();

  (async () => {
    const source = await loadAnalysisSource();
    const logs = source.logs || [];
    const lastResult = source.lastResult || null;

    const oldBrief = document.getElementById("latestAttemptBrief");
    if (oldBrief) oldBrief.remove();
    if (lastResult) {
      const brief = document.createElement("p");
      brief.id = "latestAttemptBrief";
      brief.className = "tip";
      brief.innerHTML = t("latestAttempt", {
        correct: lastResult.correct,
        total: lastResult.total,
        accuracy: lastResult.accuracy.toFixed(1),
      });
      byId("selectionSummary").after(brief);
    }

    if (!logs.length) {
      renderBars([]);
      renderAdvices([]);
      setMode(t("noPracticeHistory"), true);
      return;
    }
    try {
      if (!window.ALevelApi) {
        throw new Error("API client not loaded");
      }
      const analysis = await window.ALevelApi.buildAnalysis({
        wrongLog: logs,
        lastResult,
        language: getLanguage(),
      });
      renderBars(analysis.bars || []);
      renderAdvices(analysis.advices || []);
      renderHintRate(analysis.hintRate);
      setMode(source.source === "backend-practices" ? t("analysisFromBackend") : t("analysisFallback"), false);
    } catch (_err) {
      const localAnalysis = buildLocalAnalysis(logs, lastResult);
      renderBars(localAnalysis.bars || []);
      renderAdvices(localAnalysis.advices || []);
      if (lastResult && typeof lastResult.total === "number" && lastResult.total > 0) {
        const rate = ((lastResult.hintUsedQuestions || 0) / lastResult.total) * 100;
        renderHintRate(rate);
      }
      setMode(t("analysisFallback"), true);
    }
  })();

  applyPage();
  byId("backHome").addEventListener("click", () => {
    location.href = "../index.html";
  });
})();
