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
    accountV2: null,
    accountEpochs: new Map(),
    accountMode: false,
    accountPasskeyReady: false,
    accountContactStatus: new Map(),
  };
  const $ = (selector) => document.querySelector(selector);
  const status = $("#chatStatus");

  function setStatus(message, isError = false) {
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("is-error", isError);
  }

  function formatActionError(error) {
    const message = error?.message || (typeof error === "string" ? error : "");
    const details = [];
    if (error?.code && error.code !== "HTTP_ERROR") details.push(error.code);
    if (error?.status) details.push(`HTTP ${error.status}`);
    return `${message || (details.length ? "The operation failed." : "No error details were returned.")}${details.length ? ` (${details.join(", ")})` : ""}`;
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
    const worker = new Worker("../assets/vendor/chat-crypto-worker.js?v=20260926-2", { name: "expassway-chat-crypto" });
    worker.onerror = (event) => {
      const detail = String(event?.message || "").trim();
      for (const pending of state.pendingCrypto.values()) {
        const error = new Error(detail || `The chat encryption worker stopped during ${pending.action}.`);
        error.code = "CRYPTO_WORKER_UNAVAILABLE";
        error.action = pending.action;
        pending.reject(error);
      }
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
        const failure = new Error(error || `Chat crypto operation failed during ${pending.action}.`);
        failure.code = code || "CRYPTO_ERROR";
        failure.action = pending.action;
        pending.reject(failure);
      }
    };
    state.cryptoWorker = worker;
    return worker;
  }

  function cryptoCall(action, payload) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      state.pendingCrypto.set(id, { resolve, reject, action });
      try {
        createCryptoWorker().postMessage({ id, action, payload });
      } catch (error) {
        state.pendingCrypto.delete(id);
        const failure = new Error(error?.message || `Could not start chat crypto operation ${action}.`);
        failure.code = error?.code || "CRYPTO_WORKER_UNAVAILABLE";
        failure.action = action;
        reject(failure);
      }
    });
  }

  function base64UrlToBytes(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  function bytesToBase64Url(value) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function publicKeyOptions(raw) {
    const source = raw?.publicKey || raw || {};
    const options = { ...source };
    options.challenge = base64UrlToBytes(source.challenge);
    if (source.user?.id) options.user = { ...source.user, id: base64UrlToBytes(source.user.id) };
    for (const field of ["allowCredentials", "excludeCredentials"]) {
      if (Array.isArray(source[field])) options[field] = source[field].map((credential) => ({
        ...credential,
        id: base64UrlToBytes(credential.id),
      }));
    }
    if (source.extensions?.prf?.eval?.first) {
      options.extensions = { ...source.extensions, prf: { ...source.extensions.prf, eval: {
        ...source.extensions.prf.eval,
        first: base64UrlToBytes(source.extensions.prf.eval.first),
      } } };
    }
    return options;
  }

  function serialiseCredential(credential) {
    const response = credential.response;
    const extensionResults = credential.getClientExtensionResults?.() || {};
    const prf = extensionResults.prf ? { enabled: Boolean(extensionResults.prf.enabled || extensionResults.prf.results?.first) } : undefined;
    const output = {
      id: credential.id,
      rawId: bytesToBase64Url(credential.rawId),
      type: credential.type,
      response: {
        clientDataJSON: bytesToBase64Url(response.clientDataJSON),
      },
      clientExtensionResults: prf ? { prf } : {},
    };
    if (response.attestationObject) {
      output.response.attestationObject = bytesToBase64Url(response.attestationObject);
      output.response.transports = response.getTransports?.() || [];
    }
    if (response.authenticatorData) {
      output.response.authenticatorData = bytesToBase64Url(response.authenticatorData);
      output.response.signature = bytesToBase64Url(response.signature);
      if (response.userHandle) output.response.userHandle = bytesToBase64Url(response.userHandle);
    }
    return output;
  }

  function passkeyPrfOutput(credential) {
    const result = credential.getClientExtensionResults?.()?.prf?.results?.first;
    if (!result) {
      const error = new Error("This Passkey cannot produce the required PRF output. Choose a Passkey with PRF support.");
      error.code = "PASSKEY_PRF_UNAVAILABLE";
      throw error;
    }
    return bytesToBase64Url(result);
  }

  function supportsAccountPasskey() {
    return Boolean(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
  }

  function isExistingPasskeyError(error) {
    const name = String(error?.name || "");
    const message = String(error?.message || error || "");
    return name === "InvalidStateError" || /not,? or is no longer,? usable/i.test(message);
  }

  function passkeyActionError(error, code, action) {
    if (error?.code) return error;
    const detail = String(error?.message || error || "");
    const wrapped = new Error(detail ? `${action}: ${detail}` : action);
    wrapped.name = error?.name || "Error";
    wrapped.code = code;
    wrapped.cause = error;
    return wrapped;
  }

  async function accountPasskeyAssertion() {
    const response = await window.ALevelApi.getChatPasskeyAuthenticationOptions();
    const publicKey = publicKeyOptions(response);
    let credential;
    try {
      credential = await navigator.credentials.get({ publicKey });
    } catch (error) {
      throw passkeyActionError(error, "PASSKEY_ASSERTION_FAILED", "Could not use the secure chat Passkey");
    }
    if (!credential) {
      const error = new Error("The Passkey prompt returned no credential.");
      error.code = "PASSKEY_ASSERTION_FAILED";
      throw error;
    }
    const prfOutput = passkeyPrfOutput(credential);
    const verified = await window.ALevelApi.verifyChatPasskey("authenticate", {
      challenge: response.publicKey?.challenge || response.challenge,
      credential: serialiseCredential(credential),
    });
    return { prfOutput, proof: verified?.proof || verified?.writeProof || "" };
  }

  async function unlockAccountSync() {
    const vault = await window.ALevelApi.getChatAccountVault();
    if (!vault) return setupAccountSync();
    setStatus("Unlocking secure chat with your Passkey...");
    const assertion = await accountPasskeyAssertion();
    const unlocked = await cryptoCall("unlockAccountV2Vault", {
      userId: state.profile.id,
      keyVersion: vault.keyVersion,
      nonce: vault.nonce,
      ciphertext: vault.ciphertext,
      prfOutput: assertion.prfOutput,
    });
    state.accountV2 = { ...unlocked, proof: assertion.proof };
    $("#chatSetupPanel").hidden = true;
    $("#chatApp").hidden = false;
    setStatus("");
    await refreshData();
  }

  async function ensureAccountState() {
    let bundle;
    try { bundle = await window.ALevelApi.getChatAccountKeyBundle(); }
    catch (error) {
      if (error?.status === 503 || error?.code === "CHAT_ACCOUNT_V2_DISABLED") return false;
      throw error;
    }
    state.accountMode = true;
    state.accountPasskeyReady = Boolean(bundle?.passkeyReady);
    $("#legacyDevicePanel").hidden = true;
    if (!supportsAccountPasskey()) {
      $("#chatSetupPanel").hidden = true;
      $("#chatUnsupportedPanel").hidden = false;
      return true;
    }
    const vault = bundle?.enabled ? await window.ALevelApi.getChatAccountVault() : null;
    $("#chatSetupPanel").hidden = false;
    $("#enableAccountSync").hidden = Boolean(vault);
    $("#unlockAccountSync").hidden = !vault;
    if (!vault) $("#chatApp").hidden = true;
    return true;
  }

  async function setupAccountSync() {
    if (!supportsAccountPasskey()) {
      $("#chatSetupPanel").hidden = true;
      $("#chatUnsupportedPanel").hidden = false;
      return;
    }
    const enable = $("#enableAccountSync");
    if (enable) enable.disabled = true;
    setStatus(state.accountPasskeyReady
      ? "Unlocking the existing Passkey to finish secure chat setup..."
      : "Creating a Passkey for secure chat...");
    try {
      if (!state.accountPasskeyReady) {
        const registration = await window.ALevelApi.getChatPasskeyRegistrationOptions();
        let credential = null;
        try {
          credential = await navigator.credentials.create({ publicKey: publicKeyOptions(registration) });
        } catch (error) {
          if (!isExistingPasskeyError(error)) {
            throw passkeyActionError(error, "PASSKEY_REGISTRATION_FAILED", "Could not create the secure chat Passkey");
          }
          state.accountPasskeyReady = true;
          setStatus("This device already has a secure chat Passkey. Unlocking it to finish setup...");
        }
        if (credential) {
          const registrationChallenge = registration.publicKey?.challenge || registration.challenge;
          if (!registrationChallenge) throw new Error("The Passkey registration challenge was missing. Refresh and try again.");
          await window.ALevelApi.verifyChatPasskey("register", {
            challenge: registrationChallenge,
            credential: serialiseCredential(credential),
          });
          state.accountPasskeyReady = true;
        }
      } else {
        setStatus("This device already has a secure chat Passkey. Unlocking it to finish setup...");
      }
      const assertion = await accountPasskeyAssertion();
      const generated = await cryptoCall("generateAccountV2Vault", {
        userId: state.profile.id,
        prfOutput: assertion.prfOutput,
      });
      const writeInput = { proof: assertion.proof };
      await window.ALevelApi.initializeChatAccount({
        ...writeInput,
        keyVersion: generated.keyVersion,
        encryptionPublicKey: generated.encryptionPublicKey,
        signingPublicKey: generated.signingPublicKey,
        fingerprint: generated.fingerprint,
        kdfVersion: generated.kdfVersion,
        nonce: generated.nonce,
        ciphertext: generated.ciphertext,
      });
      state.accountV2 = { ...generated, unlocked: true, proof: assertion.proof };
      $("#chatSetupPanel").hidden = true;
      $("#chatApp").hidden = false;
      setStatus("Secure chat is ready.");
      await refreshData();
    } catch (error) {
      setStatus(formatActionError(error), true);
      if (enable) enable.disabled = false;
    }
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
      item.innerHTML = `<div><strong></strong><small></small></div><span></span>`;
      item.querySelector("strong").textContent = t("chatInviteActive", "Active invite");
      item.querySelector("small").textContent = t("chatInviteShareHint", "Share the invite link shown above; it works once.");
      item.querySelector("span").textContent = new Date(invite.expiresAt).toLocaleDateString();
      host.appendChild(item);
    });
  }

  function renderContacts() {
    const host = $("#conversationList");
    if (!host) return;
    host.replaceChildren();
    if (!state.conversations.length && !state.accountMode) {
      const empty = document.createElement("p");
      empty.className = "chat-muted";
      empty.textContent = t("chatNoContacts", "No friends yet.");
      host.appendChild(empty);
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
        button.querySelector("small").textContent = state.accountMode
          ? "End-to-end encrypted"
          : "Encrypted chat";
      }
      button.addEventListener("click", () => selectConversation(conversation));
      host.appendChild(button);
    });
    if (state.accountMode) {
      const existingPeers = new Set(state.conversations.flatMap((conversation) => conversation.kind === "direct" && conversation.peer?.contactId ? [conversation.peer.contactId] : []));
      const available = state.contacts.filter((contact) => !existingPeers.has(contact.id));
      if (available.length) {
        const heading = document.createElement("p");
        heading.className = "chat-muted";
        heading.textContent = "Start a secure chat";
        host.appendChild(heading);
        available.forEach((contact) => {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "chat-conversation-item";
          button.textContent = contact.profile?.alias || "Paired contact";
          button.addEventListener("click", async () => {
            try {
              setStatus("Creating secure conversation...");
              const conversation = await createAccountConversation("direct", [contact.id]);
              state.conversations = [conversation, ...state.conversations];
              renderContacts();
              await selectConversation(conversation);
              setStatus("");
            } catch (error) { setStatus(formatActionError(error), true); }
          });
          host.appendChild(button);
        });
      }
    }
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
      const accountStatus = state.accountContactStatus.get(contact.id);
      checkbox.disabled = state.accountMode && accountStatus !== true;
      const text = document.createElement("span");
      text.textContent = contact.profile?.alias || t("chatNoConversation", "Conversation");
      label.append(checkbox, text);
      if (state.accountMode && accountStatus !== true) {
        const unavailable = document.createElement("small");
        unavailable.textContent = accountStatus === false
          ? t("chatContactSecureRequired", "Needs secure chat enabled")
          : t("chatContactSecureChecking", "Checking secure chat...");
        label.appendChild(unavailable);
      }
      host.appendChild(label);
      if (state.accountMode && !state.accountContactStatus.has(contact.id)) {
        state.accountContactStatus.set(contact.id, null);
        window.ALevelApi.getChatContactAccountBundle(contact.id)
          .then((bundle) => {
            state.accountContactStatus.set(contact.id, Boolean(bundle?.enabled && bundle?.accountKey));
            renderGroupContactPicker();
          })
          .catch(() => {
            state.accountContactStatus.set(contact.id, false);
            renderGroupContactPicker();
          });
      }
    });
  }

  function renderGroupManagement(conversation) {
    const host = $("#groupMemberList");
    if (!host) return;
    host.replaceChildren();
    for (const member of conversation.group?.members || []) {
      const row = document.createElement("div");
      row.className = "chat-device-item";
      const details = document.createElement("div");
      details.className = "chat-device-item__details";
      const name = document.createElement("strong");
      name.textContent = member.isSelf ? "You" : (member.alias || "Paired contact");
      const role = document.createElement("small");
      role.textContent = member.role || "member";
      details.append(name, role);
      row.appendChild(details);
      host.appendChild(row);
    }
    const self = conversation.group?.members?.find((member) => member.isSelf);
    const actions = $("#groupMemberActions");
    if (actions) {
      actions.hidden = false;
      $("#dissolveGroup").hidden = self?.role !== "owner";
      $("#inviteGroupMember").hidden = !["owner", "admin"].includes(self?.role);
      $("#groupInviteContact").replaceChildren(...state.contacts.map((contact) => {
        const option = document.createElement("option");
        option.value = contact.id;
        option.textContent = contact.profile?.alias || "Paired contact";
        return option;
      }));
    }
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
      item.className = `chat-message${message.senderUserId === state.profile?.id || message.senderDeviceId === state.device?.id ? " is-mine" : ""}`;
      const decryptCode = message.decryptCode ? ` (${message.decryptCode})` : "";
      const text = message.deleted
        ? "[deleted]"
        : message.plaintext || `${t("chatDecryptFailed", "Could not decrypt this message.")}${decryptCode}`;
      item.innerHTML = `<small class="chat-message__sender" hidden></small><p></p><div class="chat-message__attachment" hidden></div><time></time>`;
      if (state.activeConversation?.kind === "group" && message.senderAlias) {
        const sender = item.querySelector(".chat-message__sender");
        sender.hidden = false;
        sender.textContent = message.senderUserId === state.profile?.id || message.senderDeviceId === state.device?.id
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

  async function getAccountRecipients(conversation) {
    const bundle = await window.ALevelApi.getChatConversationAccountBundle(conversation.id);
    const recipients = (bundle?.members || []).filter((member) => member.accountKey?.status === "active" || member.accountKey);
    if (!recipients.length) {
      const error = new Error("Every member must enable secure chat before this conversation can use account encryption.");
      error.code = "ACCOUNT_KEYS_REQUIRED";
      throw error;
    }
    return recipients.map((member) => ({
      userId: member.userId,
      keyVersion: member.accountKey.keyVersion,
      encryptionPublicKey: member.accountKey.encryptionPublicKey,
    }));
  }

  async function signAccountControl(conversationId, expectedEpoch, action, payload) {
    return cryptoCall("signAccountV2Control", { conversationId, expectedEpoch, action, payload });
  }

  async function createAccountConversation(kind, contactIds) {
    const conversationId = crypto.randomUUID();
    const userIds = [state.profile.id];
    const recipients = [];
    for (const contactId of contactIds) {
      const bundle = await window.ALevelApi.getChatContactAccountBundle(contactId);
      if (!bundle?.enabled || !bundle?.accountKey) {
        const error = new Error("Every selected contact must enable secure chat first.");
        error.code = "ACCOUNT_NOT_ENABLED";
        throw error;
      }
      recipients.push({ userId: bundle.accountKey.userId, keyVersion: bundle.accountKey.keyVersion, encryptionPublicKey: bundle.accountKey.encryptionPublicKey });
      userIds.push(bundle.accountKey.userId);
    }
    const self = state.accountV2;
    recipients.push({ userId: state.profile.id, keyVersion: self.keyVersion, encryptionPublicKey: self.encryptionPublicKey });
    const epoch = await cryptoCall("createAccountV2Epoch", { conversationId, epoch: 1, recipients });
    const payload = { kind, contactIds, recipients: epoch.recipients };
    if (kind === "group") {
      payload.metadata = await cryptoCall("encryptAccountV2Metadata", {
        conversationId,
        epoch: 1,
        version: "1",
        plaintext: { name: "Encrypted group", avatarRef: null },
      });
      payload.metadata.version = 1;
    }
    const signed = await signAccountControl(conversationId, 0, "create", payload);
    return window.ALevelApi.createAccountChatConversation({ ...signed, version: "account-v2", conversationId });
  }

  async function rotateGroupWithMembers(conversation, action, contactIds = []) {
    const expectedEpoch = await currentAccountEpoch(conversation);
    const recipients = await getAccountRecipients(conversation);
    for (const contactId of contactIds) {
      const bundle = await window.ALevelApi.getChatContactAccountBundle(contactId);
      if (!bundle?.accountKey) throw new Error("The selected contact must enable secure chat first.");
      recipients.push({ userId: bundle.accountKey.userId, keyVersion: bundle.accountKey.keyVersion, encryptionPublicKey: bundle.accountKey.encryptionPublicKey });
    }
    const unique = [...new Map(recipients.map((recipient) => [recipient.userId, recipient])).values()];
    const nextEpoch = expectedEpoch + 1;
    const epoch = await cryptoCall("createAccountV2Epoch", { conversationId: conversation.id, epoch: nextEpoch, recipients: unique });
    const metadataVersion = String(Number(conversation.metadata?.version || 1) + 1);
    const metadata = await cryptoCall("encryptAccountV2Metadata", {
      conversationId: conversation.id,
      epoch: nextEpoch,
      version: metadataVersion,
      plaintext: { name: "Encrypted group", avatarRef: null },
    });
    metadata.version = Number(metadataVersion);
    const signed = await signAccountControl(conversation.id, expectedEpoch, action, {
      ...(contactIds.length ? { contactIds } : {}),
      recipients: epoch.recipients,
      metadata,
    });
    return window.ALevelApi.updateChatGroupMembers(conversation.id, signed);
  }

  async function openAccountEpochs(conversation) {
    if (!state.accountMode || !state.accountV2?.unlocked) return [];
    const payload = await window.ALevelApi.getChatConversationEpochs(conversation.id);
    const epochs = Array.isArray(payload?.epochs) ? payload.epochs : Array.isArray(payload) ? payload : [];
    for (const item of epochs) {
      await cryptoCall("openAccountV2Envelope", {
        conversationId: conversation.id,
        epoch: item.epoch,
        envelope: item.envelope,
      });
    }
    state.accountEpochs.set(conversation.id, epochs);
    return epochs;
  }

  async function currentAccountEpoch(conversation) {
    const epochs = await openAccountEpochs(conversation);
    const current = [...epochs].sort((left, right) => Number(right.epoch) - Number(left.epoch))[0];
    if (!current) {
      const recipients = await getAccountRecipients(conversation);
      const created = await cryptoCall("createAccountV2Epoch", { conversationId: conversation.id, epoch: 1, recipients });
      await window.ALevelApi.createChatConversationEpoch(conversation.id, created);
      state.accountEpochs.set(conversation.id, [{ epoch: 1, envelope: created.recipients.find((item) => item.userId === state.profile.id) }]);
      return 1;
    }
    return Number(current.epoch);
  }

  async function sendAccountV2Payload(conversation, plaintext, attachmentRefs = []) {
    const epoch = await currentAccountEpoch(conversation);
    const clientMessageId = crypto.randomUUID();
    const encrypted = await cryptoCall("encryptAccountV2Message", {
      conversationId: conversation.id,
      clientMessageId,
      epoch,
      plaintext,
      attachmentRefs,
    });
    await window.ALevelApi.sendAccountV2Message({
      conversationId: conversation.id,
      clientMessageId,
      contentEpoch: encrypted.epoch,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
      senderKeyId: encrypted.senderKeyId,
      signature: encrypted.signature,
      attachmentRefs: encrypted.attachmentRefs,
      sizeBucket: "small",
    });
    return clientMessageId;
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

  function canRecoverSession(error) {
    return ["SESSION_MISSING", "DUPLICATE_OR_REPLAY", "MESSAGE_GAP_TOO_LARGE", "DECRYPT_FAILED"]
      .includes(error?.code);
  }

  async function refreshRecipient(device, conversation) {
    const isOwnDevice = state.ownBundle?.devices?.some((item) => item.deviceId === device.deviceId)
      || device.deviceId === state.device?.id;
    if (isOwnDevice) {
      state.ownBundle = null;
      const ownBundle = await window.ALevelApi.getChatOwnDeviceBundle(state.device.id);
      state.ownBundle = ownBundle;
      return (ownBundle?.devices || []).find((item) => item.deviceId === device.deviceId) || device;
    }
    if (conversation.kind === "group") {
      state.conversationBundles.delete(conversation.id);
    } else if (conversation.peer?.contactId) {
      state.peerBundles.delete(conversation.peer.contactId);
    }
    const fresh = await getPeerDevices(conversation);
    return fresh.find((item) => item.deviceId === device.deviceId) || device;
  }

  async function encryptForRecipient(conversation, device, plaintext) {
    let current = device;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await cryptoCall("processPreKeyBundle", {
          deviceId: state.device.id,
          peerDeviceId: current.deviceId,
          peerDeviceNumber: current.deviceNumber,
          bundle: current,
        });
        return await cryptoCall("encryptMessage", {
          deviceId: state.device.id,
          peerDeviceId: current.deviceId,
          peerDeviceNumber: current.deviceNumber,
          plaintext,
        });
      } catch (error) {
        if (attempt || !canRecoverSession(error)) throw error;
        // A stale local session can survive a device replacement. Rebuild only this
        // device pair, then retry with a freshly fetched public bundle.
        await cryptoCall("resetSession", {
          deviceId: state.device.id,
          peerDeviceId: current.deviceId,
          peerDeviceNumber: current.deviceNumber,
        });
        current = await refreshRecipient(current, conversation);
      }
    }
    throw new Error("The encrypted message could not be processed.");
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
      if (message.protocolVersion === "account-v2") {
        try {
          const decrypted = await cryptoCall("decryptAccountV2Message", {
            message: {
              conversationId: message.conversationId,
              clientMessageId: message.clientMessageId,
              epoch: message.contentEpoch,
              senderUserId: message.senderUserId,
              senderKeyId: message.senderKeyId || message.contentKeyVersion || "1",
              nonce: message.nonce,
              ciphertext: message.ciphertext,
              attachmentRefs: message.attachmentRefs || [],
              signature: message.signature,
            },
            signingPublicKey: message.senderSigningPublicKey,
          });
          result.push({ ...message, plaintext: decrypted.plaintext });
        } catch (error) {
          result.push({ ...message, plaintext: null, decryptCode: error?.code || "DECRYPT_FAILED" });
        }
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
    if (!state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    if (state.syncInFlight) return state.syncInFlight;
    const generation = state.syncGeneration;
    state.syncInFlight = (async () => {
      const conversationId = state.activeConversation.id;
      if (state.accountMode) {
        const payload = await window.ALevelApi.syncChatEvents(conversationId, state.cursor);
        if (state.syncGeneration !== generation || state.activeConversation?.id !== conversationId) return;
        const events = Array.isArray(payload?.events) ? payload.events : [];
        const incoming = events
          .filter((event) => event.type === "message" && event.message)
          .map((event) => event.message);
        if (incoming.length) {
          const fresh = await decryptMessages(incoming);
          const known = new Map(state.messages.map((message) => [message.id, message]));
          fresh.forEach((message) => known.set(message.id, message));
          state.messages = [...known.values()].sort((left, right) => String(left.createdAt || "").localeCompare(String(right.createdAt || "")));
        }
        for (const event of events.filter((item) => item.type === "deleted" && item.messageId)) {
          const existing = state.messages.find((message) => message.id === event.messageId);
          if (existing) Object.assign(existing, { deleted: true, plaintext: null, ciphertext: "" });
        }
        state.cursor = payload?.nextCursor == null ? state.cursor : String(payload.nextCursor);
        renderMessages();
        return;
      }
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
    if (!state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    if (state.accountMode) return;
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
    if (state.accountMode) {
      await openAccountEpochs(conversation);
      $("#conversationSafety").textContent = "Secure account chat";
    } else {
      await renderSafetyNumber(conversation);
    }
    $("#retentionSelect").value = String(conversation.retentionSeconds);
    $("#groupManageButton").hidden = conversation.kind !== "group";
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
      host.textContent = t("chatSecurityStatusUnavailable", "Secure identity status unavailable.");
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
    state.accountContactStatus.clear();
    if (!state.accountMode) {
      state.devices = await window.ALevelApi.listChatDevices();
      await ensurePrekeys();
      await updateRecoveryAvailability();
    }
    renderInvites(invites);
    renderContacts();
    if (!state.accountMode) renderDevices();
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
      const conversation = state.accountMode
        ? await createAccountConversation("group", selected)
        : await window.ALevelApi.createChatGroup(selected);
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
    if (!state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    const input = $("#messageInput");
    const plaintext = input.value.trim();
    if (!plaintext) return;
    const button = $("#sendMessage");
    button.disabled = true;
    setStatus(t("chatSending", "Encrypting and sending..."));
    try {
      if (state.accountMode) {
        await sendAccountV2Payload(state.activeConversation, plaintext);
        input.value = "";
        await syncConversation();
        setStatus("");
        return;
      }
      await assertSafetyStable(state.activeConversation);
      const peers = await getEncryptionRecipients(state.activeConversation);
      if (!peers.length) throw new Error("The contact has no active device.");
      const recipients = {};
      for (const peer of peers) {
        recipients[peer.deviceId] = await encryptForRecipient(state.activeConversation, peer, plaintext);
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
    if (!file || !state.activeConversation || (!state.device && !state.accountV2?.unlocked)) return;
    if (file.size > 10 * 1024 * 1024) throw new Error("Encrypted images must be 10 MB or smaller.");
    setStatus(t("chatSending", "Encrypting and sending..."));
    if (!state.accountMode) await assertSafetyStable(state.activeConversation);
    const encryptedFile = await cryptoCall("encryptAttachment", { bytes: await file.arrayBuffer() });
    const reservation = await window.ALevelApi.initChatAttachment({
      conversationId: state.activeConversation.id,
      sizeBytes: encryptedFile.bytes.byteLength,
    });
    await window.ALevelApi.uploadChatAttachment(reservation.attachmentId, encryptedFile.bytes);
    await window.ALevelApi.completeChatAttachment(reservation.attachmentId);
    if (state.accountMode) {
      const metadata = JSON.stringify({
        kind: "image",
        attachmentId: reservation.attachmentId,
        key: encryptedFile.key,
        nonce: encryptedFile.nonce,
        name: file.name,
        mime: file.type || "image/*",
      });
      await sendAccountV2Payload(state.activeConversation, metadata, [reservation.attachmentId]);
      $("#imageInput").value = "";
      await syncConversation();
      setStatus("");
      return;
    }
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
      recipients[peer.deviceId] = await encryptForRecipient(state.activeConversation, peer, metadata);
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
    $("#enableAccountSync")?.addEventListener("click", setupAccountSync);
    $("#unlockAccountSync")?.addEventListener("click", unlockAccountSync);
    $("#groupManageButton")?.addEventListener("click", () => {
      const panel = $("#groupManagePanel");
      if (!state.activeConversation || state.activeConversation.kind !== "group" || !panel) return;
      panel.hidden = false;
      renderGroupManagement(state.activeConversation);
    });
    $("#closeGroupManage")?.addEventListener("click", () => { $("#groupManagePanel").hidden = true; });
    $("#leaveGroup")?.addEventListener("click", async () => {
      if (!state.activeConversation || !window.confirm("Leave this group? A remaining owner or administrator must rotate the encryption epoch.")) return;
      try {
        const expectedEpoch = await currentAccountEpoch(state.activeConversation);
        const signed = await signAccountControl(state.activeConversation.id, expectedEpoch, "leave", {});
        await window.ALevelApi.leaveChatGroup(state.activeConversation.id, signed);
        $("#groupManagePanel").hidden = true;
        await refreshData();
      } catch (error) { setStatus(formatActionError(error), true); }
    });
    $("#inviteGroupMember")?.addEventListener("click", async () => {
      const conversation = state.activeConversation;
      const contactId = $("#groupInviteContact")?.value;
      if (!conversation || !contactId) return;
      try {
        await rotateGroupWithMembers(conversation, "add", [contactId]);
        $("#groupManagePanel").hidden = true;
        await refreshData();
      } catch (error) { setStatus(formatActionError(error), true); }
    });
    $("#dissolveGroup")?.addEventListener("click", async () => {
      const conversation = state.activeConversation;
      if (!conversation || !window.confirm("Disband this group?")) return;
      try {
        const expectedEpoch = await currentAccountEpoch(conversation);
        const signed = await signAccountControl(conversation.id, expectedEpoch, "dissolve", {});
        await window.ALevelApi.dissolveChatGroup(conversation.id, signed);
        $("#groupManagePanel").hidden = true;
        state.activeConversation = null;
        await refreshData();
      } catch (error) { setStatus(formatActionError(error), true); }
    });
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
      const accountConfigured = await ensureAccountState();
      if (accountConfigured) {
        if (state.accountV2?.unlocked) {
          $("#chatApp").hidden = false;
          await refreshData();
        }
        return;
      }
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
