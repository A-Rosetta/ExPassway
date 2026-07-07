(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const USER_LANGUAGE_KEY = "alevel.language";
  const { t, getLanguage, applyPage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  function setAuthStatus(text, isBad) {
    const statusEl = byId("authStatus");
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = isBad ? "tip bad" : "tip good";
  }

  function readUserProfile() {
    const raw = localStorage.getItem(USER_PROFILE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_err) {
      return null;
    }
  }

  function writeUserProfile(profile) {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    if (profile?.id) {
      localStorage.setItem(USER_ID_KEY, profile.id);
    }
    if (profile?.language) {
      localStorage.setItem(USER_LANGUAGE_KEY, profile.language);
      window.ALevelI18n.setLanguage(profile.language);
    }
  }

  function readAuthToken() {
    return localStorage.getItem(AUTH_TOKEN_KEY) || "";
  }

  function writeAuthToken(token) {
    if (!token) return;
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }

  function clearAuth() {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function fillForm(user) {
    byId("userDisplayName").value = user?.displayName || "";
    byId("userEmail").value = user?.email || "";
    byId("userGrade").value = user?.grade || "";
    byId("userTargetScore").value = user?.targetScore == null ? "" : String(user.targetScore);
    byId("userPassword").value = "";
  }

  function applyAuthSuccess(payload, text) {
    writeUserProfile(payload.user);
    writeAuthToken(payload.token);
    fillForm(payload.user);
    setAuthStatus(text, false);
    setTimeout(() => {
      location.href = "../index.html";
    }, 300);
  }

  async function init() {
    const registerBtn = byId("registerBtn");
    const loginBtn = byId("loginBtn");
    const logoutBtn = byId("logoutBtn");
    const goHomeBtn = byId("goHomeBtn");

    const existing = readUserProfile();
    if (existing?.displayName && readAuthToken()) {
      fillForm(existing);
      setAuthStatus(t("alreadyLoggedIn", { name: existing.displayName }), false);
    } else {
      setAuthStatus(t("notLoggedIn"), true);
    }

    registerBtn.addEventListener("click", async () => {
      const displayName = byId("userDisplayName").value.trim();
      const email = byId("userEmail").value.trim();
      const password = byId("userPassword").value.trim();
      const grade = byId("userGrade").value.trim();
      const targetScoreRaw = byId("userTargetScore").value.trim();
      const targetScore = targetScoreRaw === "" ? null : Number.parseInt(targetScoreRaw, 10);

      if (!displayName || !email || !password) {
        setAuthStatus(t("registerFieldsRequired"), true);
        return;
      }
      if (password.length < 6) {
        setAuthStatus(t("passwordTooShort"), true);
        return;
      }

      registerBtn.disabled = true;
      const old = registerBtn.textContent;
      registerBtn.textContent = t("registering");
      try {
        const data = await window.ALevelApi.register({
          displayName,
          email,
          password,
          grade: grade || null,
          targetScore: Number.isNaN(targetScore) ? null : targetScore,
          language: getLanguage(),
        });
        applyAuthSuccess(data, t("registerSuccess", { name: data.user.displayName }));
      } catch (err) {
        setAuthStatus(t("registerFailed", { message: err.message || t("retryLater") }), true);
      } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = old;
        applyPage();
      }
    });

    loginBtn.addEventListener("click", async () => {
      const email = byId("userEmail").value.trim();
      const password = byId("userPassword").value.trim();
      if (!email || !password) {
        setAuthStatus(t("loginFieldsRequired"), true);
        return;
      }

      loginBtn.disabled = true;
      const old = loginBtn.textContent;
      loginBtn.textContent = t("loggingIn");
      try {
        const data = await window.ALevelApi.login({ email, password });
        applyAuthSuccess(data, t("loginSuccess", { name: data.user.displayName }));
      } catch (err) {
        setAuthStatus(t("loginFailed", { message: err.message || t("invalidCredentials") }), true);
      } finally {
        loginBtn.disabled = false;
        loginBtn.textContent = old;
        applyPage();
      }
    });

    logoutBtn.addEventListener("click", () => {
      clearAuth();
      fillForm(null);
      setAuthStatus(t("loggedOut"), false);
    });

    goHomeBtn.addEventListener("click", () => {
      location.href = "../index.html";
    });

    const goAdminLoginBtn = byId("goAdminLoginBtn");
    if (goAdminLoginBtn) {
      goAdminLoginBtn.addEventListener("click", () => {
        location.href = "./admin-login.html";
      });
    }

    const token = readAuthToken();
    if (token) {
      window.ALevelApi.getCurrentUser(token)
        .then((user) => {
          writeUserProfile(user);
          fillForm(user);
          setAuthStatus(t("autoLoginSuccess", { name: user.displayName }), false);
          setTimeout(() => {
            location.href = "../index.html";
          }, 300);
        })
        .catch(() => {
          clearAuth();
          setAuthStatus(t("loginExpired"), true);
        });
    }
  }

  applyPage();
  init();
})();
