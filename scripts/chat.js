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
    devices: [],
    socket: null,
  };
  const $ = (selector) => document.querySelector(selector);
  const status = $("#chatStatus");

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", isError);
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

  async function storeLocalPlaintext(clientMessageId, plaintext) {
    state.localPlaintexts[clientMessageId] = plaintext;
    await cryptoCall("storeSentPlaintext", { clientMessageId, plaintext });
  }

  function createCryptoWorker() {
    if (state.cryptoWorker) return state.cryptoWorker;
    const worker = new Worker("../assets/vendor/chat-crypto-worker.js", { name: "expassway-chat-crypto" });
    worker.onmessage = (event) => {
      const { id, ok, result, error } = event.data || {};
      const pending = state.pendingCrypto.get(id);
      if (!pending) return;
      state.pendingCrypto.delete(id);
      if (ok) pending.resolve(result);
      else pending.reject(new Error(error || "Chat crypto operation failed."));
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
      item.innerHTML = `<code>${invite.id}</code><span>${new Date(invite.expiresAt).toLocaleDateString()}</span>`;
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
      button.querySelector("strong").textContent = conversation.peer?.alias || t("chatNoConversation", "Conversation");
      button.querySelector("small").textContent = conversation.peer?.identityFingerprint
        ? conversation.peer.identityFingerprint.slice(0, 12)
        : "";
      button.addEventListener("click", () => selectConversation(conversation));
      host.appendChild(button);
    });
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
      item.innerHTML = `<span></span><div class="chat-device-item__actions"><button type="button" class="btn-secondary chat-device-approve"></button><button type="button" class="btn-secondary chat-device-revoke"></button></div>`;
      item.querySelector("span").textContent = device.label || `Device ${device.deviceNumber || ""}`;
      const approve = item.querySelector(".chat-device-approve");
      const revoke = item.querySelector(".chat-device-revoke");
      approve.textContent = t("chatApproveDevice", "Create device approval token");
      revoke.textContent = t("chatRevokeDevice", "Revoke device");
      approve.hidden = device.id !== state.device?.id || Boolean(device.revokedAt);
      revoke.hidden = device.id === state.device?.id || Boolean(device.revokedAt);
      approve.addEventListener("click", () => createDeviceApproval(device.id));
      revoke.addEventListener("click", () => revokeDevice(device.id));
      host.appendChild(item);
    });
  }

  async function createDeviceApproval(deviceId) {
    try {
      const result = await window.ALevelApi.createChatDeviceApproval(deviceId);
      await navigator.clipboard?.writeText(result.token);
      setStatus(t("chatApprovalCopied", "Approval token copied. It is single-use and valid for 5 minutes."));
    } catch (error) {
      setStatus(t("chatApprovalFailed", "Could not create approval token: {message}", { message: error.message }), true);
    }
  }

  async function revokeDevice(deviceId) {
    try {
      await window.ALevelApi.revokeChatDevice(deviceId);
      state.devices = state.devices.filter((device) => device.id !== deviceId);
      renderDevices();
      setStatus("");
    } catch (error) {
      setStatus(error.message, true);
    }
  }

  function renderMessages() {
    const host = $("#messageList");
    if (!host) return;
    host.replaceChildren();
    state.messages.forEach((message) => {
      const item = document.createElement("article");
      item.className = `chat-message${message.senderDeviceId === state.device?.id ? " is-mine" : ""}`;
      const text = message.deleted ? "[deleted]" : message.plaintext || t("chatDecryptFailed", "Could not decrypt this message.");
      item.innerHTML = `<p></p><div class="chat-message__attachment" hidden></div><time></time>`;
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
      setStatus(t("chatAttachmentFailed", "Image upload failed: {message}", { message: error.message }), true);
    }
  }

  async function decryptMessages(messages) {
    const result = [];
    for (const message of messages) {
      if (message.deleted) {
        result.push({ ...message, deleted: true });
        continue;
      }
      if (message.senderDeviceId === state.device.id) {
        const localPlaintext = state.localPlaintexts[message.clientMessageId]
          || await cryptoCall("getSentPlaintext", { clientMessageId: message.clientMessageId });
        if (localPlaintext) {
          result.push({ ...message, plaintext: localPlaintext });
          continue;
        }
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
      } catch (_error) {
        result.push({ ...message, plaintext: null });
      }
    }
    return result;
  }

  async function syncConversation() {
    if (!state.activeConversation || !state.device) return;
    const payload = await window.ALevelApi.syncChatMessages(state.activeConversation.id, state.cursor);
    const fresh = await decryptMessages(payload.messages || []);
    const known = new Set(state.messages.map((message) => message.id));
    state.messages = [...state.messages, ...fresh.filter((message) => !known.has(message.id))];
    state.cursor = payload.nextCursor || state.cursor;
    renderMessages();
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
    state.activeConversation = conversation;
    state.messages = [];
    state.cursor = "";
    $("#conversationEmpty").hidden = true;
    $("#conversationActive").hidden = false;
    $("#conversationTitle").textContent = conversation.peer?.alias || "Conversation";
    $("#conversationSafety").textContent = conversation.peer?.identityFingerprint || "";
    $("#retentionSelect").value = String(conversation.retentionSeconds);
    renderContacts();
    try {
      await syncConversation();
      await openRealtime();
    } catch (error) {
      setStatus(error.message, true);
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
      setStatus(t("chatSetupFailed", "Device setup failed: {message}", { message: error.message }), true);
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
    state.devices = await window.ALevelApi.listChatDevices();
    renderInvites(invites);
    renderContacts();
    renderDevices();
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
    const token = extractInviteToken($("#inviteToken").value);
    if (!token) return;
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
        ? `${error.message} (${error.code})`
        : error.message;
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
      const contactId = state.activeConversation.peer?.contactId;
      const bundle = contactId
        ? (state.peerBundles.get(contactId) || await window.ALevelApi.getChatContactBundle(contactId))
        : null;
      const ownBundle = state.ownBundle || await window.ALevelApi.getChatOwnDeviceBundle(state.device.id);
      state.ownBundle = ownBundle;
      const peers = [...(bundle?.devices || []), ...(ownBundle?.devices || [])];
      if (!peers.length) throw new Error("The contact has no active device.");
      if (contactId && !state.peerBundles.has(contactId)) state.peerBundles.set(contactId, bundle);
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
      await storeLocalPlaintext(clientMessageId, plaintext);
      input.value = "";
      await syncConversation();
      setStatus("");
    } catch (error) {
      setStatus(t("chatMessageFailed", "Message failed: {message}", { message: error.message }), true);
    } finally {
      button.disabled = false;
    }
  }

  async function sendImage(file) {
    if (!file || !state.activeConversation || !state.device) return;
    if (file.size > 10 * 1024 * 1024) throw new Error("Encrypted images must be 10 MB or smaller.");
    setStatus(t("chatSending", "Encrypting and sending..."));
    const encryptedFile = await cryptoCall("encryptAttachment", { bytes: await file.arrayBuffer() });
    const reservation = await window.ALevelApi.initChatAttachment({
      conversationId: state.activeConversation.id,
      sizeBytes: encryptedFile.bytes.byteLength,
    });
    await window.ALevelApi.uploadChatAttachment(reservation.attachmentId, encryptedFile.bytes);
    await window.ALevelApi.completeChatAttachment(reservation.attachmentId);
    const contactId = state.activeConversation.peer?.contactId;
    const bundle = contactId
      ? (state.peerBundles.get(contactId) || await window.ALevelApi.getChatContactBundle(contactId))
      : null;
    const ownBundle = state.ownBundle || await window.ALevelApi.getChatOwnDeviceBundle(state.device.id);
    state.ownBundle = ownBundle;
    const peers = [...(bundle?.devices || []), ...(ownBundle?.devices || [])];
    if (!peers.length) throw new Error("The contact has no active device.");
    if (contactId && !state.peerBundles.has(contactId)) state.peerBundles.set(contactId, bundle);
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
    await storeLocalPlaintext(clientMessageId, metadata);
    $("#imageInput").value = "";
    await syncConversation();
    setStatus("");
  }

  function wireEvents() {
    $("#generateDeviceKeys")?.addEventListener("click", setupDevice);
    $("#createInvite")?.addEventListener("click", createInvite);
    $("#acceptInvite")?.addEventListener("click", acceptInvite);
    $("#refreshChat")?.addEventListener("click", () => refreshData().catch((error) => setStatus(error.message, true)));
    $("#messageForm")?.addEventListener("submit", sendMessage);
    $("#imageInput")?.addEventListener("change", (event) => sendImage(event.target.files?.[0]).catch((error) => setStatus(t("chatAttachmentFailed", "Image upload failed: {message}", { message: error.message }), true)));
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
      if (!existing) return;
      $("#chatApp").hidden = false;
      await refreshData();
      if (invite) $("#inviteToken").value = invite;
    } catch (error) {
      if (error?.code === "CHAT_NOT_ENABLED" || error?.status === 503) {
        $("#chatSetupPanel").hidden = true;
        $("#chatDisabledPanel").hidden = false;
      } else {
        setStatus(error.message, true);
      }
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
