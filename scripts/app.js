(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const NOTEBOOK_KEY = "alevel.wrongNotebook";
  const SELECTION_KEY = "alevel.selection";
  const { getLanguage, setLanguage, normalizeLanguage, t, applyPage } = window.ALevelI18n;
  let currentLanguage = getLanguage();
  let backendStatusState = null;
  let accountStatusState = null;
  let catalogSubjects = [];

  function getEl(id) {
    return document.getElementById(id);
  }

  function currentUserScope() {
    return localStorage.getItem(USER_ID_KEY) || "guest";
  }

  function scopedKey(base) {
    return `${base}:${currentUserScope()}`;
  }

  function applyStatus(elementId, state) {
    const statusEl = getEl(elementId);
    if (!statusEl || !state) return;
    statusEl.textContent = t(state.key, state.vars);
    statusEl.className = state.isBad ? "home-status bad" : "home-status good";
  }

  function setBackendStatus(key, isBad, vars) {
    backendStatusState = { key, isBad, vars };
    applyStatus("backendStatus", backendStatusState);
  }

  function setAccountStatus(key, isBad, vars) {
    accountStatusState = { key, isBad, vars };
    const statusEl = getEl("accountStatus");
    if (!statusEl) return;
    statusEl.textContent = t(key, vars);
    statusEl.className = isBad ? "tip bad" : "tip good";
  }

  function applyLanguage(language) {
    currentLanguage = setLanguage(language);
    applyPage();

    const languageSelect = getEl("preferredLanguage");
    if (languageSelect) languageSelect.value = currentLanguage;

    renderSubjectCourses(catalogSubjects);
    renderNotebookOverview();
    applyStatus("backendStatus", backendStatusState);
    if (accountStatusState) {
      setAccountStatus(accountStatusState.key, accountStatusState.isBad, accountStatusState.vars);
    }
  }

  function readAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  }

  function readUserProfile() {
    try {
      const raw = localStorage.getItem(USER_PROFILE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_err) {
      return null;
    }
  }

  function readNotebookRows() {
    try {
      const raw = localStorage.getItem(scopedKey(NOTEBOOK_KEY));
      const rows = raw ? JSON.parse(raw) : [];
      return Array.isArray(rows) ? rows : [];
    } catch (_err) {
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
    const totalWrongCount = rows.reduce((sum, row) => sum + Number(row.wrongCount || 0), 0);
    const masteredCount = rows.filter((row) => row.mastered).length;
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

  function subjectTheme(code) {
    return {
      "0610": { className: "biology", emblem: "DNA" },
      "0620": { className: "chemistry", emblem: "H₂O" },
      "0654": { className: "sciences", emblem: "SCI" },
      "0455": { className: "economics", emblem: "ECO" },
    }[code] || { className: "default", emblem: code || "MCQ" };
  }

  function selectSubject(subject) {
    localStorage.setItem(SELECTION_KEY, JSON.stringify({
      grade: subject.qualification,
      board: subject.board,
      subject: `${subject.qualification} ${subject.name}`,
      subjectCode: subject.code,
      paper: "MCQ",
    }));
    location.href = "pages/generate.html";
  }

  function renderSubjectCourses(subjects) {
    const grid = getEl("subjectCourses");
    if (!grid) return;
    grid.replaceChildren();
    grid.setAttribute("aria-busy", "false");

    if (!subjects.length) {
      const empty = document.createElement("p");
      empty.className = "course-grid__empty";
      empty.textContent = t("noPublishedSubjects");
      grid.appendChild(empty);
      return;
    }

    subjects.forEach((subject) => {
      const theme = subjectTheme(subject.code);
      const subjectName = currentLanguage === "en"
        ? subject.name
        : (subject.nameZh || subject.name);
      const course = document.createElement("button");
      course.type = "button";
      course.className = `course-card course-card--${theme.className}`;
      course.setAttribute("aria-label", t("openSubjectAria", { subject: subjectName }));

      const book = document.createElement("span");
      book.className = "subject-book";
      book.setAttribute("aria-hidden", "true");
      book.innerHTML = `
        <span class="subject-book__pages"></span>
        <span class="subject-book__cover">
          <span class="subject-book__spine"></span>
          <span class="subject-book__level"></span>
          <span class="subject-book__emblem"></span>
          <span class="subject-book__name"></span>
          <span class="subject-book__code"></span>
        </span>
      `;
      book.querySelector(".subject-book__level").textContent = subject.qualification;
      book.querySelector(".subject-book__emblem").textContent = theme.emblem;
      book.querySelector(".subject-book__name").textContent = subjectName;
      book.querySelector(".subject-book__code").textContent = `CIE · ${subject.code}`;

      const details = document.createElement("span");
      details.className = "course-card__details";
      const title = document.createElement("strong");
      title.className = "course-card__title";
      title.textContent = subjectName;
      const qualification = document.createElement("span");
      qualification.className = "course-card__qualification";
      qualification.textContent = `${subject.qualification} · ${subject.board} · ${subject.code}`;
      const stats = document.createElement("span");
      stats.className = "course-card__stats";
      stats.textContent = t("subjectCourseStats", {
        papers: Number(subject.paperCount || 0),
        questions: Number(subject.questionCount || 0),
      });
      const action = document.createElement("span");
      action.className = "course-card__action";
      action.textContent = t("openSubjectPicker");
      action.setAttribute("aria-hidden", "true");
      details.append(title, qualification, stats, action);
      course.append(book, details);
      course.addEventListener("click", () => selectSubject(subject));
      grid.appendChild(course);
    });
  }

  async function loadSubjectCourses() {
    if (!window.ALevelApi?.getCatalogSubjects) {
      setBackendStatus("apiMissing", true);
      return [];
    }
    try {
      const [subjects, storage] = await Promise.all([
        window.ALevelApi.getCatalogSubjects(),
        window.ALevelApi.getStorageMode().catch(() => null),
      ]);
      const modeText = storage?.mode ? t("storageMode", { mode: storage.mode }) : "";
      setBackendStatus("backendConnected", false, { modeText });
      return Array.isArray(subjects) ? subjects.filter((subject) => subject.active !== false) : [];
    } catch (_err) {
      setBackendStatus("backendUnavailable", true);
      return [];
    }
  }

  function clearSession() {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
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
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        clearSession();
        location.href = "pages/login.html";
        return;
      }
      currentUser = readUserProfile() || {};
      setBackendStatus("backendUnavailable", true);
    }

    applyLanguage(currentUser?.language || getLanguage());

    const goAdmin = getEl("goAdmin");
    if (goAdmin) {
      goAdmin.hidden = currentUser?.role !== "admin";
      goAdmin.addEventListener("click", () => {
        location.href = "pages/admin.html";
      });
    }

    getEl("goCommunity")?.addEventListener("click", () => {
      location.href = "pages/community.html";
    });
    getEl("logoutHome")?.addEventListener("click", () => {
      clearSession();
      location.href = "pages/login.html";
    });

    const profileDialog = getEl("profileDialog");
    getEl("openProfile")?.addEventListener("click", () => profileDialog?.showModal());
    getEl("closeProfile")?.addEventListener("click", () => profileDialog?.close());
    profileDialog?.addEventListener("click", (event) => {
      if (event.target === profileDialog) profileDialog.close();
    });

    const preferredLanguageEl = getEl("preferredLanguage");

    function fillAccountForm(user) {
      getEl("newDisplayName").value = user?.displayName || "";
      getEl("newGrade").value = user?.grade || "";
      getEl("newTargetScore").value = user?.targetScore == null ? "" : String(user.targetScore);
      getEl("oldPassword").value = "";
      getEl("newPassword").value = "";
      if (preferredLanguageEl) {
        preferredLanguageEl.value = normalizeLanguage(user?.language || currentLanguage);
      }
    }

    preferredLanguageEl?.addEventListener("change", () => {
      applyLanguage(preferredLanguageEl.value);
    });

    fillAccountForm(currentUser);
    setAccountStatus("signedInAs", false, {
      name: currentUser?.displayName || t("unknownUser"),
    });

    catalogSubjects = await loadSubjectCourses();
    renderSubjectCourses(catalogSubjects);

    const notebookRows = await syncNotebookRowsFromApi();
    renderNotebookOverview(notebookRows);

    const updateProfileBtn = getEl("updateProfileBtn");
    updateProfileBtn?.addEventListener("click", async () => {
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

    const changePasswordBtn = getEl("changePasswordBtn");
    changePasswordBtn?.addEventListener("click", async () => {
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

  buildHome().catch(() => {
    applyLanguage(getLanguage());
    setBackendStatus("initFailed", true);
  });
})();
