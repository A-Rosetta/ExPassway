(function () {
  const TOKEN_KEY = "alevel.authToken";
  const PREFERENCES_KEY = "expassway.chat.notifications.v1";
  const state = { userId: "", token: "", preferences: { enabled: false, mutedConversationIds: [] }, unread: 0,
    seen: new Set(), latestMessages: new Map(), baselineReady: false, activeConversationId: "", refresh: null, generation: 0, unreadRevision: 0 };
  const isStudentSurface = () => document.body?.classList.contains("student-ui")
    && document.body.classList.contains("site-ui")
    && !document.body.classList.contains("admin-auth-page")
    && !document.body.classList.contains("admin-page");
  const t = (key, fallback) => window.ALevelI18n?.t?.(key) || fallback;

  function tokenSubject(token) {
    try {
      const part = String(token || "").split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(part + "=".repeat((4 - part.length % 4) % 4)));
      return typeof payload.sub === "string" ? payload.sub : "";
    } catch (_error) { return ""; }
  }

  function preferencesKey() { return state.userId ? `${PREFERENCES_KEY}.${state.userId}` : ""; }

  function loadPreferences() {
    state.preferences = { enabled: false, mutedConversationIds: [] };
    const key = preferencesKey();
    if (!key) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved) state.preferences = { enabled: saved.enabled === true,
        mutedConversationIds: Array.isArray(saved.mutedConversationIds) ? [...new Set(saved.mutedConversationIds.filter((id) => typeof id === "string"))] : [] };
    } catch (_error) { /* Preferences remain usable when browser storage is unavailable. */ }
  }

  function getPreferences() {
    return { enabled: state.preferences.enabled, mutedConversationIds: [...state.preferences.mutedConversationIds] };
  }

  function announcePreferences() {
    window.dispatchEvent(new CustomEvent("expassway:chat-notification-preferences", { detail: getPreferences() }));
  }

  function savePreferences() {
    const key = preferencesKey();
    if (key) {
      try { localStorage.setItem(key, JSON.stringify(state.preferences)); } catch (_error) { /* Keep this tab's setting. */ }
    }
    announcePreferences();
  }

  function setUser(userId) {
    const next = typeof userId === "string" ? userId : "";
    if (next === state.userId) return;
    state.userId = next;
    state.seen.clear();
    state.latestMessages.clear();
    state.baselineReady = false;
    loadPreferences();
    announcePreferences();
  }

  function isMuted(conversationId) { return state.preferences.mutedConversationIds.includes(conversationId); }

  function setMuted(conversationId, muted) {
    if (!conversationId) return false;
    const ids = new Set(state.preferences.mutedConversationIds);
    if (muted) ids.add(conversationId); else ids.delete(conversationId);
    state.preferences.mutedConversationIds = [...ids];
    savePreferences();
    return Boolean(muted);
  }

  async function setEnabled(enabled) {
    const userId = state.userId;
    let allowed = Boolean(enabled);
    if (allowed) {
      if (typeof Notification === "undefined") allowed = false;
      else if (Notification.permission !== "granted") {
        try { allowed = await Notification.requestPermission() === "granted"; } catch (_error) { allowed = false; }
      }
    }
    if (state.userId !== userId) return false;
    state.preferences.enabled = allowed;
    savePreferences();
    return allowed;
  }

  function chatPath() { return location.pathname.includes("/pages/") ? "chat.html" : "pages/chat.html"; }

  function updateEntry() {
    const entry = document.querySelector("[data-chat-entry]");
    if (!entry) return;
    const label = t("chatNavLabel", "Chat");
    const badge = entry.querySelector("[data-chat-unread]");
    if (badge) {
      badge.hidden = state.unread < 1;
      badge.textContent = state.unread > 99 ? "99+" : String(state.unread);
    }
    entry.setAttribute("aria-label", state.unread ? `${label} (${state.unread})` : label);
    entry.title = state.unread ? `${label} (${state.unread})` : label;
    const text = entry.querySelector(".chat-entry__label");
    if (text) text.textContent = label;
  }

  function addEntry() {
    if (!isStudentSurface() || !localStorage.getItem(TOKEN_KEY)) return;
    const host = document.querySelector(".home-header-controls, .site-header-controls, .community-topbar__actions");
    if (!host || host.querySelector("[data-chat-entry]")) { updateEntry(); return; }
    const entry = document.createElement("a");
    entry.className = "site-header-control chat-entry";
    entry.href = chatPath();
    entry.dataset.chatEntry = "true";
    entry.innerHTML = `
      <img class="chat-entry__icon" src="${location.pathname.includes("/pages/") ? "../" : ""}assets/chat-mark.svg?v=20261005-5" width="28" height="28" alt="" aria-hidden="true" />
      <span class="chat-entry__label" data-i18n="chatNavLabel"></span>
      <span class="chat-entry__badge" data-chat-unread aria-live="polite" hidden>0</span>`;
    host.prepend(entry);
    updateEntry();
  }

  function updateUnread(conversations) {
    state.unreadRevision += 1;
    state.unread = (Array.isArray(conversations) ? conversations : []).reduce((sum, conversation) => {
      const count = Number(conversation?.unreadCount);
      return sum + (Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0);
    }, 0);
    updateEntry();
    return state.unread;
  }

  function notify({ conversationId, conversationTitle, messageId, preview, mention = false, isOwn = false, activeConversationId = state.activeConversationId } = {}) {
    if (!conversationId || !messageId || isOwn || isMuted(conversationId) || !state.preferences.enabled
      || typeof Notification === "undefined" || Notification.permission !== "granted"
      || (activeConversationId === conversationId && !document.hidden && document.hasFocus())) return false;
    const messageKey = JSON.stringify([conversationId, messageId]);
    if (state.seen.has(messageKey)) return false;
    try {
      const title = mention ? `${conversationTitle || t("chatNavLabel", "Chat")} · @` : conversationTitle || t("chatNavLabel", "Chat");
      const notification = new Notification(title, { body: String(preview || t("chatEncryptedPreview", "Encrypted message")).slice(0, 240), tag: `expassway-chat-${conversationId}` });
      state.seen.add(messageKey);
      if (state.seen.size > 500) state.seen.delete(state.seen.values().next().value);
      notification.onclick = () => { window.focus(); location.href = chatPath(); notification.close(); };
      return true;
    } catch (_error) { return false; }
  }

  async function refreshUnread() {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!isStudentSurface() || !token || !window.ALevelApi?.listChatConversations) return;
    if (state.refresh) return state.refresh;
    const generation = state.generation;
    const unreadRevision = state.unreadRevision;
    state.refresh = (async () => {
      try {
        const conversations = await window.ALevelApi.listChatConversations();
        if (generation !== state.generation || unreadRevision !== state.unreadRevision || localStorage.getItem(TOKEN_KEY) !== token) return;
        updateUnread(conversations);
        for (const conversation of Array.isArray(conversations) ? conversations : []) {
          const latest = conversation.latestMessage;
          if (!latest?.id) continue;
          const previous = state.latestMessages.get(conversation.id);
          if (state.baselineReady && latest.id !== previous && Number(conversation.unreadCount) > 0) {
            notify({ conversationId: conversation.id, conversationTitle: conversation.title || conversation.group?.name || conversation.peer?.alias,
              messageId: latest.id, preview: latest.preview, isOwn: latest.senderUserId === state.userId });
          }
          state.latestMessages.set(conversation.id, latest.id);
        }
        state.baselineReady = true;
      } catch (_error) { /* Retain the most recent count during a network interruption. */ }
    })().finally(() => { if (generation === state.generation) state.refresh = null; });
    return state.refresh;
  }

  function resetAuth() {
    const token = localStorage.getItem(TOKEN_KEY) || "";
    if (token !== state.token) {
      state.generation += 1;
      state.refresh = null;
      state.token = token;
      state.unread = 0;
      setUser(tokenSubject(token));
      state.seen.clear();
      state.latestMessages.clear();
      state.baselineReady = false;
      state.activeConversationId = "";
    }
    if (!token) document.querySelector("[data-chat-entry]")?.remove();
    else { addEntry(); refreshUnread(); }
  }

  window.ALevelChatNotifications = { setUser, getPreferences, isMuted, setMuted,
    toggleMuted: (id) => setMuted(id, !isMuted(id)), setEnabled, updateUnread, refreshUnread, notify,
    setActiveConversation: (id) => { state.activeConversationId = typeof id === "string" ? id : ""; } };

  function initialize() {
    resetAuth();
    window.addEventListener("alevel:languagechange", addEntry);
    window.addEventListener("storage", (event) => {
      if (event.key === TOKEN_KEY || event.key === null) resetAuth();
      else if (event.key === preferencesKey()) { loadPreferences(); announcePreferences(); }
    });
    window.addEventListener("expassway:chat-session-cleared", resetAuth);
    window.addEventListener("expassway:chat-unread-changed", (event) => updateUnread(event.detail?.conversations || []));
    window.addEventListener("focus", refreshUnread);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshUnread(); });
    window.setInterval(() => { if (!document.hidden || state.preferences.enabled) refreshUnread(); }, 1000);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(initialize, 30));
  else setTimeout(initialize, 30);
})();
