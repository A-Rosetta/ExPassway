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

  async function request(path, options = {}) {
    const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
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
        err.payload = payload;
        throw err;
      }

      return payload?.data ?? payload;
    } finally {
      clearTimeout(timer);
    }
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
        body: JSON.stringify(input),
      });
    },
    async submitPaper(input) {
      return request("/api/papers/submit", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    async submitLocalPaper(input) {
      return request("/api/papers/submit-local", {
        method: "POST",
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
    async getAdminImports(token) {
      return request("/api/admin/imports", { token, timeoutMs: 30000 });
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
    async getCurriculumVersions(token, subjectCode) {
      return request(`/api/curriculum/${encodeURIComponent(subjectCode)}/versions`, { token });
    },
    async getChapterCatalog(token, subjectCode, version = "") {
      const query = version ? `?version=${encodeURIComponent(version)}` : "";
      return request(`/api/curriculum/${encodeURIComponent(subjectCode)}/chapters${query}`, { token });
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
      return request(`/api/admin/curriculum/mappings?${params}`, { token });
    },
    async suggestAdminCurriculumMappings(token, limit = 300) {
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
      return request(`/api/users/${encodeURIComponent(userId)}/practices?limit=${limit}`);
    },
    async getUserNotebook(userId) {
      return request(`/api/users/${encodeURIComponent(userId)}/notebook`);
    },
    async updateNotebookEntry(userId, entryId, input) {
      return request(`/api/users/${encodeURIComponent(userId)}/notebook/${encodeURIComponent(entryId)}`, {
        method: "PATCH",
        body: JSON.stringify(input || {}),
      });
    },
    async clearUserPractices(userId) {
      return request(`/api/users/${encodeURIComponent(userId)}/practices`, {
        method: "DELETE",
      });
    },
    async register(input) {
      return request("/api/auth/register", {
        method: "POST",
        body: JSON.stringify(input || {}),
      });
    },
    async login(input) {
      return request("/api/auth/login", {
        method: "POST",
        body: JSON.stringify(input || {}),
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
  };
})();
