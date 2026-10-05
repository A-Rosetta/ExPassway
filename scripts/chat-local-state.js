(function () {
  const PREFIX = "expassway.chat.local-state.v1";
  const PURPOSES = new Set(["draft", "outbox", "preview", "search"]);

  function create({ userId, cryptoCall, getCryptoContext = () => ({}), storage = localStorage } = {}) {
    if (!userId || typeof cryptoCall !== "function") throw new Error("A chat account and encryption worker are required.");
    const user = String(userId);
    const namespace = `${PREFIX}:${encodeURIComponent(user)}:`;
    const queues = new Map();
    const pinsKey = `${namespace}pins`;

    function scope(conversationId, purpose, recordId = "") {
      if (!conversationId || !PURPOSES.has(purpose)) throw new Error("The local chat record scope is invalid.");
      return { userId: user, conversationId: String(conversationId), purpose, recordId: String(recordId) };
    }
    function keyFor(value) {
      return `${namespace}${value.purpose}:${encodeURIComponent(value.conversationId)}:${encodeURIComponent(value.recordId)}`;
    }
    function serial(key, operation) {
      const pending = (queues.get(key) || Promise.resolve()).catch(() => {}).then(operation);
      queues.set(key, pending);
      // A rejected write still clears its queue without creating an unhandled rejection.
      pending.then(() => { if (queues.get(key) === pending) queues.delete(key); },
        () => { if (queues.get(key) === pending) queues.delete(key); });
      return pending;
    }
    function saveEncrypted(conversationId, purpose, value, recordId = "") {
      const context = scope(conversationId, purpose, recordId);
      const key = keyFor(context);
      // Capture text now; an asynchronously encrypted draft must not see a mutated composer object.
      const plaintext = JSON.stringify(value);
      if (plaintext === undefined) return Promise.reject(new Error("A local chat record is required."));
      return serial(key, async () => {
        const sealed = await cryptoCall("sealChatLocalState", { ...getCryptoContext(), ...context, plaintext });
        storage.setItem(key, JSON.stringify(sealed));
        return true;
      });
    }
    function loadEncrypted(conversationId, purpose, recordId = "") {
      const context = scope(conversationId, purpose, recordId);
      const key = keyFor(context);
      return serial(key, async () => {
        const saved = storage.getItem(key);
        if (!saved) return null;
        const sealed = JSON.parse(saved);
        const opened = await cryptoCall("openChatLocalState", { ...getCryptoContext(), ...context, sealed });
        return JSON.parse(opened.plaintext);
      });
    }
    function removeEncrypted(conversationId, purpose, recordId = "") {
      const key = keyFor(scope(conversationId, purpose, recordId));
      // Clearing after send waits for any earlier write, so it cannot resurrect the draft.
      return serial(key, () => { storage.removeItem(key); return true; });
    }
    function listEncrypted(purpose) {
      if (!PURPOSES.has(purpose)) throw new Error("The local chat record purpose is invalid.");
      const prefix = `${namespace}${purpose}:`;
      const records = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const parts = key.slice(prefix.length).split(":");
        if (parts.length !== 2) continue;
        try { records.push({ conversationId: decodeURIComponent(parts[0]), recordId: decodeURIComponent(parts[1]) }); }
        catch (_error) { /* Invalid storage metadata is not a record. */ }
      }
      return records;
    }
    function getPinned() {
      try {
        const saved = JSON.parse(storage.getItem(pinsKey) || "[]");
        return Array.isArray(saved) ? [...new Set(saved.filter((id) => typeof id === "string" && id.length <= 256))] : [];
      } catch (_error) { return []; }
    }
    function isPinned(conversationId) { return getPinned().includes(String(conversationId)); }
    function setPinned(conversationId, pinned) {
      const id = String(conversationId || "");
      if (!id || id.length > 256) throw new Error("A conversation is required.");
      const pins = getPinned().filter((value) => value !== id);
      if (pinned) pins.unshift(id);
      storage.setItem(pinsKey, JSON.stringify(pins));
      return Boolean(pinned);
    }
    return Object.freeze({
      saveEncrypted, loadEncrypted, removeEncrypted, listEncrypted, getPinned, isPinned, setPinned,
      saveDraft: (conversationId, value) => saveEncrypted(conversationId, "draft", value),
      loadDraft: (conversationId) => loadEncrypted(conversationId, "draft"),
      clearDraft: (conversationId) => removeEncrypted(conversationId, "draft"),
    });
  }

  window.ExpChatLocalState = Object.freeze({ create });
})();
