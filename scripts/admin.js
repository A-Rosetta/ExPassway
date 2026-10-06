(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const { t, applyPage, getLanguage } = window.ALevelI18n;
  let authToken = "";
  let currentImportJob = null;
  let importPollTimer = 0;

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    if (value == null) return "-";
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function fmtDate(value) {
    if (!value) return "-";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString();
  }

  function setStatus(text, isBad) {
    const statusEl = byId("adminStatus");
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = isBad ? "tip bad" : "tip good";
  }

  function setImportStatus(text, isBad) {
    const statusEl = byId("adminImportStatus");
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = isBad ? "tip bad" : "tip good";
  }

  function setSubjectStatus(text, isBad) {
    const statusEl = byId("adminSubjectStatus");
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.className = isBad ? "tip bad" : "tip good";
  }

  function setPanelStatus(id, text, isBad = false) {
    const element = byId(id);
    if (!element) return;
    element.textContent = text || "";
    element.className = isBad ? "tip bad" : "tip good";
  }

  function actionButtons(buttons) {
    return `<div class="admin-action-grid">${buttons.join("")}</div>`;
  }

  function showDetailDialog() {
    const dialog = byId("adminDetailDialog");
    if (dialog.open) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
  }

  function openDetail(title, content) {
    byId("adminDetailTitle").textContent = title;
    const detailBody = byId("adminDetailBody");
    detailBody.innerHTML = content;
    detailBody.hidden = false;
    byId("adminImportDetail").hidden = true;
    byId("adminDetailDialog").dataset.mode = "detail";
    showDetailDialog();
  }

  function detailTable(columns, rows) {
    return `
      <div class="table-wrap"><table class="data-table">
        <thead><tr>${columns.map((column) => `<th>${safeText(column.label)}</th>`).join("")}</tr></thead>
        <tbody>${rows.length ? rows.map((row) => `<tr>${columns.map((column) => (
          `<td>${safeText(column.format ? column.format(row[column.key], row) : row[column.key])}</td>`
        )).join("")}</tr>`).join("") : `<tr><td colspan="${columns.length}" class="tip">${safeText(t("adminNoDetailRows"))}</td></tr>`}</tbody>
      </table></div>
    `;
  }

  async function loadHintReviewData() {
    const statusEl = byId("adminHintReviewStatus");
    try {
      const setting = await window.ALevelApi.getAdminAiHintSettings(authToken);
      byId("adminHintLiveToggle").checked = setting.enabled;
      byId("adminHintLiveToggle").disabled = !setting.configured;
      statusEl.textContent = t(setting.enabled ? "adminHintLiveEnabled" : "adminHintLiveDisabled");
      statusEl.className = setting.enabled ? "tip good" : "tip";
    } catch (err) {
      statusEl.textContent = t("adminHintLoadFailed", { message: err.message || t("checkBackendDb") });
      statusEl.className = "tip bad";
    }
  }


  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error(t("adminImportReadFailed")));
      reader.readAsDataURL(file);
    });
  }

  function statusLabel(status) {
    const key = {
      uploading: "adminImportStatusUploading",
      processing: "adminImportStatusProcessing",
      validated: "adminImportStatusValidated",
      published: "adminImportStatusPublished",
      failed: "adminImportStatusFailed",
      cancelled: "adminImportStatusCancelled",
    }[status];
    return key ? t(key) : status || "-";
  }

  function importStatusLabel(job) {
    if (job?.summary?.requestedAction === "publish") return t("adminImportStatusPublishQueued");
    return statusLabel(job?.status);
  }

  function scheduleImportPoll(job) {
    clearTimeout(importPollTimer);
    const queued = job?.status === "processing" || job?.summary?.requestedAction === "publish";
    if (!queued) return;
    importPollTimer = setTimeout(async () => {
      try {
        renderImportJob(await window.ALevelApi.getAdminImport(authToken, job.id));
        await loadImportAdminData();
      } catch (_error) {
        scheduleImportPoll(job);
      }
    }, 10000);
  }

  function summaryValue(summary, key) {
    return Number(summary?.[key] || 0);
  }

  function renderImportJob(job) {
    currentImportJob = job || null;
    const detail = byId("adminImportDetail");
    if (!detail) return;
    byId("adminProcessImport").disabled = !job || !["uploading", "failed"].includes(job.status);
    byId("adminPublishImport").disabled = !job || job.status !== "validated";
    byId("adminCancelImport").disabled = !job || ["published", "cancelled"].includes(job.status);
    byId("adminDeleteImport").disabled = !job || !["uploading", "failed", "cancelled"].includes(job.status);
    byId("adminHideImportRecord").textContent = t(job?.hiddenAt ? "adminRestoreImportRecord" : "adminHideImportRecord");
    if (!job) {
      detail.hidden = true;
      const dialog = byId("adminDetailDialog");
      if (dialog.open && dialog.dataset.mode === "import") dialog.close();
      return;
    }

    const summary = job.summary || {};
    const summaryRows = [
      [t("adminImportStatusLabel"), importStatusLabel(job)],
      [t("adminImportValidatedPapers"), summaryValue(summary, "validatedPaperCount")],
      [t("adminImportRejectedPapers"), summaryValue(summary, "rejectedPaperCount")],
      [t("adminImportValidQuestions"), summaryValue(summary, "validQuestionCount")],
      [t("adminImportDiscountedQuestions"), summaryValue(summary, "discountedQuestionCount")],
    ];
    byId("adminImportSummary").innerHTML = summaryRows.map(([label, value]) => `
      <div class="stat-card">
        <div class="stat-label">${safeText(label)}</div>
        <div class="stat-value admin-import-stat-value">${safeText(value)}</div>
      </div>
    `).join("");

    const files = Array.isArray(job.files) ? job.files : [];
    byId("adminImportFilesBody").innerHTML = files.length
      ? files.map((file) => `
          <tr>
            <td class="mono">${safeText(file.fileName)}</td>
            <td class="mono">${safeText(file.paperSlug)}</td>
            <td>${safeText(file.documentType.toUpperCase())}</td>
            <td>${safeText(formatBytes(file.byteSize))}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="4" class="tip">${safeText(t("adminImportNoFiles"))}</td></tr>`;

    const issues = Array.isArray(job.issues) ? job.issues : [];
    const failures = Array.isArray(summary.publishFailures) ? summary.publishFailures : [];
    byId("adminImportIssues").innerHTML = issues.length || failures.length
      ? `<h4>${safeText(t("adminImportIssuesTitle"))}</h4><ul class="admin-import-issues">${[
          ...issues.map((issue) => `${issue.paperSlug ? `${issue.paperSlug}: ` : ""}${issue.message}`),
          ...failures.map((failure) => `${failure.paperSlug}: ${failure.message}`),
        ].map((message) => `<li>${safeText(message)}</li>`).join("")}</ul>`
      : `<p class="tip">${safeText(t("adminImportNoIssues"))}</p>`;
    scheduleImportPoll(job);
  }

  function openImportDetail(job) {
    renderImportJob(job);
    byId("adminDetailTitle").textContent = t("adminImportDetailTitle");
    byId("adminDetailBody").hidden = true;
    byId("adminImportDetail").hidden = false;
    byId("adminDetailDialog").dataset.mode = "import";
    showDetailDialog();
  }

  function renderSubjects(subjects) {
    const select = byId("adminImportSubject");
    if (!select) return;
    const selected = select.value;
    select.innerHTML = (subjects || []).map((subject) => `
      <option value="${safeText(subject.code)}"${subject.importMode ? " disabled" : ""}>${safeText(`${subject.code} - ${getLanguage() === "en" ? subject.name : subject.nameZh || subject.name}`)}</option>
    `).join("");
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
    const body = byId("adminSubjectsBody");
    body.innerHTML = subjects?.length ? subjects.map((subject) => `
      <tr>
        <td class="mono">${safeText(subject.code)}</td>
        <td>${safeText(getLanguage() === "en" ? subject.name : subject.nameZh || subject.name)}</td>
        <td>${safeText(subject.qualification || "")}</td>
        <td>${safeText(t(subject.active ? "adminSubjectActive" : "adminSubjectInactive"))}</td>
        <td>${safeText(subject.questionCount)}</td>
        <td>${safeText(subject.importMode ? `${t("subjectResourcesPending")}: ${["syllabus", "textbooks", "papers", "questions"].map((key) => `${t({syllabus:"subjectSyllabus",textbooks:"subjectTextbooks",papers:"subjectPapers",questions:"subjectQuestions"}[key])}:${subject.contentCounts?.[key] || 0}`).join(" · ")}` : "")} ${subject.importMode ? safeText(getLanguage() === "en" ? "Imported from a prepared resource package." : "资源由整理后的数据包导入。") : ""}</td>
        <td>${actionButtons([
          `<button type="button" class="btn-secondary" data-subject-questions="${safeText(subject.code)}">${safeText(t("adminViewQuestions"))}</button>`,
          `<button type="button" class="btn-secondary" data-subject-active="${safeText(subject.code)}" data-active="${subject.active ? "1" : "0"}">${safeText(t(subject.active ? "adminDisableSubject" : "adminEnableSubject"))}</button>`,
          `<button type="button" class="btn-danger" data-subject-delete="${safeText(subject.code)}">${safeText(t("adminDeleteSubject"))}</button>`,
        ])}</td>
      </tr>
    `).join("") : `<tr><td colspan="7" class="tip">${safeText(t("adminNoSubjects"))}</td></tr>`;
    body.querySelectorAll("[data-subject-questions]").forEach((button) => {
      button.addEventListener("click", () => showSubjectQuestions(button.dataset.subjectQuestions));
    });
    body.querySelectorAll("[data-subject-active]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await window.ALevelApi.setAdminSubjectActive(authToken, button.dataset.subjectActive, button.dataset.active !== "1");
          await loadImportAdminData();
        } catch (error) {
          setSubjectStatus(t("adminSubjectActionFailed", { message: error.message }), true);
          button.disabled = false;
        }
      });
    });
    body.querySelectorAll("[data-subject-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm(t("adminDeleteSubjectConfirm", { code: button.dataset.subjectDelete }))) return;
        button.disabled = true;
        try {
          await window.ALevelApi.deleteAdminSubject(authToken, button.dataset.subjectDelete);
          await loadImportAdminData();
        } catch (error) {
          setSubjectStatus(t("adminSubjectActionFailed", { message: error.message }), true);
          button.disabled = false;
        }
      });
    });
  }

  async function showSubjectQuestions(subjectCode) {
    try {
      const data = await window.ALevelApi.getAdminSubjectQuestions(authToken, subjectCode, { limit: 300 });
      openDetail(t("adminSubjectQuestionsTitle", { code: subjectCode, count: data.total }), detailTable([
        { key: "id", label: t("adminQuestionId") },
        { key: "paper_slug", label: t("adminImportPaperSlug") },
        { key: "question_no", label: t("adminQuestionNumber") },
        { key: "year", label: t("adminQuestionYear") },
        { key: "topic", label: t("adminQuestionTopic") },
        { key: "active", label: t("adminUserStatus"), format: (value) => t(value ? "adminSubjectActive" : "adminSubjectInactive") },
      ], data.questions));
    } catch (error) {
      setSubjectStatus(t("adminSubjectActionFailed", { message: error.message }), true);
    }
  }

  function renderImportHistory(jobs) {
    const body = byId("adminImportsBody");
    if (!body) return;
    body.innerHTML = jobs?.length
      ? jobs.map((job) => `
          <tr>
            <td>${safeText(fmtDate(job.createdAt))}</td>
            <td>${safeText(`${job.subjectCode} - ${job.subjectName}`)}</td>
            <td><span class="status-pill admin-import-status-${safeText(job.status)}">${safeText(importStatusLabel(job))}</span></td>
            <td>${safeText(job.fileCount)}</td>
            <td>${actionButtons([
              `<button type="button" class="btn-secondary" data-import-id="${safeText(job.id)}">${safeText(t("adminImportView"))}</button>`,
              job.hiddenAt ? `<button type="button" class="btn-secondary" data-import-restore="${safeText(job.id)}">${safeText(t("adminRestoreImportRecord"))}</button>` : "",
            ])}</td>
          </tr>
        `).join("")
      : `<tr><td colspan="5" class="tip">${safeText(t("adminImportNoHistory"))}</td></tr>`;
    body.querySelectorAll("[data-import-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          openImportDetail(await window.ALevelApi.getAdminImport(authToken, button.dataset.importId));
        } catch (err) {
          setImportStatus(t("adminImportLoadFailed", { message: err.message }), true);
        } finally {
          button.disabled = false;
        }
      });
    });
    body.querySelectorAll("[data-import-restore]").forEach((button) => {
      button.addEventListener("click", async () => {
        await window.ALevelApi.setAdminImportHidden(authToken, button.dataset.importRestore, false);
        await loadImportAdminData();
      });
    });
  }

  async function loadImportAdminData() {
    try {
      const [subjects, jobs] = await Promise.all([
        window.ALevelApi.getAdminSubjects(authToken),
        window.ALevelApi.getAdminImports(authToken, byId("adminShowHiddenImports").checked),
      ]);
      renderSubjects(subjects);
      renderImportHistory(jobs);
    } catch (err) {
      setImportStatus(t("adminImportLoadFailed", { message: err.message || t("checkBackendDb") }), true);
    }
  }

  function renderSummary(summary) {
    const wrap = byId("summaryCards");
    if (!wrap) return;

    const cards = [
      { label: t("totalUsers"), value: summary?.usersCount ?? 0 },
      { label: t("totalPractices"), value: summary?.practiceCount ?? 0 },
      { label: t("submittedPractices"), value: summary?.submittedCount ?? 0 },
    ];

    wrap.innerHTML = cards
      .map(
        (item) => `
      <article class="stat-card">
        <div class="stat-label">${safeText(item.label)}</div>
        <div class="stat-value">${safeText(item.value)}</div>
      </article>
    `
      )
      .join("");
  }

  function renderUsers(users) {
    const body = byId("usersBody");
    if (!body) return;

    if (!users?.length) {
      body.innerHTML = `<tr><td colspan='9' class='tip'>${t("noUsers")}</td></tr>`;
      return;
    }

    body.innerHTML = users
      .map(
        (u) => `
      <tr>
        <td class="mono">${safeText(u.id)}</td>
        <td>${safeText(u.displayName)}</td>
        <td>${safeText(u.email || "-")}</td>
        <td>${safeText(u.role)}</td>
        <td>${safeText(u.grade || "-")}</td>
        <td>${safeText(u.targetScore ?? "-")}</td>
        <td>${safeText(u.isDisabled ? t("adminUserDisabled") : t("adminUserActive"))}</td>
        <td>${safeText(fmtDate(u.createdAt))}</td>
        <td>${actionButtons([
          `<button type="button" class="btn-secondary" data-user-history="${safeText(u.id)}">${safeText(t("adminViewUserHistory"))}</button>`,
          u.role === "admin" ? "" : `<button type="button" class="${u.isDisabled ? "btn-secondary" : "btn-danger"}" data-user-status="${safeText(u.id)}" data-disabled="${u.isDisabled ? "1" : "0"}">${u.isDisabled ? t("adminEnableUser") : t("adminDisableUser")}</button>`,
          u.role === "admin" ? "" : `<button type="button" class="btn-danger" data-user-delete="${safeText(u.id)}">${safeText(t("adminDeleteUser"))}</button>`,
        ])}</td>
      </tr>
    `
      )
      .join("");

    body.querySelectorAll("[data-user-status]").forEach((button) => {
      button.addEventListener("click", async () => {
        const disabled = button.dataset.disabled !== "1";
        if (!window.confirm(t(disabled ? "adminDisableUserConfirm" : "adminEnableUserConfirm"))) return;
        button.disabled = true;
        try {
          await window.ALevelApi.setAdminUserDisabled(authToken, button.dataset.userStatus, disabled);
          await loadRecords();
          setStatus(t(disabled ? "adminUserDisabledSuccess" : "adminUserEnabledSuccess"), false);
        } catch (err) {
          button.disabled = false;
          setStatus(t("adminUserStatusFailed", { message: err.message || t("checkBackendDb") }), true);
        }
      });
    });
    body.querySelectorAll("[data-user-history]").forEach((button) => {
      button.addEventListener("click", () => showUserHistory(button.dataset.userHistory));
    });
    body.querySelectorAll("[data-user-delete]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm(t("adminDeleteUserConfirm"))) return;
        button.disabled = true;
        try {
          await window.ALevelApi.deleteAdminUser(authToken, button.dataset.userDelete);
          await loadRecords();
          setStatus(t("adminDeleteUserSuccess"), false);
        } catch (error) {
          setStatus(t("adminDeleteUserFailed", { message: error.message }), true);
          button.disabled = false;
        }
      });
    });
  }

  async function showUserHistory(userId) {
    try {
      const data = await window.ALevelApi.getAdminUserHistory(authToken, userId);
      const summary = data.summary || {};
      const sections = [
        `<div class="stats-grid admin-import-summary">
          <div class="stat-card"><div class="stat-label">${safeText(t("totalPractices"))}</div><div class="stat-value">${safeText(summary.practiceCount)}</div></div>
          <div class="stat-card"><div class="stat-label">${safeText(t("adminHistoryAttempts"))}</div><div class="stat-value">${safeText(summary.attemptCount)}</div></div>
          <div class="stat-card"><div class="stat-label">${safeText(t("adminHistoryCorrect"))}</div><div class="stat-value">${safeText(summary.correctCount)}</div></div>
          <div class="stat-card"><div class="stat-label">${safeText(t("adminHistoryNotebook"))}</div><div class="stat-value">${safeText(summary.notebookCount)}</div></div>
        </div>`,
        `<h3>${safeText(t("adminHistoryPractices"))}</h3>`,
        detailTable([
          { key: "id", label: t("adminPracticeId") },
          { key: "subject", label: t("adminSubjectPath") },
          { key: "status", label: t("adminPracticeStatus") },
          { key: "created_at", label: t("adminCreatedAt"), format: fmtDate },
          { key: "submitted_at", label: t("adminSubmittedAt"), format: fmtDate },
        ], data.practices || []),
        `<h3>${safeText(t("adminHistoryAttempts"))}</h3>`,
        detailTable([
          { key: "question_id", label: t("adminQuestionId") },
          { key: "paper_slug", label: t("adminImportPaperSlug") },
          { key: "selected_index", label: t("adminHistorySelected") },
          { key: "correct", label: t("adminHistoryCorrect"), format: (value) => value ? t("yes") : t("no") },
          { key: "hints_used", label: t("adminHistoryHintsUsed") },
          { key: "attempted_at", label: t("adminCreatedAt"), format: fmtDate },
        ], data.attempts || []),
        `<h3>${safeText(t("adminHistoryNotebook"))}</h3>`,
        detailTable([
          { key: "question_key", label: t("adminQuestionId") },
          { key: "topic", label: t("adminQuestionTopic") },
          { key: "wrong_count", label: t("adminHistoryWrongCount") },
          { key: "mastered", label: t("adminHistoryMastered"), format: (value) => value ? t("yes") : t("no") },
          { key: "last_wrong_at", label: t("adminHistoryLastWrong"), format: fmtDate },
        ], data.notebook || []),
        `<h3>${safeText(t("adminHistoryCommunity"))}</h3>`,
        detailTable([
          { key: "id", label: t("adminReportDiscussion") },
          { key: "title", label: t("communityTitleLabel") },
          { key: "status", label: t("adminPracticeStatus") },
          { key: "created_at", label: t("adminCreatedAt"), format: fmtDate },
        ], data.discussions?.threads || []),
      ];
      openDetail(t("adminUserHistoryTitle", { name: data.user.displayName }), sections.join(""));
    } catch (error) {
      setStatus(t("adminUserHistoryFailed", { message: error.message }), true);
    }
  }

  function renderPractices(practices) {
    const body = byId("practicesBody");
    if (!body) return;

    if (!practices?.length) {
      body.innerHTML = `<tr><td colspan='7' class='tip'>${t("noPractices")}</td></tr>`;
      return;
    }

    body.innerHTML = practices
      .map((p) => {
        const path = `${p.board || "-"} / ${p.subject || "-"} / ${p.paper || "-"}`;
        const userLabel = p.userDisplayName || p.userEmail || p.userId || "-";
        const accuracy =
          p.accuracy == null || Number.isNaN(Number(p.accuracy))
            ? "-"
            : `${Number(p.accuracy).toFixed(1)}%`;

        return `
        <tr>
          <td class="mono">${safeText(p.id)}</td>
          <td>${safeText(userLabel)}</td>
          <td>${safeText(path)}</td>
          <td>${safeText(p.status || "-")}</td>
          <td>${safeText(accuracy)}</td>
          <td>${safeText(fmtDate(p.createdAt))}</td>
          <td>${safeText(fmtDate(p.submittedAt))}</td>
        </tr>
      `;
      })
      .join("");
  }

  async function loadRecords() {
    const refreshBtn = byId("refreshBtn");
    const oldText = refreshBtn.textContent;
    refreshBtn.disabled = true;
    refreshBtn.textContent = t("refreshing");

    const usersLimit = Number(byId("usersLimit").value || 10);
    const practicesLimit = Number(byId("practicesLimit").value || 20);

    try {
      if (!window.ALevelApi) {
        throw new Error("API client not loaded");
      }

      const data = await window.ALevelApi.getAdminRecords(authToken, {
        usersLimit,
        practicesLimit,
      });

      renderSummary(data.summary || {});
      renderUsers(data.latestUsers || []);
      renderPractices(data.latestPractices || []);
      setStatus(t("adminDataLoaded"), false);
    } catch (err) {
      renderSummary({ usersCount: 0, practiceCount: 0, submittedCount: 0 });
      renderUsers([]);
      renderPractices([]);
      setStatus(t("adminLoadFailed", { message: err.message || t("checkBackendDb") }), true);
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = oldText;
      applyPage();
    }
  }

  async function loadCommunityReports() {
    try {
      const reports = await window.ALevelApi.getAdminCommunityReports(authToken, byId("adminReportStatus").value);
      const body = byId("adminReportsBody");
      body.innerHTML = reports.length ? reports.map((report) => `
        <tr>
          <td>${safeText(fmtDate(report.created_at))}<br><small>${safeText(report.reporter_name || "-")}</small></td>
          <td><strong>${safeText(report.thread_title)}</strong><br><small>${safeText(report.author_name || t("unknownUser"))}</small></td>
          <td class="admin-cell-wrap">${safeText(report.body)}</td>
          <td>${safeText(report.reason || "-")}</td>
          <td>${actionButtons([
            `<button type="button" class="btn-secondary" data-report-post="${safeText(report.post_id)}" data-hidden="${report.post_hidden ? "1" : "0"}">${safeText(t(report.post_hidden ? "adminRestorePost" : "adminHidePost"))}</button>`,
            `<button type="button" class="btn-secondary" data-report-lock="${safeText(report.thread_id)}" data-locked="${report.thread_status === "locked" ? "1" : "0"}">${safeText(t(report.thread_status === "locked" ? "adminOpenThread" : "adminLockThread"))}</button>`,
            `<button type="button" class="btn-secondary" data-report-pin="${safeText(report.thread_id)}" data-sticky="${report.thread_sticky ? "1" : "0"}">${safeText(t(report.thread_sticky ? "adminUnpinThread" : "adminPinThread"))}</button>`,
            report.author_id ? `<button type="button" class="btn-secondary" data-report-mute="${safeText(report.author_id)}" data-muted="${isActiveMute(report.muted_until) ? "1" : "0"}">${safeText(t(isActiveMute(report.muted_until) ? "adminUnmuteUser" : "adminMuteUser"))}</button>` : "",
            report.status === "pending" ? `<button type="button" class="btn-primary" data-report-resolve="${safeText(report.id)}">${safeText(t("adminResolveReport"))}</button>` : "",
            report.status === "pending" ? `<button type="button" class="btn-secondary" data-report-dismiss="${safeText(report.id)}">${safeText(t("adminDismissReport"))}</button>` : "",
            `<button type="button" class="btn-danger" data-report-delete="${safeText(report.thread_id)}">${safeText(t("adminDeleteThread"))}</button>`,
          ])}</td>
        </tr>
      `).join("") : `<tr><td colspan="5" class="tip">${safeText(t("adminNoReports"))}</td></tr>`;
      bindCommunityActions(body);
      setPanelStatus("adminCommunityStatus", t("adminReportsLoaded", { count: reports.length }));
    } catch (error) {
      setPanelStatus("adminCommunityStatus", t("adminReportsFailed", { message: error.message }), true);
    }
  }

  function isActiveMute(value) {
    return Boolean(value) && new Date(value).getTime() > Date.now();
  }

  function threadStatusLabel(status) {
    const key = {
      open: "adminThreadOpen",
      solved: "adminThreadSolved",
      locked: "adminThreadLocked",
      hidden: "adminThreadHidden",
    }[status];
    return key ? t(key) : status;
  }

  async function loadCommunityThreads() {
    try {
      const data = await window.ALevelApi.getAdminCommunityThreads(authToken, byId("adminDiscussionStatus").value);
      const body = byId("adminThreadsBody");
      body.innerHTML = data.threads.length ? data.threads.map((thread) => `
        <tr>
          <td><strong>${safeText(thread.title)}</strong><br><small class="mono">${safeText(thread.id)}</small></td>
          <td>${safeText(thread.author_name || thread.author_email || t("unknownUser"))}</td>
          <td>${safeText(threadStatusLabel(thread.status))}${thread.sticky ? `<br><small>${safeText(t("adminThreadPinned"))}</small>` : ""}</td>
          <td>${safeText(t("adminThreadActivitySummary", {
            posts: Number(thread.post_count || 0),
            reports: Number(thread.pending_report_count || 0),
          }))}<br><small>${safeText(fmtDate(thread.last_post_at))}</small></td>
          <td>${actionButtons([
            `<button type="button" class="btn-secondary" data-thread-view="${safeText(thread.id)}">${safeText(t("adminViewPosts"))}</button>`,
            `<button type="button" class="btn-secondary" data-report-lock="${safeText(thread.id)}" data-locked="${thread.status === "locked" ? "1" : "0"}">${safeText(t(thread.status === "locked" ? "adminOpenThread" : "adminLockThread"))}</button>`,
            `<button type="button" class="btn-secondary" data-report-pin="${safeText(thread.id)}" data-sticky="${thread.sticky ? "1" : "0"}">${safeText(t(thread.sticky ? "adminUnpinThread" : "adminPinThread"))}</button>`,
            thread.author_id ? `<button type="button" class="btn-secondary" data-report-mute="${safeText(thread.author_id)}" data-muted="${isActiveMute(thread.muted_until) ? "1" : "0"}">${safeText(t(isActiveMute(thread.muted_until) ? "adminUnmuteUser" : "adminMuteUser"))}</button>` : "",
            `<button type="button" class="btn-danger" data-report-delete="${safeText(thread.id)}">${safeText(t("adminDeleteThread"))}</button>`,
          ])}</td>
        </tr>
      `).join("") : `<tr><td colspan="5" class="tip">${safeText(t("adminNoDiscussions"))}</td></tr>`;
      bindCommunityActions(body);
      body.querySelectorAll("[data-thread-view]").forEach((button) => {
        button.addEventListener("click", () => showCommunityThreadPosts(button.dataset.threadView));
      });
      setPanelStatus("adminCommunityStatus", t("adminCommunityLoaded", {
        threads: data.threads.length,
      }));
    } catch (error) {
      setPanelStatus("adminCommunityStatus", t("adminCommunityFailed", { message: error.message }), true);
    }
  }

  async function showCommunityThreadPosts(threadId) {
    try {
      const data = await window.ALevelApi.getAdminCommunityThreadPosts(authToken, threadId);
      const rows = data.posts.map((post) => `
        <tr>
          <td>${safeText(fmtDate(post.created_at))}</td>
          <td>${safeText(post.author_name || post.author_email || t("unknownUser"))}</td>
          <td class="admin-cell-wrap">${safeText(post.body)}</td>
          <td>${safeText(post.hidden ? t("adminPostHidden") : t("adminPostVisible"))}</td>
          <td>${actionButtons([
            `<button type="button" class="btn-secondary" data-report-post="${safeText(post.id)}" data-hidden="${post.hidden ? "1" : "0"}" data-thread-posts="${safeText(threadId)}">${safeText(t(post.hidden ? "adminRestorePost" : "adminHidePost"))}</button>`,
            post.author_id ? `<button type="button" class="btn-secondary" data-report-mute="${safeText(post.author_id)}" data-muted="${isActiveMute(post.muted_until) ? "1" : "0"}">${safeText(t(isActiveMute(post.muted_until) ? "adminUnmuteUser" : "adminMuteUser"))}</button>` : "",
          ])}</td>
        </tr>
      `).join("");
      openDetail(data.thread.title, `
        <div class="table-wrap"><table class="data-table admin-action-table">
          <thead><tr>
            <th>${safeText(t("adminCreatedAt"))}</th>
            <th>${safeText(t("adminThreadAuthor"))}</th>
            <th>${safeText(t("adminReportPost"))}</th>
            <th>${safeText(t("adminUserStatus"))}</th>
            <th>${safeText(t("adminUserActions"))}</th>
          </tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="tip">${safeText(t("adminNoPosts"))}</td></tr>`}</tbody>
        </table></div>
      `);
      bindCommunityActions(byId("adminDetailBody"));
    } catch (error) {
      setPanelStatus("adminCommunityStatus", t("adminCommunityFailed", { message: error.message }), true);
    }
  }

  async function refreshCommunity() {
    await Promise.all([loadCommunityThreads(), loadCommunityReports()]);
  }

  async function runCommunityAction(action) {
    try {
      await action();
    } catch (error) {
      setPanelStatus("adminCommunityStatus", t("adminCommunityActionFailed", { message: error.message }), true);
    }
  }

  function bindCommunityActions(container) {
    container.querySelectorAll("[data-report-post]").forEach((button) => {
      button.addEventListener("click", () => runCommunityAction(async () => {
        await window.ALevelApi.setAdminCommunityPostHidden(authToken, button.dataset.reportPost, button.dataset.hidden !== "1");
        await refreshCommunity();
        if (button.dataset.threadPosts) await showCommunityThreadPosts(button.dataset.threadPosts);
      }));
    });
    container.querySelectorAll("[data-report-lock]").forEach((button) => {
      button.addEventListener("click", () => runCommunityAction(async () => {
        await window.ALevelApi.updateAdminCommunityThread(authToken, button.dataset.reportLock, {
          status: button.dataset.locked === "1" ? "open" : "locked",
        });
        await refreshCommunity();
      }));
    });
    container.querySelectorAll("[data-report-pin]").forEach((button) => {
      button.addEventListener("click", () => runCommunityAction(async () => {
        await window.ALevelApi.updateAdminCommunityThread(authToken, button.dataset.reportPin, {
          sticky: button.dataset.sticky !== "1",
        });
        await refreshCommunity();
      }));
    });
    container.querySelectorAll("[data-report-resolve], [data-report-dismiss]").forEach((button) => {
      button.addEventListener("click", () => runCommunityAction(async () => {
        const id = button.dataset.reportResolve || button.dataset.reportDismiss;
        await window.ALevelApi.resolveAdminCommunityReport(authToken, id, button.dataset.reportResolve ? "resolved" : "dismissed");
        await refreshCommunity();
      }));
    });
    container.querySelectorAll("[data-report-mute]").forEach((button) => {
      button.addEventListener("click", () => runCommunityAction(async () => {
        if (button.dataset.muted === "1") {
          await window.ALevelApi.setAdminCommunityMute(authToken, button.dataset.reportMute, { active: false });
          setPanelStatus("adminCommunityStatus", t("adminUnmuteSuccess"));
          await refreshCommunity();
          return;
        }
        const raw = window.prompt(t("adminMuteDaysPrompt"), "7");
        if (raw === null) return;
        const days = Number(raw);
        if (!Number.isInteger(days) || days < 1 || days > 365) {
          setPanelStatus("adminCommunityStatus", t("adminMuteDaysInvalid"), true);
          return;
        }
        await window.ALevelApi.setAdminCommunityMute(authToken, button.dataset.reportMute, { days });
        setPanelStatus("adminCommunityStatus", t("adminMuteSuccess", { days }));
        await refreshCommunity();
      }));
    });
    container.querySelectorAll("[data-report-delete]").forEach((button) => {
      button.addEventListener("click", () => runCommunityAction(async () => {
        if (!window.confirm(t("adminDeleteThreadConfirm"))) return;
        await window.ALevelApi.deleteAdminCommunityThread(authToken, button.dataset.reportDelete);
        await refreshCommunity();
      }));
    });
  }

  async function loadAuditLogs() {
    try {
      const rows = await window.ALevelApi.getAdminAuditLogs(authToken, { limit: 100 });
      byId("adminAuditBody").innerHTML = rows.length ? rows.map((event) => `
        <tr>
          <td>${safeText(fmtDate(event.created_at))}</td>
          <td>${safeText(event.actor_name || event.actor_email || event.actor_user_id || "-")}</td>
          <td class="mono">${safeText(event.action)}</td>
          <td>${safeText(`${event.target_type}${event.target_id ? ` / ${event.target_id}` : ""}`)}</td>
          <td class="admin-cell-wrap">${safeText(JSON.stringify(event.details || {}))}</td>
        </tr>
      `).join("") : `<tr><td colspan="5" class="tip">${safeText(t("adminNoAuditLogs"))}</td></tr>`;
    } catch (error) {
      setPanelStatus("adminDataStatus", t("adminAuditFailed", { message: error.message }), true);
    }
  }

  function saveBlob(blob, fileName) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportData(format) {
    const dataset = byId("adminExportDataset").value;
    try {
      const result = await window.ALevelApi.exportAdminData(authToken, dataset, format);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const blob = format === "csv"
        ? result
        : new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
      saveBlob(blob, `expassway-${dataset}-${stamp}.${format}`);
      setPanelStatus("adminDataStatus", t("adminExportSuccess", { dataset, format: format.toUpperCase() }));
      await loadAuditLogs();
    } catch (error) {
      setPanelStatus("adminDataStatus", t("adminExportFailed", { message: error.message }), true);
    }
  }

  byId("refreshBtn").addEventListener("click", () => {
    loadRecords();
  });

  byId("openMapper").addEventListener("click", () => {
    location.href = "./image-mapper.html";
  });

  byId("openCurriculumReview").addEventListener("click", () => {
    location.href = "./curriculum-review.html";
  });

  byId("backHome").addEventListener("click", () => {
    location.href = "../index.html";
  });

  byId("adminRegisterSubject").addEventListener("click", async () => {
    const button = byId("adminRegisterSubject");
    const input = {
      code: byId("adminSubjectCode").value.trim(),
      name: byId("adminSubjectName").value.trim(),
      nameZh: byId("adminSubjectNameZh").value.trim(),
      assetKey: byId("adminSubjectAssetKey").value.trim(),
      qualification: byId("adminSubjectQualification").value,
    };
    button.disabled = true;
    try {
      const subject = await window.ALevelApi.createAdminSubject(authToken, input);
      setSubjectStatus(t("adminSubjectSaved", { code: subject.code }), false);
      await loadImportAdminData();
      byId("adminImportSubject").value = subject.code;
    } catch (err) {
      setSubjectStatus(t("adminSubjectSaveFailed", { message: err.message }), true);
    } finally {
      button.disabled = false;
    }
  });

  byId("adminUploadImport").addEventListener("click", async () => {
    const button = byId("adminUploadImport");
    const files = [...byId("adminImportFiles").files];
    const subjectCode = byId("adminImportSubject").value;
    if (!subjectCode || !files.length) {
      setImportStatus(t("adminImportFilesRequired"), true);
      return;
    }
    const progress = byId("adminImportProgress");
    button.disabled = true;
    progress.hidden = false;
    progress.max = files.length;
    progress.value = 0;
    try {
      const job = await window.ALevelApi.createAdminImport(authToken, subjectCode);
      currentImportJob = job;
      for (const file of files) {
        const dataUrl = await fileToDataUrl(file);
        await window.ALevelApi.uploadAdminImportFile(authToken, job.id, {
          fileName: file.name,
          dataUrl,
        });
        progress.value += 1;
        setImportStatus(t("adminImportUploadingProgress", {
          current: progress.value,
          total: files.length,
        }), false);
      }
      openImportDetail(await window.ALevelApi.getAdminImport(authToken, job.id));
      setImportStatus(t("adminImportUploaded"), false);
      await loadImportAdminData();
    } catch (err) {
      if (currentImportJob?.id) {
        const job = await window.ALevelApi.getAdminImport(authToken, currentImportJob.id).catch(() => null);
        if (job) renderImportJob(job);
      }
      setImportStatus(t("adminImportUploadFailed", { message: err.message }), true);
    } finally {
      button.disabled = false;
      progress.hidden = true;
    }
  });

  byId("adminProcessImport").addEventListener("click", async () => {
    if (!currentImportJob?.id) return;
    const button = byId("adminProcessImport");
    button.disabled = true;
    setImportStatus(t("adminImportQueueingValidation"), false);
    try {
      openImportDetail(await window.ALevelApi.processAdminImport(authToken, currentImportJob.id));
      setImportStatus(t("adminImportValidationQueued"), false);
      await loadImportAdminData();
    } catch (err) {
      const job = await window.ALevelApi.getAdminImport(authToken, currentImportJob.id).catch(() => null);
      if (job) renderImportJob(job);
      setImportStatus(t("adminImportProcessFailed", { message: err.message }), true);
    } finally {
      if (currentImportJob?.status !== "validated") button.disabled = false;
    }
  });

  byId("adminPublishImport").addEventListener("click", async () => {
    if (!currentImportJob?.id || !window.confirm(t("adminImportPublishConfirm"))) return;
    const button = byId("adminPublishImport");
    button.disabled = true;
    setImportStatus(t("adminImportQueueingPublish"), false);
    try {
      openImportDetail(await window.ALevelApi.publishAdminImport(authToken, currentImportJob.id));
      setImportStatus(t("adminImportPublishQueued"), false);
      await loadImportAdminData();
    } catch (err) {
      const job = await window.ALevelApi.getAdminImport(authToken, currentImportJob.id).catch(() => null);
      if (job) renderImportJob(job);
      setImportStatus(t("adminImportPublishFailed", { message: err.message }), true);
    }
  });

  byId("adminRefreshImports").addEventListener("click", loadImportAdminData);
  byId("adminHintLiveToggle").addEventListener("change", async (event) => {
    const toggle = event.currentTarget;
    toggle.disabled = true;
    try {
      await window.ALevelApi.setAdminAiHintSettings(authToken, toggle.checked);
      await loadHintReviewData();
    } catch (error) {
      toggle.checked = !toggle.checked;
      setPanelStatus("adminHintReviewStatus", t("adminHintLiveFailed", { message: error.message }), true);
      toggle.disabled = false;
    }
  });
  byId("adminRunImportWorker").addEventListener("click", async () => {
    const button = byId("adminRunImportWorker");
    button.disabled = true;
    try {
      await window.ALevelApi.dispatchAdminImports(authToken);
      setImportStatus(t("adminImportWorkerDispatched"), false);
    } catch (error) {
      setImportStatus(t("adminImportWorkerFailed", { message: error.message }), true);
    } finally {
      button.disabled = false;
    }
  });
  byId("adminCancelImport").addEventListener("click", async () => {
    if (!currentImportJob?.id || !window.confirm(t("adminCancelImportConfirm"))) return;
    try {
      await window.ALevelApi.cancelAdminImport(authToken, currentImportJob.id);
      renderImportJob(await window.ALevelApi.getAdminImport(authToken, currentImportJob.id));
      await loadImportAdminData();
    } catch (error) {
      setImportStatus(t("adminImportActionFailed", { message: error.message }), true);
    }
  });
  byId("adminHideImportRecord").addEventListener("click", async () => {
    if (!currentImportJob?.id) return;
    try {
      await window.ALevelApi.setAdminImportHidden(authToken, currentImportJob.id, !currentImportJob.hiddenAt);
      currentImportJob.hiddenAt = currentImportJob.hiddenAt ? null : new Date().toISOString();
      renderImportJob(currentImportJob);
      await loadImportAdminData();
    } catch (error) {
      setImportStatus(t("adminImportActionFailed", { message: error.message }), true);
    }
  });
  byId("adminDeleteImport").addEventListener("click", async () => {
    if (!currentImportJob?.id || !window.confirm(t("adminDeleteImportConfirm"))) return;
    try {
      await window.ALevelApi.deleteAdminImport(authToken, currentImportJob.id);
      renderImportJob(null);
      await loadImportAdminData();
    } catch (error) {
      setImportStatus(t("adminImportActionFailed", { message: error.message }), true);
    }
  });
  byId("adminHideImportDetail").addEventListener("click", () => {
    byId("adminDetailDialog").close();
  });
  byId("adminShowHiddenImports").addEventListener("change", loadImportAdminData);
  byId("adminRefreshCommunity").addEventListener("click", refreshCommunity);
  byId("adminReportStatus").addEventListener("change", loadCommunityReports);
  byId("adminDiscussionStatus").addEventListener("change", loadCommunityThreads);
  byId("adminRefreshAudit").addEventListener("click", loadAuditLogs);
  byId("adminExportJson").addEventListener("click", () => exportData("json"));
  byId("adminExportCsv").addEventListener("click", () => exportData("csv"));
  byId("adminCloseDetail").addEventListener("click", () => byId("adminDetailDialog").close());

  async function init() {
    authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!authToken) {
      setStatus(t("adminLoginRequired"), true);
      setTimeout(() => {
        location.href = "./admin-login.html";
      }, 350);
      return;
    }

    try {
      const currentUser = await window.ALevelApi.getCurrentUser(authToken);
      if (currentUser?.role !== "admin") {
        setStatus(t("notAdmin"), true);
        setTimeout(() => {
          location.href = "./admin-login.html";
        }, 500);
        return;
      }
    } catch (_err) {
      setStatus(t("adminSessionInvalid"), true);
      setTimeout(() => {
        location.href = "./admin-login.html";
      }, 500);
      return;
    }

    byId("adminContent").removeAttribute("style");
    byId("adminContent").hidden = false;
    await Promise.all([
      loadRecords(),
      loadImportAdminData(),
      loadHintReviewData(),
      refreshCommunity(),
      loadAuditLogs(),
    ]);
  }

  applyPage();
  init();
})();
