(function () {
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const { t, applyPage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  function setStatus(text, isBad) {
    const el = byId("adminLoginStatus");
    if (!el) return;
    el.textContent = text;
    el.className = isBad ? "tip bad" : "tip good";
  }

  function writeAuth(user, token) {
    localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(user));
    if (user?.id) {
      localStorage.setItem(USER_ID_KEY, user.id);
    }
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  }

  async function onLogin() {
    const email = byId("adminEmail").value.trim();
    const password = byId("adminPassword").value.trim();
    if (!email || !password) {
      setStatus(t("enterAdminCredentials"), true);
      return;
    }

    const btn = byId("adminLoginBtn");
    const oldText = btn.textContent;
    btn.disabled = true;
    btn.textContent = t("loggingIn");

    try {
      const data = await window.ALevelApi.login({ email, password });
      writeAuth(data.user, data.token);
      setStatus(t("loginSuccess", { name: data.user.displayName }), false);
      setTimeout(() => {
        location.href = "./admin.html";
      }, 250);
    } catch (err) {
      setStatus(t("loginFailed", { message: err.message || t("invalidCredentials") }), true);
    } finally {
      btn.disabled = false;
      btn.textContent = oldText;
      applyPage();
    }
  }

  byId("adminLoginBtn").addEventListener("click", onLogin);
  byId("goUserLoginBtn").addEventListener("click", () => {
    location.href = "./login.html";
  });
  byId("goHomeBtn").addEventListener("click", () => {
    location.href = "../index.html";
  });

  applyPage();
  setStatus(t("adminLoginPrompt"), false);
})();
