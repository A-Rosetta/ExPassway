(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const { t, applyPage, getLanguage } = window.ALevelI18n;
  let authToken = "";
  let data = { mappings: [], curriculumSections: [], coursebookSections: [] };

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

  function renderMappings() {
    const list = byId("mappingList");
    if (!data.mappings.length) {
      list.innerHTML = `<section class="card panel"><p class="tip">${safeText(t("noCurriculumMappings"))}</p></section>`;
      return;
    }
    list.innerHTML = data.mappings.map((mapping, index) => {
      const image = (mapping.images || []).map(imageSource).find(Boolean);
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
              <span>${safeText(mapping.year)} · ${safeText(mapping.source)} · ${Number(mapping.confidence || 0).toFixed(2)}</span>
            </div>
            ${image
              ? `<figure class="curriculum-mapping-image"><img src="${safeText(image)}" alt="${safeText(t("questionImageAlt", { number: mapping.questionNo || "" }))}" /></figure>`
              : `<p>${safeText(mapping.stem)}</p>`}
          </div>
          <div class="curriculum-mapping-controls">
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
      bookSelect.addEventListener("change", () => {
        curriculumSelect.innerHTML = syllabusOptions(bookSelect.value, "");
      });
      item.querySelector("[data-review]").addEventListener("click", () => updateMapping(item, mapping, "reviewed"));
      item.querySelector("[data-reject]").addEventListener("click", () => updateMapping(item, mapping, "rejected"));
    });
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
      item.remove();
      setStatus(t(status === "reviewed" ? "mappingApproved" : "mappingRejectedMessage"));
      if (!byId("mappingList").children.length) await loadMappings();
    } catch (error) {
      setStatus(t("mappingUpdateFailed", { message: error.message }), true);
      buttons.forEach((button) => { button.disabled = false; });
    }
  }

  async function loadMappings() {
    setStatus(t("loadingMappings"));
    try {
      data = await window.ALevelApi.getAdminCurriculumMappings(authToken, {
        status: byId("mappingStatus").value,
        limit: 100,
      });
      renderMappings();
      setStatus(t("mappingsLoaded", { count: data.mappings.length }));
    } catch (error) {
      setStatus(t("mappingLoadFailed", { message: error.message }), true);
    }
  }

  async function generateSuggestions() {
    const button = byId("generateSuggestions");
    button.disabled = true;
    setStatus(t("generatingMappings"));
    try {
      const result = await window.ALevelApi.suggestAdminCurriculumMappings(authToken, 300);
      byId("mappingStatus").value = "suggested";
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

  async function init() {
    applyPage();
    authToken = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!authToken) {
      location.href = "./login.html";
      return;
    }
    try {
      const currentUser = await window.ALevelApi.getCurrentUser(authToken);
      if (currentUser.role !== "admin") {
        location.href = "./login.html";
        return;
      }
    } catch (_error) {
      location.href = "./login.html";
      return;
    }
    byId("refreshMappings").addEventListener("click", loadMappings);
    byId("mappingStatus").addEventListener("change", loadMappings);
    byId("generateSuggestions").addEventListener("click", generateSuggestions);
    byId("backAdmin").addEventListener("click", () => { location.href = "./admin.html"; });
    await loadMappings();
  }

  init();
})();
