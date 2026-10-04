(function () {
  const api = window.ALevelApi;
  const { t, getLanguage } = window.ALevelI18n;
  const { publicKeyOptions, serialiseCredential } = window.ALevelPasskeys;
  const list = document.getElementById("passkeyList");
  const add = document.getElementById("addPasskeyBtn");
  const status = document.getElementById("passkeySettingsStatus");
  if (!list || !add || !status) return;
  const token = () => localStorage.getItem("alevel.authToken") || "";
  let rows = [];
  let busy = false;
  let statusKey = "";
  let statusText = "";
  let generation = 0;

  function setStatus(key, text = "") {
    statusKey = key;
    statusText = text;
    status.textContent = key ? t(key) : text;
  }

  function failure(error) {
    if (error?.code === "LAST_CHAT_PASSKEY") setStatus("passkeySettingsProtectedChat");
    else if (error?.code === "LAST_PASSKEY") setStatus("passkeySettingsProtectedLast");
    else if (error?.name === "NotAllowedError" || error?.name === "AbortError") setStatus("passkeySettingsCancelled");
    else setStatus("", error?.message || t("passkeySettingsFailed"));
  }

  function render() {
    list.replaceChildren();
    const active = rows.filter((row) => !row.revoked);
    add.disabled = busy || !window.PublicKeyCredential || !navigator.credentials?.create;
    if (!active.length) { list.textContent = t("passkeySettingsEmpty"); return; }
    active.forEach((passkey) => {
      const row = document.createElement("div");
      row.className = "profile-passkey-row";
      const text = document.createElement("span");
      const date = new Date(passkey.createdAt).toLocaleString(getLanguage() === "zh-CN" ? "zh-CN" : "en");
      const label = t(passkey.chatUnlock ? "passkeySettingsChatUnlock" : "passkeySettingsLoginOnly");
      text.textContent = `${String(passkey.credentialId || "").slice(0, 16)}… · ${t("passkeySettingsAddedAt", { date })} · ${label}`;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary";
      button.textContent = t("passkeySettingsRevoke");
      const protectedChat = passkey.revokeBlockedReason === "LAST_CHAT_PASSKEY";
      button.disabled = busy || active.length <= 1 || passkey.canRevoke === false;
      if (protectedChat || active.length <= 1) button.title = t(protectedChat ? "passkeySettingsProtectedChat" : "passkeySettingsProtectedLast");
      button.addEventListener("click", async () => {
        if (busy || !window.confirm(t("passkeySettingsRevokeConfirm"))) return;
        busy = true;
        render();
        try { await api.revokePasskey(token(), passkey.id); await load(); setStatus("passkeySettingsRevoked"); }
        catch (error) { failure(error); }
        finally { busy = false; render(); }
      });
      row.append(text, button);
      list.append(row);
    });
  }

  async function load() {
    const currentGeneration = ++generation;
    try {
      const data = await api.listPasskeys(token());
      if (currentGeneration !== generation) return;
      rows = Array.isArray(data) ? data : [];
      render();
    } catch (error) { if (currentGeneration === generation) failure(error); }
  }

  add.addEventListener("click", async () => {
    if (busy) return;
    if (!window.PublicKeyCredential || !navigator.credentials?.create) { setStatus("passkeySettingsUnavailable"); return; }
    busy = true;
    render();
    setStatus("passkeySettingsCreating");
    try {
      const raw = await api.getPasskeyRegistrationOptions(token());
      const credential = await navigator.credentials.create({ publicKey: publicKeyOptions(raw) });
      if (!credential) { setStatus("passkeySettingsCancelled"); return; }
      await api.registerPasskey(token(), { challenge: (raw.publicKey || raw).challenge, credential: serialiseCredential(credential) });
      await load();
      setStatus("passkeySettingsAdded");
    } catch (error) { failure(error); }
    finally { busy = false; render(); }
  });

  document.getElementById("openProfile")?.addEventListener("click", () => { setStatus(""); load(); });
  window.addEventListener("alevel:languagechange", () => { render(); status.textContent = statusKey ? t(statusKey) : statusText; });
})();
