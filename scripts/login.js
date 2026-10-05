(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const GOOGLE_AUTH_PENDING_KEY = "alevel.googleAuthPending";
  const VISITOR_MODE_KEY = "alevel.visitorMode";
  const GOOGLE_AUTH_MAX_AGE_MS = 10 * 60 * 1000;
  const { t, getLanguage, applyPage } = window.ALevelI18n;
  let resendAvailableAt = 0;
  let resendTimer = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function setAuthStatus(text, isBad = false) {
    const status = byId("authStatus");
    status.textContent = text || "";
    status.className = isBad ? "auth-status bad" : "auth-status good";
    status.hidden = !text;
  }

  function redirectAfterAuth() {
    const next = new URLSearchParams(location.search).get("next");
    const destination = next && /^chat\.html(?:\?|$)/.test(next)
      ? next
      : "../index.html";
    location.href = destination;
  }

  function writeUserProfile(profile) {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(profile));
    if (profile?.id) localStorage.setItem(USER_ID_KEY, profile.id);
  }

  function clearAuth() {
    window.ALevelChatSession?.clear();
    localStorage.removeItem(USER_PROFILE_KEY);
    localStorage.removeItem(USER_ID_KEY);
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }

  function applyAuthSuccess(payload, messageKey) {
    window.ALevelChatSession?.clear();
    localStorage.removeItem(VISITOR_MODE_KEY);
    writeUserProfile(payload.user);
    localStorage.setItem(AUTH_TOKEN_KEY, payload.token);
    setAuthStatus(t(messageKey, { name: payload.user.displayName }));
    setTimeout(redirectAfterAuth, 300);
  }

  const { publicKeyOptions, serialiseCredential } = window.ALevelPasskeys;

  async function offerPasskeyRegistration(payload) {
    if (!payload.needsPasskeySetup) {
      applyAuthSuccess(payload, "loginSuccess");
      return;
    }
    if (!window.PublicKeyCredential || !navigator.credentials?.create) {
      applyAuthSuccess(payload, "loginSuccess");
      return;
    }
    const shouldRegister = window.confirm(t("passkeyRegisterPrompt"));
    if (!shouldRegister) {
      applyAuthSuccess(payload, "loginSuccess");
      return;
    }
    try {
      const options = await window.ALevelApi.getPasskeyRegistrationOptions(payload.token);
      const credential = await navigator.credentials.create({ publicKey: publicKeyOptions(options) });
      if (!credential) throw new Error("No Passkey was created.");
      await window.ALevelApi.registerPasskey(payload.token, {
        challenge: options.publicKey?.challenge || options.challenge,
        credential: serialiseCredential(credential),
      });
    } catch (error) {
      setAuthStatus(error.message || t("passkeyLoginFailed"), true);
    }
    applyAuthSuccess(payload, "loginSuccess");
  }

  function passkeyLoginSupported() {
    return Boolean(window.isSecureContext && window.PublicKeyCredential && navigator.credentials?.get);
  }

  async function authenticateWithPasskey() {
    const button = byId("passkeyLoginBtn");
    if (button.disabled) return;
    const input = byId("emailOtpAddress");
    const email = normalizedEmail();
    if (!input.checkValidity() || !email) {
      setFieldError(input, byId("emailOtpAddressError"), t("invalidEmailAddress"));
      input.focus();
      return;
    }
    setFieldError(input, byId("emailOtpAddressError"), "");
    if (!passkeyLoginSupported()) {
      setAuthStatus(t("passkeyLoginUnsupported"), true);
      return;
    }
    const emailButton = byId("emailOtpRequestBtn");
    setButtonBusy(button, true, "passkeyLoginStarting");
    emailButton.disabled = true;
    input.readOnly = true;
    setAuthStatus(t("passkeyLoginStarting"));
    try {
      // Each explicit click starts a fresh challenge for the current email.
      const options = await window.ALevelApi.getAuthPasskeyOptions(email);
      const credential = await navigator.credentials.get({ publicKey: publicKeyOptions(options) });
      if (!credential) throw new Error("No Passkey was selected.");
      const data = await window.ALevelApi.verifyAuthPasskey(email, {
        challenge: options.publicKey?.challenge || options.challenge,
        credential: serialiseCredential(credential),
      });
      applyAuthSuccess(data, "loginSuccess");
    } catch (_error) {
      setAuthStatus(t("passkeyLoginFailed"), true);
    } finally {
      setButtonBusy(button, false, "passkeyLoginStarting");
      emailButton.disabled = false;
      input.readOnly = false;
    }
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

  function setFieldError(input, errorElement, message) {
    input.setAttribute("aria-invalid", message ? "true" : "false");
    errorElement.textContent = message || "";
    errorElement.hidden = !message;
  }

  function normalizedEmail() {
    return byId("emailOtpAddress").value.trim().toLowerCase();
  }

  function retryAfterSeconds(error) {
    return Number(error?.payload?.error?.details?.retryAfterSeconds) || 0;
  }

  function updateResendButton() {
    const button = byId("emailOtpResendBtn");
    const seconds = Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000));
    button.disabled = seconds > 0;
    button.textContent = seconds > 0 ? t("resendEmailOtpIn", { seconds }) : t("resendEmailOtp");
    if (seconds === 0 && resendTimer) {
      clearInterval(resendTimer);
      resendTimer = 0;
    }
  }

  function startResendCooldown(seconds) {
    resendAvailableAt = Date.now() + (Math.max(1, Number(seconds) || 60) * 1000);
    if (resendTimer) clearInterval(resendTimer);
    updateResendButton();
    resendTimer = window.setInterval(updateResendButton, 250);
  }

  function showOtpStep(email) {
    document.body.classList.add("is-otp-step");
    byId("emailStep").hidden = true;
    byId("otpStep").hidden = false;
    byId("otpAccountEmail").textContent = email;
    byId("emailOtpCode").value = "";
    byId("emailOtpCode").focus();
  }

  function showEmailStep() {
    document.body.classList.remove("is-otp-step");
    byId("otpStep").hidden = true;
    byId("emailStep").hidden = false;
    setFieldError(byId("emailOtpCode"), byId("emailOtpCodeError"), "");
    setAuthStatus("");
    resendAvailableAt = 0;
    if (resendTimer) clearInterval(resendTimer);
    resendTimer = 0;
    updateResendButton();
    byId("emailOtpAddress").focus();
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
      await offerPasskeyRegistration(data);
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
      setTimeout(redirectAfterAuth, 300);
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
    byId("emailOtpRequestForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = byId("emailOtpAddress");
      const errorElement = byId("emailOtpAddressError");
      const email = normalizedEmail();
      if (!input.checkValidity() || !email) {
        setFieldError(input, errorElement, t("invalidEmailAddress"));
        return;
      }
      setFieldError(input, errorElement, "");
      const button = byId("emailOtpRequestBtn");
      setButtonBusy(button, true, "sendingEmailOtp");
      byId("passkeyLoginBtn").disabled = true;
      input.readOnly = true;
      try {
        const result = await window.ALevelApi.requestEmailOtp(email);
        showOtpStep(email);
        startResendCooldown(result.retryAfterSeconds);
        setAuthStatus(t("emailOtpSent"));
      } catch (err) {
        setAuthStatus(t("emailOtpSendFailed", { message: err.message || t("retryLater") }), true);
      } finally {
        setButtonBusy(button, false, "sendingEmailOtp");
        byId("passkeyLoginBtn").disabled = false;
        input.readOnly = false;
      }
    });
    byId("passkeyLoginBtn").hidden = !passkeyLoginSupported();
    byId("passkeyLoginBtn").addEventListener("click", authenticateWithPasskey);
    byId("emailOtpResendBtn").addEventListener("click", async () => {
      if (Date.now() < resendAvailableAt) return;
      const button = byId("emailOtpResendBtn");
      button.disabled = true;
      button.textContent = t("sendingEmailOtp");
      try {
        const result = await window.ALevelApi.requestEmailOtp(normalizedEmail());
        startResendCooldown(result.retryAfterSeconds);
        setAuthStatus(t("emailOtpSent"));
      } catch (error) {
        const seconds = retryAfterSeconds(error);
        if (seconds) startResendCooldown(seconds);
        else updateResendButton();
        setAuthStatus(t("emailOtpSendFailed", { message: error.message || t("retryLater") }), true);
      }
    });
    byId("emailOtpVerifyForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = byId("emailOtpCode");
      const errorElement = byId("emailOtpCodeError");
      const code = input.value.trim();
      if (!/^\d{6}$/.test(code)) {
        setFieldError(input, errorElement, t("invalidEmailOtpCode"));
        return;
      }
      setFieldError(input, errorElement, "");
      const button = byId("emailOtpVerifyBtn");
      setButtonBusy(button, true, "verifyingEmailOtp");
      try {
        const data = await window.ALevelApi.verifyEmailOtp(normalizedEmail(), code, getLanguage());
        await offerPasskeyRegistration(data);
      } catch (_err) {
        setAuthStatus(t("emailOtpVerifyFailed"), true);
        setButtonBusy(button, false, "verifyingEmailOtp");
      }
    });
    byId("emailOtpBackBtn").addEventListener("click", showEmailStep);
    byId("visitorModeBtn").addEventListener("click", () => {
      clearAuth();
      localStorage.setItem(VISITOR_MODE_KEY, "1");
      location.href = "../index.html";
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
    window.addEventListener("alevel:languagechange", updateResendButton);
    const handledCallback = await handleGoogleCallback();
    if (!handledCallback) await restoreSession();
  }

  init();
})();
