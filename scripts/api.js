(function () {
  const DEFAULT_TIMEOUT_MS = 8000;
  const API_BASE_KEY = "alevel.apiBase";

  function normalizeBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function resolveBaseUrl() {
    const saved = normalizeBaseUrl(localStorage.getItem(API_BASE_KEY));
    const isStaticPreview = window.location.protocol === "http:" && window.location.port === "8080";
    let savedUrl = null;
    try {
      savedUrl = saved ? new URL(saved) : null;
    } catch (_err) {
    }
    const legacyLocalBase = savedUrl?.port === "3001" && (
      savedUrl.hostname === window.location.hostname ||
      savedUrl.hostname === "localhost" ||
      savedUrl.hostname === "127.0.0.1"
    );

    if (legacyLocalBase && (isStaticPreview || window.location.pathname.startsWith("/alevel/"))) {
      localStorage.removeItem(API_BASE_KEY);
    } else if (saved) {
      return saved;
    }

    // The IDE static preview runs separately from the deployed backend.
    if (isStaticPreview) {
      return `http://${window.location.hostname}:3002`;
    }

    if (window.location.protocol.startsWith("http")) {
      // Default same-origin API.
      return "";
    }

    return "http://localhost:3002";
  }

  let apiBaseUrl = resolveBaseUrl();

  function currentToken() {
    return localStorage.getItem("alevel.authToken") || "";
  }

  async function request(path, options = {}) {
    const timeoutMs = options.timeoutMs || (path.startsWith("/api/chat/") ? 30000 : DEFAULT_TIMEOUT_MS);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const hasBody = options.body != null;
    const headers = {
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers || {}),
    };

    try {
      const res = await fetch(`${apiBaseUrl}${path}`, {
        method: options.method || "GET",
        headers,
        body: options.body,
        signal: controller.signal,
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok) {
        const message =
          payload?.error?.message || `Request failed with status ${res.status}`;
        const err = new Error(message);
        err.status = res.status;
        err.code = payload?.error?.code || "HTTP_ERROR";
        err.payload = payload;
        throw err;
      }

      return payload?.data ?? payload;
    } catch (error) {
      if (controller.signal.aborted) {
        const timeout = new Error(path.startsWith("/api/chat/")
          ? "The chat request timed out. Refresh the chat to check whether the change was saved."
          : "The request timed out. Please try again.");
        timeout.code = "REQUEST_TIMEOUT";
        timeout.cause = error;
        throw timeout;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async function download(path, token) {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload?.error?.message || `Request failed with status ${response.status}`);
    }
    return response.blob();
  }

  window.ALevelApi = {
    getBaseUrl() {
      return apiBaseUrl;
    },
    setBaseUrl(url) {
      const normalized = normalizeBaseUrl(url);
      if (!normalized) return;
      apiBaseUrl = normalized;
      localStorage.setItem(API_BASE_KEY, normalized);
    },
    async getCurriculum() {
      return request("/api/meta/curriculum");
    },
    async getStorageMode() {
      return request("/api/meta/storage");
    },
    async getCatalogSubjects() {
      return request("/api/catalog/subjects");
    },
    async getCatalogPapers(subjectCode) {
      return request(`/api/catalog/subjects/${encodeURIComponent(subjectCode)}/papers`);
    },
    async getCatalogPaper(paperSlug) {
      return request(`/api/catalog/papers/${encodeURIComponent(paperSlug)}`);
    },
    async getCatalogPaperQuestions(paperSlug) {
      return request(`/api/catalog/papers/${encodeURIComponent(paperSlug)}/questions`);
    },
    async generatePaper(input) {
      return request("/api/papers/generate", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input),
      });
    },
    async submitPaper(input) {
      return request("/api/papers/submit", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input),
      });
    },
    async submitLocalPaper(input) {
      return request("/api/papers/submit-local", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input),
      });
    },
    async buildAnalysis(input) {
      return request("/api/analysis", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async getAdminRecords(token, input = {}) {
      const usersLimit = Number(input.usersLimit || 20);
      const practicesLimit = Number(input.practicesLimit || 20);
      const query = `?usersLimit=${usersLimit}&practicesLimit=${practicesLimit}`;
      return request(`/api/admin/records${query}`, { token });
    },
    async setAdminUserDisabled(token, userId, disabled) {
      return request(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ disabled: Boolean(disabled) }),
      });
    },
    async getAdminUserHistory(token, userId) {
      return request(`/api/admin/users/${encodeURIComponent(userId)}/history`, { token, timeoutMs: 30000 });
    },
    async deleteAdminUser(token, userId) {
      return request(`/api/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", token });
    },
    async getAdminSubjects(token) {
      return request("/api/admin/subjects", { token });
    },
    async createAdminSubject(token, input) {
      return request("/api/admin/subjects", {
        method: "POST",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async setAdminSubjectActive(token, subjectCode, active) {
      return request(`/api/admin/subjects/${encodeURIComponent(subjectCode)}/status`, {
        method: "PATCH", token, body: JSON.stringify({ active: Boolean(active) }),
      });
    },
    async deleteAdminSubject(token, subjectCode) {
      return request(`/api/admin/subjects/${encodeURIComponent(subjectCode)}`, { method: "DELETE", token });
    },
    async getAdminSubjectQuestions(token, subjectCode, input = {}) {
      const params = new URLSearchParams({ limit: String(input.limit || 100), offset: String(input.offset || 0) });
      return request(`/api/admin/subjects/${encodeURIComponent(subjectCode)}/questions?${params}`, { token });
    },
    async getAdminImports(token, includeHidden = false) {
      return request(`/api/admin/imports${includeHidden ? "?includeHidden=1" : ""}`, { token, timeoutMs: 30000 });
    },
    async getAdminImport(token, jobId) {
      return request(`/api/admin/imports/${encodeURIComponent(jobId)}`, { token, timeoutMs: 30000 });
    },
    async createAdminImport(token, subjectCode) {
      return request("/api/admin/imports", {
        method: "POST",
        token,
        body: JSON.stringify({ subjectCode }),
      });
    },
    async uploadAdminImportFile(token, jobId, input) {
      return request(`/api/admin/imports/${encodeURIComponent(jobId)}/files`, {
        method: "POST",
        token,
        timeoutMs: 120000,
        body: JSON.stringify(input || {}),
      });
    },
    async processAdminImport(token, jobId) {
      return request(`/api/admin/imports/${encodeURIComponent(jobId)}/process`, {
        method: "POST",
        token,
        timeoutMs: 10 * 60 * 1000,
      });
    },
    async publishAdminImport(token, jobId) {
      return request(`/api/admin/imports/${encodeURIComponent(jobId)}/publish`, {
        method: "POST",
        token,
        timeoutMs: 10 * 60 * 1000,
      });
    },
    async dispatchAdminImports(token, jobId = "") {
      return request("/api/admin/imports/dispatch", {
        method: "POST", token, body: JSON.stringify({ jobId }),
      });
    },
    async cancelAdminImport(token, jobId) {
      return request(`/api/admin/imports/${encodeURIComponent(jobId)}/cancel`, { method: "POST", token });
    },
    async setAdminImportHidden(token, jobId, hidden) {
      return request(`/api/admin/imports/${encodeURIComponent(jobId)}/visibility`, {
        method: "PATCH", token, body: JSON.stringify({ hidden: Boolean(hidden) }),
      });
    },
    async deleteAdminImport(token, jobId) {
      return request(`/api/admin/imports/${encodeURIComponent(jobId)}`, { method: "DELETE", token });
    },
    async getAdminAiHintSettings(token) {
      return request("/api/admin/settings/ai-hints", { token });
    },
    async setAdminAiHintSettings(token, enabled) {
      return request("/api/admin/settings/ai-hints", {
        method: "PATCH", token, body: JSON.stringify({ enabled: Boolean(enabled) }),
      });
    },
    async getAdminAuditLogs(token, input = {}) {
      const params = new URLSearchParams({ limit: String(input.limit || 100), offset: String(input.offset || 0) });
      if (input.action) params.set("action", input.action);
      if (input.targetType) params.set("targetType", input.targetType);
      return request(`/api/admin/audit-logs?${params}`, { token });
    },
    async exportAdminData(token, dataset, format) {
      const path = `/api/admin/exports?dataset=${encodeURIComponent(dataset)}&format=${encodeURIComponent(format)}`;
      return format === "csv" ? download(path, token) : request(path, { token });
    },
    async getAdminCommunityReports(token, status = "pending") {
      return request(`/api/admin/community/reports?status=${encodeURIComponent(status)}`, { token });
    },
    async getAdminCommunityThreads(token, status = "all") {
      return request(`/api/admin/community/threads?status=${encodeURIComponent(status)}&limit=200`, { token });
    },
    async getAdminCommunityThreadPosts(token, threadId) {
      return request(`/api/admin/community/threads/${encodeURIComponent(threadId)}/posts`, { token });
    },
    async resolveAdminCommunityReport(token, reportId, status) {
      return request(`/api/admin/community/reports/${encodeURIComponent(reportId)}`, {
        method: "PATCH", token, body: JSON.stringify({ status }),
      });
    },
    async setAdminCommunityPostHidden(token, postId, hidden) {
      return request(`/api/admin/community/posts/${encodeURIComponent(postId)}/visibility`, {
        method: "PATCH", token, body: JSON.stringify({ hidden: Boolean(hidden) }),
      });
    },
    async updateAdminCommunityThread(token, threadId, input) {
      return request(`/api/admin/community/threads/${encodeURIComponent(threadId)}`, {
        method: "PATCH", token, body: JSON.stringify(input || {}),
      });
    },
    async deleteAdminCommunityThread(token, threadId) {
      return request(`/api/admin/community/threads/${encodeURIComponent(threadId)}`, { method: "DELETE", token });
    },
    async setAdminCommunityMute(token, userId, input) {
      return request(`/api/admin/community/mutes/${encodeURIComponent(userId)}`, {
        method: "PATCH", token, body: JSON.stringify(input || {}),
      });
    },
    async getAdminQuestionHints(token, status = "pending_review") {
      const params = new URLSearchParams({ status, subjectCode: "0610", limit: "100" });
      return request(`/api/admin/question-hints?${params}`, { token, timeoutMs: 30000 });
    },
    async getAdminQuestionHintSampleStatus(token) {
      return request("/api/admin/question-hints/sample-status", { token, timeoutMs: 30000 });
    },
    async initializeAdminQuestionHints(token) {
      return request("/api/admin/question-hints/initialize", { method: "POST", token, timeoutMs: 180000 });
    },
    async reviewAdminQuestionHint(token, hintSetId, status) {
      return request(`/api/admin/question-hints/${encodeURIComponent(hintSetId)}`, {
        method: "PATCH",
        token,
        body: JSON.stringify({ status }),
      });
    },
    async getCurriculumVersions(token, subjectCode) {
      return request(`/api/curriculum/${encodeURIComponent(subjectCode)}/versions`, { token });
    },
    async getCurriculumSubjects(token) {
      return request("/api/curriculum/subjects", { token });
    },
    async getChapterCatalog(token, subjectCode, version = "") {
      const query = version ? `?version=${encodeURIComponent(version)}` : "";
      return request(`/api/curriculum/${encodeURIComponent(subjectCode)}/chapters${query}`, { token });
    },
    async generateChapterPaper(token, input) {
      return request("/api/paper-builder/generate", {
        method: "POST",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async createChapterPractice(token, input) {
      return request("/api/chapter-practice/sessions", {
        method: "POST",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async submitChapterPractice(token, sessionId, answers) {
      return request(`/api/chapter-practice/sessions/${encodeURIComponent(sessionId)}/submit`, {
        method: "POST",
        token,
        body: JSON.stringify({ answers }),
      });
    },
    async getAdminCurriculumMappings(token, input = {}) {
      const params = new URLSearchParams();
      params.set("status", input.status || "suggested");
      params.set("limit", String(input.limit || 100));
      params.set("offset", String(input.offset || 0));
      if (input.year) params.set("year", input.year);
      if (input.chapter) params.set("chapter", String(input.chapter));
      return request(`/api/admin/curriculum/mappings?${params}`, { token });
    },
    async suggestAdminCurriculumMappings(token, limit = 100) {
      return request("/api/admin/curriculum/mappings/suggest", {
        method: "POST",
        token,
        body: JSON.stringify({ limit }),
      });
    },
    async reviewAdminCurriculumMapping(token, questionId, currentSectionId, input) {
      return request(
        `/api/admin/curriculum/mappings/${encodeURIComponent(questionId)}/${encodeURIComponent(currentSectionId)}`,
        {
          method: "PATCH",
          token,
          body: JSON.stringify(input || {}),
        }
      );
    },
    async createUser(input) {
      return request("/api/users", {
        method: "POST",
        body: JSON.stringify(input || {}),
      });
    },
    async getUserById(userId) {
      return request(`/api/users/${encodeURIComponent(userId)}`);
    },
    async getUserPractices(userId, input = {}) {
      const limit = Number(input.limit || 20);
      return request(`/api/users/${encodeURIComponent(userId)}/practices?limit=${limit}`, {
        token: currentToken(),
      });
    },
    async getUserNotebook(userId) {
      return request(`/api/users/${encodeURIComponent(userId)}/notebook`, {
        token: currentToken(),
      });
    },
    async createNotebookPractice(userId, input) {
      return request(`/api/users/${encodeURIComponent(userId)}/notebook/practice`, {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async updateNotebookEntry(userId, entryId, input) {
      return request(`/api/users/${encodeURIComponent(userId)}/notebook/${encodeURIComponent(entryId)}`, {
        method: "PATCH",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async clearUserPractices(userId) {
      return request(`/api/users/${encodeURIComponent(userId)}/practices`, {
        method: "DELETE",
        token: currentToken(),
      });
    },
    async getGoogleAuthStart() {
      return request("/api/auth/google/start");
    },
    async loginWithGoogle(accessToken, language) {
      return request("/api/auth/google", {
        method: "POST",
        body: JSON.stringify({ accessToken, language }),
      });
    },
    async requestEmailOtp(email) {
      return request("/api/auth/email/otp", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
    },
    async verifyEmailOtp(email, code, language) {
      return request("/api/auth/email/verify", {
        method: "POST",
        body: JSON.stringify({ email, code, language }),
      });
    },
    async getCurrentUser(token) {
      return request("/api/auth/me", { token });
    },
    async updateCurrentUser(token, input) {
      return request("/api/auth/me", {
        method: "PATCH",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async updatePetPreferences(token, input) {
      return request("/api/auth/me/pet", {
        method: "PATCH",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async getQuestionHints(token, questionKey, language) {
      return request(`/api/question-hints/${encodeURIComponent(questionKey)}`, {
        method: "POST",
        token,
        body: JSON.stringify({ language }),
        timeoutMs: 50000,
      });
    },
    async changePassword(token, input) {
      return request("/api/auth/change-password", {
        method: "POST",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async getDiscussions(token, input = {}) {
      const params = new URLSearchParams();
      Object.entries(input || {}).forEach(([key, value]) => {
        if (value != null && value !== "") params.set(key, value);
      });
      const query = params.toString();
      return request(`/api/discussions${query ? `?${query}` : ""}`, { token });
    },
    async createDiscussion(token, input) {
      return request("/api/discussions", {
        method: "POST",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async uploadDiscussionImage(token, dataUrl) {
      return request("/api/discussions/images", {
        method: "POST",
        token,
        body: JSON.stringify({ dataUrl }),
        timeoutMs: 30000,
      });
    },
    async getDiscussion(token, threadId) {
      return request(`/api/discussions/${encodeURIComponent(threadId)}`, { token });
    },
    async getQuestionReference(token, questionKey) {
      return request(`/api/questions/${encodeURIComponent(questionKey)}`, { token });
    },
    async replyDiscussion(token, threadId, input) {
      return request(`/api/discussions/${encodeURIComponent(threadId)}/posts`, {
        method: "POST",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async deleteDiscussionPost(token, postId) {
      return request(`/api/discussions/posts/${encodeURIComponent(postId)}`, {
        method: "DELETE",
        token,
      });
    },
    async likeDiscussionPost(token, postId) {
      return request(`/api/discussions/posts/${encodeURIComponent(postId)}/like`, {
        method: "POST",
        token,
      });
    },
    async unlikeDiscussionPost(token, postId) {
      return request(`/api/discussions/posts/${encodeURIComponent(postId)}/like`, {
        method: "DELETE",
        token,
      });
    },
    async flagDiscussionPost(token, postId, input) {
      return request(`/api/discussions/posts/${encodeURIComponent(postId)}/flag`, {
        method: "POST",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async followDiscussion(token, threadId) {
      return request(`/api/discussions/${encodeURIComponent(threadId)}/follow`, {
        method: "POST",
        token,
      });
    },
    async unfollowDiscussion(token, threadId) {
      return request(`/api/discussions/${encodeURIComponent(threadId)}/follow`, {
        method: "DELETE",
        token,
      });
    },
    async moderateDiscussion(token, threadId, input) {
      return request(`/api/discussions/${encodeURIComponent(threadId)}/moderation`, {
        method: "PATCH",
        token,
        body: JSON.stringify(input || {}),
      });
    },
    async getChatProfile() {
      return request("/api/chat/profile", { token: currentToken() });
    },
    async getChatAccountKeys() {
      return request("/api/chat/account/keys", { token: currentToken() });
    },
    /** Return the active account-v2 public key bundle for the signed-in user. */
    async getChatAccountKeyBundle() {
      return this.getChatAccountKeys();
    },
    async saveChatAccountKeys(input) {
      return request("/api/chat/account/keys", { method: "PUT", token: currentToken(), body: JSON.stringify(input || {}) });
    },
    async upsertChatAccountKeyBundle(input) {
      return this.saveChatAccountKeys(input);
    },
    async getChatAccountVault() {
      return request("/api/chat/account/vault", { token: currentToken() });
    },
    async saveChatAccountVault(input) {
      return request("/api/chat/account/vault", { method: "PUT", token: currentToken(), body: JSON.stringify(input || {}) });
    },
    async initializeChatAccount(input) {
      return request("/api/chat/account/initialize", { method: "POST", token: currentToken(), body: JSON.stringify(input || {}) });
    },
    async getChatPasskeyOptions(kind) {
      if (kind !== "register" && kind !== "authenticate") {
        throw new TypeError("Passkey options kind must be register or authenticate");
      }
      return request(`/api/chat/account/passkeys/${kind}/options`, { method: "POST", token: currentToken() });
    },
    async getChatPasskeyRegistrationOptions() {
      return this.getChatPasskeyOptions("register");
    },
    async getChatPasskeyAuthenticationOptions() {
      return this.getChatPasskeyOptions("authenticate");
    },
    async verifyChatPasskey(kind, input) {
      if (kind !== "register" && kind !== "authenticate") {
        throw new TypeError("Passkey verification kind must be register or authenticate");
      }
      return request(`/api/chat/account/passkeys/${kind}/verify`, { method: "POST", token: currentToken(), body: JSON.stringify(input || {}) });
    },
    async verifyChatPasskeyRegistration(input) {
      return this.verifyChatPasskey("register", input);
    },
    async verifyChatPasskeyAuthentication(input) {
      return this.verifyChatPasskey("authenticate", input);
    },
    async getChatConversationEpochs(conversationId) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/epochs`, { token: currentToken() });
    },
    async listChatConversationEpochs(conversationId) {
      return this.getChatConversationEpochs(conversationId);
    },
    async syncChatEvents(conversationId, cursor = "") {
      const params = new URLSearchParams({ conversationId });
      if (cursor) params.set("cursor", cursor);
      return request(`/api/chat/sync-events?${params}`, { token: currentToken(), timeoutMs: 30000 });
    },
    async pullChatSyncEvents(conversationId, cursor = "") {
      return this.syncChatEvents(conversationId, cursor);
    },
    async updateChatProfile(input) {
      return request("/api/chat/profile", {
        method: "PATCH",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async listChatInvites() {
      return request("/api/chat/invites", { token: currentToken() });
    },
    async createChatInvite() {
      return request("/api/chat/invites", { method: "POST", token: currentToken() });
    },
    async revokeChatInvite(inviteId) {
      return request(`/api/chat/invites/${encodeURIComponent(inviteId)}`, {
        method: "DELETE",
        token: currentToken(),
      });
    },
    async acceptChatInvite(token) {
      return request(`/api/chat/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        token: currentToken(),
      });
    },
    async listChatContacts() {
      return request("/api/chat/contacts", { token: currentToken() });
    },
    async getChatContactBundle(contactId) {
      return request(`/api/chat/contacts/${encodeURIComponent(contactId)}/bundle`, { token: currentToken() });
    },
    async getChatContactAccountBundle(contactId) {
      return request(`/api/chat/contacts/${encodeURIComponent(contactId)}/account-key`, { token: currentToken() });
    },
    async listChatDevices() {
      return request("/api/chat/devices", { token: currentToken() });
    },
    async getChatOwnDeviceBundle(excludeDeviceId) {
      const params = excludeDeviceId ? `?excludeDeviceId=${encodeURIComponent(excludeDeviceId)}` : "";
      return request(`/api/chat/devices/bundle${params}`, { token: currentToken() });
    },
    async registerChatDevice(input) {
      return request("/api/chat/devices", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async refillChatDevicePreKeys(deviceId, oneTimePreKeys) {
      return request(`/api/chat/devices/${encodeURIComponent(deviceId)}/prekeys`, {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify({ oneTimePreKeys }),
      });
    },
    async createChatDeviceApproval(deviceId) {
      return request("/api/chat/devices/approval", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify({ deviceId }),
      });
    },
    async revokeChatDevice(deviceId) {
      return request(`/api/chat/devices/${encodeURIComponent(deviceId)}`, {
        method: "DELETE",
        token: currentToken(),
      });
    },
    async listChatConversations() {
      return request("/api/chat/conversations", { token: currentToken() });
    },
    async createChatConversation(contactId) {
      return request("/api/chat/conversations", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify({ contactId }),
      });
    },
    async createChatGroup(contactIds) {
      return request("/api/chat/conversations", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify({ kind: "group", contactIds: Array.isArray(contactIds) ? contactIds : [] }),
      });
    },
    async createAccountChatConversation(input) {
      return request("/api/chat/conversations", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify({ ...(input || {}), protocolVersion: "account-v2" }),
      });
    },
    async getChatConversationBundle(conversationId) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/bundle`, { token: currentToken() });
    },
    async getChatConversationAccountBundle(conversationId) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/account-bundle`, { token: currentToken() });
    },
    async createChatConversationEpoch(conversationId, input) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/epochs`, {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async updateChatGroupMembers(conversationId, input) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/members`, {
        method: "PATCH",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async leaveChatGroup(conversationId, input) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/leave`, {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async updateChatGroupMetadata(conversationId, input) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/metadata`, {
        method: "PUT",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async dissolveChatGroup(conversationId, input) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/dissolve`, {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async updateChatConversationSettings(conversationId, retentionSeconds) {
      return request(`/api/chat/conversations/${encodeURIComponent(conversationId)}/settings`, {
        method: "PATCH",
        token: currentToken(),
        body: JSON.stringify({ retentionSeconds }),
      });
    },
    async syncChatMessages(conversationId, cursor = "") {
      const params = new URLSearchParams({ conversationId });
      if (cursor) params.set("cursor", cursor);
      return request(`/api/chat/sync?${params}`, { token: currentToken(), timeoutMs: 30000 });
    },
    async sendChatMessage(input) {
      return request("/api/chat/messages", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
        timeoutMs: 30000,
      });
    },
    async sendAccountV2Message(input) {
      const payload = { ...(input || {}), protocolVersion: "account-v2" };
      return this.sendChatMessage(payload);
    },
    async deleteChatMessage(messageId) {
      return request(`/api/chat/messages/${encodeURIComponent(messageId)}/delete`, {
        method: "POST",
        token: currentToken(),
      });
    },
    async initChatAttachment(input) {
      return request("/api/chat/attachments/init", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async uploadChatAttachment(attachmentId, bytes) {
      return request(`/api/chat/attachments/${encodeURIComponent(attachmentId)}`, {
        method: "PUT",
        token: currentToken(),
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
        timeoutMs: 120000,
      });
    },
    async completeChatAttachment(attachmentId) {
      return request(`/api/chat/attachments/${encodeURIComponent(attachmentId)}/complete`, {
        method: "POST",
        token: currentToken(),
      });
    },
    async downloadChatAttachment(attachmentId) {
      return download(`/api/chat/attachments/${encodeURIComponent(attachmentId)}`, currentToken());
    },
    async createChatWebSocketTicket(conversationId, deviceId) {
      return request("/api/chat/ws-ticket", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify({ conversationId, deviceId }),
      });
    },
    async getChatKeyBackup() {
      return request("/api/chat/key-backup", { token: currentToken() });
    },
    async saveChatKeyBackup(input) {
      return request("/api/chat/key-backup", {
        method: "PUT",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async restoreChatKeyBackup(input) {
      return request("/api/chat/key-backup/restore", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
    async reportChatMessage(input) {
      return request("/api/chat/reports", {
        method: "POST",
        token: currentToken(),
        body: JSON.stringify(input || {}),
      });
    },
  };
})();
