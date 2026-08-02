(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const GOOGLE_AUTH_PENDING_KEY = "alevel.googleAuthPending";
  const { t, getLanguage, applyPage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(text, isBad = false) {
    const status = byId("authStatus");
    status.textContent = text || "";
    status.className = isBad ? "auth-status bad" : "auth-status good";
    status.hidden = !text;
  }

  function clearAuth() {
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function storeAdminSession(payload) {
    if (payload.user.role !== "admin") {
      clearAuth();
      setStatus(t("notAdmin"), true);
      return false;
    }
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(payload.user));
    localStorage.setItem(USER_ID_KEY, payload.user.id);
    localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
    location.href = "../index.html";
    return true;
  }

  function setBusy(button, busy, busyKey) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = busy;
    if (busy) button.textContent = t(busyKey);
    else {
      button.innerHTML = button.dataset.originalHtml;
      applyPage(button);
    }
  }

  function setFieldError(input, errorElement, message) {
    input.setAttribute("aria-invalid", message ? "true" : "false");
    errorElement.textContent = message || "";
    errorElement.hidden = !message;
  }

  function normalizedEmail() {
    return byId("adminEmailOtpAddress").value.trim().toLowerCase();
  }

  function showOtpStep(email) {
    byId("adminEmailStep").hidden = true;
    byId("adminOtpStep").hidden = false;
    byId("adminOtpAccountEmail").textContent = email;
    byId("adminEmailOtpCode").value = "";
    byId("adminEmailOtpCode").focus();
  }

  function showEmailStep() {
    byId("adminOtpStep").hidden = true;
    byId("adminEmailStep").hidden = false;
    setFieldError(byId("adminEmailOtpCode"), byId("adminEmailOtpCodeError"), "");
    setStatus("");
    byId("adminEmailOtpAddress").focus();
  }

  async function restoreAdminSession() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!token) return;
    setStatus(t("checkingLogin"));
    try {
      const user = await window.ALevelApi.getCurrentUser(token);
      if (user.role !== "admin") {
        clearAuth();
        setStatus(t("notAdmin"), true);
        return;
      }
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
      localStorage.setItem(USER_ID_KEY, user.id);
      location.href = "../index.html";
    } catch (_error) {
      clearAuth();
      setStatus(t("adminSessionInvalid"), true);
    }
  }

  async function init() {
    byId("adminGoogleLoginBtn").addEventListener("click", async () => {
      const button = byId("adminGoogleLoginBtn");
      setBusy(button, true, "connectingToGoogle");
      try {
        const data = await window.ALevelApi.getGoogleAuthStart();
        sessionStorage.setItem(GOOGLE_AUTH_PENDING_KEY, String(Date.now()));
        location.assign(data.url);
      } catch (error) {
        setStatus(t(error?.status === 503 ? "googleLoginNotConfigured" : "googleLoginFailed", {
          message: error.message || t("retryLater"),
        }), true);
        setBusy(button, false, "connectingToGoogle");
      }
    });

    byId("adminEmailOtpRequestForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = byId("adminEmailOtpAddress");
      const errorElement = byId("adminEmailOtpAddressError");
      const email = normalizedEmail();
      if (!input.checkValidity() || !email) {
        setFieldError(input, errorElement, t("invalidEmailAddress"));
        return;
      }
      setFieldError(input, errorElement, "");
      const button = byId("adminEmailOtpRequestBtn");
      setBusy(button, true, "sendingEmailOtp");
      try {
        await window.ALevelApi.requestEmailOtp(email);
        showOtpStep(email);
        setStatus(t("emailOtpSent"));
      } catch (error) {
        setStatus(t("emailOtpSendFailed", { message: error.message || t("retryLater") }), true);
      } finally {
        setBusy(button, false, "sendingEmailOtp");
      }
    });

    byId("adminEmailOtpVerifyForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = byId("adminEmailOtpCode");
      const errorElement = byId("adminEmailOtpCodeError");
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) {
        setFieldError(input, errorElement, t("invalidEmailOtpCode"));
        return;
      }
      setFieldError(input, errorElement, "");
      const button = byId("adminEmailOtpVerifyBtn");
      setBusy(button, true, "verifyingEmailOtp");
      try {
        const data = await window.ALevelApi.verifyEmailOtp(normalizedEmail(), code, getLanguage());
        if (!storeAdminSession(data)) setBusy(button, false, "verifyingEmailOtp");
      } catch (_error) {
        clearAuth();
        setStatus(t("emailOtpVerifyFailed"), true);
        setBusy(button, false, "verifyingEmailOtp");
      }
    });

    byId("adminEmailOtpBackBtn").addEventListener("click", showEmailStep);

    applyPage();
    const hasOAuthResponse = /(?:^|#|&)access_token=/.test(location.hash)
      || /(?:^|#|&)error(?:_description)?=/.test(location.hash);
    if (hasOAuthResponse) location.replace(`./login.html${location.hash}`);
    else await restoreAdminSession();
  }

  init();
})();
