(function () {
  const TOKEN_KEY = "alevel.authToken";
  const DB_NAME = "expassway-chat-login-session-v1";
  const STORE_NAME = "session";
  const SLOT = "unlocked-account";
  const EVENT = "expassway:chat-session-cleared";
  let generation = 0;
  let databasePromise;
  let trackedToken = currentToken();
  let expiryTimer;
  const channel = typeof BroadcastChannel === "function" ? new BroadcastChannel(DB_NAME) : null;

  function currentToken() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function invalidate() {
    generation += 1;
    window.dispatchEvent(new CustomEvent(EVENT));
  }
  function openDatabase() {
    if (!databasePromise) databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).catch((error) => { databasePromise = null; throw error; });
    return databasePromise;
  }
  async function readRecord() {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(SLOT);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  async function writeRecord(record, expectedRevision, isCurrent) {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      let written = false;
      const request = store.get(SLOT);
      request.onsuccess = () => {
        if (!isCurrent() || (request.result?.revision || null) !== expectedRevision) return;
        store.put(record, SLOT);
        written = true;
      };
      transaction.oncomplete = () => resolve(written);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Chat session write was aborted."));
    });
  }
  async function tokenBinding(token) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  async function clear({ token = currentToken() } = {}) {
    const scopeToken = token || trackedToken;
    if (scopeToken === trackedToken) invalidate();
    const binding = await tokenBinding(scopeToken);
    channel?.postMessage({ type: "clear", binding });
    try {
      const db = await openDatabase();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(SLOT);
        request.onsuccess = () => { if (request.result?.binding === binding) store.delete(SLOT); };
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
    } catch (_error) { /* A blocked local cache must never block sign out. */ }
  }
  async function context(userId) {
    const token = currentToken();
    if (!token || !userId) return null;
    let payload;
    try {
      const segment = token.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      payload = JSON.parse(atob(segment + "=".repeat((4 - segment.length % 4) % 4)));
    } catch (_error) { return null; }
    const expiresAt = Number(payload.exp) * 1000;
    if (payload.sub !== userId || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;
    const binding = await tokenBinding(token);
    return { userId, binding, expiresAt, token };
  }
  function stillCurrent(expectedGeneration, session) {
    return generation === expectedGeneration && currentToken() === session.token && session.expiresAt > Date.now();
  }
  async function save(cryptoCall, { userId, credentialId } = {}) {
    const expectedGeneration = generation;
    const session = await context(userId);
    if (!session || !stillCurrent(expectedGeneration, session)) return false;
    let record = await readRecord();
    if (!stillCurrent(expectedGeneration, session)) return false;
    if (!record || record.binding !== session.binding || record.userId !== userId || record.expiresAt <= Date.now()) {
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      if (!stillCurrent(expectedGeneration, session)) return false;
      const fresh = { userId, binding: session.binding, expiresAt: session.expiresAt, key, revision: crypto.randomUUID() };
      if (!await writeRecord(fresh, record?.revision || null, () => stillCurrent(expectedGeneration, session))) return false;
      record = fresh;
    }
    const snapshot = await cryptoCall("sealAccountV2Session", {
      userId, credentialId, sessionBinding: session.binding, expiresAt: session.expiresAt, wrappingKey: record.key,
    });
    if (!stillCurrent(expectedGeneration, session)) return false;
    return writeRecord({ ...record, ...snapshot, revision: crypto.randomUUID() }, record.revision, () => stillCurrent(expectedGeneration, session));
  }
  async function restore(cryptoCall, { userId, accountKeys } = {}) {
    const expectedGeneration = generation;
    const entryToken = currentToken();
    const session = await context(userId);
    if (!session) {
      if (generation === expectedGeneration && currentToken() === entryToken) await clear({ token: entryToken });
      return null;
    }
    let record;
    try { record = await readRecord(); }
    catch (_error) { return null; }
    if (!stillCurrent(expectedGeneration, session)) return null;
    if (!record || !record.ciphertext) return null;
    if (record.userId !== userId || record.binding !== session.binding || record.expiresAt !== session.expiresAt || record.expiresAt <= Date.now()) {
      await clear({ token: session.token });
      return null;
    }
    if (!stillCurrent(expectedGeneration, session)) return null;
    let restored;
    try {
      restored = await cryptoCall("restoreAccountV2Session", {
        userId, sessionBinding: session.binding, expiresAt: session.expiresAt,
        wrappingKey: record.key, nonce: record.nonce, ciphertext: record.ciphertext, accountKeys,
      });
    } catch (_error) {
      if (stillCurrent(expectedGeneration, session)) await clear({ token: session.token });
      return null;
    }
    if (!stillCurrent(expectedGeneration, session)) {
      await cryptoCall("lockAccountV2Vault");
      return null;
    }
    return restored;
  }
  function armExpiryTimer() {
    clearTimeout(expiryTimer);
    try {
      const segment = trackedToken.split(".")[0].replace(/-/g, "+").replace(/_/g, "/");
      const expiresAt = Number(JSON.parse(atob(segment + "=".repeat((4 - segment.length % 4) % 4))).exp) * 1000;
      if (!Number.isFinite(expiresAt)) return;
      if (expiresAt <= Date.now()) { void clear({ token: trackedToken }); return; }
      expiryTimer = setTimeout(validateLogin, Math.min(expiresAt - Date.now() + 1, 2147483647));
    } catch (_error) { if (trackedToken) void clear({ token: trackedToken }); }
  }
  function validateLogin() {
    const token = currentToken();
    if (trackedToken !== token) {
      const previous = trackedToken;
      void clear({ token: previous });
      trackedToken = token;
    }
    armExpiryTimer();
  }
  channel?.addEventListener("message", async (event) => {
    if (event.data?.type !== "clear" || !event.data.binding) return;
    const token = trackedToken;
    const expectedGeneration = generation;
    if (await tokenBinding(token) === event.data.binding && trackedToken === token && generation === expectedGeneration) invalidate();
  });
  window.addEventListener("storage", (event) => {
    if ((event.key === TOKEN_KEY && event.oldValue !== event.newValue) || event.key === null) validateLogin();
  });
  window.addEventListener("pageshow", validateLogin);
  window.addEventListener("focus", validateLogin);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") validateLogin(); });
  window.ALevelChatSession = { clear, save, restore };
  armExpiryTimer();
})();
