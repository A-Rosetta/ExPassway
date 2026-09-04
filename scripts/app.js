(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const VISITOR_MODE_KEY = "alevel.visitorMode";
  const SELECTION_KEY = "alevel.selection";
  const { getLanguage, setLanguage, t, applyPage } = window.ALevelI18n;
  let currentLanguage = getLanguage();
  let backendStatusState = null;
  let accountStatusState = null;
  let catalogSubjects = [];
  let pdfDownloadPapers = [];
  let pdfPaperLoadId = 0;
  let pdfDownloadStatusKey = "";
  const additionalSubjects = [{
    qualification: "IGCSE",
    board: "CIE",
    code: "0625",
    name: "Physics",
    nameZh: "物理",
    paperCount: 36,
    questionCount: 1439,
  }];

  function getEl(id) {
    return document.getElementById(id);
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
    renderAdditionalSubjects();
    renderPdfDownloadOptions();
    setPdfDownloadStatus(pdfDownloadStatusKey);
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

  function subjectTheme(code) {
    return {
      "0610": { className: "biology", emblem: "DNA" },
      "0620": { className: "chemistry", emblem: "H₂O" },
      "0654": { className: "sciences", emblem: "SCI" },
      "0455": { className: "economics", emblem: "ECO" },
      "0625": { className: "physics", emblem: "F=ma" },
    }[code] || { className: "default", emblem: code || "MCQ" };
  }

  function selectSubject(subject) {
    if (localStorage.getItem(VISITOR_MODE_KEY) === "1" && !readAuthToken()) {
      location.href = "pages/login.html";
      return;
    }
    localStorage.setItem(SELECTION_KEY, JSON.stringify({
      grade: subject.qualification,
      board: subject.board,
      subject: `${subject.qualification} ${subject.name}`,
      subjectCode: subject.code,
      paper: "MCQ",
    }));
    location.href = ["0610", "0620", "0625", "0654", "0455"].includes(subject.code)
      ? `pages/biology.html?subject=${encodeURIComponent(subject.code)}`
      : "pages/generate.html";
  }

  function renderSubjectCourses(subjects, gridId = "subjectCourses") {
    const grid = getEl(gridId);
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

  function subjectDisplayName(subject) {
    return currentLanguage === "en" ? subject.name : (subject.nameZh || subject.name);
  }

  function renderAdditionalSubjects() {
    const catalogCodes = new Set(catalogSubjects.map((subject) => subject.code));
    const subjects = additionalSubjects.filter((subject) => !catalogCodes.has(subject.code));
    renderSubjectCourses(subjects, "moreSubjectCourses");
    const button = getEl("toggleMoreSubjects");
    if (button) button.hidden = subjects.length === 0;
  }

  function setPdfDownloadStatus(key) {
    pdfDownloadStatusKey = key;
    const status = getEl("pdfDownloadStatus");
    if (!status) return;
    status.hidden = !key;
    status.textContent = key ? t(key) : "";
  }

  function setPdfDownloadLinks(paperSlug) {
    [
      [getEl("downloadQuestionPdf"), "qp"],
      [getEl("downloadAnswerPdf"), "ms"],
    ].forEach(([link, documentType]) => {
      if (!link) return;
      if (!paperSlug) {
        link.removeAttribute("href");
        link.classList.add("is-disabled");
        link.setAttribute("aria-disabled", "true");
        return;
      }
      const baseUrl = window.ALevelApi?.getBaseUrl?.() || "";
      link.href = `${baseUrl}/api/catalog/papers/${encodeURIComponent(paperSlug)}/download/${documentType}`;
      link.classList.remove("is-disabled");
      link.removeAttribute("aria-disabled");
    });
  }

  function renderPdfDownloadOptions() {
    const subjectSelect = getEl("pdfDownloadSubject");
    const paperSelect = getEl("pdfDownloadPaper");
    if (!subjectSelect || !paperSelect) return;

    const selectedSubject = subjectSelect.value;
    subjectSelect.replaceChildren(...catalogSubjects.map((subject) => {
      const option = document.createElement("option");
      option.value = subject.code;
      option.textContent = `${subject.code} · ${subjectDisplayName(subject)}`;
      return option;
    }));
    if (catalogSubjects.some((subject) => subject.code === selectedSubject)) {
      subjectSelect.value = selectedSubject;
    }

    const selectedPaper = paperSelect.value;
    paperSelect.replaceChildren(...pdfDownloadPapers.map((paper) => {
      const option = document.createElement("option");
      option.value = paper.slug;
      option.textContent = paper.slug;
      return option;
    }));
    if (pdfDownloadPapers.some((paper) => paper.slug === selectedPaper)) {
      paperSelect.value = selectedPaper;
    }
    paperSelect.disabled = pdfDownloadPapers.length === 0;
    setPdfDownloadLinks(paperSelect.value);
  }

  async function loadPdfDownloadPapers(subjectCode) {
    const loadId = ++pdfPaperLoadId;
    pdfDownloadPapers = [];
    renderPdfDownloadOptions();
    setPdfDownloadStatus("pdfDownloadLoading");
    try {
      const papers = await window.ALevelApi.getCatalogPapers(subjectCode);
      if (loadId !== pdfPaperLoadId) return;
      pdfDownloadPapers = Array.isArray(papers) ? papers : [];
      renderPdfDownloadOptions();
      setPdfDownloadStatus(pdfDownloadPapers.length ? "" : "pdfDownloadUnavailable");
    } catch (_err) {
      if (loadId !== pdfPaperLoadId) return;
      setPdfDownloadStatus("pdfDownloadUnavailable");
    }
  }

  function setupPdfDownloads() {
    const dialog = getEl("pdfDownloadDialog");
    const openButton = getEl("openPdfDownload");
    const subjectSelect = getEl("pdfDownloadSubject");
    const paperSelect = getEl("pdfDownloadPaper");
    if (!dialog || !openButton || !subjectSelect || !paperSelect) return;

    openButton.disabled = catalogSubjects.length === 0;
    renderPdfDownloadOptions();
    openButton.addEventListener("click", () => {
      dialog.showModal();
      if (subjectSelect.value) loadPdfDownloadPapers(subjectSelect.value);
    });
    getEl("closePdfDownload")?.addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    subjectSelect.addEventListener("change", () => loadPdfDownloadPapers(subjectSelect.value));
    paperSelect.addEventListener("change", () => setPdfDownloadLinks(paperSelect.value));
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
    localStorage.removeItem(VISITOR_MODE_KEY);
  }

  async function buildHome() {
    const token = readAuthToken();
    const visitorMode = !token && localStorage.getItem(VISITOR_MODE_KEY) === "1";
    if ((!token && !visitorMode) || (!visitorMode && !window.ALevelApi?.getCurrentUser)) {
      location.href = "pages/login.html";
      return;
    }

    let currentUser = visitorMode ? { role: "visitor", displayName: t("visitorMode") } : null;
    if (!visitorMode) {
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
    }

    applyLanguage(getLanguage());

    const goAdmin = getEl("goAdmin");
    if (goAdmin) {
      goAdmin.hidden = currentUser?.role !== "admin";
      goAdmin.addEventListener("click", () => {
        location.href = "pages/admin.html";
      });
    }
    if (visitorMode) {
      getEl("goNotebook").hidden = true;
      getEl("mobileNotebookShortcut").hidden = true;
      // The analysis page reads the signed-in user's notebook, so it has
      // nothing to show a visitor - same reason the notebook entry is hidden.
      const analysisEntry = getEl("goAnalysis");
      if (analysisEntry) analysisEntry.hidden = true;
      getEl("openProfile").hidden = true;
      getEl("logoutHome").dataset.i18n = "visitorLogIn";
      getEl("logoutHome").textContent = t("visitorLogIn");
    }

    getEl("goNotebook")?.addEventListener("click", () => {
      location.href = "pages/notebook.html";
    });
    getEl("goAnalysis")?.addEventListener("click", () => {
      location.href = "pages/analysis.html";
    });
    getEl("goCommunity")?.addEventListener("click", () => {
      location.href = "pages/community.html";
    });
    getEl("logoutHome")?.addEventListener("click", () => {
      clearSession();
      localStorage.removeItem(VISITOR_MODE_KEY);
      location.href = "pages/login.html";
    });

    const profileDialog = getEl("profileDialog");
    getEl("openProfile")?.addEventListener("click", () => profileDialog?.showModal());
    getEl("closeProfile")?.addEventListener("click", () => profileDialog?.close());
    profileDialog?.addEventListener("click", (event) => {
      if (event.target === profileDialog) profileDialog.close();
    });

    function fillAccountForm(user) {
      getEl("newDisplayName").value = user?.displayName || "";
      getEl("newGrade").value = user?.grade || "";
      getEl("newTargetScore").value = user?.targetScore == null ? "" : String(user.targetScore);
      getEl("oldPassword").value = "";
      getEl("newPassword").value = "";
      const petEnabled = getEl("petEnabled");
      const petSkin = getEl("petSkin");
      if (petEnabled) petEnabled.checked = user?.pet?.enabled !== false;
      if (petSkin) petSkin.value = user?.pet?.skin || "codex-glass";
    }

    if (!visitorMode) fillAccountForm(currentUser);
    const passwordSettings = getEl("passwordSettings");
    if (passwordSettings) passwordSettings.hidden = currentUser?.hasPassword === false;
    if (!visitorMode) {
      setAccountStatus("signedInAs", false, {
        name: currentUser?.displayName || t("unknownUser"),
      });
    }

    catalogSubjects = await loadSubjectCourses();
    renderSubjectCourses(catalogSubjects);
    renderAdditionalSubjects();
    const moreSubjectsButton = getEl("toggleMoreSubjects");
    const moreSubjectPanel = getEl("moreSubjectPanel");
    moreSubjectsButton?.addEventListener("click", () => {
      const expanded = moreSubjectPanel?.hidden === true;
      if (moreSubjectPanel) moreSubjectPanel.hidden = !expanded;
      moreSubjectsButton.setAttribute("aria-expanded", String(expanded));
    });
    setupPdfDownloads();

    const savePetSettings = async () => {
      const petEnabled = getEl("petEnabled");
      const petSkin = getEl("petSkin");
      const status = getEl("petSettingsStatus");
      const previous = window.ALevelPet?.getPreferences?.() || currentUser?.pet;
      const position = previous?.position || { x: 0.92, y: 0.84 };
      petEnabled.disabled = true;
      petSkin.disabled = true;
      if (status) status.textContent = t("profilePetSaving");
      try {
        const pet = await window.ALevelApi.updatePetPreferences(token, {
          enabled: petEnabled.checked,
          skin: petSkin.value,
          position,
        });
        currentUser = { ...currentUser, pet };
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(currentUser));
        window.ALevelPet?.applyPreferences?.(pet);
        if (status) status.textContent = t("profilePetSaved");
      } catch (error) {
        petEnabled.checked = previous?.enabled !== false;
        petSkin.value = previous?.skin || "codex-glass";
        if (status) status.textContent = t("profilePetSaveFailed", {
          message: error.message || t("retryLater"),
        });
      } finally {
        petEnabled.disabled = false;
        petSkin.disabled = false;
      }
    };
    if (!visitorMode) getEl("petEnabled")?.addEventListener("change", savePetSettings);
    if (!visitorMode) getEl("petSkin")?.addEventListener("change", savePetSettings);
    window.addEventListener("alevel:petpreferences", (event) => {
      const pet = event.detail;
      if (!pet) return;
      currentUser = { ...currentUser, pet };
      getEl("petEnabled").checked = pet.enabled !== false;
      getEl("petSkin").value = pet.skin || "codex-glass";
    });

    const updateProfileBtn = getEl("updateProfileBtn");
    updateProfileBtn?.addEventListener("click", async () => {
      const displayName = getEl("newDisplayName").value.trim();
      const grade = getEl("newGrade").value.trim();
      const targetScoreRaw = getEl("newTargetScore").value.trim();
      const targetScore = targetScoreRaw === "" ? null : Number.parseInt(targetScoreRaw, 10);
      const language = currentLanguage;

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
