(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const NOTEBOOK_KEY = "alevel.wrongNotebook";
  const { getLanguage, setLanguage, normalizeLanguage, t, applyPage } = window.ALevelI18n;
  let currentLanguage = getLanguage();
  let backendStatusState = null;
  let accountStatusState = null;

  function getEl(id) {
    return document.getElementById(id);
  }

  function currentUserScope() {
    return localStorage.getItem(USER_ID_KEY) || "guest";
  }

  function scopedKey(base) {
    return `${base}:${currentUserScope()}`;
  }

  function fillSelect(select, items) {
    select.innerHTML = "";
    items.forEach((item) => {
      const opt = document.createElement("option");
      opt.value = item;
      opt.textContent = item;
      select.appendChild(opt);
    });
  }

  function applyStatus(elementId, state) {
    const statusEl = getEl(elementId);
    if (!statusEl || !state) return;
    statusEl.textContent = t(state.key, state.vars);
    statusEl.className = state.isBad ? "tip bad" : "tip good";
  }

  function setBackendStatus(key, isBad, vars) {
    backendStatusState = { key, isBad, vars };
    applyStatus("backendStatus", backendStatusState);
  }

  function setAccountStatus(key, isBad, vars) {
    accountStatusState = { key, isBad, vars };
    applyStatus("accountStatus", accountStatusState);
  }

  function applyLanguage(language) {
    currentLanguage = setLanguage(language);
    applyPage();

    const languageSelect = getEl("preferredLanguage");
    if (languageSelect) {
      languageSelect.value = currentLanguage;
    }

    renderNotebookOverview();
    applyStatus("backendStatus", backendStatusState);
    applyStatus("accountStatus", accountStatusState);
  }

  function readAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  }

  function readNotebookRows() {
    try {
      const raw = localStorage.getItem(scopedKey(NOTEBOOK_KEY));
      const rows = raw ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows : [];
    } catch (_e) {
      return [];
    }
  }

  async function syncNotebookRowsFromApi() {
    const userId = localStorage.getItem(USER_ID_KEY) || "";
    if (!userId || !window.ALevelApi?.getUserNotebook) return readNotebookRows();
    try {
      const rows = await window.ALevelApi.getUserNotebook(userId);
      localStorage.setItem(scopedKey(NOTEBOOK_KEY), JSON.stringify(Array.isArray(rows) ? rows : []));
      return Array.isArray(rows) ? rows : [];
    } catch (_err) {
      return readNotebookRows();
    }
  }

  function renderNotebookOverview(rowsInput) {
    const box = getEl("notebookOverview");
    if (!box) return;
    const rows = (Array.isArray(rowsInput) ? rowsInput : readNotebookRows())
      .sort((a, b) => new Date(b.lastWrongAt || 0) - new Date(a.lastWrongAt || 0));
    const totalWrongCount = rows.reduce((sum, r) => sum + Number(r.wrongCount || 0), 0);
    const masteredCount = rows.filter((r) => r.mastered).length;
    const latest = rows[0];
    const time = latest?.lastWrongAt
      ? new Date(latest.lastWrongAt).toLocaleString(currentLanguage === "en" ? "en-US" : "zh-CN")
      : "";

    box.innerHTML = `
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

  async function loadCurriculumData() {
    if (!window.ALevelApi) {
      setBackendStatus("apiMissing", true);
      return window.CURRICULUM_DATA;
    }

    try {
      const [curriculum, storage] = await Promise.all([
        window.ALevelApi.getCurriculum(),
        window.ALevelApi.getStorageMode().catch(() => null),
      ]);
      const modeText = storage?.mode ? t("storageMode", { mode: storage.mode }) : "";
      setBackendStatus("backendConnected", false, { modeText });
      return curriculum;
    } catch (_err) {
      setBackendStatus("backendUnavailable", true);
      return window.CURRICULUM_DATA;
    }
  }

  async function buildHome() {
    const token = readAuthToken();
    if (!token || !window.ALevelApi?.getCurrentUser) {
      location.href = "pages/login.html";
      return;
    }

    let currentUser = null;
    try {
      currentUser = await window.ALevelApi.getCurrentUser(token);
    } catch (_err) {
      localStorage.removeItem(USER_PROFILE_KEY);
      localStorage.removeItem(USER_ID_KEY);
      localStorage.removeItem(AUTH_TOKEN_KEY);
      location.href = "pages/login.html";
      return;
    }

    applyLanguage(currentUser?.language || getLanguage());

    const gradeEl = getEl("grade");
    if (!gradeEl) return;

    const boardEl = getEl("board");
    const subjectEl = getEl("subject");
    const paperEl = getEl("paper");
    const preferredLanguageEl = getEl("preferredLanguage");

    await loadCurriculumData();

    fillSelect(gradeEl, ["IGCSE"]);
    fillSelect(boardEl, ["CIE"]);

    function refreshSubjects() {
      fillSelect(subjectEl, ["IGCSE Chemistry"]);
      refreshPapers();
    }

    function refreshPapers() {
      fillSelect(paperEl, ["MCQ"]);
    }

    boardEl.addEventListener("change", refreshSubjects);
    subjectEl.addEventListener("change", refreshPapers);
    refreshSubjects();

    const packSelection = () => {
      const payload = {
        grade: gradeEl.value,
        board: boardEl.value,
        subject: subjectEl.value,
        paper: paperEl.value,
      };
      localStorage.setItem("alevel.selection", JSON.stringify(payload));
      return payload;
    };

    getEl("goGenerate").addEventListener("click", () => {
      packSelection();
      location.href = "pages/generate.html";
    });

    getEl("goAnalysis").addEventListener("click", () => {
      packSelection();
      location.href = "pages/analysis.html";
    });

    const goNotebook = getEl("goNotebook");
    if (goNotebook) {
      goNotebook.addEventListener("click", () => {
        location.href = "pages/notebook.html";
      });
    }

    const goNotebookFromPanel = getEl("goNotebookFromPanel");
    if (goNotebookFromPanel) {
      goNotebookFromPanel.addEventListener("click", () => {
        location.href = "pages/notebook.html";
      });
    }

    const goAdmin = getEl("goAdmin");
    if (goAdmin) {
      goAdmin.addEventListener("click", () => {
        location.href = "pages/admin.html";
      });
    }

    const goLogin = getEl("goLogin");
    if (goLogin) {
      goLogin.addEventListener("click", () => {
        location.href = "pages/login.html";
      });
    }

    const showAlertBtn = getEl("showAlertBtn");
    if (showAlertBtn) {
      showAlertBtn.addEventListener("click", () => {
        alert(currentLanguage === "en" ? "Hello from the main page." : "这是主页上的提示。");
      });
    }

    function fillAccountForm(user) {
      getEl("newDisplayName").value = user?.displayName || "";
      getEl("newGrade").value = user?.grade || "";
      getEl("newTargetScore").value =
        user?.targetScore == null ? "" : String(user.targetScore);
      getEl("oldPassword").value = "";
      getEl("newPassword").value = "";
      if (preferredLanguageEl) {
        preferredLanguageEl.value = normalizeLanguage(user?.language || currentLanguage);
      }
    }

    if (preferredLanguageEl) {
      preferredLanguageEl.addEventListener("change", () => {
        applyLanguage(preferredLanguageEl.value);
      });
    }

    fillAccountForm(currentUser);
    const notebookRows = await syncNotebookRowsFromApi();
    renderNotebookOverview(notebookRows);
    setAccountStatus("signedInAs", false, {
      name: currentUser?.displayName || t("unknownUser"),
    });

    const updateProfileBtn = getEl("updateProfileBtn");
    if (updateProfileBtn) {
      updateProfileBtn.addEventListener("click", async () => {
        const displayName = getEl("newDisplayName").value.trim();
        const grade = getEl("newGrade").value.trim();
        const targetScoreRaw = getEl("newTargetScore").value.trim();
        const targetScore = targetScoreRaw === "" ? null : Number.parseInt(targetScoreRaw, 10);
        const language = normalizeLanguage(preferredLanguageEl?.value);

        if (!displayName) {
          setAccountStatus("displayNameRequired", true);
          return;
        }

        updateProfileBtn.disabled = true;
        const oldText = updateProfileBtn.textContent;
        updateProfileBtn.textContent = t("saving");
        try {
          const user = await window.ALevelApi.updateCurrentUser(token, {
            displayName,
            grade: grade || null,
            targetScore: Number.isNaN(targetScore) ? null : targetScore,
            language,
          });
          localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
          applyLanguage(user.language);
          fillAccountForm(user);
          setAccountStatus("profileUpdated", false);
        } catch (err) {
          setAccountStatus("profileUpdateFailed", true, {
            message: err.message || t("retryLater"),
          });
        } finally {
          updateProfileBtn.disabled = false;
          updateProfileBtn.textContent = oldText;
        }
      });
    }

    const changePasswordBtn = getEl("changePasswordBtn");
    if (changePasswordBtn) {
      changePasswordBtn.addEventListener("click", async () => {
        const oldPassword = getEl("oldPassword").value.trim();
        const newPassword = getEl("newPassword").value.trim();
        if (!oldPassword || !newPassword) {
          setAccountStatus("passwordFieldsRequired", true);
          return;
        }
        if (newPassword.length < 6) {
          setAccountStatus("passwordTooShort", true);
          return;
        }

        changePasswordBtn.disabled = true;
        const oldText = changePasswordBtn.textContent;
        changePasswordBtn.textContent = t("updating");
        try {
          await window.ALevelApi.changePassword(token, { oldPassword, newPassword });
          getEl("oldPassword").value = "";
          getEl("newPassword").value = "";
          setAccountStatus("passwordChanged", false);
        } catch (err) {
          setAccountStatus("passwordChangeFailed", true, {
            message: err.message || t("retryLater"),
          });
        } finally {
          changePasswordBtn.disabled = false;
          changePasswordBtn.textContent = oldText;
        }
      });
    }
  }

  window.ALevelApp = { fillSelect };
  buildHome().catch(() => {
    applyLanguage(getLanguage());
    setBackendStatus("initFailed", true);
  });
})();
