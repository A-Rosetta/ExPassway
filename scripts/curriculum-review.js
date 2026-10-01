(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const { t, applyPage, getLanguage } = window.ALevelI18n;
  const PAGE_SIZE = 100;
  let authToken = "";
  let currentOffset = 0;
  let mappingRequestId = 0;
  let data = { mappings: [], curriculumSections: [], coursebookSections: [], years: [], total: 0 };
  const selectedMappings = new Set();

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function localized(item, field) {
    const suffix = getLanguage() === "en" ? "En" : "Zh";
    return item?.[`${field}${suffix}`] || item?.[`${field}En`] || "";
  }

  function setStatus(message, isBad = false) {
    const element = byId("reviewStatus");
    element.textContent = message || "";
    element.className = isBad ? "tip bad" : "tip good";
  }

  function imageSource(image) {
    const raw = typeof image === "string" ? image : image?.detailUrl || image?.url || image?.src || "";
    if (raw.startsWith("/assets/") && location.pathname.startsWith("/alevel/")) {
      return `/alevel${raw}`;
    }
    return raw;
  }

  function syllabusOptions(bookSectionId, selectedId) {
    const bookSection = data.coursebookSections.find((item) => item.id === bookSectionId);
    const allowed = new Set(bookSection?.curriculumSectionIds || []);
    return data.curriculumSections
      .filter((item) => allowed.has(item.id))
      .map((item) => `
        <option value="${safeText(item.id)}" ${item.id === selectedId ? "selected" : ""}>
          ${safeText(item.syllabusCode)} · ${safeText(localized(item, "title"))} · ${safeText(item.coreLevel)}
        </option>
      `).join("");
  }

  function mappingKey(mapping) {
    return `${mapping.questionId}\u0000${mapping.curriculumSectionId}`;
  }

  function updateBulkControls() {
    const eligible = [...byId("mappingList").querySelectorAll("[data-bulk-select]:not(:disabled)")];
    const selectAll = byId("selectAllMappings");
    selectAll.disabled = eligible.length === 0;
    selectAll.checked = eligible.length > 0 && eligible.every((input) => input.checked);
    selectAll.indeterminate = eligible.some((input) => input.checked) && !selectAll.checked;
    byId("selectedMappingsCount").textContent = t("mappingSelectedCount", { count: selectedMappings.size });
    byId("bulkReviewMappings").disabled = selectedMappings.size === 0;
  }

  function renderMappings() {
    const list = byId("mappingList");
    if (!data.mappings.length) {
      list.innerHTML = `<section class="card panel"><p class="tip">${safeText(t("noCurriculumMappings"))}</p></section>`;
    } else {
      list.innerHTML = data.mappings.map((mapping, index) => {
      const image = (mapping.images || []).map(imageSource).find(Boolean);
      const textOptions = !image && Array.isArray(mapping.options)
        ? `<ol type="A">${mapping.options.map((option) => `<li>${safeText(option)}</li>`).join("")}</ol>` : "";
      const bookOptions = data.coursebookSections.map((section) => `
        <option value="${safeText(section.id)}" ${section.id === mapping.coursebookSectionId ? "selected" : ""}>
          ${safeText(section.sectionCode)} · ${safeText(localized(section, "title"))}
        </option>
      `).join("");
      return `
        <article class="curriculum-mapping-item" data-mapping-index="${index}">
          <div class="curriculum-mapping-source">
            <div class="curriculum-mapping-id">
              <strong>${safeText(mapping.paperSlug || mapping.questionId)} · Q${safeText(mapping.questionNo || "-")}</strong>
              <span>${safeText(mapping.year)} · ${safeText(mapping.source)} · ${Number(mapping.confidence || 0).toFixed(2)} · ${safeText(t(mapping.reviewedBy ? "mappingHumanVerified" : "mappingNoHumanReview"))}</span>
            </div>
            ${image
              ? `<figure class="curriculum-mapping-image"><img src="${safeText(image)}" alt="${safeText(t("questionImageAlt", { number: mapping.questionNo || "" }))}" loading="lazy" decoding="async" /></figure>`
              : `<p>${safeText(mapping.stem)}</p>${textOptions}`}
            <p class="tip">${safeText(t("mappingReferenceAnswer"))}: ${safeText(Number.isInteger(mapping.answer) && mapping.answer >= 0 && mapping.answer <= 3 ? "ABCD"[mapping.answer] : "-")}</p>
          </div>
          <div class="curriculum-mapping-controls">
            <label class="mapping-bulk-toggle"><input data-bulk-select type="checkbox" ${mapping.isPrimary && !mapping.reviewedBy && mapping.status !== "rejected" ? "" : "disabled"} />
              <span>${safeText(t("mappingSelectQuestion"))}</span></label>
            <label>${safeText(t("coursebookSectionLabel"))}
              <select data-book-section>${bookOptions}</select>
            </label>
            <label>${safeText(t("syllabusStatementLabel"))}
              <select data-curriculum-section>${syllabusOptions(mapping.coursebookSectionId, mapping.curriculumSectionId)}</select>
            </label>
            <label class="mapping-primary-toggle">
              <input data-primary type="checkbox" ${mapping.isPrimary ? "checked" : ""} />
              <span>${safeText(t("primaryMappingLabel"))}</span>
            </label>
            <div class="actions">
              <button class="btn-primary" type="button" data-review>${safeText(t("approveMapping"))}</button>
              <button class="btn-danger" type="button" data-reject>${safeText(t("rejectMapping"))}</button>
            </div>
          </div>
        </article>
      `;
      }).join("");

      list.querySelectorAll("[data-mapping-index]").forEach((item) => {
        const index = Number(item.dataset.mappingIndex);
        const mapping = data.mappings[index];
        const bookSelect = item.querySelector("[data-book-section]");
        const curriculumSelect = item.querySelector("[data-curriculum-section]");
        const bulkSelect = item.querySelector("[data-bulk-select]");
        const syncEligibility = () => {
          const unchanged = bookSelect.value === mapping.coursebookSectionId
            && curriculumSelect.value === mapping.curriculumSectionId
            && item.querySelector("[data-primary]").checked === mapping.isPrimary;
          bulkSelect.disabled = !unchanged || !mapping.isPrimary || !!mapping.reviewedBy || mapping.status === "rejected";
          if (bulkSelect.disabled) {
            bulkSelect.checked = false;
            selectedMappings.delete(mappingKey(mapping));
          }
          updateBulkControls();
        };
        bookSelect.addEventListener("change", () => {
          curriculumSelect.innerHTML = syllabusOptions(bookSelect.value, "");
          syncEligibility();
        });
        curriculumSelect.addEventListener("change", syncEligibility);
        item.querySelector("[data-primary]").addEventListener("change", syncEligibility);
        bulkSelect.addEventListener("change", () => {
          if (bulkSelect.checked) selectedMappings.add(mappingKey(mapping));
          else selectedMappings.delete(mappingKey(mapping));
          updateBulkControls();
        });
        item.querySelector("[data-review]").addEventListener("click", () => updateMapping(item, mapping, "reviewed"));
        item.querySelector("[data-reject]").addEventListener("click", () => updateMapping(item, mapping, "rejected"));
      });
    }
    const start = data.total ? currentOffset + 1 : 0;
    const end = Math.min(currentOffset + data.mappings.length, data.total);
    byId("mappingPageSummary").textContent = t("mappingPageSummary", {
      start,
      end,
      total: data.total,
    });
    byId("previousMappings").disabled = currentOffset === 0;
    byId("nextMappings").disabled = currentOffset + data.mappings.length >= data.total;
    updateBulkControls();
  }

  function renderYearFilter() {
    const select = byId("mappingYear");
    const current = select.value;
    select.replaceChildren(new Option(t("allYears"), ""));
    data.years.forEach((year) => select.add(new Option(year, year)));
    select.value = data.years.includes(current) ? current : "";
  }

  function renderChapterFilter() {
    const select = byId("mappingChapter");
    const chapters = new Map();
    data.coursebookSections.forEach((section) => {
      if (!chapters.has(section.chapterNo)) {
        chapters.set(section.chapterNo, section.chapterTitleZh || section.chapterTitleEn || "");
      }
    });
    const current = select.value;
    select.innerHTML = `<option value="0">${safeText(t("allChapters"))}</option>`
      + [...chapters.entries()].map(([chapterNo, title]) => `
        <option value="${chapterNo}">${safeText(t("chapterFilterOption", { number: chapterNo, title }))}</option>
      `).join("");
    select.value = [...select.options].some((option) => option.value === current) ? current : "0";
  }

  async function updateMapping(item, mapping, status) {
    const buttons = item.querySelectorAll("button");
    buttons.forEach((button) => { button.disabled = true; });
    try {
      await window.ALevelApi.reviewAdminCurriculumMapping(
        authToken,
        mapping.questionId,
        mapping.curriculumSectionId,
        {
          curriculumSectionId: item.querySelector("[data-curriculum-section]").value,
          coursebookSectionId: item.querySelector("[data-book-section]").value,
          isPrimary: item.querySelector("[data-primary]").checked,
          status,
        }
      );
      selectedMappings.delete(mappingKey(mapping));
      const messageKey = status === "reviewed"
        ? mapping.year === "2024" ? "mappingApprovedReserved" : "mappingApproved"
        : "mappingRejectedMessage";
      setStatus(t(messageKey));
      await loadMappings();
    } catch (error) {
      setStatus(t("mappingUpdateFailed", { message: error.message }), true);
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function loadMappings() {
    const requestId = ++mappingRequestId;
    selectedMappings.clear();
    byId("mappingList").querySelectorAll("[data-bulk-select]").forEach((input) => { input.checked = false; });
    updateBulkControls();
    setStatus(t("loadingMappings"));
    try {
      const nextData = await window.ALevelApi.getAdminCurriculumMappings(authToken, {
        status: byId("mappingStatus").value,
        subjectCode: byId("mappingSubject").value,
        year: byId("mappingYear").value,
        chapter: Number(byId("mappingChapter").value || 0),
        limit: PAGE_SIZE,
        offset: currentOffset,
      });
      if (requestId !== mappingRequestId) return;
      data = nextData;
      renderYearFilter();
      renderChapterFilter();
      renderMappings();
      setStatus(t("mappingsLoaded", { count: data.total }));
    } catch (error) {
      if (requestId !== mappingRequestId) return;
      setStatus(t("mappingLoadFailed", { message: error.message }), true);
    }
  }

  async function generateSuggestions() {
    const button = byId("generateSuggestions");
    button.disabled = true;
    setStatus(t("generatingMappings"));
    try {
      const result = await window.ALevelApi.suggestAdminCurriculumMappings(authToken, 100);
      byId("mappingStatus").value = "suggested";
      currentOffset = 0;
      setStatus(t("mappingSuggestionsGenerated", {
        created: result.created,
        matched: result.matched,
      }));
      await loadMappings();
    } catch (error) {
      setStatus(t("mappingGenerationFailed", { message: error.message }), true);
    } finally {
      button.disabled = false;
    }
  }

  async function bulkReviewMappings() {
    const mappings = data.mappings.filter((mapping) => selectedMappings.has(mappingKey(mapping)))
      .map((mapping) => ({ questionId: mapping.questionId, curriculumSectionId: mapping.curriculumSectionId }));
    if (!mappings.length || !window.confirm(t("mappingBulkConfirm", { count: mappings.length }))) return;
    const button = byId("bulkReviewMappings");
    button.disabled = true;
    setStatus(t("mappingBulkWorking", { count: mappings.length }));
    try {
      const result = await window.ALevelApi.bulkReviewAdminCurriculumMappings(
        authToken, byId("mappingSubject").value, mappings
      );
      await loadMappings();
      setStatus(t("mappingBulkDone", { count: result.updated }));
    } catch (error) {
      setStatus(t("mappingUpdateFailed", { message: error.message }), true);
    } finally {
      updateBulkControls();
    }
  }

  async function init() {
    applyPage();
    authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!authToken) {
      location.href = "./admin-login.html";
      return;
    }
    try {
      const currentUser = await window.ALevelApi.getCurrentUser(authToken);
      if (currentUser.role !== "admin") {
        location.href = "./admin-login.html";
        return;
      }
    } catch (_error) {
      location.href = "./admin-login.html";
      return;
    }
    try {
      const subjects = await window.ALevelApi.getCurriculumSubjects(authToken);
      const select = byId("mappingSubject");
      subjects.forEach((subject) => select.add(new Option(
        `${getLanguage() === "en" ? subject.name : subject.nameZh || subject.name} · ${subject.code}`, subject.code
      )));
      select.value = subjects.some((subject) => subject.code === "0610") ? "0610" : subjects[0]?.code || "";
      if (!select.value) throw new Error(t("noCurriculumMappings"));
    } catch (error) {
      setStatus(t("mappingLoadFailed", { message: error.message }), true);
      return;
    }
    byId("refreshMappings").addEventListener("click", loadMappings);
    ["mappingSubject", "mappingStatus", "mappingYear", "mappingChapter"].forEach((id) => {
      byId(id).addEventListener("change", () => {
        currentOffset = 0;
        if (id === "mappingSubject") {
          byId("mappingYear").value = "";
          byId("mappingChapter").value = "0";
          byId("generateSuggestions").hidden = byId("mappingSubject").value !== "0610";
        }
        loadMappings();
      });
    });
    byId("selectAllMappings").addEventListener("change", (event) => {
      byId("mappingList").querySelectorAll("[data-bulk-select]:not(:disabled)").forEach((input) => {
        input.checked = event.target.checked;
        const mapping = data.mappings[Number(input.closest("[data-mapping-index]").dataset.mappingIndex)];
        if (input.checked) selectedMappings.add(mappingKey(mapping));
        else selectedMappings.delete(mappingKey(mapping));
      });
      updateBulkControls();
    });
    byId("bulkReviewMappings").addEventListener("click", bulkReviewMappings);
    byId("previousMappings").addEventListener("click", () => {
      currentOffset = Math.max(0, currentOffset - PAGE_SIZE);
      loadMappings();
    });
    byId("nextMappings").addEventListener("click", () => {
      currentOffset += PAGE_SIZE;
      loadMappings();
    });
    byId("generateSuggestions").addEventListener("click", generateSuggestions);
    byId("backAdmin").addEventListener("click", () => { location.href = "./admin.html"; });
    await loadMappings();
  }

  init();
})();
