(function () {
  const NOTEBOOK_KEY = "alevel.wrongNotebook";
  const USER_ID_KEY = "alevel.userId";
  const PAGE_SIZE = 10;
  const { t, getLanguage, applyPage } = window.ALevelI18n;
  let currentPage = 1;
  const USER_RECORD_KEYS = [
    "alevel.wrongNotebook",
    "alevel.lastResult",
    "alevel.wrongLog",
    "alevel.pendingSubmit",
    "alevel.generatedPaper",
  ];

  function byId(id) {
    return document.getElementById(id);
  }

  function currentUserScope() {
    return localStorage.getItem(USER_ID_KEY) || "guest";
  }

  function scopedKey(base) {
    return `${base}:${currentUserScope()}`;
  }

  async function clearUserRecords() {
    const userId = localStorage.getItem(USER_ID_KEY) || "";
    if (userId && window.ALevelApi?.clearUserPractices) {
      try {
        await window.ALevelApi.clearUserPractices(userId);
      } catch (_err) {
      }
    }
    USER_RECORD_KEYS.forEach((key) => {
      localStorage.removeItem(scopedKey(key));
    });
  }

  function readNotebook() {
    try {
      const raw = localStorage.getItem(scopedKey(NOTEBOOK_KEY));
      const rows = raw ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows : [];
    } catch (_e) {
      return [];
    }
  }

  function writeNotebook(rows) {
    localStorage.setItem(scopedKey(NOTEBOOK_KEY), JSON.stringify(rows || []));
  }

  async function loadNotebookRows() {
    const userId = localStorage.getItem(USER_ID_KEY) || "";
    if (userId && window.ALevelApi?.getUserNotebook) {
      try {
        const rows = await window.ALevelApi.getUserNotebook(userId);
        if (Array.isArray(rows)) {
          writeNotebook(rows);
          return rows;
        }
      } catch (_err) {
      }
    }
    return readNotebook();
  }

  function toTime(v) {
    return new Date(v || 0).getTime() || 0;
  }

  function sortRows(rows, sortBy) {
    const copy = [...rows];
    if (sortBy === "count_desc") {
      copy.sort((a, b) => {
        const c = Number(b.wrongCount || 0) - Number(a.wrongCount || 0);
        if (c !== 0) return c;
        return toTime(b.lastWrongAt) - toTime(a.lastWrongAt);
      });
      return copy;
    }
    copy.sort((a, b) => toTime(b.lastWrongAt) - toTime(a.lastWrongAt));
    return copy;
  }

  function groupLabel(ts) {
    const d = new Date(ts || 0);
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    if ((d.getTime() || 0) >= startToday) return "today";
    if ((d.getTime() || 0) >= startToday - 7 * dayMs) return "last7Days";
    return "earlier";
  }

  function renderStats(rows) {
    const totalWrongCount = rows.reduce((sum, r) => sum + Number(r.wrongCount || 0), 0);
    const masteredCount = rows.filter((r) => r.mastered).length;
    const latest = rows[0];
    const time = latest?.lastWrongAt
      ? new Date(latest.lastWrongAt).toLocaleString(getLanguage() === "en" ? "en-US" : "zh-CN")
      : "";
    byId("notebookStats").innerHTML = `
      <div class="stats-grid">
        <div class="stat-card"><div class="stat-label">${t("notebookItems")}</div><div class="stat-value">${rows.length}</div></div>
        <div class="stat-card"><div class="stat-label">${t("totalWrongAttempts")}</div><div class="stat-value">${totalWrongCount}</div></div>
        <div class="stat-card"><div class="stat-label">${t("mastered")}</div><div class="stat-value">${masteredCount}</div></div>
      </div>
      <p class="tip">${
        latest
          ? t("latestWrongRecord", {
            subject: latest.subject || "-",
            paper: latest.paper || "-",
            time,
          })
          : t("noWrongRecords")
      }</p>
    `;
  }

  function renderFilter(rows) {
    const subjects = Array.from(new Set(rows.map((r) => r.subject).filter(Boolean)));
    const filter = byId("subjectFilter");
    filter.innerHTML = `<option value="">${t("allSubjects")}</option>${subjects.map((s) => `<option value="${s}">${s}</option>`).join("")}`;
  }

  function buildGroups(rows) {
    const groups = { today: [], last7Days: [], earlier: [] };
    rows.forEach((r) => {
      groups[groupLabel(r.lastWrongAt)].push(r);
    });
    return groups;
  }

  function buildCommunityUrl(row) {
    const params = new URLSearchParams();
    const questionKey = row.questionKey || row.id || "";
    if (questionKey) params.set("questionKey", questionKey);
    if (row.board) params.set("board", row.board);
    if (row.subject) params.set("subject", row.subject);
    if (row.paper) params.set("paper", row.paper);
    if (row.topic) params.set("topic", row.topic);
    if (row.stem) params.set("stem", String(row.stem).slice(0, 220));
    return `./community.html?${params.toString()}`;
  }

  function getQuestionNumber(row, fallback) {
    const questionKey = String(row.questionKey || "");
    const legacyId = String(row.id || "");
    const source = questionKey || (/^[0-9a-f-]{36}$/i.test(legacyId) ? "" : legacyId);
    const match = source.match(/-(\d{1,3})$/);
    const number = match ? Number(match[1]) : 0;
    return Number.isInteger(number) && number > 0 ? number : fallback;
  }

  function isAnswered(row) {
    if (row.lastSelected === null || row.lastSelected === "") return false;
    const selected = Number(row.lastSelected);
    return Number.isInteger(selected) && selected >= 0 && selected <= 3;
  }

  function renderList(rows, state) {
    const wrap = byId("notebookList");
    let filtered = state.subject ? rows.filter((r) => r.subject === state.subject) : rows;
    if (state.hideMastered) {
      filtered = filtered.filter((r) => !r.mastered);
    }
    filtered = sortRows(filtered, state.sortBy);
    const fallbackNumbers = new Map(filtered.map((row, idx) => [row, idx + 1]));

    if (!filtered.length) {
      wrap.innerHTML = `<p class='tip'>${t("noNotebookRecords")}</p>`;
      return;
    }

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    currentPage = Math.min(Math.max(currentPage, 1), totalPages);
    const pageStart = (currentPage - 1) * PAGE_SIZE;
    const pageRows = filtered.slice(pageStart, pageStart + PAGE_SIZE);
    const groups = buildGroups(pageRows);
    const order = ["today", "last7Days", "earlier"];

    const questionGroups = order
      .map((name) => {
        const list = groups[name] || [];
        if (!list.length) return "";
        return `
          <section class="notebook-group">
            <h3 class="notebook-group-title">${t(name)}（${list.length}）</h3>
            ${list
              .map((r, idx) => `
                <details class="question notebook-question ${r.mastered ? "mastered" : ""}">
                  <summary>
                    <span>${r.subject || "-"} / ${r.paper || "-"} / ${t("questionNumber", { number: getQuestionNumber(r, fallbackNumbers.get(r) || idx + 1) })}</span>
                  </summary>
                  <div class="notebook-question-content">
                    <p class="chem-text">${r.stem || t("stemMissing")}</p>
                    <div class="tag-row">
                      <span class="tag">${r.topic || "-"}</span>
                      <span class="tag">${t("wrongCountLabel")} ${r.wrongCount || 1}</span>
                      <span class="tag">${t("latestLabel")} ${r.lastWrongAt ? new Date(r.lastWrongAt).toLocaleString(getLanguage() === "en" ? "en-US" : "zh-CN") : "-"}</span>
                      ${r.mastered ? `<span class='tag'>${t("mastered")}</span>` : ""}
                    </div>
                    <p class="bad">${t("yourAnswer", { answer: r.lastSelectedText || t("unanswered") })}</p>
                    <p class="good">${t("correctAnswer", { answer: r.answerText || "-" })}</p>
                    <div class="actions">
                      <button class="btn-secondary" data-mastered-id="${r.id}">${r.mastered ? t("unmarkMastered") : t("markMastered")}</button>
                      <a class="btn-link" href="${buildCommunityUrl(r)}">${t("discussQuestion")}</a>
                    </div>
                  </div>
                </details>
              `)
              .join("")}
          </section>
        `;
      })
      .join("");
    wrap.innerHTML = `
      ${questionGroups}
      <div class="actions notebook-pagination" aria-label="${t("reviewPageProgress", { page: currentPage, total: totalPages, size: PAGE_SIZE })}">
        <button id="notebookPrevPage" class="btn-secondary" type="button" ${currentPage === 1 ? "disabled" : ""}>${t("prevPage")}</button>
        <span class="notebook-page-progress">${t("reviewPageProgress", { page: currentPage, total: totalPages, size: PAGE_SIZE })}</span>
        <button id="notebookNextPage" class="btn-secondary" type="button" ${currentPage === totalPages ? "disabled" : ""}>${t("nextPage")}</button>
      </div>
    `;

    const changePage = (nextPage) => {
      currentPage = nextPage;
      renderList(rows, state);
      byId("notebookList").scrollIntoView({ behavior: "smooth", block: "start" });
    };
    byId("notebookPrevPage")?.addEventListener("click", () => changePage(currentPage - 1));
    byId("notebookNextPage")?.addEventListener("click", () => changePage(currentPage + 1));

    const btns = wrap.querySelectorAll("[data-mastered-id]");
    btns.forEach((btn) => {
      btn.addEventListener("click", async function () {
        const id = this.getAttribute("data-mastered-id");
        if (!id) return;
        const all = readNotebook();
        const target = all.find((r) => r.id === id);
        if (!target) return;
        const nextMastered = !target.mastered;
        const userId = localStorage.getItem(USER_ID_KEY) || "";
        if (userId && window.ALevelApi?.updateNotebookEntry) {
          try {
            await window.ALevelApi.updateNotebookEntry(userId, id, { mastered: nextMastered });
          } catch (_err) {
          }
        }
        const next = all.map((r) => (r.id === id ? { ...r, mastered: nextMastered } : r));
        writeNotebook(next);
        await init();
      });
    });
  }

  async function init() {
    const allRows = await loadNotebookRows();
    const answeredRows = allRows.filter(isAnswered);
    const state = {
      subject: byId("subjectFilter")?.value || "",
      sortBy: byId("sortBy")?.value || "time_desc",
      hideMastered: Boolean(byId("hideMastered")?.checked),
    };

    const sortedForStats = sortRows(answeredRows, "time_desc");
    renderStats(sortedForStats);
    renderFilter(sortedForStats);

    const sf = byId("subjectFilter");
    if (sf && state.subject) sf.value = state.subject;

    renderList(sortedForStats, state);
  }

  byId("subjectFilter").addEventListener("change", () => { currentPage = 1; init(); });
  byId("sortBy").addEventListener("change", () => { currentPage = 1; init(); });
  byId("hideMastered").addEventListener("change", () => { currentPage = 1; init(); });

  byId("clearNotebook").addEventListener("click", async function () {
    await clearUserRecords();
    await init();
  });

  byId("backHome").addEventListener("click", function () {
    location.href = "../index.html";
  });

  byId("goGenerate").addEventListener("click", function () {
    location.href = "./generate.html";
  });

  applyPage();
  init();
})();
