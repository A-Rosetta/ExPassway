(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const GOOGLE_AUTH_PENDING_KEY = "alevel.googleAuthPending";
  const { t, applyPage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(text, isBad = false) {
    const status = byId("authStatus");
    status.textContent = text || "";
    status.className = isBad ? "auth-status bad" : "auth-status good";
    status.hidden = !text;
  }

  function setBusy(button, busy) {
    if (!button.dataset.originalHtml) button.dataset.originalHtml = button.innerHTML;
    button.disabled = busy;
    if (busy) button.textContent = t("connectingToGoogle");
    else {
      button.innerHTML = button.dataset.originalHtml;
      applyPage(button);
    }
  }

  byId("adminGoogleLoginBtn").addEventListener("click", async () => {
    const button = byId("adminGoogleLoginBtn");
    setBusy(button, true);
    try {
      const data = await window.ALevelApi.getGoogleAuthStart();
      sessionStorage.setItem(GOOGLE_AUTH_PENDING_KEY, String(Date.now()));
      location.assign(data.url);
    } catch (error) {
      setStatus(t(error?.status === 503 ? "googleLoginNotConfigured" : "googleLoginFailed", {
        message: error.message || t("retryLater"),
      }), true);
      setBusy(button, false);
    }
  });

  async function restoreAdminSession() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!token) return;
    setStatus(t("checkingLogin"));
    try {
      const user = await window.ALevelApi.getCurrentUser(token);
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
      localStorage.setItem(USER_ID_KEY, user.id);
      if (user.role !== "admin") {
        setStatus(t("notAdmin"), true);
        return;
      }
      location.href = "./admin.html";
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) {
        localStorage.removeItem(USER_PROFILE_KEY);
        localStorage.removeItem(USER_ID_KEY);
        localStorage.removeItem(AUTH_TOKEN_KEY);
      }
      setStatus(t("adminSessionInvalid"), true);
    }
  }

  applyPage();
  const hasOAuthResponse = /(?:^|#|&)access_token=/.test(location.hash)
    || /(?:^|#|&)error(?:_description)?=/.test(location.hash);
  if (hasOAuthResponse) {
    location.replace(`./login.html${location.hash}`);
  } else {
    restoreAdminSession();
  }
})();
