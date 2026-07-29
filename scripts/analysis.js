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
          localStorage.setItem(scopedKey("alevel.wrongLog"), JSON.stringify(wrongLog));
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

  const raw = localStorage.getItem("alevel.selection");
  const selection = raw ? JSON.parse(raw) : null;
  byId("selectionSummary").textContent = selection
    ? t("selectionSummary", selection)
    : t("selectionMissing");

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
