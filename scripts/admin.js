(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const { t, applyPage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    if (value == null) return "-";
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function fmtDate(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function setStatus(text, isBad) {
    const statusEl = byId("adminStatus");
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = isBad ? "tip bad" : "tip good";
  }

  function renderSummary(summary) {
    const wrap = byId("summaryCards");
    if (!wrap) return;

    const cards = [
      { label: t("totalUsers"), value: summary?.usersCount ?? 0 },
      { label: t("totalPractices"), value: summary?.practiceCount ?? 0 },
      { label: t("submittedPractices"), value: summary?.submittedCount ?? 0 },
    ];

    wrap.innerHTML = cards
      .map(
        (item) => `
      <article class="stat-card">
        <div class="stat-label">${safeText(item.label)}</div>
        <div class="stat-value">${safeText(item.value)}</div>
      </article>
    `
      )
      .join("");
  }

  function renderUsers(users) {
    const body = byId("usersBody");
    if (!body) return;

    if (!users?.length) {
      body.innerHTML = `<tr><td colspan='7' class='tip'>${t("noUsers")}</td></tr>`;
      return;
    }

    body.innerHTML = users
      .map(
        (u) => `
      <tr>
        <td class="mono">${safeText(u.id)}</td>
        <td>${safeText(u.displayName)}</td>
        <td>${safeText(u.email || "-")}</td>
        <td>${safeText(u.role)}</td>
        <td>${safeText(u.grade || "-")}</td>
        <td>${safeText(u.targetScore ?? "-")}</td>
        <td>${safeText(fmtDate(u.createdAt))}</td>
      </tr>
    `
      )
      .join("");
  }

  function renderPractices(practices) {
    const body = byId("practicesBody");
    if (!body) return;

    if (!practices?.length) {
      body.innerHTML = `<tr><td colspan='7' class='tip'>${t("noPractices")}</td></tr>`;
      return;
    }

    body.innerHTML = practices
      .map((p) => {
        const path = `${p.board || "-"} / ${p.subject || "-"} / ${p.paper || "-"}`;
        const userLabel = p.userDisplayName || p.userEmail || p.userId || "-";
        const accuracy =
          p.accuracy == null || Number.isNaN(Number(p.accuracy))
            ? "-"
            : `${Number(p.accuracy).toFixed(1)}%`;

        return `
        <tr>
          <td class="mono">${safeText(p.id)}</td>
          <td>${safeText(userLabel)}</td>
          <td>${safeText(path)}</td>
          <td>${safeText(p.status || "-")}</td>
          <td>${safeText(accuracy)}</td>
          <td>${safeText(fmtDate(p.createdAt))}</td>
          <td>${safeText(fmtDate(p.submittedAt))}</td>
        </tr>
      `;
      })
      .join("");
  }

  async function loadRecords() {
    const refreshBtn = byId("refreshBtn");
    const oldText = refreshBtn.textContent;
    refreshBtn.disabled = true;
    refreshBtn.textContent = t("refreshing");

    const usersLimit = Number(byId("usersLimit").value || 10);
    const practicesLimit = Number(byId("practicesLimit").value || 20);

    try {
      if (!window.ALevelApi) {
        throw new Error("API client not loaded");
      }

      const data = await window.ALevelApi.getAdminRecords({
        usersLimit,
        practicesLimit,
      });

      renderSummary(data.summary || {});
      renderUsers(data.latestUsers || []);
      renderPractices(data.latestPractices || []);
      setStatus(t("adminDataLoaded"), false);
    } catch (err) {
      renderSummary({ usersCount: 0, practiceCount: 0, submittedCount: 0 });
      renderUsers([]);
      renderPractices([]);
      setStatus(t("adminLoadFailed", { message: err.message || t("checkBackendDb") }), true);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = oldText;
      applyPage();
    }
  }

  byId("refreshBtn").addEventListener("click", () => {
    loadRecords();
  });

  byId("openMapper").addEventListener("click", () => {
    location.href = "./image-mapper.html";
  });

  byId("backHome").addEventListener("click", () => {
    location.href = "../index.html";
  });

  async function init() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!token) {
      setStatus(t("adminLoginRequired"), true);
      setTimeout(() => {
        location.href = "./admin-login.html";
      }, 350);
      return;
    }

    try {
      const user = await window.ALevelApi.getCurrentUser(token);
      if (user?.role !== "admin") {
        setStatus(t("notAdmin"), true);
        setTimeout(() => {
          location.href = "./admin-login.html";
        }, 500);
        return;
      }
    } catch (_err) {
      setStatus(t("adminSessionInvalid"), true);
      setTimeout(() => {
        location.href = "./admin-login.html";
      }, 500);
      return;
    }

    loadRecords();
  }

  applyPage();
  init();
})();
