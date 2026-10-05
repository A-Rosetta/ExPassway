(function () {
  const TOKEN_KEY = "alevel.authToken";
  const isStudentSurface = () => document.body?.classList.contains("student-ui")
    && document.body.classList.contains("site-ui")
    && !document.body.classList.contains("admin-auth-page")
    && !document.body.classList.contains("admin-page");
  const t = (key, fallback) => window.ALevelI18n?.t?.(key) || fallback;

  function chatPath() {
    return location.pathname.includes("/pages/") ? "chat.html" : "pages/chat.html";
  }

  function addEntry() {
    if (!isStudentSurface() || !localStorage.getItem(TOKEN_KEY)) return;
    const host = document.querySelector(".home-header-controls, .site-header-controls, .community-topbar__actions");
    if (!host || host.querySelector("[data-chat-entry]")) return;
    const entry = document.createElement("a");
    entry.className = "site-header-control chat-entry";
    entry.href = chatPath();
    entry.dataset.chatEntry = "true";
    entry.innerHTML = `
      <img class="chat-entry__icon" src="${location.pathname.includes("/pages/") ? "../" : ""}assets/chat-mark.svg?v=20261005-5" width="28" height="28" alt="" aria-hidden="true" />
      <span class="chat-entry__label" data-i18n="chatNavLabel"></span>
      <span class="chat-entry__badge" data-chat-unread hidden>0</span>`;
    entry.setAttribute("aria-label", t("chatNavLabel", "Chat"));
    entry.title = t("chatNavLabel", "Chat");
    host.prepend(entry);
    window.ALevelI18n?.applyPage?.(entry);
  }

  async function refreshUnread() {
    if (!isStudentSurface() || !localStorage.getItem(TOKEN_KEY) || !window.ALevelApi) return;
    // The first phase intentionally omits read receipts and presence. This badge is only a lightweight entry signal.
    const badge = document.querySelector("[data-chat-unread]");
    if (badge) badge.hidden = true;
  }

  function initialize() {
    addEntry();
    refreshUnread();
    window.addEventListener("alevel:languagechange", addEntry);
    window.addEventListener("storage", (event) => {
      if (event.key !== TOKEN_KEY && event.key !== null) return;
      if (!localStorage.getItem(TOKEN_KEY)) document.querySelector("[data-chat-entry]")?.remove();
      else addEntry();
    });
    window.addEventListener("expassway:chat-session-cleared", () => {
      if (!localStorage.getItem(TOKEN_KEY)) document.querySelector("[data-chat-entry]")?.remove();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, 30));
  else setTimeout(initialize, 30);
})();
