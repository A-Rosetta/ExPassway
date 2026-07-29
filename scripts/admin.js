(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const { t, applyPage, getLanguage } = window.ALevelI18n;
  let authToken = "";
  let currentImportJob = null;

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

  function hintImageUrl(hintSet) {
    const image = hintSet?.question?.images?.[0];
    const url = typeof image === "string" ? image : image?.url || image?.detailUrl || "";
    return url.startsWith("/assets/") && location.pathname.startsWith("/alevel/") ? `/alevel${url}` : url;
  }

  function renderHintSets(rows) {
    const list = byId("adminHintList");
    if (!list) return;
    list.innerHTML = rows?.length ? rows.map((hintSet) => {
      const question = hintSet.question || {};
      const imageUrl = hintImageUrl(hintSet);
      return `
        <article class="admin-hint-card">
          <header>
            <div>
              <strong>${safeText(`${question.paperSlug || hintSet.questionId} · Q${question.questionNo || "-"}`)}</strong>
              <span class="status-pill">${safeText(hintSet.language === "en" ? t("adminHintLanguageEn") : t("adminHintLanguageZh"))}</span>
            </div>
            <small class="mono">${safeText(hintSet.model)}</small>
          </header>
          <div class="admin-hint-question">
            ${imageUrl ? `<img src="${safeText(imageUrl)}" alt="${safeText(question.stem || hintSet.questionId)}" />` : ""}
            <div>
              <p>${safeText(question.stem || "-")}</p>
              <ol type="A">${(question.options || []).map((option) => `<li>${safeText(option)}</li>`).join("")}</ol>
            </div>
          </div>
          <ol class="admin-hint-steps">${(hintSet.hints || []).map((hint) => `<li>${safeText(hint)}</li>`).join("")}</ol>
          ${hintSet.status === "pending_review" ? `
            <div class="actions">
              <button class="btn-primary" type="button" data-hint-review="approved" data-hint-id="${safeText(hintSet.id)}">${safeText(t("adminHintApprove"))}</button>
              <button class="btn-danger" type="button" data-hint-review="rejected" data-hint-id="${safeText(hintSet.id)}">${safeText(t("adminHintReject"))}</button>
            </div>
          ` : ""}
        </article>
      `;
    }).join("") : `<p class="tip">${safeText(t("adminHintNoRows"))}</p>`;

    list.querySelectorAll("[data-hint-review]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          await window.ALevelApi.reviewAdminQuestionHint(
            authToken,
            button.dataset.hintId,
            button.dataset.hintReview
          );
          await loadHintReviewData();
        } catch (err) {
          button.disabled = false;
          byId("adminHintReviewStatus").textContent = t("adminHintReviewFailed", { message: err.message });
          byId("adminHintReviewStatus").className = "tip bad";
        }
      });
    });
  }

  async function loadHintReviewData() {
    const statusEl = byId("adminHintReviewStatus");
    try {
      const [rows, sample] = await Promise.all([
        window.ALevelApi.getAdminQuestionHints(authToken, byId("adminHintStatus").value),
        window.ALevelApi.getAdminQuestionHintSampleStatus(authToken),
      ]);
      statusEl.textContent = t("adminHintProgress", {
        version: sample.version,
        approved: sample.approved,
        expected: sample.expected,
        pending: sample.pendingReview,
        rejected: sample.rejected,
        missing: sample.missing,
        state: t(sample.ready ? "adminHintLiveReady" : "adminHintLiveLocked"),
      });
      statusEl.className = sample.ready ? "tip good" : "tip";
      renderHintSets(rows);
    } catch (err) {
      renderHintSets([]);
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
    }[status];
    return key ? t(key) : status || "-";
  }

  function summaryValue(summary, key) {
    return Number(summary?.[key] || 0);
  }

  function renderImportJob(job) {
    currentImportJob = job || null;
    const detail = byId("adminImportDetail");
    if (!detail) return;
    detail.hidden = !job;
    byId("adminProcessImport").disabled = !job || !["uploading", "failed"].includes(job.status);
    byId("adminPublishImport").disabled = !job || job.status !== "validated";
    if (!job) return;

    const summary = job.summary || {};
    const summaryRows = [
      [t("adminImportStatusLabel"), statusLabel(job.status)],
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
  }

  function renderSubjects(subjects) {
    const select = byId("adminImportSubject");
    if (!select) return;
    const selected = select.value;
    select.innerHTML = (subjects || []).map((subject) => `
      <option value="${safeText(subject.code)}">${safeText(`${subject.code} - ${getLanguage() === "en" ? subject.name : subject.nameZh || subject.name}`)}</option>
    `).join("");
    if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  }

  function renderImportHistory(jobs) {
    const body = byId("adminImportsBody");
    if (!body) return;
    body.innerHTML = jobs?.length
      ? jobs.map((job) => `
          <tr>
            <td>${safeText(fmtDate(job.createdAt))}</td>
            <td>${safeText(`${job.subjectCode} - ${job.subjectName}`)}</td>
            <td><span class="status-pill admin-import-status-${safeText(job.status)}">${safeText(statusLabel(job.status))}</span></td>
            <td>${safeText(job.fileCount)}</td>
            <td><button type="button" class="btn-secondary" data-import-id="${safeText(job.id)}">${safeText(t("adminImportView"))}</button></td>
          </tr>
        `).join("")
      : `<tr><td colspan="5" class="tip">${safeText(t("adminImportNoHistory"))}</td></tr>`;
    body.querySelectorAll("[data-import-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        button.disabled = true;
        try {
          renderImportJob(await window.ALevelApi.getAdminImport(authToken, button.dataset.importId));
          byId("adminImportDetail").scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
          setImportStatus(t("adminImportLoadFailed", { message: err.message }), true);
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  async function loadImportAdminData() {
    try {
      const [subjects, jobs] = await Promise.all([
        window.ALevelApi.getAdminSubjects(authToken),
        window.ALevelApi.getAdminImports(authToken),
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
        <td>${u.role === "admin"
          ? "-"
          : `<button type="button" class="${u.isDisabled ? "btn-secondary" : "btn-danger"}" data-user-status="${safeText(u.id)}" data-disabled="${u.isDisabled ? "1" : "0"}">${u.isDisabled ? t("adminEnableUser") : t("adminDisableUser")}</button>`}
        </td>
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
      renderImportJob(await window.ALevelApi.getAdminImport(authToken, job.id));
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
    setImportStatus(t("adminImportProcessing"), false);
    try {
      renderImportJob(await window.ALevelApi.processAdminImport(authToken, currentImportJob.id));
      setImportStatus(t("adminImportProcessed"), false);
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
    setImportStatus(t("adminImportPublishing"), false);
    try {
      renderImportJob(await window.ALevelApi.publishAdminImport(authToken, currentImportJob.id));
      setImportStatus(t("adminImportPublished"), false);
      await loadImportAdminData();
    } catch (err) {
      const job = await window.ALevelApi.getAdminImport(authToken, currentImportJob.id).catch(() => null);
      if (job) renderImportJob(job);
      setImportStatus(t("adminImportPublishFailed", { message: err.message }), true);
    }
  });

  byId("adminRefreshImports").addEventListener("click", loadImportAdminData);
  byId("adminRefreshHints").addEventListener("click", loadHintReviewData);
  byId("adminHintStatus").addEventListener("change", loadHintReviewData);

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

    await Promise.all([loadRecords(), loadImportAdminData(), loadHintReviewData()]);
  }

  applyPage();
  init();
})();
