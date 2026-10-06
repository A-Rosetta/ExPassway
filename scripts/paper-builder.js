import { buildPaperBlueprint, buildBlueprintIssues, compareEquivalentPapers } from "../shared/paper-blueprint.js";
import { createAnswerKeyPdf, createMarkSchemePdf, createQuestionPaperPdf, createPaperZip, createEquivalentPaperZip } from "./paper-export.js";
import { hasStructuredContent, normalizeStructuredDocument, orderedImages, pairedMarkScheme, questionPresentationImages, structuredDisplayBlocks } from "../shared/structured-content.js";

export function isStructuredQuestion(question) {
  return String(question?.questionType ?? question?.question_type ?? "mcq").trim().toLowerCase() === "structured";
}

export function isFullParentQuestion(question) {
  if (!question || question.isChild === true || question.isParent === false) return false;
  const ownId = String(question.id || question.questionId || "");
  for (const key of ["parentQuestionId", "parent_question_id", "parentId", "parent_id"]) {
    if (question[key] != null && String(question[key]).trim() && String(question[key]).trim() !== ownId) return false;
  }
  return true;
}

export function filterFullParentQuestions(questions = []) {
  return questions.filter(isFullParentQuestion);
}

export function normalizeBuilderQuestion(question = {}) {
  if (!isStructuredQuestion(question)) return { ...question };
  const maxMarks = question.maxMarks ?? question.max_marks ?? null;
  const difficulty = String(question.difficulty ?? "").trim();
  return {
    ...question,
    questionType: "structured",
    maxMarks,
    marks: maxMarks,
    answer: null,
    difficulty: !difficulty || ["unmarked", "unknown"].includes(difficulty.toLowerCase()) ? null : difficulty,
    content: normalizeStructuredDocument(question.content),
    markScheme: normalizeStructuredDocument(question.markScheme),
    images: Array.isArray(question.images) ? question.images : [],
  };
}

export function createPaperBuilderState() {
  return {
    items: [], subjectCode: "", title: "", savedId: "", paperCode: "",
    curriculumVersionId: "", buildMode: "manual", buildSeed: "", status: "draft",
    settings: { filters: {}, targetSections: {} }, dirty: false,
  };
}

function basketItem(question) {
  question = normalizeBuilderQuestion(question);
  const reviewed = question.mappingStatus === "reviewed";
  return {
    ...question, id: question.id || question.questionId,
    marks: isStructuredQuestion(question)
      ? question.maxMarks
      : Number.isInteger(question.marks) && question.marks > 0 ? question.marks : 1,
    sectionId: reviewed ? question.sectionId || "" : "",
    sectionCode: reviewed ? question.sectionCode || "" : "",
  };
}

function requireOfficialMarks(item) {
  if (isStructuredQuestion(item) && (!Number.isInteger(item.maxMarks) || item.maxMarks <= 0)) {
    const error = new Error("paperBuilderMissingOfficialMarks");
    error.questionId = item.id || item.questionId || "";
    throw error;
  }
}

export function addBasketItem(state, question) {
  if (!isFullParentQuestion(question)) return false;
  const item = basketItem(question);
  if (state.items.some((current) => current.id === item.id)) return false;
  requireOfficialMarks(item);
  if (state.items.length >= 200) throw new Error("paperBuilderBasketLimit");
  if (state.subjectCode && item.subjectCode !== state.subjectCode) throw new Error("paperBuilderSameSubject");
  state.subjectCode = item.subjectCode;
  state.items.push(item);
  state.dirty = true;
  return true;
}

export function addBasketItems(state, questions) {
  const existing = new Set(state.items.map((item) => item.id));
  const additions = filterFullParentQuestions(questions).filter((question) => {
    const id = question.id || question.questionId;
    if (existing.has(id)) return false;
    existing.add(id);
    return true;
  });
  if (state.items.length + additions.length > 200) throw new Error("paperBuilderBasketLimit");
  const subjectCode = state.subjectCode || additions[0]?.subjectCode;
  if (additions.some((question) => question.subjectCode !== subjectCode)) {
    throw new Error("paperBuilderSameSubject");
  }
  for (const question of additions) requireOfficialMarks(normalizeBuilderQuestion(question));
  for (const question of additions) addBasketItem(state, question);
  return additions.length;
}

export function removeBasketItem(state, id) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0) return;
  state.items.splice(index, 1);
  state.dirty = true;
}

export function moveBasketItem(state, id, position) {
  const index = state.items.findIndex((item) => item.id === id);
  if (index < 0 || position < 0 || position >= state.items.length || index === position) return;
  const [item] = state.items.splice(index, 1);
  state.items.splice(position, 0, item);
  state.dirty = true;
}

export function sortBasketItems(state) {
  state.items.sort((left, right) => (
    String(left.sectionCode || "\uffff").localeCompare(String(right.sectionCode || "\uffff"), undefined, { numeric: true })
  ));
  state.dirty = true;
}

export function serializeSavedPaper(state) {
  return {
    title: state.title, subjectCode: state.subjectCode,
    curriculumVersionId: state.curriculumVersionId, buildMode: state.buildMode,
    buildSeed: state.buildSeed, status: state.status, settings: state.settings,
    items: state.items.map((item) => ({ questionId: item.id, marks: item.marks, sectionId: item.sectionId || "" })),
  };
}

if (typeof window !== "undefined") {
  window.PaperExport = { createAnswerKeyPdf, createMarkSchemePdf, createQuestionPaperPdf, createPaperZip, createEquivalentPaperZip };
  initializePaperBuilder();
}

function initializePaperBuilder() {
  const byId = (id) => document.getElementById(id);
  const api = window.ALevelApi;
  let paper = createPaperBuilderState();
  const view = {
    token: "", subjects: [], subject: null, catalog: null, sections: [],
    results: [], page: 1, pages: 0, total: 0, mode: "manual", busy: false,
    saved: [], equivalent: null, sourcePaper: null, dragId: "", selectedIds: new Set(),
  };
  const filterIds = {
    year: "paperBuilderYear", season: "paperBuilderSeason",
    paperNumber: "paperBuilderPaperNumber", variant: "paperBuilderVariant",
    sectionId: "paperBuilderSection", paperSlug: "paperBuilderSearch",
    questionNo: "paperBuilderQuestionNo",
  };
  const t = (key, vars) => window.ALevelI18n?.t?.(key, vars) || key;
  const isChinese = () => window.ALevelI18n?.getLanguage?.() === "zh-CN";
  const structuredOnly = () => paper.subjectCode === "9618";
  const builderTitle = () => t(structuredOnly() ? "paperBuilderStructuredTitle" : "paperBuilderTitle");
  const localized = (value, en = "titleEn", zh = "titleZh") => isChinese()
    ? value?.[zh] || value?.[en] || "" : value?.[en] || value?.[zh] || "";
  const sectionLabel = (item) => [item.sectionCode, localized(item)].filter(Boolean).join(" ");
  const sourceLabel = (item) => [item.paperSlug, item.questionNo ? "Q" + item.questionNo : ""].filter(Boolean).join(" · ");

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(label, action, disabled = false) {
    const node = element("button", "btn-secondary", label);
    node.type = "button";
    node.disabled = disabled || view.busy;
    node.addEventListener("click", action);
    return node;
  }

  function setStatus(message = "", error = false) {
    byId("paperBuilderStatus").textContent = message;
    byId("paperBuilderStatus").classList.toggle("paper-builder-status-error", error);
  }

  function clearEquivalent() {
    view.equivalent = null;
    view.sourcePaper = null;
    byId("paperBuilderEquivalentPanel").hidden = true;
    byId("paperBuilderComparison").replaceChildren();
    byId("paperBuilderEquivalentDeficits").replaceChildren();
    byId("paperBuilderRelaxEquivalent").hidden = true;
    byId("paperBuilderDownloadPair").hidden = true;
    byId("paperBuilderOpenB").hidden = true;
  }

  function markChanged() {
    paper.dirty = true;
    clearEquivalent();
    byId("paperBuilderPreviewSection").hidden = true;
    renderBasket();
    renderResults();
  }

  async function perform(action) {
    if (view.busy) return;
    view.busy = true;
    document.querySelectorAll("main button, main input, main select").forEach((node) => { node.disabled = true; });
    setStatus(t("paperBuilderLoading"));
    try {
      await action();
    } catch (error) {
      if (error.status === 401) {
        window.location.href = "./login.html";
        return;
      }
      const message = error.message?.startsWith("paperBuilder") ? t(error.message, { questionId: error.questionId }) : error.message;
      setStatus(t("paperBuilderFailed", { message }), true);
    } finally {
      view.busy = false;
      document.querySelectorAll("main button, main input, main select").forEach((node) => { node.disabled = false; });
      renderBasket();
      renderResults();
      renderSections();
      renderSaved();
    }
  }

  function confirmDiscard() {
    return !paper.dirty || window.confirm(t("paperBuilderConfirmDiscard"));
  }

  function setMode(mode) {
    if (mode === "smart" && structuredOnly()) mode = "manual";
    view.mode = mode;
    document.querySelectorAll("[data-panel]").forEach((node) => { node.hidden = node.dataset.panel !== mode; });
    document.querySelectorAll("[data-mode]").forEach((node) => {
      node.classList.toggle("is-active", node.dataset.mode === mode);
      node.setAttribute("aria-selected", String(node.dataset.mode === mode));
    });
    if (mode === "saved") perform(loadSavedList);
  }

  function renderSubjects() {
    for (const id of ["paperBuilderManualSubject", "paperBuilderSubject"]) {
      const select = byId(id);
      select.replaceChildren(new Option(t("paperBuilderChooseSubject"), ""));
      for (const subject of view.subjects) {
        select.add(new Option(localized(subject, "name", "nameZh") + " · " + subject.code, subject.code));
      }
      select.value = paper.subjectCode;
    }
    renderCapabilities();
  }

  function renderCapabilities() {
    const manualOnly = structuredOnly();
    for (const node of document.querySelectorAll("[data-i18n='paperBuilderTitle'], [data-i18n='paperBuilderStructuredTitle']")) {
      node.dataset.i18n = manualOnly ? "paperBuilderStructuredTitle" : "paperBuilderTitle";
      node.textContent = builderTitle();
    }
    for (const node of document.querySelectorAll("[data-i18n='paperBuilderSubtitle'], [data-i18n='paperBuilderStructuredSubtitle']")) {
      node.dataset.i18n = manualOnly ? "paperBuilderStructuredSubtitle" : "paperBuilderSubtitle";
      node.textContent = t(node.dataset.i18n);
    }
    const back = document.querySelector(".paper-builder-heading > a");
    back.href = manualOnly ? "./subject.html?subject=9618" : "./generate.html";
    back.dataset.i18n = manualOnly ? "paperBuilderBackToSubject" : "paperBuilderBack";
    back.textContent = t(back.dataset.i18n);
    byId("paperBuilderModeSmart").hidden = manualOnly;
    byId("paperBuilderEquivalent").hidden = manualOnly;
    if (manualOnly && view.mode === "smart") setMode("manual");
    const paperNumber = byId("paperBuilderPaperNumber");
    const selectedPaper = paperNumber.value;
    paperNumber.replaceChildren(new Option(t("paperBuilderAll"), ""));
    for (const number of manualOnly ? [1, 2, 3] : [1, 2]) paperNumber.add(new Option("Paper " + number, String(number)));
    paperNumber.value = selectedPaper;
    byId("paperBuilderSearch").placeholder = manualOnly ? "9618_s24_qp_11" : "0625_s23_qp_21";
    const notice = byId("paperBuilderStructuredNotice");
    if (notice) {
      notice.hidden = !manualOnly;
      notice.textContent = isChinese()
        ? "9618 仅支持选择完整大题。官方分值不可修改；下载包含试卷和评分方案 PDF。"
        : "9618 selects complete parent questions. Official marks are fixed; downloads contain the question paper and mark scheme PDFs.";
    }
  }

  function renderSectionFilter() {
    const select = byId("paperBuilderSection");
    select.replaceChildren(new Option(t("paperBuilderAllSections"), ""));
    let group = null;
    let chapterId = "";
    for (const section of view.sections) {
      if (section.chapterNo !== chapterId) {
        chapterId = section.chapterNo;
        group = document.createElement("optgroup");
        group.label = t("paperBuilderChapter", { number: section.chapterNo, title: localized(section, "chapterTitleEn", "chapterTitleZh") });
        select.append(group);
      }
      group.append(new Option(sectionLabel(section), section.id));
    }
    select.value = paper.settings.filters?.sectionId || "";
  }

  async function loadSubjectData(code) {
    view.subject = view.subjects.find((subject) => subject.code === code) || null;
    view.catalog = null;
    view.sections = [];
    if (view.subject?.version) {
      try {
        view.catalog = await api.getChapterCatalog(view.token, code, view.subject.version.id);
        view.sections = (view.catalog.chapters || []).flatMap((chapter) => (
          (chapter.sections || []).map((section) => ({
            ...section, chapterNo: chapter.chapterNo,
            chapterTitleEn: chapter.titleEn, chapterTitleZh: chapter.titleZh,
          }))
        ));
      } catch (error) {
        if (error.code !== "CURRICULUM_NOT_FOUND") throw error;
      }
    }
    renderSectionFilter();
    renderSections();
  }

  async function changeSubject(code) {
    if (!code || code === paper.subjectCode) {
      renderSubjects();
      setStatus("");
      return;
    }
    if ((paper.items.length || paper.dirty) && !window.confirm(t("paperBuilderConfirmDiscard"))) {
      renderSubjects();
      setStatus("");
      return;
    }
    paper = createPaperBuilderState();
    paper.subjectCode = code;
    paper.title = builderTitle() + " · " + code;
    clearEquivalent();
    history.replaceState(null, "", window.location.pathname + "?subject=" + encodeURIComponent(code));
    renderDocument();
    renderSubjects();
    await loadSubjectData(code);
    paper.curriculumVersionId = view.catalog?.version?.id || "";
    resetFilters();
    await searchQuestions(1);
    if (!view.catalog) setStatus(t("paperBuilderNoCurriculum"));
  }

  function resetFilters() {
    Object.values(filterIds).forEach((id) => { byId(id).value = ""; });
    paper.settings.filters = {};
  }

  function readFilters() {
    return Object.fromEntries(Object.entries(filterIds).map(([key, id]) => [key, byId(id).value.trim()]));
  }

  async function searchQuestions(page = 1) {
    if (!paper.subjectCode) return;
    const filters = readFilters();
    const result = await api.searchPaperBuilderQuestions(view.token, {
      ...filters, subjectCode: paper.subjectCode, page, pageSize: 20,
    });
    view.results = filterFullParentQuestions((result.items || []).map(normalizeBuilderQuestion));
    view.page = result.page;
    view.pages = result.totalPages;
    view.total = result.total;
    view.selectedIds.clear();
    renderResults();
    setStatus("");
  }

  function imageUrl(image) {
    const value = typeof image === "string" ? image : image?.detailUrl || image?.url || image?.thumbnailUrl;
    if (!value) return "";
    try {
      const url = new URL(value, window.location.origin);
      return ["http:", "https:"].includes(url.protocol) ? url.href : "";
    } catch { return ""; }
  }

  function showImage(source) {
    const dialog = byId("paperBuilderImageDialog");
    const image = byId("paperBuilderImage");
    image.src = source;
    image.alt = t("paperBuilderOpenImage");
    byId("paperBuilderOriginalImage").href = source;
    byId("paperBuilderImageZoom").value = "100";
    image.style.width = "";
    dialog.showModal();
  }

  function appendContent(root, item, compact = false) {
    const fragments = isStructuredQuestion(item) ? questionPresentationImages(item) : item.images || [];
    const images = orderedImages(fragments).map(imageUrl).filter(Boolean);
    if (images.length) {
      for (const source of compact ? images.slice(0, 1) : images) {
        const image = element("img", compact ? "paper-builder-result-image" : "");
        image.src = source;
        image.alt = t("paperBuilderOpenImage");
        image.loading = "lazy";
        image.tabIndex = 0;
        image.setAttribute("role", "button");
        image.addEventListener("click", () => showImage(source));
        image.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); showImage(source); }
        });
        image.addEventListener("error", () => {
          image.replaceWith(element("p", "paper-builder-status-error", t("paperBuilderImageUnavailable")));
        }, { once: true });
        root.append(image);
      }
    }
    if (isStructuredQuestion(item)) {
      if (!images.length) appendStructuredBlocks(root, item.content, compact);
    } else if (!images.length) {
      root.append(element("p", "", item.stem));
      const options = Array.isArray(item.options)
        ? item.options.map((text, index) => [String.fromCharCode(65 + index), text])
        : Object.entries(item.options || {});
      const list = element("div", "paper-builder-options");
      for (const [letter, text] of options) list.append(element("div", "", letter + ". " + text));
      root.append(list);
    }
  }

  function appendStructuredBlocks(root, content, compact = false) {
    const blocks = structuredDisplayBlocks(content);
    for (const block of (compact ? blocks.slice(0, 2) : blocks)) {
      if (block.type === "table") {
        const table = element("table", "paper-builder-structured-table");
        for (const [index, values] of [block.headers, ...(block.rows || [])].filter(Array.isArray).entries()) {
          const row = element("tr");
          for (const value of values) row.append(element(index === 0 && block.headers ? "th" : "td", "", String(value)));
          table.append(row);
        }
        root.append(table);
      } else if (block.type === "image") {
        appendContent(root, { questionType: "mcq", images: [block] }, compact);
      } else if (String(block.text || "").trim()) {
        const node = element(block.type === "code" ? "pre" : "p", "paper-builder-structured-block", block.text);
        if (Number(block.depth) > 0) node.style.marginInlineStart = Math.min(5, Number(block.depth)) * 12 + "px";
        root.append(node);
      }
    }
  }

  function renderBulkControls() {
    const available = view.results.filter((item) => !paper.items.some((current) => current.id === item.id));
    const selectedCount = available.filter((item) => view.selectedIds.has(item.id)).length;
    const all = byId("paperBuilderSelectPage");
    all.checked = available.length > 0 && selectedCount === available.length;
    all.indeterminate = selectedCount > 0 && selectedCount < available.length;
    all.disabled = view.busy || !available.length;
    byId("paperBuilderSelectedCount").textContent = t("paperBuilderBulkCount", { count: selectedCount });
    byId("paperBuilderAddSelected").disabled = view.busy || !selectedCount;
  }

  function renderResults() {
    const root = byId("paperBuilderResults");
    root.replaceChildren();
    byId("paperBuilderManualCount").textContent = t(structuredOnly() ? "paperBuilderStructuredResultCount" : "paperBuilderResultCount", { count: view.total });
    if (!view.results.length) root.append(element("p", "paper-builder-empty", t("paperBuilderNoResults")));
    for (const item of view.results) {
      const inBasket = paper.items.some((current) => current.id === item.id);
      const card = element("article", "paper-builder-result");
      const heading = element("div", "paper-builder-result-heading");
      const selectLabel = element("label", "paper-builder-result-select");
      const checkbox = element("input");
      checkbox.type = "checkbox";
      checkbox.checked = view.selectedIds.has(item.id) && !inBasket;
      checkbox.disabled = view.busy || inBasket;
      checkbox.setAttribute("aria-label", t("paperBuilderSelectQuestion", { question: sourceLabel(item) }));
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) view.selectedIds.add(item.id);
        else view.selectedIds.delete(item.id);
        renderBulkControls();
      });
      selectLabel.append(checkbox, element("strong", "paper-builder-result-title", sourceLabel(item)));
      heading.append(selectLabel);
      heading.append(button(t(inBasket ? "paperBuilderRemove" : "paperBuilderAdd"), () => {
        try {
          if (inBasket) removeBasketItem(paper, item.id);
          else { addBasketItem(paper, item); view.selectedIds.delete(item.id); }
          markChanged();
          setStatus("");
        } catch (error) { setStatus(t(error.message, { questionId: error.questionId }), true); }
      }));
      card.append(heading);
      const chapter = view.sections.find((section) => section.id === item.sectionId);
      const section = item.mappingStatus === "reviewed"
        ? [chapter && t("paperBuilderChapter", { number: chapter.chapterNo, title: localized(chapter, "chapterTitleEn", "chapterTitleZh") }),
          item.sectionCode, localized(item, "sectionTitleEn", "sectionTitleZh")].filter(Boolean).join(" · ")
        : t("paperBuilderPendingReview");
      const tentative = item.mappingConfidence != null && item.mappingConfidence <= 0.2 && item.mappingSource === "rule";
      card.append(element("p", "paper-builder-result-meta", section + (tentative ? " · " + t("paperBuilderChapterNeedsCheck") : "")));
      appendContent(card, item, true);
      const actions = element("div", "paper-builder-result-actions");
      if (!isStructuredQuestion(item)) {
        const answer = element("span", "paper-builder-answer", String.fromCharCode(65 + Number(item.answer)));
        answer.hidden = true;
        const toggle = button(t("paperBuilderShowAnswer"), () => {
          answer.hidden = !answer.hidden;
          toggle.textContent = t(answer.hidden ? "paperBuilderShowAnswer" : "paperBuilderHideAnswer");
        });
        actions.append(toggle, answer);
      } else {
        actions.append(element("span", "tip", (isChinese() ? "官方分值：" : "Official marks: ") + item.maxMarks));
        actions.append(element("span", "tip", t("difficultyFilterLabel") + ": " + (item.difficulty || t("paperBuilderUnlabelled"))));
        const markScheme = element("details", "paper-builder-mark-scheme");
        markScheme.append(element("summary", "", isChinese() ? "查看评分方案" : "View mark scheme"));
        if (hasStructuredContent(item.markScheme)) appendContent(markScheme, { ...item, content: pairedMarkScheme(item.markScheme, item.content), images: [] });
        else markScheme.append(element("p", "paper-builder-status-error", isChinese() ? "缺少评分方案，无法导出。" : "Mark scheme missing; export is unavailable."));
        actions.append(markScheme);
      }
      const details = element("details");
      details.append(element("summary", "", t("paperBuilderProvenance")));
      details.append(element("p", "tip", [
        sourceLabel(item), item.year, item.season?.toUpperCase(),
        item.paperNumber ? "Paper " + item.paperNumber : "", item.variant ? "Variant " + item.variant : "",
      ].filter(Boolean).join(" · ")));
      card.append(actions, details);
      root.append(card);
    }
    byId("paperBuilderPageSummary").textContent = t("paperBuilderPageSummary", {
      page: view.pages ? view.page : 0, pages: view.pages, total: view.total,
    });
    byId("paperBuilderPrevious").disabled = view.busy || view.page <= 1;
    byId("paperBuilderNext").disabled = view.busy || view.page >= view.pages;
    renderBulkControls();
  }

  function selectedTargetTotal() {
    return Object.values(paper.settings.targetSections || {}).reduce((sum, count) => sum + Number(count), 0);
  }

  function renderSections() {
    const root = byId("paperBuilderChapters");
    const opened = new Set([...root.querySelectorAll("details[open]")].map((node) => node.dataset.chapter));
    root.replaceChildren();
    const targets = paper.settings.targetSections || {};
    for (const [index, chapter] of (view.catalog?.chapters || []).entries()) {
      const details = element("details", "paper-builder-chapter");
      details.dataset.chapter = chapter.id;
      details.open = opened.has(chapter.id) || (!opened.size && index === 0);
      details.append(element("summary", "paper-builder-chapter-summary", t("paperBuilderChapter", {
        number: chapter.chapterNo, title: localized(chapter),
      })));
      for (const section of chapter.sections || []) {
        const available = Number(section.progress?.availableQuestions || 0);
        const row = element("div", "paper-builder-section-row");
        row.append(element("strong", "paper-builder-section-name", sectionLabel(section)));
        row.append(element("span", "paper-builder-available", t("paperBuilderAvailable", { count: available })));
        const label = element("label", "paper-builder-section-count");
        label.append(element("span", "", t("paperBuilderTarget")));
        const input = element("input");
        input.type = "number";
        input.min = "0";
        input.max = "20";
        input.value = String(targets[section.id] || 0);
        input.disabled = view.busy;
        input.setAttribute("aria-label", sectionLabel(section));
        input.addEventListener("change", () => {
          const others = selectedTargetTotal() - Number(targets[section.id] || 0);
          const count = Math.max(0, Math.min(20, 80 - others, Number.parseInt(input.value, 10) || 0));
          input.value = String(count);
          paper.settings.targetSections[section.id] = count;
          markChanged();
          byId("paperBuilderTotal").textContent = t("paperBuilderTotal", { count: selectedTargetTotal() });
          byId("generateChapterPaper").disabled = view.busy || selectedTargetTotal() === 0;
        });
        label.append(input);
        row.append(label);
        details.append(row);
      }
      root.append(details);
    }
    if (!view.sections.length) root.append(element("p", "paper-builder-empty", t("paperBuilderNoCurriculum")));
    byId("paperBuilderSubject").disabled = view.busy;
    byId("paperBuilderTotal").textContent = t("paperBuilderTotal", { count: selectedTargetTotal() });
    byId("generateChapterPaper").disabled = view.busy || !view.sections.length || selectedTargetTotal() === 0;
  }

  async function generateSmart() {
    if (structuredOnly()) throw new Error("9618 supports manual selection only.");
    const selections = Object.entries(paper.settings.targetSections).map(([sectionId, target]) => ({
      coursebookSectionId: sectionId,
      count: Number(target) - paper.items.filter((item) => item.sectionId === sectionId).length,
    })).filter((selection) => selection.count > 0);
    if (!selections.length) { setStatus(""); return; }
    const requested = selections.reduce((sum, selection) => sum + selection.count, 0);
    if (paper.items.length + requested > 200) throw new Error("paperBuilderBasketLimit");
    const result = await api.generateChapterPaper(view.token, {
      curriculumVersion: view.catalog.version.id, sections: selections,
      excludeQuestionIds: paper.items.map((item) => item.id),
    });
    const items = (result.groups || []).flatMap((group) => group.questions.map((question) => ({
      ...question, sectionId: group.section.id, sectionCode: group.section.sectionCode,
      sectionTitleEn: group.section.titleEn, sectionTitleZh: group.section.titleZh,
      mappingStatus: "reviewed", marks: 1,
    })));
    for (const item of items) addBasketItem(paper, item);
    paper.buildMode = "smart";
    paper.buildSeed = result.buildSeed || "";
    paper.curriculumVersionId = result.curriculumVersion?.id || view.catalog.version.id;
    markChanged();
    setStatus("");
  }

  function paperIssues(items = paper.items, settings = paper.settings, documentKind = "both") {
    const blueprint = buildPaperBlueprint(items);
    const issues = buildBlueprintIssues(blueprint, { targetSections: settings.targetSections || {} });
    const invalid = items.filter((item) => {
      if (item.active === false || (item.sourceStatus && item.sourceStatus !== "published") || !item.paperSlug || !item.questionNo || !isFullParentQuestion(item)) return true;
      if (isStructuredQuestion(item)) {
        return !Number.isInteger(Number(item.maxMarks)) || Number(item.maxMarks) <= 0
          || (documentKind !== "mark-scheme" && !(item.images || []).some(imageUrl) && !hasStructuredContent(item.content))
          || (documentKind !== "question" && !hasStructuredContent(item.markScheme));
      }
      return !Number.isInteger(Number(item.answer)) || Number(item.answer) < 0 || Number(item.answer) > 3
        || (!questionPresentationImages(item).some(imageUrl) && !String(item.stem || "").trim());
    });
    if (invalid.length) issues.unshift({
      code: "INVALID_QUESTION", blocking: true, questionIds: invalid.map((item) => item.id), details: {},
    });
    return { blueprint, issues };
  }

  function blueprintRow(root, label, value) {
    const row = element("div", "paper-builder-blueprint-row");
    row.append(element("span", "", label), element("strong", "", String(value)));
    root.append(row);
  }

  function renderBlueprint() {
    const root = byId("paperBuilderBlueprintContent");
    root.replaceChildren();
    const { blueprint, issues } = paperIssues();
    blueprintRow(root, t(structuredOnly() ? "paperBuilderStructuredQuestionCount" : "paperBuilderQuestionCount"), blueprint.questionCount);
    blueprintRow(root, t("paperBuilderTotalMarks"), blueprint.totalMarks);
    const durationKnown = paper.items.length && paper.items.every((item) => Number(item.estimatedSeconds) > 0);
    blueprintRow(root, t("paperBuilderEstimated"), durationKnown
      ? t("paperBuilderMinutes", { count: Math.ceil(blueprint.estimatedSeconds / 60) }) : t("paperBuilderUnavailable"));
    if (!structuredOnly() && blueprint.mcqQuestionCount) blueprintRow(root, t("paperBuilderAnswerDistribution"), ["A", "B", "C", "D"].map((letter) => letter + " " + blueprint.answerDistribution[letter]).join(" / "));
    const distribution = (record) => Object.entries(record).map(([key, value]) => key + ": " + value).join(" · ") || "—";
    blueprintRow(root, t("paperBuilderYears"), distribution(blueprint.years));
    blueprintRow(root, t("paperBuilderSources"), Object.values(blueprint.sources).map((source) => source.paperSlug + ": " + source.count).join(" · ") || "—");
    blueprintRow(root, t("paperBuilderProvenanceComplete"), paper.items.filter((item) => item.paperSlug && item.questionNo).length + "/" + paper.items.length);
    if (blueprint.difficulty.coverage >= 0.7) blueprintRow(root, t("paperBuilderDifficulty"), distribution(blueprint.difficulty.distribution));
    for (const section of Object.values(blueprint.sections)) {
      blueprintRow(root, section.code || t("paperBuilderPendingReview"), section.count);
    }
    for (const issue of issues) {
      const details = issue.details;
      const numbers = issue.questionIds.map((id) => paper.items.findIndex((item) => item.id === id) + 1).join(", ");
      let message = "";
      if (issue.code === "SECTION_TARGET_MISSING") message = t("paperBuilderSectionDeficit", {
        section: sectionLabel(view.sections.find((section) => section.id === details.sectionId) || {}) || details.sectionId,
        ...details,
      });
      if (issue.code === "SIMILAR_GROUP_REPEAT") message = t("paperBuilderSimilarWarning", { group: details.sourceGroup, numbers });
      if (issue.code === "SOURCE_CONCENTRATION") message = t("paperBuilderSourceWarning", { source: details.paperSlug, ratio: Math.round(details.ratio * 100), numbers });
      if (issue.code === "ANSWER_DISTRIBUTION_IMBALANCE") message = t("paperBuilderAnswerWarning", { answer: details.answer, ratio: Math.round(details.ratio * 100) });
      if (issue.code === "DIFFICULTY_DATA_INSUFFICIENT") message = t("paperBuilderDifficultyMissing", { ratio: Math.round(details.coverage * 100) });
      if (issue.code === "INVALID_QUESTION") message = t("paperBuilderInvalidQuestion", { numbers });
      const node = element("div", "paper-builder-blueprint-issue" + (issue.blocking ? " is-blocking" : ""), message);
      const affected = issue.questionIds.length ? issue.questionIds : (
        issue.code === "ANSWER_DISTRIBUTION_IMBALANCE"
          ? paper.items.filter((item) => String.fromCharCode(65 + Number(item.answer)) === details.answer).map((item) => item.id) : []
      );
      const id = affected.find((questionId) => paper.items.some((item) => item.id === questionId && item.sectionId));
      if (id && !structuredOnly()) node.append(button(t("paperBuilderReplace"), () => perform(() => replaceQuestion(id))));
      root.append(node);
    }
    return issues.some((issue) => issue.blocking);
  }

  function renderBasket() {
    const root = byId("paperBuilderBasketItems");
    root.replaceChildren();
    let marks = 0;
    for (const [index, item] of paper.items.entries()) {
      marks += item.marks;
      const card = element("article", "paper-builder-basket-item");
      card.draggable = true;
      card.dataset.questionId = item.id;
      card.addEventListener("dragstart", (event) => {
        view.dragId = item.id;
        event.dataTransfer.setData("text/plain", item.id);
        event.dataTransfer.effectAllowed = "move";
      });
      card.addEventListener("dragover", (event) => event.preventDefault());
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        if (!view.busy) { moveBasketItem(paper, view.dragId, index); markChanged(); }
        view.dragId = "";
      });
      card.append(element("div", "paper-builder-basket-item-title", (index + 1) + ". " + sourceLabel(item)));
      card.append(element("div", "paper-builder-basket-item-meta", item.sectionCode || t("paperBuilderPendingReview")));
      const actions = element("div", "paper-builder-basket-actions");
      actions.append(
        button("↑", () => { moveBasketItem(paper, item.id, index - 1); markChanged(); }, index === 0),
        button("↓", () => { moveBasketItem(paper, item.id, index + 1); markChanged(); }, index === paper.items.length - 1),
        button(t("paperBuilderRemove"), () => { removeBasketItem(paper, item.id); markChanged(); })
      );
      if (!structuredOnly()) actions.append(button(t("paperBuilderReplace"), () => perform(() => replaceQuestion(item.id)), !item.sectionId));
      actions.children[0].setAttribute("aria-label", t("paperBuilderUp"));
      actions.children[1].setAttribute("aria-label", t("paperBuilderDown"));
      const label = element(isStructuredQuestion(item) ? "p" : "label", "paper-builder-marks-label", isStructuredQuestion(item)
        ? (isChinese() ? "官方分值：" : "Official marks: ") + item.maxMarks : t("paperBuilderMarks"));
      if (!isStructuredQuestion(item)) {
      const input = element("input");
      input.type = "number";
      input.min = "1";
      input.max = "100";
      input.value = String(item.marks);
      input.disabled = view.busy;
      input.addEventListener("change", () => {
        item.marks = Math.max(1, Math.min(100, Math.trunc(Number(input.value)) || 1));
        markChanged();
      });
      label.append(input);
      }
      card.append(actions, label);
      root.append(card);
    }
    if (!paper.items.length) root.append(element("p", "paper-builder-empty", t("paperBuilderEmptyBasket")));
    byId("paperBuilderBasketSummary").textContent = t(structuredOnly() ? "paperBuilderStructuredBasketSummary" : "paperBuilderBasketSummary", { count: paper.items.length, marks });
    byId("paperBuilderBasketToggle").textContent = t("paperBuilderBasketTitle") + " (" + paper.items.length + ")";
    byId("paperBuilderDirty").hidden = !paper.dirty;
    const blocking = renderBlueprint();
    byId("paperBuilderSave").disabled = view.busy || !paper.subjectCode || !paper.title.trim() || (paper.status === "final" && blocking);
    byId("paperBuilderPreview").disabled = view.busy || !paper.items.length;
    byId("paperBuilderDownload").disabled = view.busy || !paper.items.length || blocking;
    byId("paperBuilderDownloadQuestion").disabled = view.busy || !paper.items.length
      || paperIssues(paper.items, paper.settings, "question").issues.some((issue) => issue.blocking);
    byId("paperBuilderDownloadMarkScheme").disabled = view.busy || !paper.items.length
      || paperIssues(paper.items, paper.settings, "mark-scheme").issues.some((issue) => issue.blocking);
    byId("paperBuilderDownloadQuestion").textContent = isChinese() ? "下载试卷 PDF" : "Download question paper PDF";
    byId("paperBuilderDownloadMarkScheme").textContent = isChinese() ? "下载评分方案 PDF" : "Download mark scheme PDF";
    byId("paperBuilderEquivalent").disabled = view.busy || !paper.savedId || paper.dirty || !paper.items.length || blocking || paper.items.some((item) => !item.sectionId);
    byId("paperBuilderClear").disabled = view.busy || !paper.items.length;
    byId("paperBuilderSort").disabled = view.busy || !paper.items.length;
  }

  async function replaceQuestion(id) {
    if (structuredOnly()) throw new Error("9618 supports manual selection only.");
    const original = paper.items.find((item) => item.id === id);
    if (!original?.sectionId) throw new Error("paperBuilderNeedSection");
    const ids = new Set(paper.items.map((item) => item.id));
    const groups = new Set(paper.items.map((item) => item.sourceGroup).filter(Boolean));
    let candidate = null;
    let page = 1;
    let totalPages = 1;
    do {
      const result = await api.searchPaperBuilderQuestions(view.token, {
        subjectCode: paper.subjectCode, sectionId: original.sectionId, page, pageSize: 50,
      });
      totalPages = result.totalPages;
      const available = result.items.filter((item) => !ids.has(item.id) && (!item.sourceGroup || !groups.has(item.sourceGroup)));
      available.sort((left, right) => (
        Number(right.paperNumber === original.paperNumber) - Number(left.paperNumber === original.paperNumber)
        || Number(left.paperSlug === original.paperSlug) - Number(right.paperSlug === original.paperSlug)
        || Math.abs(Number(left.year) - Number(original.year)) - Math.abs(Number(right.year) - Number(original.year))
      ));
      candidate = available[0];
      if (candidate || page >= result.totalPages) break;
      page += 1;
    } while (page <= totalPages);
    if (!candidate) throw new Error("paperBuilderNoReplacement");
    paper.items[paper.items.findIndex((item) => item.id === id)] = basketItem({ ...candidate, marks: original.marks });
    markChanged();
    setStatus("");
  }

  function renderDocument() {
    byId("paperBuilderPaperTitle").value = paper.title;
    byId("paperBuilderPaperStatus").value = paper.status;
    byId("paperBuilderPaperCode").textContent = paper.paperCode;
  }

  function adoptSaved(saved) {
    paper = {
      ...createPaperBuilderState(), ...saved, savedId: saved.id,
      items: (saved.items || []).map(basketItem),
      settings: { ...saved.settings, filters: saved.settings?.filters || {}, targetSections: saved.settings?.targetSections || {} },
      dirty: false,
    };
    renderDocument();
    history.replaceState(null, "", window.location.pathname + "?paper=" + encodeURIComponent(paper.savedId));
  }

  async function savePaper() {
    const payload = serializeSavedPaper(paper);
    const saved = paper.savedId
      ? await api.updateSavedPaper(view.token, paper.savedId, payload)
      : await api.createSavedPaper(view.token, payload);
    adoptSaved(saved);
    clearEquivalent();
    setStatus(t("paperBuilderSaved"));
  }

  async function openSaved(id) {
    if (!confirmDiscard()) { setStatus(""); return; }
    const saved = await api.getSavedPaper(view.token, id);
    await loadSubjectData(saved.subjectCode);
    adoptSaved(saved);
    renderSubjects();
    renderSectionFilter();
    for (const [key, field] of Object.entries(filterIds)) byId(field).value = paper.settings.filters[key] || "";
    clearEquivalent();
    await searchQuestions(1);
    setMode("manual");
  }

  async function loadSavedList() {
    view.saved = await api.listSavedPapers(view.token);
    renderSaved();
    setStatus("");
  }

  function renderSaved() {
    const root = byId("paperBuilderSavedList");
    root.replaceChildren();
    if (!view.saved.length) root.append(element("p", "paper-builder-empty", t("paperBuilderNoSaved")));
    for (const saved of view.saved) {
      const card = element("article", "paper-builder-saved-item");
      card.append(element("h3", "", saved.title));
      card.append(element("p", "tip", [
        saved.paperCode, saved.subjectCode,
        t(saved.subjectCode === "9618" ? "paperBuilderStructuredBasketSummary" : "paperBuilderBasketSummary", { count: saved.questionCount, marks: saved.totalMarks }),
        t(saved.status === "final" ? "paperBuilderFinal" : "paperBuilderDraft"),
        saved.updatedAt?.slice(0, 10),
      ].filter(Boolean).join(" · ")));
      const actions = element("div", "paper-builder-saved-actions");
      actions.append(
        button(t("paperBuilderOpenSaved"), () => perform(() => openSaved(saved.id))),
        button(t("paperBuilderCopy"), () => perform(async () => {
          if (!confirmDiscard()) { setStatus(""); return; }
          const source = await api.getSavedPaper(view.token, saved.id);
          const copied = await api.createSavedPaper(view.token, {
            ...source, title: source.title.slice(0, 140) + " (" + t("paperBuilderCopy") + ")", status: "draft",
          });
          await loadSubjectData(copied.subjectCode);
          adoptSaved(copied);
          renderSubjects();
          renderSectionFilter();
          for (const [key, field] of Object.entries(filterIds)) byId(field).value = paper.settings.filters[key] || "";
          await searchQuestions(1);
          setMode("manual");
        })),
        button(t("paperBuilderDownload"), () => perform(async () => {
          const source = await api.getSavedPaper(view.token, saved.id);
          await downloadPaper(source);
        })),
        button(t("paperBuilderDelete"), () => perform(async () => {
          if (!window.confirm(t("paperBuilderConfirmDelete"))) { setStatus(""); return; }
          await api.deleteSavedPaper(view.token, saved.id);
          if (paper.savedId === saved.id) {
            paper.savedId = "";
            paper.paperCode = "";
            paper.status = "draft";
            markChanged();
            renderDocument();
            history.replaceState(null, "", window.location.pathname + "?subject=" + paper.subjectCode);
          }
          await loadSavedList();
        }))
      );
      card.append(actions);
      root.append(card);
    }
  }

  function orderedGroups(items) {
    const groups = [];
    for (const item of items) {
      const section = view.sections.find((value) => value.id === item.sectionId);
      const metadata = section || {
        id: item.sectionId, sectionCode: item.sectionCode || "",
        titleEn: item.sectionTitleEn || "", titleZh: item.sectionTitleZh || "",
      };
      if (!groups.length || groups[groups.length - 1].section.id !== metadata.id) groups.push({ section: metadata, questions: [] });
      groups[groups.length - 1].questions.push(item);
    }
    return groups;
  }

  function showPreview() {
    const root = byId("paperBuilderPreviewContent");
    root.replaceChildren();
    for (const [index, item] of paper.items.entries()) {
      const card = element("article", "paper-builder-preview-question");
      card.append(element("h3", "", t("paperBuilderQuestion", { number: index + 1 }) + " [" + item.marks + "]"));
      appendContent(card, item);
      root.append(card);
    }
    byId("paperBuilderPreviewSummary").textContent = paper.title;
    byId("paperBuilderPreviewSection").hidden = false;
    byId("paperBuilderPreviewSection").scrollIntoView({ behavior: "smooth", block: "start" });
    setDrawer(false);
  }

  async function loadImage(source) {
    const response = await fetch(imageUrl(source));
    if (!response.ok) throw new Error(t("paperBuilderImageUnavailable") + " (" + response.status + ")");
    return new Uint8Array(await response.arrayBuffer());
  }

  async function paperPdfs(value, documentKind = "both") {
    const items = value.items || [];
    if (!items.length || paperIssues(items, value.settings || {}, documentKind).issues.some((issue) => issue.blocking)) {
      throw new Error("paperBuilderExportBlocked");
    }
    const subject = view.subjects.find((item) => item.code === value.subjectCode);
    const metadata = {
      paperTitle: value.title, paperCode: value.paperCode,
      subjectName: subject?.name || value.subjectCode, loadImage,
    };
    const groups = orderedGroups(items);
    const questionPdf = documentKind === "mark-scheme" ? null : await createQuestionPaperPdf(groups, metadata);
    const answerPdf = documentKind === "question" ? null : await createAnswerKeyPdf(groups, metadata);
    return { questionPdf, answerPdf };
  }

  function saveArchive(archive, name) {
    const url = URL.createObjectURL(archive);
    const link = element("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadPaper(value = paper) {
    setStatus(t("paperBuilderBuildingPdf"));
    const { questionPdf, answerPdf } = await paperPdfs(value);
    saveArchive(createPaperZip(questionPdf, answerPdf), "ExPassway-" + (value.paperCode || value.subjectCode) + ".zip");
    setStatus(t("paperBuilderDownloadReady", { questions: questionPdf.questionCount, answers: answerPdf.answerCount }));
  }

  async function downloadSinglePdf(documentKind, value = paper) {
    setStatus(t("paperBuilderBuildingPdf"));
    const pdfs = await paperPdfs(value, documentKind);
    const result = documentKind === "question" ? pdfs.questionPdf : pdfs.answerPdf;
    saveArchive(new Blob([result.bytes], { type: "application/pdf" }),
      "ExPassway-" + (value.paperCode || value.subjectCode) + "-" + documentKind + ".pdf");
    setStatus(isChinese() ? "PDF 已生成。" : "PDF generated.");
  }

  async function generateEquivalent(allowSimilarGroups = false) {
    if (structuredOnly()) throw new Error("9618 supports manual selection only.");
    if (!paper.savedId || paper.dirty) throw new Error("paperBuilderSavedFirst");
    clearEquivalent();
    try {
      const equivalent = await api.generateEquivalentPaper(view.token, paper.savedId, { allowSimilarGroups });
      view.sourcePaper = { ...paper, items: paper.items.map((item) => ({ ...item })) };
      view.equivalent = equivalent;
      const comparison = compareEquivalentPapers(paper.items, equivalent.items);
      const root = byId("paperBuilderComparison");
      const matchLabel = (value) => t(value ? "paperBuilderMatch" : "paperBuilderMismatch");
      blueprintRow(root, t("paperBuilderQuestionCount"), matchLabel(comparison.questionCountMatch));
      blueprintRow(root, t("paperBuilderTotalMarks"), matchLabel(comparison.totalMarksMatch));
      blueprintRow(root, t("paperBuilderSectionMatch"), matchLabel(comparison.sectionCountsMatch));
      blueprintRow(root, t("paperBuilderExactOverlap"), comparison.repeatedQuestionIds.length);
      blueprintRow(root, t("paperBuilderSimilarOverlap"), comparison.repeatedSourceGroups.length);
      const durationKnown = [...paper.items, ...equivalent.items].every((item) => Number(item.estimatedSeconds) > 0);
      blueprintRow(root, t("paperBuilderDurationDifference"), durationKnown
        ? t("paperBuilderMinutes", { count: Math.round(comparison.estimatedSecondsDifference / 60) }) : t("paperBuilderUnavailable"));
      const distribution = (record) => Object.entries(record).map(([key, count]) => key + ": " + count).join(" · ") || "—";
      blueprintRow(root, "A " + t("paperBuilderYears"), distribution(comparison.sourceYears));
      blueprintRow(root, "B " + t("paperBuilderYears"), distribution(comparison.equivalentYears));
      if (comparison.sourceDifficulty.coverage >= 0.7 && comparison.equivalentDifficulty.coverage >= 0.7) {
        blueprintRow(root, "A " + t("paperBuilderDifficulty"), distribution(comparison.sourceDifficulty.distribution));
        blueprintRow(root, "B " + t("paperBuilderDifficulty"), distribution(comparison.equivalentDifficulty.distribution));
      }
      byId("paperBuilderDownloadPair").hidden = false;
      byId("paperBuilderOpenB").hidden = false;
      blueprintRow(root, "A", paper.paperCode);
      blueprintRow(root, "B", equivalent.paperCode);
      setStatus(t("paperBuilderEquivalentReady"));
    } catch (error) {
      if (error.code !== "EQUIVALENT_POOL_INSUFFICIENT") throw error;
      for (const deficit of error.payload?.error?.details?.sections || []) {
        byId("paperBuilderEquivalentDeficits").append(element("p", "paper-builder-status-error", t("paperBuilderEquivalentDeficit", {
          ...deficit,
          section: sectionLabel(view.sections.find((section) => section.id === deficit.sectionId) || {}) || deficit.sectionId,
        })));
      }
      byId("paperBuilderRelaxEquivalent").hidden = allowSimilarGroups || paper.items.some((item) => !item.sectionId);
      setStatus(t("paperBuilderNoQuestionPool", { message: error.message }), true);
    }
    byId("paperBuilderEquivalentPanel").hidden = false;
  }

  function setDrawer(open) {
    byId("paperBuilderSidebar").classList.toggle("is-open", open);
    byId("paperBuilderBasketToggle").setAttribute("aria-expanded", String(open));
  }

  function setSidebarTab(blueprint) {
    byId("paperBuilderBasket").hidden = blueprint;
    byId("paperBuilderBlueprint").hidden = !blueprint;
    for (const [id, selected] of [["paperBuilderBasketTab", !blueprint], ["paperBuilderBlueprintTab", blueprint]]) {
      byId(id).classList.toggle("is-active", selected);
      byId(id).setAttribute("aria-selected", String(selected));
    }
  }

  function bindEvents() {
    document.querySelectorAll("[data-mode]").forEach((node) => node.addEventListener("click", () => setMode(node.dataset.mode)));
    for (const id of ["paperBuilderManualSubject", "paperBuilderSubject"]) {
      byId(id).addEventListener("change", (event) => perform(() => changeSubject(event.target.value)));
    }
    for (const id of Object.values(filterIds)) byId(id).addEventListener("change", () => {
      paper.settings.filters = readFilters();
      markChanged();
      perform(() => searchQuestions(1));
    });
    const applySearch = () => {
      const filters = readFilters();
      if (JSON.stringify(filters) !== JSON.stringify(paper.settings.filters)) {
        paper.settings.filters = filters;
        markChanged();
      }
      perform(() => searchQuestions(1));
    };
    byId("paperBuilderSearchButton").addEventListener("click", applySearch);
    byId("paperBuilderSearch").addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); applySearch(); }
    });
    byId("paperBuilderPrevious").addEventListener("click", () => perform(() => searchQuestions(view.page - 1)));
    byId("paperBuilderNext").addEventListener("click", () => perform(() => searchQuestions(view.page + 1)));
    byId("paperBuilderSelectPage").addEventListener("change", (event) => {
      const available = view.results.filter((item) => !paper.items.some((current) => current.id === item.id));
      for (const item of available) {
        if (event.target.checked) view.selectedIds.add(item.id);
        else view.selectedIds.delete(item.id);
      }
      renderResults();
    });
    byId("paperBuilderAddSelected").addEventListener("click", () => {
      try {
        const count = addBasketItems(paper, view.results.filter((item) => view.selectedIds.has(item.id)));
        view.selectedIds.clear();
        if (count) markChanged();
        setStatus(t("paperBuilderBulkAdded", { count }));
      } catch (error) { setStatus(t(error.message, { questionId: error.questionId }), true); }
    });
    byId("generateChapterPaper").addEventListener("click", () => perform(generateSmart));
    byId("paperBuilderSave").addEventListener("click", () => perform(savePaper));
    byId("paperBuilderPreview").addEventListener("click", showPreview);
    byId("paperBuilderClosePreview").addEventListener("click", () => { byId("paperBuilderPreviewSection").hidden = true; });
    byId("paperBuilderDownload").addEventListener("click", () => perform(() => downloadPaper()));
    byId("paperBuilderDownloadQuestion").addEventListener("click", () => perform(() => downloadSinglePdf("question")));
    byId("paperBuilderDownloadMarkScheme").addEventListener("click", () => perform(() => downloadSinglePdf("mark-scheme")));
    byId("paperBuilderEquivalent").addEventListener("click", () => perform(() => generateEquivalent(false)));
    byId("paperBuilderRelaxEquivalent").addEventListener("click", () => perform(() => generateEquivalent(true)));
    byId("paperBuilderDownloadPair").addEventListener("click", () => perform(async () => {
      if (!view.equivalent) return;
      setStatus(t("paperBuilderBuildingPdf"));
      const source = await paperPdfs(view.sourcePaper);
      const equivalent = await paperPdfs(view.equivalent);
      saveArchive(createEquivalentPaperZip(source.questionPdf, source.answerPdf, equivalent.questionPdf, equivalent.answerPdf),
        "ExPassway-" + view.sourcePaper.paperCode + "-AB.zip");
      setStatus("");
    }));
    byId("paperBuilderOpenB").addEventListener("click", () => {
      const id = view.equivalent?.id;
      if (id) perform(() => openSaved(id));
    });
    byId("paperBuilderSort").addEventListener("click", () => { sortBasketItems(paper); markChanged(); });
    byId("paperBuilderClear").addEventListener("click", () => {
      if (window.confirm(t("paperBuilderConfirmClear"))) { paper.items = []; markChanged(); }
    });
    byId("paperBuilderNew").addEventListener("click", () => perform(async () => {
      if (!confirmDiscard()) { setStatus(""); return; }
      const code = paper.subjectCode;
      paper = createPaperBuilderState();
      paper.subjectCode = code;
      paper.curriculumVersionId = view.catalog?.version?.id || "";
      paper.title = builderTitle() + " · " + code;
      clearEquivalent();
      renderDocument();
      resetFilters();
      history.replaceState(null, "", window.location.pathname + "?subject=" + code);
      await searchQuestions(1);
    }));
    byId("paperBuilderPaperTitle").addEventListener("input", (event) => { paper.title = event.target.value; markChanged(); });
    byId("paperBuilderPaperStatus").addEventListener("change", (event) => { paper.status = event.target.value; markChanged(); });
    byId("paperBuilderBasketToggle").addEventListener("click", () => setDrawer(!byId("paperBuilderSidebar").classList.contains("is-open")));
    byId("paperBuilderBasketTab").addEventListener("click", () => setSidebarTab(false));
    byId("paperBuilderBlueprintTab").addEventListener("click", () => setSidebarTab(true));
    byId("paperBuilderImageZoom").addEventListener("input", (event) => {
      const image = byId("paperBuilderImage");
      image.style.width = image.naturalWidth * Number(event.target.value) / 100 + "px";
      image.classList.add("is-zoomed");
    });
    byId("paperBuilderImageDialog").addEventListener("close", () => byId("paperBuilderImage").classList.remove("is-zoomed"));
    window.addEventListener("beforeunload", (event) => {
      if (paper.dirty) { event.preventDefault(); event.returnValue = ""; }
    });
    window.addEventListener("alevel:languagechange", () => {
      renderSubjects(); renderSectionFilter(); renderSections(); renderBasket(); renderResults(); renderSaved();
    });
  }

  async function initialize() {
    view.token = localStorage.getItem("alevel.authToken") || "";
    if (!view.token) { window.location.href = "./login.html"; return; }
    bindEvents();
    for (let year = new Date().getFullYear(); year >= 2000; year -= 1) byId("paperBuilderYear").add(new Option(String(year), String(year)));
    for (const [season, label] of [["m", "Feb/Mar"], ["s", "May/Jun"], ["w", "Oct/Nov"]]) byId("paperBuilderSeason").add(new Option(label, season));
    for (const number of [1, 2]) byId("paperBuilderPaperNumber").add(new Option("Paper " + number, String(number)));
    for (let variant = 1; variant <= 9; variant += 1) byId("paperBuilderVariant").add(new Option(String(variant), String(variant)));
    await perform(async () => {
      await api.getCurrentUser(view.token);
      view.subjects = await api.getPaperBuilderSubjects(view.token);
      renderSubjects();
      const params = new URLSearchParams(window.location.search);
      if (params.get("paper")) { await openSaved(params.get("paper")); return; }
      const requested = params.get("subject");
      const subject = view.subjects.find((item) => item.code === requested) || (requested ? null : view.subjects[0]);
      if (!subject) { setStatus(t("paperBuilderNoSubjects"), true); return; }
      await changeSubject(subject.code);
      const requestedSection = params.get("sectionId");
      if (requestedSection && view.sections.some((section) => section.id === requestedSection)) {
        byId("paperBuilderSection").value = requestedSection;
        paper.settings.filters = readFilters();
        await searchQuestions(1);
      }
    });
  }

  initialize();
}
