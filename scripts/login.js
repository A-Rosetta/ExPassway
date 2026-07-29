(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const GOOGLE_AUTH_PENDING_KEY = "alevel.googleAuthPending";
  const GOOGLE_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
  const { t, getLanguage, applyPage } = window.ALevelI18n;
  let selectedEmail = "";

  function byId(id) {
    return document.getElementById(id);
  }

  function setAuthStatus(text, isBad = false) {
    const status = byId("authStatus");
    status.textContent = text || "";
    status.className = isBad ? "auth-status bad" : "auth-status good";
    status.hidden = !text;
  }

  function setEmailError(text) {
    const error = byId("emailError");
    byId("userEmail").setAttribute("aria-invalid", text ? "true" : "false");
    error.textContent = text || "";
    error.hidden = !text;
  }

  function isValidEmail(value) {
    const email = String(value || "").trim();
    if (email.length > 254 || /\s/.test(email)) return false;
    const parts = email.split("@");
    if (parts.length !== 2) return false;
    const [local, domain] = parts;
    if (!local || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) {
      return false;
    }
    const labels = domain.split(".");
    return labels.length >= 2 && labels.every((label) => (
      label.length > 0
      && label.length <= 63
      && !label.startsWith("-")
      && !label.endsWith("-")
      && /^[a-z0-9-]+$/i.test(label)
    ));
  }

  function writeUserProfile(profile) {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    if (profile?.id) localStorage.setItem(USER_ID_KEY, profile.id);
  }

  function clearAuth() {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function applyAuthSuccess(payload, messageKey) {
    writeUserProfile(payload.user);
    localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
    setAuthStatus(t(messageKey, { name: payload.user.displayName }));
    setTimeout(() => {
      location.href = payload.user?.role === "admin" ? "./admin.html" : "../index.html";
    }, 300);
  }

  function setStep(step) {
    byId("emailStep").hidden = step !== "email";
    byId("passwordStep").hidden = step !== "password";
    byId("registerStep").hidden = step !== "register";
    document.querySelectorAll("[data-auth-email]").forEach((node) => {
      node.textContent = selectedEmail;
    });
    setAuthStatus("");

    const focusTarget = {
      email: byId("userEmail"),
      password: byId("loginPassword"),
      register: byId("userDisplayName"),
    }[step];
    requestAnimationFrame(() => focusTarget?.focus());
  }

  function setButtonBusy(button, busy, busyKey) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = busy;
    if (busy) {
      button.textContent = t(busyKey);
      return;
    }
    button.innerHTML = button.dataset.originalHtml;
    applyPage(button);
  }

  async function handleGoogleCallback() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const accessToken = params.get("access_token");
    const error = params.get("error_description") || params.get("error");
    if (!accessToken && !error) return false;

    history.replaceState(null, "", `${location.pathname}${location.search}`);
    const startedAt = Number(sessionStorage.getItem(GOOGLE_AUTH_PENDING_KEY));
    sessionStorage.removeItem(GOOGLE_AUTH_PENDING_KEY);
    if (!startedAt || Date.now() - startedAt > GOOGLE_AUTH_MAX_AGE_MS) {
      setAuthStatus(t("googleLoginUnexpectedCallback"), true);
      return true;
    }
    if (error) {
      setAuthStatus(t("googleLoginFailed", { message: error }), true);
      return true;
    }

    setAuthStatus(t("googleLoginFinishing"));
    try {
      const data = await window.ALevelApi.loginWithGoogle(accessToken, getLanguage());
      applyAuthSuccess(data, "loginSuccess");
    } catch (err) {
      setAuthStatus(t("googleLoginFailed", { message: err.message || t("retryLater") }), true);
    }
    return true;
  }

  async function restoreSession() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!token) return;
    setAuthStatus(t("checkingLogin"));
    try {
      const user = await window.ALevelApi.getCurrentUser(token);
      writeUserProfile(user);
      setAuthStatus(t("autoLoginSuccess", { name: user.displayName }));
      setTimeout(() => {
        location.href = user?.role === "admin" ? "./admin.html" : "../index.html";
      }, 300);
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) {
        clearAuth();
        setAuthStatus(t(err.status === 403 ? "accountDisabled" : "loginExpired"), true);
        return;
      }
      setAuthStatus(t("loginCheckUnavailable", { message: err.message || t("retryLater") }), true);
    }
  }

  async function init() {
    byId("emailForm").addEventListener("submit", (event) => {
      event.preventDefault();
      const email = byId("userEmail").value.trim().toLowerCase();
      if (!isValidEmail(email)) {
        setEmailError(t("invalidEmailAddress"));
        return;
      }
      setEmailError("");
      selectedEmail = email;
      setStep("password");
    });

    byId("userEmail").addEventListener("input", () => setEmailError(""));
    document.querySelectorAll("[data-auth-back]").forEach((button) => {
      button.addEventListener("click", () => setStep(button.dataset.authBack));
    });
    byId("showRegisterBtn").addEventListener("click", () => setStep("register"));

    byId("loginForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = byId("loginPassword").value;
      if (!password) {
        setAuthStatus(t("passwordRequired"), true);
        return;
      }
      const button = byId("loginBtn");
      setButtonBusy(button, true, "loggingIn");
      try {
        const data = await window.ALevelApi.login({ identifier: selectedEmail, password });
        applyAuthSuccess(data, "loginSuccess");
      } catch (err) {
        setAuthStatus(
          err?.status === 403
            ? t("accountDisabled")
            : t("loginFailed", { message: err.message || t("invalidCredentials") }),
          true
        );
      } finally {
        setButtonBusy(button, false, "loggingIn");
      }
    });

    byId("registerForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const displayName = byId("userDisplayName").value.trim();
      const password = byId("registerPassword").value;
      if (!displayName) {
        setAuthStatus(t("displayNameRequired"), true);
        return;
      }
      if (password.length < 6) {
        setAuthStatus(t("passwordTooShort"), true);
        return;
      }
      const button = byId("registerBtn");
      setButtonBusy(button, true, "registering");
      try {
        const data = await window.ALevelApi.register({
          displayName,
          email: selectedEmail,
          password,
          grade: null,
          targetScore: null,
          language: getLanguage(),
        });
        applyAuthSuccess(data, "registerSuccess");
      } catch (err) {
        setAuthStatus(t("registerFailed", { message: err.message || t("retryLater") }), true);
      } finally {
        setButtonBusy(button, false, "registering");
      }
    });

    byId("googleLoginBtn").addEventListener("click", async () => {
      const button = byId("googleLoginBtn");
      setButtonBusy(button, true, "connectingToGoogle");
      try {
        const data = await window.ALevelApi.getGoogleAuthStart();
        sessionStorage.setItem(GOOGLE_AUTH_PENDING_KEY, String(Date.now()));
        location.assign(data.url);
      } catch (err) {
        setAuthStatus(
          t(err?.status === 503 ? "googleLoginNotConfigured" : "googleLoginFailed", {
            message: err.message || t("retryLater"),
          }),
          true
        );
        setButtonBusy(button, false, "connectingToGoogle");
      }
    });

    applyPage();
    const handledCallback = await handleGoogleCallback();
    if (!handledCallback) await restoreSession();
  }

  init();
})();
