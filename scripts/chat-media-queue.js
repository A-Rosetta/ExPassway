(function () {
  const DATABASE_NAME = "expassway-chat-encrypted-media-queue-v1";
  const STORE_NAME = "encrypted-media";
  let databasePromise = null;

  function database() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("userId", "userId", { unique: false });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => { request.result.close(); databasePromise = null; };
        resolve(request.result);
      };
      request.onerror = () => { databasePromise = null; reject(request.error || new Error("Encrypted image queue is unavailable.")); };
      request.onblocked = () => { databasePromise = null; reject(new Error("Close the other chat tab before updating the encrypted image queue.")); };
    });
    return databasePromise;
  }

  function mediaKey(userId, id) {
    if (typeof userId !== "string" || !userId || typeof id !== "string" || !id) throw new Error("An account and message ID are required for the encrypted image queue.");
    return JSON.stringify([userId, id]);
  }

  async function transaction(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || new Error("Encrypted image queue storage failed."));
      tx.onabort = () => reject(tx.error || new Error("Encrypted image queue storage was interrupted."));
      try { operation(tx.objectStore(STORE_NAME), (value) => { result = value; }); }
      catch (error) { tx.abort(); reject(error); }
    });
  }

  async function put(userId, id, bytes) {
    const key = mediaKey(userId, id);
    const encryptedBytes = bytes instanceof ArrayBuffer ? bytes.slice(0)
      : ArrayBuffer.isView(bytes) ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : null;
    if (!encryptedBytes || !encryptedBytes.byteLength) throw new Error("Encrypted image bytes are required before queueing an image.");
    const createdAt = new Date().toISOString();
    await transaction("readwrite", (store) => store.put({ key, userId, id, createdAt, bytes: encryptedBytes, sizeBytes: encryptedBytes.byteLength }));
    return { id, createdAt, sizeBytes: encryptedBytes.byteLength };
  }

  async function get(userId, id) {
    const key = mediaKey(userId, id);
    return transaction("readonly", (store, result) => {
      const request = store.get(key);
      request.onsuccess = () => result(request.result?.bytes || null);
    });
  }

  async function remove(userId, id) {
    const key = mediaKey(userId, id);
    await transaction("readwrite", (store) => store.delete(key));
  }

  async function list(userId) {
    mediaKey(userId, "account");
    return transaction("readonly", (store, result) => {
      const request = store.index("userId").getAll(userId);
      request.onsuccess = () => result(request.result.map(({ id, createdAt, sizeBytes }) => ({ id, createdAt, sizeBytes })));
    });
  }

  async function clear(userId) {
    mediaKey(userId, "account");
    await transaction("readwrite", (store) => {
      const request = store.index("userId").openKeyCursor(IDBKeyRange.only(userId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) { store.delete(cursor.primaryKey); cursor.continue(); }
      };
    });
  }

  window.ALevelChatMediaQueue = { put, get, remove, list, clear };
})();
