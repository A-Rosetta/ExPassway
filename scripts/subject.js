import { orderedImages, pairedMarkScheme, structuredDisplayBlocks } from "../shared/structured-content.js";

const { getLanguage, setLanguage, t, applyPage } = window.ALevelI18n;
const requestedCode = new URLSearchParams(location.search).get("subject") || "9618";
const subjectCode = /^\d{4}$/.test(requestedCode) ? requestedCode : "9618";
const token = localStorage.getItem("alevel.authToken") || "";
const api = window.ALevelApi;
const el = (id) => document.getElementById(id);
const list = (value) => Array.isArray(value) ? value : [];
const make = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
};
const state = {
  subject: { code: subjectCode, board: "CIE", qualification: "AS & A Level", name: "Computer Science", nameZh: "计算机科学" },
  components: [], resources: [], syllabus: [], syllabusResources: [], textbooks: [], papers: [], questions: [], counts: {}, readiness: {},
  filters: { year: "", season: "", paperNumber: "" }, status: "", statusVars: {}, failed: false, requestId: 0,
};
const localized = (item, fallback = "") => getLanguage() === "zh-CN"
  ? item?.titleZh || item?.nameZh || item?.title || item?.name || fallback
  : item?.title || item?.name || fallback;

function status(key, vars = {}, bad = false) {
  state.status = key; state.statusVars = vars;
  el("subjectStatus").textContent = key ? t(key, vars) : "";
  el("subjectStatus").classList.toggle("bad", bad);
}
function unauthorized(error) {
  if (![401, 403].includes(error?.status)) return false;
  localStorage.removeItem("alevel.authToken"); location.href = "./login.html"; return true;
}
function empty(target, title, body) {
  const box = make("div", "subject-empty");
  box.append(make("h2", "", t(title)), make("p", "", t(body))); target.replaceChildren(box);
}
function url(value) {
  if (!value) return "";
  try { const target = new URL(value, location.href); return ["http:", "https:"].includes(target.protocol) ? target.href : ""; } catch { return ""; }
}
function images(target, values) {
  orderedImages(values).forEach((image, index) => {
    const source = image.url.startsWith("/api/") ? `${api.getBaseUrl?.() || ""}${image.url}` : image.url;
    if (!url(source)) return;
    const figure = make("figure", "question-image"); const img = make("img");
    img.src = url(source); img.loading = "lazy"; img.alt = image.alt || t("subjectImagePage", { page: image.page || index + 1 });
    figure.appendChild(img); if (image.caption) figure.appendChild(make("figcaption", "", image.caption)); target.appendChild(figure);
  });
}
function documentContent(target, content) {
  if (orderedImages(content?.images).length) { images(target, content.images); return; }
  structuredDisplayBlocks(content).forEach((block) => {
    let element;
    if (block.type === "image") { images(target, [block]); return; }
    if (block.type === "table") {
      element = make("div", "content-table-wrap"); const table = make("table", "content-table");
      if (block.caption) table.appendChild(make("caption", "", block.caption));
      if (list(block.headers).length) { const head = make("thead"); const row = make("tr"); block.headers.forEach((cell) => row.appendChild(make("th", "", cell))); head.appendChild(row); table.appendChild(head); }
      const body = make("tbody"); list(block.rows).forEach((cells) => { const row = make("tr"); list(cells).forEach((cell) => row.appendChild(make("td", "", typeof cell === "object" ? cell.text : cell))); body.appendChild(row); });
      table.appendChild(body); element.appendChild(table);
    } else if (["code", "pseudocode"].includes(block.type)) { element = make("pre", "question-code"); element.appendChild(make("code", "", block.text || "")); }
    else element = make("p", "question-content", block.text || "");
    element.style.marginLeft = `${Math.min(8, Number(block.depth) || 0) * 16}px`; target.appendChild(element);
  });
  images(target, content?.images);
}
function questionCard(question, index) {
  const card = make("article", "question-card question-card--full");
  card.appendChild(make("h3", "", t("subjectQuestionNumber", { number: question.questionNo || index + 1 })));
  card.appendChild(make("p", "paper-meta", [question.paperSlug, question.maxMarks ? t("subjectMarks", { count: question.maxMarks }) : ""].filter(Boolean).join(" · ")));
  const content = question.content || {};
  const hasContent = orderedImages(content.images).length || structuredDisplayBlocks(content).length;
  if (hasContent) documentContent(card, content);
  else if (orderedImages(question.images).length) images(card, question.images);
  else if (question.stem) card.appendChild(make("p", "question-content", question.stem));
  const scheme = question.markScheme || {};
  if (Object.keys(scheme).length) {
    const details = make("details", "question-mark-scheme"); details.appendChild(make("summary", "", t("subjectMarkScheme")));
    const body = make("div", "question-mark-scheme__body"); documentContent(body, pairedMarkScheme(scheme, content)); details.appendChild(body); card.appendChild(details);
  } else card.appendChild(make("p", "subject-muted", t("subjectNoMarkScheme")));
  return card;
}
function directory(target, entries, depth = 0) {
  if (depth > 12) return;
  list(entries).forEach((entry) => {
    const details = make("details"); const title = `${entry.code ? `${entry.code} · ` : ""}${localized(entry)}`;
    details.appendChild(make("summary", "", title));
    const children = make("div", "tree-children");
    if (entry.syllabusSectionIds?.length) children.appendChild(make("p", "subject-muted", t("subjectMappedSections", { count: entry.syllabusSectionIds.length })));
    if (list(entry.syllabusSectionIds).length && entry.id) {
      const link = make("a", "btn-secondary", t("subjectSectionQuestions"));
      link.href = `./paper-builder.html?subject=${encodeURIComponent(subjectCode)}&sectionId=${encodeURIComponent(entry.id)}`;
      children.appendChild(link);
    }
    directory(children, entry.children, depth + 1); details.appendChild(children); target.appendChild(details);
  });
}
async function resourceDownload(resource, button, preview = false) {
  const label = button.textContent; button.disabled = true; button.textContent = t("subjectDownloading");
  try {
    const blob = await api.downloadResource(token, resource.id); const blobUrl = URL.createObjectURL(blob); const anchor = make("a");
    if (preview) {
      const dialog = el("questionDialog"); const frame = make("iframe", "resource-preview"); frame.src = blobUrl; frame.title = localized(resource);
      el("questionDialogTitle").textContent = localized(resource); el("questionDialogBody").replaceChildren(frame); dialog.showModal();
      dialog.addEventListener("close", () => URL.revokeObjectURL(blobUrl), { once: true });
    } else {
      anchor.href = blobUrl; anchor.download = resource.metadata?.fileName || `${resource.title || resource.id}${resource.mimeType === "application/pdf" ? ".pdf" : ""}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    }
    status("");
  } catch (error) { if (!unauthorized(error)) status("subjectDownloadFailed", { message: error.message }, true); }
  finally { button.disabled = false; button.textContent = label; }
}
function renderResources(kind, targetId, titleKey, bodyKey, resources = state[kind]) {
  const target = el(targetId); if (!resources.length) return empty(target, titleKey, bodyKey);
  target.replaceChildren(...resources.map((resource) => {
    const card = make("article", "book-card"); card.appendChild(make("h3", "", localized(resource)));
    if (resource.version) card.appendChild(make("p", "book-meta", resource.version));
    if (resource.id) {
      const button = make("button", "btn-secondary", t("subjectDownloadResource")); button.type = "button";
      button.addEventListener("click", () => resourceDownload(resource, button)); card.appendChild(button);
      if (resource.mimeType === "application/pdf" || resource.mimeType?.startsWith("image/") || resource.mimeType === "text/plain") {
        const open = make("button", "btn-secondary", t("subjectOpenResource")); open.type = "button"; open.addEventListener("click", () => resourceDownload(resource, open, true)); card.appendChild(open);
      }
    }
    const entries = resource.metadata?.directory || resource.chapters || resource.metadata?.sections;
    if (entries?.length) { const tree = make("div", "tree resource-directory"); tree.appendChild(make("h4", "", t("subjectDirectory"))); directory(tree, entries); card.appendChild(tree); }
    else card.appendChild(make("p", "subject-muted", t("subjectDirectoryPending")));
    return card;
  }));
}
function renderComponents() {
  const target = el("subjectComponents"); target.replaceChildren(); if (!state.components.length) return;
  target.appendChild(make("h2", "", t("subjectComponents"))); const grid = make("div", "component-grid");
  state.components.forEach((component) => {
    const card = make("article", "component-card"); card.appendChild(make("h3", "", `P${component.paperNumber} · ${localized(component)}`));
    card.appendChild(make("p", "", `${t("subjectMinutes", { count: component.durationMinutes })} · ${t("subjectMarks", { count: component.totalMarks })}`));
    if (component.capabilities?.manualPaperBuilder) card.appendChild(make("p", "subject-muted", t("subjectManualPaperBuilder")));
    card.appendChild(make("p", "subject-muted", t(Number(component.paperNumber) === 4 ? "subjectPracticalMaterials" : "subjectStructuredPaper"))); grid.appendChild(card);
  }); target.appendChild(grid);
}
function renderReadiness() {
  el("subjectReadiness").replaceChildren(...[["syllabus", "subjectSyllabus"], ["textbooks", "subjectTextbooks"], ["papers", "subjectPapers"]].map(([key, label]) => {
    const count = Number(state.counts[key] ?? state[key].length) || 0; const item = make("div", `readiness-item${count ? " is-ready" : ""}`);
    item.append(make("strong", "", count), make("span", "", t(label))); return item;
  }));
}
function renderPapers() {
  const target = el("papersView"); target.replaceChildren(); const toolbar = make("div", "paper-toolbar");
  [["year", "subjectYear", [...new Set(state.papers.map((paper) => paper.year))].sort((a, b) => b - a)], ["season", "subjectSeason", [...new Set(state.papers.map((paper) => paper.season))].sort()], ["paperNumber", "subjectPaperNumber", [1, 2, 3, 4]]].forEach(([key, labelKey, values]) => {
    const label = make("label"); label.appendChild(make("span", "", t(labelKey))); const select = make("select"); select.id = `subjectFilter${key}`;
    select.appendChild(new Option(t("subjectAll"), "")); values.forEach((value) => select.appendChild(new Option(key === "paperNumber" ? `P${value}` : String(value), String(value)))); select.value = state.filters[key];
    select.addEventListener("change", () => { state.filters[key] = select.value; renderPaperList(); }); label.appendChild(select); toolbar.appendChild(label);
  }); const container = make("div", "paper-list"); container.id = "subjectPaperList"; target.append(toolbar, container); renderPaperList();
  const attachments = state.resources.filter((resource) => !["syllabus", "textbook"].includes(resource.kind)
    && !state.papers.some((paper) => paper.slug === resource.paperSlug));
  if (attachments.length) {
    const resources = make("div", "book-list"); resources.id = "subjectAdditionalResources";
    target.append(make("h2", "", t("subjectAdditionalResources")), resources);
    renderResources(null, resources.id, "", "", attachments);
  }
}
function renderPaperList() {
  const target = el("subjectPaperList"); const papers = state.papers.filter((paper) => Object.entries(state.filters).every(([key, value]) => !value || String(paper[key]) === value));
  if (!papers.length) return empty(target, "subjectPapersEmptyTitle", state.papers.length ? "subjectNoMatchingPapers" : "subjectPapersEmptyBody");
  target.replaceChildren(...papers.map((paper) => {
    const card = make("article", "paper-card"); card.appendChild(make("h3", "", paper.slug));
    card.appendChild(make("p", "paper-meta", `${paper.year} · ${paper.season} · P${paper.paperNumber} · ${t("subjectVariant", { value: paper.variant })}`));
    const practical = Number(paper.paperNumber) === 4; if (practical) card.appendChild(make("p", "subject-muted", t("subjectPracticalMaterials")));
    const actions = make("div", "paper-actions"); ["qp", "ms"].forEach((type) => {
      if (!paper[`${type}FileName`] && !paper.metadata?.[`${type}StorageKey`]) return;
      const link = make("a", "btn-secondary", t(type === "qp" ? "downloadQuestionPdf" : "downloadAnswerPdf")); link.href = `${api.getBaseUrl?.() || ""}/api/catalog/papers/${encodeURIComponent(paper.slug)}/download/${type}`; link.target = "_blank"; link.rel = "noopener"; actions.appendChild(link);
      const read = make("a", "btn-secondary", `${t("subjectOpenResource")} ${type.toUpperCase()}`); read.href = `${link.href}?inline=1`; read.target = "_blank"; read.rel = "noopener"; actions.appendChild(read);
    });
    state.resources.filter((resource) => resource.paperSlug === paper.slug).forEach((resource) => { const button = make("button", "btn-secondary", localized(resource)); button.type = "button"; button.addEventListener("click", () => resourceDownload(resource, button)); actions.appendChild(button); });
    const hasQuestions = Number(paper.validQuestionCount) > 0 || state.questions.some((question) => question.paperSlug === paper.slug);
    if (!practical && hasQuestions) { const button = make("button", "btn-primary", t("subjectViewQuestions")); button.type = "button"; button.addEventListener("click", () => openQuestions(paper, button)); actions.appendChild(button); }
    card.appendChild(actions); return card;
  }));
}
async function openQuestions(paper, button) {
  const dialog = el("questionDialog"); const body = el("questionDialogBody"); const requestId = ++state.requestId;
  el("questionDialogTitle").textContent = paper.slug; body.textContent = t("subjectLoadingQuestions"); dialog.showModal(); button.disabled = true;
  try { const questions = list(await api.getCatalogPaperQuestions(paper.slug)); if (requestId !== state.requestId) return;
    if (!questions.length) empty(body, "subjectQuestionsEmptyTitle", "subjectQuestionsEmptyBody"); else body.replaceChildren(...questions.map(questionCard));
  } catch (error) { if (!unauthorized(error) && requestId === state.requestId) body.textContent = t("subjectQuestionsLoadFailed"); }
  finally { button.disabled = false; }
}
function renderAll() {
  applyPage(); const name = localized(state.subject); el("subjectTitle").textContent = name;
  el("subjectEyebrow").textContent = `${state.subject.board} · ${state.subject.qualification} · ${subjectCode}`;
  el("subjectSubtitle").textContent = t("subjectHubSubtitle", { subject: name, code: subjectCode }); document.title = `${name} · ${t("subjectHubTitle")}`;
  const builderReady = state.readiness.manualPaperBuilder === true && state.questions.some((question) => !/_qp_4[1-9]$/.test(question.paperSlug || ""));
  const builder = el("subjectBuilder"); builder.classList.toggle("is-disabled", !builderReady); builder.setAttribute("aria-disabled", String(!builderReady));
  if (builderReady) builder.href = `./paper-builder.html?subject=${encodeURIComponent(subjectCode)}`; else builder.removeAttribute("href");
  builder.title = t(builderReady ? "subjectBuilder" : "subjectBuilderPending"); el("subjectLanguage").textContent = getLanguage() === "en" ? "中文" : "EN";
  renderReadiness(); renderComponents(); renderResources("syllabusResources", "syllabusView", "subjectSyllabusEmptyTitle", "subjectSyllabusEmptyBody"); renderResources("textbooks", "textbooksView", "subjectTextbooksEmptyTitle", "subjectTextbooksEmptyBody"); renderPapers();
  if (!state.questions.length) empty(el("questionsView"), "subjectQuestionsEmptyTitle", "subjectQuestionsEmptyBody"); else el("questionsView").replaceChildren(...state.questions.map(questionCard));
  status(state.status, state.statusVars, state.failed);
}
function setup() {
  document.querySelectorAll(".subject-tab").forEach((tab, index) => {
    tab.type = "button"; tab.tabIndex = index ? -1 : 0; tab.id = `${tab.dataset.view}Tab`; tab.setAttribute("aria-controls", `${tab.dataset.view}View`); el(`${tab.dataset.view}View`).setAttribute("aria-labelledby", tab.id);
    tab.addEventListener("click", () => { document.querySelectorAll(".subject-tab").forEach((item) => { item.classList.toggle("is-active", item === tab); item.setAttribute("aria-selected", String(item === tab)); item.tabIndex = item === tab ? 0 : -1; }); document.querySelectorAll(".subject-view").forEach((panel) => { panel.hidden = panel.id !== `${tab.dataset.view}View`; }); });
    tab.addEventListener("keydown", (event) => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const tabs = [...document.querySelectorAll(".subject-tab")]; const current = tabs.indexOf(tab); const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length; tabs[next].click(); tabs[next].focus(); });
  });
  el("subjectLanguage").addEventListener("click", () => { setLanguage(getLanguage() === "en" ? "zh-CN" : "en"); renderAll(); });
  el("closeQuestion").addEventListener("click", () => el("questionDialog").close()); el("questionDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
}
async function init() {
  if (!token) { location.href = "./login.html"; return; } setup(); status("subjectLoading"); renderAll();
  try {
    await api.getCurrentUser(token); const data = await api.getCatalogSubjectOverview(subjectCode, token); state.subject = { ...state.subject, ...data.subject };
    state.components = list(data.components); state.resources = list(data.resources); state.syllabus = list(data.syllabus); state.syllabusResources = list(data.syllabusResources).length ? data.syllabusResources : state.resources.filter((resource) => resource.kind === "syllabus"); state.textbooks = list(data.textbooks).length ? data.textbooks : state.resources.filter((resource) => resource.kind === "textbook"); state.readiness = data.readiness || {};
    state.questions = list(data.questions); state.counts = data.counts || {}; state.papers = list(data.papers); if (!state.papers.length) state.papers = list(await api.getCatalogPapers(subjectCode)); status("");
  } catch (error) { if (unauthorized(error)) return; state.failed = true; status("subjectLoadFailed", { message: error.message }, true); }
  renderAll();
}
init();
