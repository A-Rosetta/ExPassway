(function () {
  const TOKEN_KEY = "alevel.authToken";
  const DEVICE_KEY = "expassway.chat.device.v1";
  const PENDING_INVITE_KEY = "expassway.chat.pendingInvite.v1";
  const t = (key, fallback, vars = {}) => {
    let value = window.ALevelI18n?.t?.(key) || fallback;
    Object.entries(vars).forEach(([name, replacement]) => {
      value = value.replaceAll(`{${name}}`, String(replacement));
    });
    return value;
  };
  const state = {
    profile: null,
    device: null,
    contacts: [],
    conversations: [],
    activeConversation: null,
    messages: [],
    cursor: "",
    cryptoWorker: null,
    pendingCrypto: new Map(),
    localPlaintexts: {},
    peerBundles: new Map(),
    ownBundle: null,
    conversationBundles: new Map(),
    devices: [],
    recoveryEnabled: false,
    socket: null,
    pollTimer: null,
    syncInFlight: null,
    syncGeneration: 0,
  };
  const $ = (selector) => document.querySelector(selector);
  const status = $("#chatStatus");

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", isError);
  }

  function formatActionError(error) {
    const message = error?.message || String(error || "Unknown error");
    const details = [];
    if (error?.code && error.code !== "HTTP_ERROR") details.push(error.code);
    if (error?.status) details.push(`HTTP ${error.status}`);
    return `${message}${details.length ? ` (${details.join(", ")})` : ""}`;
  }

  async function shortIdentityFingerprint(identityKey) {
    const normalized = String(identityKey || "").replace(/-/g, "+").replace(/_/g, "/");
    if (!normalized) return "?";
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    let encoded = "";
    for (const byte of new Uint8Array(digest)) encoded += String.fromCharCode(byte);
    return btoa(encoded).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "").slice(0, 12);
  }

  function currentToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function savedDevice() {
    try {
      return JSON.parse(localStorage.getItem(DEVICE_KEY) || "null");
    } catch (_error) {
      return null;
    }
  }

  function saveDevice(device) {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
  }

  async function cacheLocalPlaintext(clientMessageId, plaintext) {
    state.localPlaintexts[clientMessageId] = plaintext;
    await cryptoCall("storeLocalPlaintext", { clientMessageId, plaintext });
  }

  async function getCachedLocalPlaintext(clientMessageId) {
    if (Object.prototype.hasOwnProperty.call(state.localPlaintexts, clientMessageId)) {
      return state.localPlaintexts[clientMessageId];
    }
    const plaintext = await cryptoCall("getLocalPlaintext", { clientMessageId });
    if (plaintext != null) state.localPlaintexts[clientMessageId] = plaintext;
    return plaintext;
  }

  function createCryptoWorker() {
    if (state.cryptoWorker) return state.cryptoWorker;
    const worker = new Worker("../assets/vendor/chat-crypto-worker.js?v=20260812-1", { name: "expassway-chat-crypto" });
    worker.onerror = (event) => {
      const error = new Error(event.message || "The chat encryption worker stopped unexpectedly.");
      for (const pending of state.pendingCrypto.values()) pending.reject(error);
      state.pendingCrypto.clear();
      state.cryptoWorker = null;
    };
    worker.onmessage = (event) => {
      const { id, ok, result, error, code } = event.data || {};
      const pending = state.pendingCrypto.get(id);
      if (!pending) return;
      state.pendingCrypto.delete(id);
      if (ok) pending.resolve(result);
      else {
        const failure = new Error(error || "Chat crypto operation failed.");
        failure.code = code || "CRYPTO_ERROR";
        pending.reject(failure);
      }
    };
    state.cryptoWorker = worker;
    return worker;
  }

  function cryptoCall(action, payload) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      state.pendingCrypto.set(id, { resolve, reject });
      createCryptoWorker().postMessage({ id, action, payload });
    });
  }

  function extractInviteToken(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try {
      const url = new URL(raw, location.href);
      return url.searchParams.get("invite") || url.pathname.split("/").at(-1) || raw;
    } catch (_error) {
      return raw;
    }
  }

  function pendingInviteToken() {
    const fromUrl = new URL(location.href).searchParams.get("invite");
    return extractInviteToken(fromUrl || sessionStorage.getItem(PENDING_INVITE_KEY) || "");
  }

  function renderInvites(invites) {
    const host = $("#inviteList");
    if (!host) return;
    host.replaceChildren();
    invites.filter((invite) => invite.active).slice(0, 5).forEach((invite) => {
      const item = document.createElement("div");
      item.className = "chat-invite-item";
      item.innerHTML = `<div><code></code><small></small></div><span></span>`;
      item.querySelector("code").textContent = invite.id;
      item.querySelector("small").textContent = t("chatInviteIdOnly", "Internal ID only");
      item.querySelector("span").textContent = new Date(invite.expiresAt).toLocaleDateString();
      host.appendChild(item);
    });
  }

  function renderContacts() {
    const host = $("#conversationList");
    if (!host) return;
    host.replaceChildren();
    if (!state.conversations.length) {
      const empty = document.createElement("p");
      empty.className = "chat-muted";
      empty.textContent = t("chatNoContacts", "No friends yet.");
      host.appendChild(empty);
      return;
    }
    state.conversations.forEach((conversation) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `chat-conversation-item${state.activeConversation?.id === conversation.id ? " is-active" : ""}`;
      button.innerHTML = `<strong></strong><small></small>`;
      if (conversation.kind === "group") {
        button.querySelector("strong").textContent = t("chatGroupTitle", "Group ({count} members)", {
          count: conversation.group?.memberCount || 0,
        });
        button.querySelector("small").textContent = t("chatGroupMemberCount", "{count} members", {
          count: conversation.group?.memberCount || 0,
        });
      } else {
        button.querySelector("strong").textContent = conversation.peer?.alias || t("chatNoConversation", "Conversation");
        button.querySelector("small").textContent = conversation.peer?.identityFingerprint
          ? conversation.peer.identityFingerprint.slice(0, 12)
          : "";
      }
      button.addEventListener("click", () => selectConversation(conversation));
      host.appendChild(button);
    });
    renderGroupContactPicker();
  }

  function renderGroupContactPicker() {
    const host = $("#groupContactList");
    if (!host) return;
    host.replaceChildren();
    if (!state.contacts.length) {
      const empty = document.createElement("p");
      empty.className = "chat-muted";
      empty.textContent = t("chatGroupNeedsContacts", "Pair at least one friend before creating a group.");
      host.appendChild(empty);
      return;
    }
    state.contacts.forEach((contact) => {
      const label = document.createElement("label");
      label.className = "chat-group-contact-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = contact.id;
      const text = document.createElement("span");
      text.textContent = contact.profile?.alias || t("chatNoConversation", "Conversation");
      label.append(checkbox, text);
      host.appendChild(label);
    });
  }

  function setGroupFormVisible(visible) {
    const form = $("#groupCreatePanel");
    if (!form) return;
    form.hidden = !visible;
    if (visible) renderGroupContactPicker();
  }

  function renderDevices() {
    const host = $("#deviceList");
    if (!host) return;
    host.replaceChildren();
    state.device && ($("#deviceFingerprint").textContent = t("chatDeviceReady", "Device ready. Safety number: {fingerprint}", { fingerprint: state.device.identityFingerprint }));
    const devices = state.devices.length ? state.devices : (state.device ? [state.device] : []);
    devices.forEach((device) => {
      const item = document.createElement("div");
      item.className = "chat-device-item";
      item.innerHTML = `<div class="chat-device-item__details"><strong></strong><small></small></div><div class="chat-device-item__actions"><button type="button" class="btn-secondary chat-device-approve"></button><button type="button" class="btn-secondary chat-device-backup"></button><button type="button" class="btn-secondary chat-device-revoke"></button></div>`;
      item.querySelector("strong").textContent = device.label || `Device ${device.deviceNumber || ""}`;
      item.querySelector("small").textContent = t("chatPrekeyCount", "Pre-keys: {count}", { count: device.oneTimePreKeyCount ?? "?" });
      const approve = item.querySelector(".chat-device-approve");
      const backup = item.querySelector(".chat-device-backup");
      const revoke = item.querySelector(".chat-device-revoke");
      approve.textContent = t("chatApproveDevice", "Create device approval token");
      backup.textContent = t("chatCreateBackup", "Create encrypted recovery backup");
      revoke.textContent = t("chatRevokeDevice", "Revoke device");
      approve.hidden = device.id !== state.device?.id || Boolean(device.revokedAt);
      backup.hidden = !state.recoveryEnabled || device.id !== state.device?.id || Boolean(device.revokedAt);
      revoke.hidden = device.id === state.device?.id || Boolean(device.revokedAt);
      approve.addEventListener("click", () => createDeviceApproval(device.id));
      backup.addEventListener("click", () => createRecoveryBackup(device.id));
      revoke.addEventListener("click", () => revokeDevice(device.id));
      host.appendChild(item);
    });
  }

  async function updateRecoveryAvailability() {
    const actions = [$("#createRecoveryBackup"), $("#restoreRecoveryBackup"), $("#restoreRecoveryBackupSetup")].filter(Boolean);
    if (!actions.length) return;
    try {
      await window.ALevelApi.getChatKeyBackup();
      state.recoveryEnabled = true;
      actions.forEach((button) => { button.hidden = false; });
    } catch (_error) {
      state.recoveryEnabled = false;
      actions.forEach((button) => { button.hidden = true; });
    }
  }

  async function createRecoveryBackup(deviceId) {
    if (!window.confirm(t("chatBackupWarning", "The backup excludes message plaintext but includes secure session state. Anyone with this recovery password may decrypt messages near the backup time."))) return;
    const password = window.prompt(t("chatRecoveryPasswordPrompt", "Enter a separate recovery password:"))?.trim() || "";
    if (!password) return;
    try {
      const backup = await cryptoCall("createRecoveryBackup", { userId: state.profile?.id, sourceDeviceId: deviceId, password });
      await window.ALevelApi.saveChatKeyBackup(backup);
      setStatus(t("chatBackupCreated", "Encrypted recovery backup saved. Keep the recovery password safe."));
      await refreshData();
    } catch (error) {
      setStatus(`${t("chatBackupFailed", "Could not save recovery backup: {message}", { message: error.message })}${error.code ? ` (${error.code})` : ""}`, true);
    }
  }

  async function restoreRecoveryBackup() {
    const source = window.prompt(t("chatRecoverySourcePrompt", "Enter the source device ID shown in the backup:"))?.trim() || "";
    const password = window.prompt(t("chatRecoveryPasswordPrompt", "Enter the separate recovery password:"))?.trim() || "";
    if (!source || !password) return;
    try {
      const backup = await window.ALevelApi.getChatKeyBackup();
      if (!backup || backup.sourceDeviceId !== source) throw new Error(t("chatBackupNotFound", "No recovery backup matches that source device."));
      const validation = await cryptoCall("restoreRecoveryBackup", { userId: state.profile?.id, backup, password });
      const backupDate = validation.createdAt ? new Date(validation.createdAt).toLocaleString() : "unknown";
      if (!window.confirm(t(
        "chatRecoveryConfirm",
        "Restore encrypted device state from {source}, created at {date}? The source device will be revoked after confirmation.",
        { source, date: backupDate },
      ))) {
        await cryptoCall("clearRestoredDeviceState", {});
        return;
      }
      const bundle = await cryptoCall("createRestoredDeviceBundle", { label: navigator.userAgent.includes("Mobile") ? "Restored mobile browser" : "Restored browser" });
      const restored = await window.ALevelApi.restoreChatKeyBackup({
        deviceId: bundle.deviceId,
        restoreOperationId: bundle.restoreOperationId,
        sourceDeviceId: bundle.sourceDeviceId,
        identityPublicKey: bundle.identityPublicKey,
        registrationId: bundle.registrationId,
        signedPreKey: bundle.signedPreKey,
        oneTimePreKeys: bundle.oneTimePreKeys,
        label: bundle.label,
      });
      await cryptoCall("commitRestoredDeviceState", { deviceId: bundle.deviceId });
      state.device = { ...restored.device, identityFingerprint: bundle.identityFingerprint };
      saveDevice(state.device);
      setStatus(t("chatRecoveryComplete", "Device recovery complete. The previous device was revoked."));
      await refreshData();
    } catch (error) {
      await cryptoCall("clearRestoredDeviceState", {}).catch(() => {});
      setStatus(t("chatRecoveryFailed", "Device recovery failed: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function createDeviceApproval(deviceId) {
    try {
      const result = await window.ALevelApi.createChatDeviceApproval(deviceId);
      await navigator.clipboard?.writeText(result.token);
      setStatus(t("chatApprovalCopied", "Approval token copied. It is single-use and valid for 5 minutes."));
    } catch (error) {
      setStatus(t("chatApprovalFailed", "Could not create approval token: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function revokeDevice(deviceId) {
    try {
      await window.ALevelApi.revokeChatDevice(deviceId);
      state.devices = state.devices.filter((device) => device.id !== deviceId);
      renderDevices();
      setStatus("");
    } catch (error) {
      setStatus(formatActionError(error), true);
    }
  }

  function renderMessages() {
    const host = $("#messageList");
    if (!host) return;
    host.replaceChildren();
    state.messages.forEach((message) => {
      const item = document.createElement("article");
      item.className = `chat-message${message.senderDeviceId === state.device?.id ? " is-mine" : ""}`;
      const decryptCode = message.decryptCode ? ` (${message.decryptCode})` : "";
      const text = message.deleted
        ? "[deleted]"
        : message.plaintext || `${t("chatDecryptFailed", "Could not decrypt this message.")}${decryptCode}`;
      item.innerHTML = `<small class="chat-message__sender" hidden></small><p></p><div class="chat-message__attachment" hidden></div><time></time>`;
      if (state.activeConversation?.kind === "group" && message.senderAlias) {
        const sender = item.querySelector(".chat-message__sender");
        sender.hidden = false;
        sender.textContent = message.senderDeviceId === state.device?.id
          ? t("chatYou", "You")
          : message.senderAlias;
      }
      let structured = null;
      try { structured = JSON.parse(text); } catch (_error) { }
      if (structured?.kind === "image" && structured.attachmentId) {
        item.querySelector("p").textContent = structured.name || t("chatAttachImage", "Encrypted image");
        const attachment = item.querySelector(".chat-message__attachment");
        attachment.hidden = false;
        const downloadButton = document.createElement("button");
        downloadButton.type = "button";
        downloadButton.className = "btn-secondary chat-small-action";
        downloadButton.textContent = t("chatAttachImage", "Download encrypted image");
        downloadButton.addEventListener("click", () => downloadImage(structured));
        attachment.appendChild(downloadButton);
      } else {
        item.querySelector("p").textContent = text;
      }
      item.querySelector("time").textContent = new Date(message.createdAt).toLocaleString();
      host.appendChild(item);
    });
    host.scrollTop = host.scrollHeight;
  }

  async function resetActiveSession() {
    const conversation = state.activeConversation;
    const peer = conversation?.peer;
    if (!conversation || !peer?.deviceId) return;
    if (!window.confirm(t("chatResetSessionConfirm", "Reset this secure session? You should compare the safety number with your friend first."))) return;
    try {
      await cryptoCall("resetSession", { deviceId: state.device.id, peerDeviceId: peer.deviceId, peerDeviceNumber: peer.deviceNumber });
      state.peerBundles.delete(peer.contactId);
      await renderSafetyNumber(conversation);
      setStatus(t("chatSessionReset", "Secure session reset. Send a new message to establish it again."));
    } catch (error) {
      setStatus(formatActionError(error), true);
    }
  }

  async function assertSafetyStable(conversation) {
    if (!conversation || !state.device) return;
    const peerDevices = await getPeerDevices(conversation);
    if (!peerDevices.length) return;
    const safety = await cryptoCall("safetyNumber", {
      localDeviceId: state.device.id,
      localDevices: state.devices.filter((item) => !item.revokedAt).map((item) => ({
        deviceId: item.id,
        deviceNumber: item.deviceNumber,
        identityKey: item.identityPublicKey,
      })),
      peerDevices,
    });
    const verified = await cryptoCall("getSafetyNumberVerification", { key: conversation.id });
    const changed = await cryptoCall("getSafetyNumberChange", { key: conversation.id });
    if (changed || (verified && verified !== safety)) {
      const error = new Error(t("chatSafetyChangedBlock", "The safety number changed. Verify it again before sending."));
      error.code = "SAFETY_NUMBER_CHANGED";
      throw error;
    }
    return peerDevices;
  }

  async function getPeerDevices(conversation) {
    if (conversation?.kind === "group") {
      const bundle = state.conversationBundles.get(conversation.id)
        || await window.ALevelApi.getChatConversationBundle(conversation.id);
      state.conversationBundles.set(conversation.id, bundle);
      return (bundle?.members || []).flatMap((member) => member.devices || []);
    }
    const contactId = conversation?.peer?.contactId;
    if (!contactId) return [];
    const bundle = state.peerBundles.get(contactId) || await window.ALevelApi.getChatContactBundle(contactId);
    state.peerBundles.set(contactId, bundle);
    return bundle?.devices || [];
  }

  async function getEncryptionRecipients(conversation) {
    const peerDevices = await getPeerDevices(conversation);
    if (!peerDevices.length) {
      const error = new Error(t("chatNoActiveGroupDevices", "No active recipient devices are available."));
      error.code = "NO_ACTIVE_RECIPIENT_DEVICES";
      throw error;
    }
    const ownBundle = state.ownBundle || await window.ALevelApi.getChatOwnDeviceBundle(state.device.id);
    state.ownBundle = ownBundle;
    const ownDevices = ownBundle?.devices || [];
    const recipients = [...peerDevices, ...ownDevices];
    const seen = new Set();
    return recipients.filter((device) => {
      if (!device?.deviceId || seen.has(device.deviceId)) return false;
      seen.add(device.deviceId);
      return true;
    });
  }

  async function downloadImage(metadata) {
    try {
      const blob = await window.ALevelApi.downloadChatAttachment(metadata.attachmentId);
      const bytes = await blob.arrayBuffer();
      const decrypted = await cryptoCall("decryptAttachment", { bytes, key: metadata.key, nonce: metadata.nonce });
      const imageBlob = new Blob([decrypted], { type: metadata.mime || "image/*" });
      const url = URL.createObjectURL(imageBlob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = metadata.name || "encrypted-image";
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setStatus(t("chatAttachmentFailed", "Image upload failed: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function decryptMessages(messages) {
    const result = [];
    for (const message of messages) {
      if (message.deleted) {
        result.push({ ...message, deleted: true });
        continue;
      }
      try {
        const cachedPlaintext = await getCachedLocalPlaintext(message.clientMessageId);
        if (cachedPlaintext != null) {
          result.push({ ...message, plaintext: cachedPlaintext });
          continue;
        }
      } catch (_error) {
        // A cache read failure should not prevent a normal decrypt attempt.
      }
      try {
        const outer = JSON.parse(atob(message.ciphertext.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - message.ciphertext.length % 4) % 4)));
        const selected = outer.recipients?.[state.device.id] || outer;
        if (!selected?.body) throw new Error("No ciphertext for this device.");
        const plaintext = await cryptoCall("decryptMessage", {
          deviceId: state.device.id,
          peerDeviceId: message.senderDeviceId,
          peerDeviceNumber: message.senderDeviceNumber || state.activeConversation?.peer?.deviceNumber || 1,
          ciphertext: selected,
        });
        result.push({ ...message, plaintext });
        try {
          await cacheLocalPlaintext(message.clientMessageId, plaintext);
        } catch (_error) {
          // The message is still usable in this render if local caching fails.
        }
      } catch (error) {
        result.push({ ...message, plaintext: null, decryptCode: error?.code || "DECRYPT_FAILED" });
      }
    }
    return result;
  }

  async function syncConversation() {
    if (!state.activeConversation || !state.device) return;
    if (state.syncInFlight) return state.syncInFlight;
    const generation = state.syncGeneration;
    state.syncInFlight = (async () => {
      const conversationId = state.activeConversation.id;
      const payload = await window.ALevelApi.syncChatMessages(conversationId, state.cursor);
      if (state.syncGeneration !== generation || state.activeConversation?.id !== conversationId) return;
      const fresh = await decryptMessages(payload.messages || []);
      const known = new Set(state.messages.map((message) => message.id));
      state.messages = [...state.messages, ...fresh.filter((message) => !known.has(message.id))];
      state.cursor = payload.nextCursor || state.cursor;
      renderMessages();
    })().finally(() => {
      if (state.syncGeneration === generation) state.syncInFlight = null;
    });
    return state.syncInFlight;
  }

  function stopPolling() {
    if (state.pollTimer) window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }

  function startPolling() {
    stopPolling();
    state.pollTimer = window.setInterval(() => {
      if (document.hidden || !state.activeConversation) return;
      syncConversation().catch((error) => setStatus(formatActionError(error), true));
    }, 5000);
  }

  async function openRealtime() {
    if (!state.activeConversation || !state.device) return;
    state.socket?.close();
    try {
      const ticket = await window.ALevelApi.createChatWebSocketTicket(state.activeConversation.id, state.device.id);
      const base = window.ALevelApi.getBaseUrl() || location.origin;
      const wsUrl = new URL(`/api/chat/ws/${encodeURIComponent(state.activeConversation.id)}`, base);
      wsUrl.protocol = wsUrl.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(wsUrl, [ticket.protocol, `ticket.${ticket.ticket}`]);
      socket.onmessage = async (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type !== "message" || payload.message?.conversationId !== state.activeConversation.id) return;
          const fresh = await decryptMessages([payload.message]);
          if (!state.messages.some((message) => message.id === fresh[0].id)) state.messages.push(fresh[0]);
          renderMessages();
        } catch (_error) {
        }
      };
      state.socket = socket;
    } catch (_error) {
      // Cursor sync remains available when realtime is unavailable.
    }
  }

  async function selectConversation(conversation) {
    stopPolling();
    const previousSync = state.syncInFlight;
    state.syncGeneration += 1;
    state.syncInFlight = null;
    await previousSync?.catch(() => {});
    state.activeConversation = conversation;
    state.messages = [];
    state.cursor = "";
    $("#conversationEmpty").hidden = true;
    $("#conversationActive").hidden = false;
    $("#conversationTitle").textContent = conversation.kind === "group"
      ? t("chatGroupTitle", "Group ({count} members)", { count: conversation.group?.memberCount || 0 })
      : conversation.peer?.alias || "Conversation";
    await renderSafetyNumber(conversation);
    $("#retentionSelect").value = String(conversation.retentionSeconds);
    renderContacts();
    try {
      await syncConversation();
      await openRealtime();
      startPolling();
    } catch (error) {
      setStatus(formatActionError(error), true);
    }
  }

  async function renderSafetyNumber(conversation) {
    const host = $("#conversationSafety");
    if (!host) return;
    try {
      const peerDevices = await getPeerDevices(conversation);
      const safety = await cryptoCall("safetyNumber", {
        localDeviceId: state.device.id,
        localDevices: state.devices.filter((item) => !item.revokedAt).map((item) => ({
          deviceId: item.id,
          deviceNumber: item.deviceNumber,
          identityKey: item.identityPublicKey,
        })),
        peerDevices,
      });
      const verificationKey = conversation.id;
      const verified = await cryptoCall("getSafetyNumberVerification", { key: verificationKey });
      const safetyChanged = Boolean(verified && verified !== safety);
      const safetyChange = await cryptoCall("getSafetyNumberChange", { key: verificationKey });
      if (safetyChanged && safetyChange !== safety) {
        await cryptoCall("clearSafetyNumberVerification", { key: verificationKey });
        await cryptoCall("markSafetyNumberChanged", { key: verificationKey, safety });
      }
      const safetyNeedsVerification = safetyChanged || Boolean(safetyChange);
      host.replaceChildren();
      const label = document.createElement("span");
      const safetyStatus = safetyNeedsVerification
        ? t("chatSafetyChanged", "Safety number changed; verify again")
        : verified
          ? t("chatSafetyVerified", "Verified")
          : t("chatSafetyUnverified", "Not verified");
      label.textContent = `${t("chatSafetyNumber", "Safety number")}: ${safety} · ${safetyStatus}`;
      host.appendChild(label);
      const deviceFingerprints = document.createElement("small");
      deviceFingerprints.className = "chat-device-fingerprints";
      const fingerprints = await Promise.all(peerDevices.map(async (device) =>
        `${device.deviceNumber}: ${await shortIdentityFingerprint(device.identityKey)}`));
      deviceFingerprints.textContent = t(
        "chatPeerDeviceFingerprints",
        "Peer device fingerprints: {devices}",
        { devices: fingerprints.join(" · ") || "-" },
      );
      host.appendChild(deviceFingerprints);
      if (conversation.kind === "group") {
        const memberNames = document.createElement("small");
        memberNames.className = "chat-device-fingerprints";
        memberNames.textContent = t(
          "chatGroupMembers",
          "Members: {members}",
          { members: (conversation.group?.members || []).map((member) => member.isSelf ? t("chatYou", "You") : member.alias).join(", ") || "-" },
        );
        host.appendChild(memberNames);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn-secondary chat-small-action";
      button.textContent = verified === safety && !safetyNeedsVerification
        ? t("chatSafetyVerified", "Verified")
        : t("chatSafetyVerify", "Mark verified");
      button.addEventListener("click", async () => {
        await cryptoCall("setSafetyNumberVerification", { key: verificationKey, safety });
        await renderSafetyNumber(conversation);
      });
      host.appendChild(button);
      if (conversation.kind !== "group") {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "btn-secondary chat-small-action";
        reset.textContent = t("chatResetSession", "Reset secure session");
        reset.addEventListener("click", resetActiveSession);
        host.appendChild(reset);
      }
    } catch (error) {
      host.textContent = conversation.peer?.identityFingerprint || "";
      if (error?.code) setStatus(`${error.message} (${error.code})`, true);
    }
  }

  async function ensureDevice() {
    const existing = savedDevice();
    if (existing) {
      const serverDevices = await window.ALevelApi.listChatDevices();
      state.devices = serverDevices;
      const current = serverDevices.find((device) => device.id === existing.id && !device.revokedAt);
      if (!current) {
        localStorage.removeItem(DEVICE_KEY);
        $("#chatSetupPanel").hidden = false;
        return;
      }
      state.device = { ...existing, ...current };
      renderDevices();
      return;
    }
    $("#chatSetupPanel").hidden = false;
  }

  async function setupDevice() {
    const button = $("#generateDeviceKeys");
    button.disabled = true;
    setStatus(t("chatSetupLoading", "Generating device keys..."));
    try {
      const browserDeviceId = crypto.randomUUID();
      const bundle = await cryptoCall("generateDeviceBundle", { deviceId: browserDeviceId, label: navigator.userAgent.includes("Mobile") ? "Mobile browser" : "Browser" });
      const existingDevices = await window.ALevelApi.listChatDevices();
      let approvalToken = "";
      if (existingDevices.length) {
        approvalToken = window.prompt("Enter the one-time approval token from a trusted device.")?.trim() || "";
        if (!approvalToken) throw new Error("A trusted device approval token is required.");
      }
      const registered = await window.ALevelApi.registerChatDevice({ ...bundle, approvalToken });
      state.device = { ...registered.device, identityFingerprint: bundle.identityFingerprint };
      saveDevice(state.device);
      $("#chatSetupPanel").hidden = true;
      $("#chatApp").hidden = false;
      renderDevices();
      setStatus("");
      await refreshData();
    } catch (error) {
      setStatus(t("chatSetupFailed", "Device setup failed: {message}", { message: formatActionError(error) }), true);
      button.disabled = false;
    }
  }

  async function refreshData() {
    const [profile, invites, contacts, conversations] = await Promise.all([
      window.ALevelApi.getChatProfile(),
      window.ALevelApi.listChatInvites(),
      window.ALevelApi.listChatContacts(),
      window.ALevelApi.listChatConversations(),
    ]);
    state.profile = profile;
    state.contacts = contacts;
    state.conversations = conversations;
    state.peerBundles.clear();
    state.conversationBundles.clear();
    state.ownBundle = null;
    state.devices = await window.ALevelApi.listChatDevices();
    await ensurePrekeys();
    await updateRecoveryAvailability();
    renderInvites(invites);
    renderContacts();
    renderDevices();
  }

  async function ensurePrekeys() {
    const current = state.devices.find((device) => device.id === state.device?.id && !device.revokedAt);
    if (!current || Number(current.oneTimePreKeyCount) >= 5) return;
    try {
      const refill = await cryptoCall("generatePreKeyRefill", { deviceId: state.device.id, count: 20 });
      await window.ALevelApi.refillChatDevicePreKeys(state.device.id, refill.oneTimePreKeys);
      state.devices = await window.ALevelApi.listChatDevices();
    } catch (error) {
      setStatus(t("chatPrekeyRefillFailed", "Could not replenish one-time pre-keys: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function createGroup() {
    const selected = [...document.querySelectorAll("#groupContactList input[type=checkbox]:checked")]
      .map((input) => input.value);
    if (!selected.length) {
      setStatus(t("chatGroupSelectMembers", "Select at least one friend."), true);
      return;
    }
    if (selected.length > 49) {
      setStatus(t("chatGroupTooManyMembers", "A group can contain at most 50 people including you."), true);
      return;
    }
    try {
      const conversation = await window.ALevelApi.createChatGroup(selected);
      state.conversations = [conversation, ...state.conversations.filter((item) => item.id !== conversation.id)];
      setGroupFormVisible(false);
      renderContacts();
      await selectConversation(conversation);
      setStatus(t("chatGroupCreated", "Encrypted group created."));
    } catch (error) {
      setStatus(t("chatGroupCreateFailed", "Could not create group: {message}", { message: formatActionError(error) }), true);
    }
  }

  async function createInvite() {
    try {
      const invite = await window.ALevelApi.createChatInvite();
      const url = new URL(location.href);
      url.search = `?invite=${encodeURIComponent(invite.token)}`;
      const inviteUrl = url.toString();
      $("#inviteToken").value = inviteUrl;
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(inviteUrl);
          copied = true;
        }
      } catch (_error) {
        // Private browsing may deny clipboard access; the URL remains visible for manual copying.
      }
      setStatus(t(
        copied ? "chatInviteCreated" : "chatInviteCreatedManualCopy",
        copied
          ? "Invite created. It expires in 7 days and can be used once."
          : "Invite created. Copy the URL from the invite field; it expires in 7 days and can be used once."
      ));
      try {
        await refreshData();
      } catch (error) {
        setStatus(t("chatInviteRefreshFailed", "Invite processed, but the chat list could not refresh: {message}", { message: error.message }), true);
      }
    } catch (error) {
      setStatus(t("chatInviteFailed", "Invite action failed: {message}", { message: error.message }), true);
    }
  }

  async function acceptInvite() {
    const raw = $("#inviteToken").value.trim();
    const token = extractInviteToken(raw);
    if (!token) {
      setStatus(t("chatInviteTokenMissing", "Paste the full invite URL or the invite token first."), true);
      return;
    }
    if (/^[A-Za-z0-9_-]{20,32}$/.test(token)) {
      setStatus(t("chatInviteIdNotToken", "This looks like an internal invite ID, not the invite token. Ask the creator to create a new invite and copy the full URL."), true);
      return;
    }
    try {
      await window.ALevelApi.acceptChatInvite(token);
      $("#inviteToken").value = "";
      sessionStorage.removeItem(PENDING_INVITE_KEY);
      setStatus(t("chatInviteAccepted", "Friend paired."));
      try {
        await refreshData();
      } catch (error) {
        setStatus(t("chatInviteRefreshFailed", "Friend paired, but the chat list could not refresh: {message}", { message: error.message }), true);
      }
    } catch (error) {
      if (error.code === "INVITE_SELF") {
        setStatus(t("chatInviteSelf", error.message), true);
        return;
      }
      const detail = error.code && error.code !== "HTTP_ERROR"
        ? `${error.message || "Request failed"} (${error.code})`
        : error.message || t("chatInviteUnknownError", "No error details were returned. Check the browser console and network response.");
      setStatus(t("chatInviteFailed", "Invite action failed: {message}", { message: detail }), true);
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (!state.activeConversation || !state.device) return;
    const input = $("#messageInput");
    const plaintext = input.value.trim();
    if (!plaintext) return;
    const button = $("#sendMessage");
    button.disabled = true;
    setStatus(t("chatSending", "Encrypting and sending..."));
    try {
      await assertSafetyStable(state.activeConversation);
      const peers = await getEncryptionRecipients(state.activeConversation);
      if (!peers.length) throw new Error("The contact has no active device.");
      const recipients = {};
      for (const peer of peers) {
        await cryptoCall("processPreKeyBundle", {
          deviceId: state.device.id,
          peerDeviceId: peer.deviceId,
          peerDeviceNumber: peer.deviceNumber,
          bundle: peer,
        });
        recipients[peer.deviceId] = await cryptoCall("encryptMessage", {
          deviceId: state.device.id,
          peerDeviceId: peer.deviceId,
          peerDeviceNumber: peer.deviceNumber,
          plaintext,
        });
      }
      const envelope = btoa(JSON.stringify({ version: 1, recipients })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
      const clientMessageId = crypto.randomUUID();
      await window.ALevelApi.sendChatMessage({
        conversationId: state.activeConversation.id,
        senderDeviceId: state.device.id,
        clientMessageId,
        protocolVersion: "signal-v1",
        ciphertext: envelope,
        sizeBucket: "small",
      });
      await cacheLocalPlaintext(clientMessageId, plaintext);
      input.value = "";
      await syncConversation();
      setStatus("");
    } catch (error) {
      setStatus(t("chatMessageFailed", "Message failed: {message}", { message: formatActionError(error) }), true);
    } finally {
      button.disabled = false;
    }
  }

  async function sendImage(file) {
    if (!file || !state.activeConversation || !state.device) return;
    if (file.size > 10 * 1024 * 1024) throw new Error("Encrypted images must be 10 MB or smaller.");
    setStatus(t("chatSending", "Encrypting and sending..."));
    await assertSafetyStable(state.activeConversation);
    const encryptedFile = await cryptoCall("encryptAttachment", { bytes: await file.arrayBuffer() });
    const reservation = await window.ALevelApi.initChatAttachment({
      conversationId: state.activeConversation.id,
      sizeBytes: encryptedFile.bytes.byteLength,
    });
    await window.ALevelApi.uploadChatAttachment(reservation.attachmentId, encryptedFile.bytes);
    await window.ALevelApi.completeChatAttachment(reservation.attachmentId);
    const peers = await getEncryptionRecipients(state.activeConversation);
    if (!peers.length) throw new Error("The contact has no active device.");
    const metadata = JSON.stringify({
      kind: "image",
      attachmentId: reservation.attachmentId,
      key: encryptedFile.key,
      nonce: encryptedFile.nonce,
      name: file.name,
      mime: file.type || "image/*",
    });
    const recipients = {};
    for (const peer of peers) {
      await cryptoCall("processPreKeyBundle", {
        deviceId: state.device.id,
        peerDeviceId: peer.deviceId,
        peerDeviceNumber: peer.deviceNumber,
        bundle: peer,
      });
      recipients[peer.deviceId] = await cryptoCall("encryptMessage", {
        deviceId: state.device.id,
        peerDeviceId: peer.deviceId,
        peerDeviceNumber: peer.deviceNumber,
        plaintext: metadata,
      });
    }
    const envelope = btoa(JSON.stringify({ version: 1, recipients })).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    const clientMessageId = crypto.randomUUID();
    await window.ALevelApi.sendChatMessage({
      conversationId: state.activeConversation.id,
      senderDeviceId: state.device.id,
      clientMessageId,
      protocolVersion: "signal-v1",
      ciphertext: envelope,
      attachmentRefs: [reservation.attachmentId],
    });
    await cacheLocalPlaintext(clientMessageId, metadata);
    $("#imageInput").value = "";
    await syncConversation();
    setStatus("");
  }

  function wireEvents() {
    $("#generateDeviceKeys")?.addEventListener("click", setupDevice);
    $("#createGroup")?.addEventListener("click", () => setGroupFormVisible(true));
    $("#confirmCreateGroup")?.addEventListener("click", createGroup);
    $("#cancelCreateGroup")?.addEventListener("click", () => setGroupFormVisible(false));
    $("#createInvite")?.addEventListener("click", createInvite);
    $("#acceptInvite")?.addEventListener("click", acceptInvite);
    $("#createRecoveryBackup")?.addEventListener("click", () => createRecoveryBackup(state.device?.id));
    $("#restoreRecoveryBackup")?.addEventListener("click", restoreRecoveryBackup);
    $("#restoreRecoveryBackupSetup")?.addEventListener("click", restoreRecoveryBackup);
    $("#refreshChat")?.addEventListener("click", () => refreshData().catch((error) => setStatus(formatActionError(error), true)));
    $("#messageForm")?.addEventListener("submit", sendMessage);
    $("#imageInput")?.addEventListener("change", (event) => sendImage(event.target.files?.[0]).catch((error) => setStatus(t("chatAttachmentFailed", "Image upload failed: {message}", { message: formatActionError(error) }), true)));
    $("#emojiButton")?.addEventListener("click", () => { $("#emojiTray").hidden = !$("#emojiTray").hidden; });
    $("#emojiTray")?.addEventListener("click", (event) => {
      if (event.target.tagName !== "BUTTON") return;
      $("#messageInput").value += event.target.textContent;
      $("#messageInput").focus();
    });
    $("#retentionSelect")?.addEventListener("change", async (event) => {
      if (!state.activeConversation) return;
      try {
        await window.ALevelApi.updateChatConversationSettings(state.activeConversation.id, Number(event.target.value));
        state.activeConversation.retentionSeconds = Number(event.target.value);
      } catch (error) {
        setStatus(error.message, true);
      }
    });
  }

  async function initialize() {
    const invite = pendingInviteToken();
    if (!currentToken()) {
      if (invite) sessionStorage.setItem(PENDING_INVITE_KEY, invite);
      const next = `chat.html${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
      location.href = `login.html?next=${encodeURIComponent(next)}`;
      return;
    }
    try {
      wireEvents();
      if (invite) $("#inviteToken").value = invite;
      state.profile = await window.ALevelApi.getChatProfile();
      await ensureDevice();
      const existing = savedDevice();
      if (!existing) {
        await updateRecoveryAvailability();
        return;
      }
      $("#chatApp").hidden = false;
      await refreshData();
      if (invite) $("#inviteToken").value = invite;
    } catch (error) {
      if (error?.code === "CHAT_NOT_ENABLED" || error?.status === 503) {
        $("#chatSetupPanel").hidden = true;
        $("#chatDisabledPanel").hidden = false;
      } else {
        setStatus(formatActionError(error), true);
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
  window.addEventListener("beforeunload", () => {
    stopPolling();
    state.socket?.close();
  });
})();
