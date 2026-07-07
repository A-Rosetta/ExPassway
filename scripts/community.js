(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const USER_PROFILE_KEY = "alevel.userProfile";
  const { t, applyPage } = window.ALevelI18n;

  const state = {
    token: localStorage.getItem(AUTH_TOKEN_KEY) || "",
    user: null,
    currentThreadId: "",
    context: readContext(),
    threads: [],
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function textWithBreaks(value) {
    return escapeHtml(value).replace(/\n/g, "<br />");
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function readContext() {
    const params = new URLSearchParams(location.search);
    const selection = readJson("alevel.selection", {}) || {};
    return {
      questionKey: params.get("questionKey") || "",
      board: params.get("board") || selection.board || "CIE",
      subject: params.get("subject") || selection.subject || "IGCSE Chemistry",
      paper: params.get("paper") || selection.paper || "MCQ",
      topic: params.get("topic") || "",
      stem: params.get("stem") || "",
    };
  }

  function setStatus(message, isBad) {
    const el = byId("communityStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = isBad ? "tip bad" : "tip good";
  }

  function authHeaderMissing() {
    if (!state.token) {
      location.href = "./login.html";
      return true;
    }
    return false;
  }

  function fillFilters() {
    const subject = byId("communitySubjectFilter");
    const paper = byId("communityPaperFilter");
    subject.innerHTML = `
      <option value="">${t("allSubjects")}</option>
      <option value="IGCSE Chemistry">IGCSE Chemistry</option>
    `;
    paper.innerHTML = `
      <option value="">${t("communityAllPapers")}</option>
      <option value="MCQ">MCQ</option>
    `;
    subject.value = state.context.subject || "";
    paper.value = state.context.paper || "";
    byId("communityTopicFilter").value = state.context.topic || "";
  }

  function renderContext() {
    const box = byId("communityQuestionContext");
    if (!state.context.questionKey && !state.context.topic) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = `
      <div class="tag-row">
        ${state.context.questionKey ? `<span class="tag">${t("communityQuestionTag", { key: escapeHtml(state.context.questionKey) })}</span>` : ""}
        ${state.context.topic ? `<span class="tag">${escapeHtml(state.context.topic)}</span>` : ""}
        <span class="tag">${escapeHtml(state.context.subject || "IGCSE Chemistry")}</span>
        <span class="tag">${escapeHtml(state.context.paper || "MCQ")}</span>
      </div>
      ${state.context.stem ? `<p class="tip">${escapeHtml(state.context.stem)}</p>` : ""}
    `;
  }

  function buildFilterInput() {
    return {
      questionKey: state.context.questionKey,
      subject: byId("communitySubjectFilter").value,
      paper: byId("communityPaperFilter").value,
      topic: byId("communityTopicFilter").value.trim(),
      status: byId("communityStatusFilter").value,
      followedOnly: byId("communityFollowedOnly").checked ? "1" : "",
      limit: 50,
    };
  }

  function statusLabel(status) {
    if (status === "solved") return t("communityStatusSolved");
    if (status === "locked") return t("communityStatusLocked");
    if (status === "hidden") return t("communityStatusHidden");
    return t("communityStatusOpen");
  }

  function renderThreads() {
    const wrap = byId("communityThreadList");
    if (!state.threads.length) {
      wrap.innerHTML = `<p class="tip">${t("communityNoThreads")}</p>`;
      return;
    }
    wrap.innerHTML = state.threads.map((thread) => `
      <article class="discussion-thread ${thread.sticky ? "is-sticky" : ""}" data-thread-id="${escapeHtml(thread.id)}">
        <div class="discussion-thread-head">
          <button class="thread-title-button" data-open-thread="${escapeHtml(thread.id)}">
            ${thread.sticky ? `<span class="status-pill">${t("communitySticky")}</span>` : ""}
            <span>${escapeHtml(thread.title)}</span>
          </button>
          <span class="status-pill status-${escapeHtml(thread.status)}">${statusLabel(thread.status)}</span>
        </div>
        <div class="tag-row">
          ${(thread.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          ${thread.topic ? `<span class="tag">${escapeHtml(thread.topic)}</span>` : ""}
          ${thread.questionKey ? `<span class="tag">${t("communityQuestionTag", { key: escapeHtml(thread.questionKey) })}</span>` : ""}
        </div>
        <p class="tip">${t("communityThreadMeta", {
          author: thread.authorName || t("unknownUser"),
          posts: thread.postCount,
          likes: thread.likeCount,
          time: thread.lastPostAt ? new Date(thread.lastPostAt).toLocaleString() : "-",
        })}</p>
      </article>
    `).join("");

    wrap.querySelectorAll("[data-open-thread]").forEach((button) => {
      button.addEventListener("click", () => openThread(button.getAttribute("data-open-thread")));
    });
  }

  async function loadThreads() {
    if (authHeaderMissing()) return;
    setStatus(t("communityLoading"), false);
    try {
      state.threads = await window.ALevelApi.getDiscussions(state.token, buildFilterInput());
      renderThreads();
      setStatus(t("communityLoaded", { count: state.threads.length }), false);
    } catch (err) {
      setStatus(t("communityLoadFailed", { message: err.message || t("unknownError") }), true);
    }
  }

  function renderPosts(payload) {
    const thread = payload.thread;
    const posts = payload.posts || [];
    const detail = byId("communityThreadDetail");
    const canModerate = state.user?.role === "teacher";
    byId("communityReplyBody").disabled = thread.status === "locked" || thread.status === "hidden";
    byId("communitySubmitReply").disabled = thread.status === "locked" || thread.status === "hidden";

    detail.innerHTML = `
      <div class="discussion-detail-head">
        <div>
          <h2>${escapeHtml(thread.title)}</h2>
          <div class="tag-row">
            <span class="status-pill status-${escapeHtml(thread.status)}">${statusLabel(thread.status)}</span>
            ${(thread.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
            ${thread.followed ? `<span class="tag">${t("communityFollowing")}</span>` : ""}
          </div>
        </div>
        <button id="communityFollowToggle" class="btn-secondary">${thread.followed ? t("communityUnfollow") : t("communityFollow")}</button>
      </div>
      ${canModerate ? `
        <div class="moderation-row">
          <label><span>${t("communityStatusLabel")}</span>
            <select id="communityModerationStatus">
              <option value="open">${t("communityStatusOpen")}</option>
              <option value="solved">${t("communityStatusSolved")}</option>
              <option value="locked">${t("communityStatusLocked")}</option>
              <option value="hidden">${t("communityStatusHidden")}</option>
            </select>
          </label>
          <label class="inline-check"><input id="communityModerationSticky" type="checkbox" /> <span>${t("communitySticky")}</span></label>
          <button id="communitySaveModeration" class="btn-secondary">${t("communitySaveModeration")}</button>
        </div>
      ` : ""}
      <div class="discussion-posts">
        ${posts.map((post) => `
          <article class="discussion-post" data-post-id="${escapeHtml(post.id)}">
            <div class="discussion-post-meta">
              <strong>${escapeHtml(post.authorName || t("unknownUser"))}</strong>
              <span>${post.createdAt ? new Date(post.createdAt).toLocaleString() : "-"}</span>
            </div>
            <p>${textWithBreaks(post.body)}</p>
            <div class="actions compact-actions">
              <button class="btn-secondary" data-like-post="${escapeHtml(post.id)}" data-liked="${post.liked ? "1" : "0"}">${post.liked ? t("communityLiked") : t("communityHelpful")} (${post.likeCount})</button>
              <button class="btn-secondary" data-flag-post="${escapeHtml(post.id)}">${t("communityFlag")}</button>
              ${canModerate ? `<span class="tip">${t("communityFlagCount", { count: post.flagCount })}</span>` : ""}
            </div>
          </article>
        `).join("")}
      </div>
    `;

    const followToggle = byId("communityFollowToggle");
    if (followToggle) {
      followToggle.addEventListener("click", async () => {
        if (thread.followed) await window.ALevelApi.unfollowDiscussion(state.token, thread.id);
        else await window.ALevelApi.followDiscussion(state.token, thread.id);
        await openThread(thread.id);
        await loadThreads();
      });
    }

    detail.querySelectorAll("[data-like-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        const postId = button.getAttribute("data-like-post");
        const liked = button.getAttribute("data-liked") === "1";
        if (liked) await window.ALevelApi.unlikeDiscussionPost(state.token, postId);
        else await window.ALevelApi.likeDiscussionPost(state.token, postId);
        await openThread(thread.id);
        await loadThreads();
      });
    });

    detail.querySelectorAll("[data-flag-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        const reason = window.prompt(t("communityFlagReason")) || "";
        if (!reason.trim()) return;
        await window.ALevelApi.flagDiscussionPost(state.token, button.getAttribute("data-flag-post"), { reason });
        setStatus(t("communityFlagged"), false);
        await openThread(thread.id);
      });
    });

    if (canModerate) {
      byId("communityModerationStatus").value = thread.status;
      byId("communityModerationSticky").checked = Boolean(thread.sticky);
      byId("communitySaveModeration").addEventListener("click", async () => {
        await window.ALevelApi.moderateDiscussion(state.token, thread.id, {
          status: byId("communityModerationStatus").value,
          sticky: byId("communityModerationSticky").checked,
        });
        await openThread(thread.id);
        await loadThreads();
      });
    }
  }

  async function openThread(threadId) {
    state.currentThreadId = threadId;
    try {
      const payload = await window.ALevelApi.getDiscussion(state.token, threadId);
      renderPosts(payload);
      byId("communityDetailPanel").hidden = false;
      byId("communityComposerPanel").hidden = true;
    } catch (err) {
      setStatus(t("communityLoadFailed", { message: err.message || t("unknownError") }), true);
    }
  }

  function openComposer() {
    byId("communityComposerPanel").hidden = false;
    byId("communityDetailPanel").hidden = true;
    byId("communityTitle").value = state.context.questionKey
      ? t("communityDefaultQuestionTitle", { key: state.context.questionKey })
      : "";
    byId("communityBody").value = state.context.stem ? `${state.context.stem}\n\n` : "";
    byId("communityTagSelect").value = state.context.questionKey ? "question" : "topic";
    byId("communityTitle").focus();
  }

  async function submitThread() {
    const title = byId("communityTitle").value.trim();
    const body = byId("communityBody").value.trim();
    if (!title || !body) {
      setStatus(t("communityRequiredFields"), true);
      return;
    }
    byId("communitySubmitThread").disabled = true;
    try {
      const thread = await window.ALevelApi.createDiscussion(state.token, {
        questionKey: state.context.questionKey || null,
        title,
        body,
        board: state.context.board || "CIE",
        subject: byId("communitySubjectFilter").value || state.context.subject || "IGCSE Chemistry",
        paper: byId("communityPaperFilter").value || state.context.paper || "MCQ",
        topic: byId("communityTopicFilter").value.trim() || state.context.topic || null,
        tags: [byId("communityTagSelect").value],
      });
      byId("communityComposerPanel").hidden = true;
      await loadThreads();
      await openThread(thread.id);
      setStatus(t("communityCreated"), false);
    } catch (err) {
      setStatus(t("communityCreateFailed", { message: err.message || t("unknownError") }), true);
    } finally {
      byId("communitySubmitThread").disabled = false;
    }
  }

  async function submitReply() {
    const body = byId("communityReplyBody").value.trim();
    if (!state.currentThreadId || !body) {
      setStatus(t("communityReplyRequired"), true);
      return;
    }
    byId("communitySubmitReply").disabled = true;
    try {
      await window.ALevelApi.replyDiscussion(state.token, state.currentThreadId, { body });
      byId("communityReplyBody").value = "";
      await openThread(state.currentThreadId);
      await loadThreads();
      setStatus(t("communityReplyCreated"), false);
    } catch (err) {
      setStatus(t("communityReplyFailed", { message: err.message || t("unknownError") }), true);
    } finally {
      byId("communitySubmitReply").disabled = false;
    }
  }

  async function initUser() {
    const saved = readJson(USER_PROFILE_KEY, null);
    state.user = saved || null;
    if (state.token && window.ALevelApi?.getCurrentUser) {
      try {
        state.user = await window.ALevelApi.getCurrentUser(state.token);
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(state.user));
      } catch (_err) {
        localStorage.removeItem(AUTH_TOKEN_KEY);
        location.href = "./login.html";
      }
    }
  }

  async function init() {
    applyPage();
    if (authHeaderMissing()) return;
    await initUser();
    fillFilters();
    renderContext();
    byId("communityApplyFilters").addEventListener("click", loadThreads);
    byId("communityNewThread").addEventListener("click", openComposer);
    byId("communityCancelComposer").addEventListener("click", () => {
      byId("communityComposerPanel").hidden = true;
    });
    byId("communitySubmitThread").addEventListener("click", submitThread);
    byId("communitySubmitReply").addEventListener("click", submitReply);
    byId("communityCloseDetail").addEventListener("click", () => {
      byId("communityDetailPanel").hidden = true;
      state.currentThreadId = "";
    });
    byId("communityBackHome").addEventListener("click", () => {
      location.href = "../index.html";
    });
    await loadThreads();
    if (state.context.questionKey && !state.threads.length) {
      openComposer();
    }
  }

  init().catch((err) => {
    setStatus(t("communityLoadFailed", { message: err.message || t("unknownError") }), true);
  });
})();
