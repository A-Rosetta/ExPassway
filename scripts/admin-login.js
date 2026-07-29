(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
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
    button.disabled = busy;
    button.textContent = t(busy ? "loggingIn" : "loginBtn");
  }

  byId("adminLoginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const identifier = byId("adminIdentifier").value.trim();
    const password = byId("adminPassword").value;
    if (!identifier || !password) {
      setStatus(t("adminCredentialsRequired"), true);
      return;
    }

    const button = byId("adminLoginBtn");
    setBusy(button, true);
    try {
      const data = await window.ALevelApi.adminLogin({ identifier, password });
      localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(data.user));
      localStorage.setItem(USER_ID_KEY, data.user.id);
      localStorage.setItem(AUTH_TOKEN_KEY, data.token);
      location.href = "./admin.html";
    } catch (error) {
      setStatus(t("loginFailed", { message: error.message || t("invalidCredentials") }), true);
    } finally {
      setBusy(button, false);
    }
  });

  applyPage();
})();
