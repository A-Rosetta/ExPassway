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
  openSessions: new Set(),
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
function examSeason(value) {
  const normalized = String(value || "").toLowerCase().trim().replace(/[\s/_-]+/g, "");
  if (["m", "march", "februarymarch", "febmarch"].includes(normalized)) return "m";
  if (["s", "summer", "june", "mayjune"].includes(normalized)) return "s";
  if (["w", "winter", "november", "octobernovember", "octnov"].includes(normalized)) return "w";
  return normalized;
}
function seasonLabel(season) {
  return t({ m: "subjectSeasonMarch", s: "subjectSeasonJune", w: "subjectSeasonNovember" }[season] || "subjectSeasonOther", { season });
}
function resourceCategory(resource) {
  const type = String(resource.metadata?.resourceType || resource.kind || "").toLowerCase().replace(/_/g, "-");
  const fileName = resource.metadata?.fileName || resource.id || resource.storageKey || "";
  if (["examiner-report", "er"].includes(type) || /_er(?:\.|$)/i.test(fileName)) return "er";
  if (["grade-threshold", "grade-thresholds", "gt"].includes(type) || /_gt(?:\.|$)/i.test(fileName)) return "gt";
  if (["insert", "in"].includes(type)) return "in";
  if (["source", "source-files"].includes(type)) return "source";
  if (["qp", "ms"].includes(type)) return type;
  return "other";
}
function resourceSession(resource) {
  const paper = state.papers.find((item) => item.slug === resource.paperSlug);
  if (paper) return { year: Number(paper.year), season: examSeason(paper.season) };
  const category = resourceCategory(resource);
  if (category === "other") return null;
  const metadata = resource.metadata || {};
  const match = [metadata.fileName, resource.paperSlug, resource.id, resource.storageKey].map((value) => /(?:^|[/_])(?:\d{4})_([msw])(\d{2})_/i.exec(String(value || ""))).find(Boolean);
  const year = Number(metadata.year || metadata.examYear || (resource.examYearStart === resource.examYearEnd ? resource.examYearStart : 0) || (match ? 2000 + Number(match[2]) : 0));
  const season = examSeason(metadata.season || metadata.examSeason || resource.season || match?.[1]);
  return year > 0 && season ? { year, season } : null;
}
function examSessions() {
  const sessions = new Map(); const additional = [];
  const get = ({ year, season }) => {
    const key = `${year}-${season}`;
    if (!sessions.has(key)) sessions.set(key, { key, year, season, papers: [], resources: [] });
    return sessions.get(key);
  };
  state.papers.forEach((paper) => get({ year: Number(paper.year), season: examSeason(paper.season) }).papers.push(paper));
  state.resources.filter((resource) => !["syllabus", "textbook"].includes(resource.kind)).forEach((resource) => {
    const session = resourceSession(resource);
    if (session) get(session).resources.push(resource); else additional.push(resource);
  });
  const order = { w: 0, s: 1, m: 2 };
  return { sessions: [...sessions.values()].sort((a, b) => b.year - a.year || (order[a.season] ?? 3) - (order[b.season] ?? 3) || a.season.localeCompare(b.season)), additional };
}
function paperHasFile(paper, type) {
  return Boolean(paper[`${type}FileName`] || paper.metadata?.[`${type}StorageKey`]);
}
function resourceBadge(type) {
  const label = { qp: "QP", ms: "MS", er: "ER", gt: "GT", in: "IN", source: "SRC", other: "PDF" }[type] || "PDF";
  const badge = make("span", `session-file-badge session-file-badge--${type}`, label);
  badge.title = t({ qp: "subjectQuestionPaper", ms: "subjectOfficialMarkScheme", er: "subjectExaminerReport", gt: "subjectGradeThreshold", in: "subjectInsert", source: "subjectSourceFiles", other: "subjectResource" }[type] || "subjectResource");
  badge.setAttribute("aria-label", badge.title); return badge;
}
function renderPapers() {
  const target = el("papersView"); target.replaceChildren(); const { sessions, additional } = examSessions();
  const heading = make("div", "paper-archive-heading"); heading.append(make("h2", "", t("subjectExamArchive")), make("p", "subject-muted", t("subjectExamArchiveHelp"))); target.appendChild(heading);
  const years = [...new Set(sessions.map((session) => session.year))];
  if (years.length) {
    const navigation = make("nav", "paper-year-navigation"); navigation.setAttribute("aria-label", t("subjectYear"));
    [["", t("subjectAllYears")], ...years.map((year) => [String(year), String(year)])].forEach(([year, label]) => {
      const button = make("button", "paper-year-chip", label); button.type = "button"; button.dataset.year = year;
      button.addEventListener("click", () => { state.filters.year = year; renderPaperList(); }); navigation.appendChild(button);
    }); target.appendChild(navigation);
  }
  const toolbar = make("div", "paper-toolbar");
  [["season", "subjectSeason", [...new Set(sessions.map((session) => session.season))]], ["paperNumber", "subjectPaperNumber", [1, 2, 3, 4]]].forEach(([key, labelKey, values]) => {
    const label = make("label"); label.appendChild(make("span", "", t(labelKey))); const select = make("select"); select.id = `subjectFilter${key}`;
    select.appendChild(new Option(t("subjectAll"), "")); values.forEach((value) => select.appendChild(new Option(key === "paperNumber" ? t("subjectPaperLabel", { number: value }) : seasonLabel(value), String(value)))); select.value = state.filters[key];
    select.addEventListener("change", () => { state.filters[key] = select.value; renderPaperList(); }); label.appendChild(select); toolbar.appendChild(label);
  }); const container = make("div", "paper-year-list"); container.id = "subjectPaperList"; target.append(toolbar, container); renderPaperList();
  if (additional.length) {
    const resources = make("div", "book-list"); resources.id = "subjectAdditionalResources";
    target.append(make("h2", "additional-resources-heading", t("subjectAdditionalResources")), resources);
    renderResources(null, resources.id, "", "", additional);
  }
}
function renderPaperList() {
  document.querySelectorAll(".paper-year-chip").forEach((button) => { const selected = button.dataset.year === state.filters.year; button.classList.toggle("is-active", selected); button.setAttribute("aria-pressed", String(selected)); });
  const target = el("subjectPaperList"); const { sessions: allSessions } = examSessions();
  const sessions = allSessions.filter((session) => (!state.filters.year || String(session.year) === state.filters.year) && (!state.filters.season || session.season === state.filters.season)).map((session) => {
    if (!state.filters.paperNumber) return session;
    const papers = session.papers.filter((paper) => String(paper.paperNumber) === state.filters.paperNumber);
    return { ...session, papers, resources: session.resources.filter((resource) => !resource.paperSlug || papers.some((paper) => paper.slug === resource.paperSlug)) };
  }).filter((session) => session.papers.length || session.resources.length);
  if (!sessions.length) return empty(target, "subjectPapersEmptyTitle", allSessions.length ? "subjectNoMatchingPapers" : "subjectPapersEmptyBody");
  const years = [...new Set(sessions.map((session) => session.year))];
  target.replaceChildren(...years.map((year) => {
    const section = make("section", "paper-year-group"); const title = make("h2", "paper-year-heading", year); title.id = `subjectPaperYear${year}`; section.setAttribute("aria-labelledby", title.id);
    const grid = make("div", "paper-session-grid"); grid.append(...sessions.filter((session) => session.year === year).map(sessionCard)); section.append(title, grid); return section;
  }));
}
function sessionCard(session) {
  const card = make("details", "paper-session-card"); card.dataset.session = session.key; card.open = state.openSessions.has(session.key);
  card.addEventListener("toggle", () => { if (card.open) state.openSessions.add(session.key); else state.openSessions.delete(session.key); });
  const summary = make("summary", "paper-session-summary"); const mark = make("span", "session-calendar", t({ m: "subjectMonthMarch", s: "subjectMonthJune", w: "subjectMonthNovember" }[session.season] || "subjectSeason")); mark.setAttribute("aria-hidden", "true");
  const text = make("span", "session-summary-text"); text.appendChild(make("span", "session-title", `${seasonLabel(session.season)} ${session.year}`));
  text.appendChild(make("span", "session-count", t(session.papers.length ? "subjectSessionPaperCount" : "subjectSessionResourcesOnly", { papers: session.papers.length, resources: session.resources.length })));
  const badges = make("span", "session-file-badges"); const categories = new Set();
  ["qp", "ms"].forEach((type) => { if (session.papers.some((paper) => paperHasFile(paper, type))) categories.add(type); });
  session.resources.forEach((resource) => categories.add(resourceCategory(resource))); badges.append(...[...categories].map(resourceBadge)); text.appendChild(badges);
  const arrow = make("span", "session-expand"); arrow.setAttribute("aria-hidden", "true"); summary.append(mark, text, arrow); card.appendChild(summary);
  const body = make("div", "paper-session-body");
  const shared = session.resources.filter((resource) => !session.papers.some((paper) => paper.slug === resource.paperSlug));
  if (shared.length) {
    const materials = make("div", "session-materials"); shared.forEach((resource) => {
      const row = make("article", "session-resource-row"); const info = make("div", "session-resource-info"); info.append(resourceBadge(resourceCategory(resource)), make("h4", "", localized(resource))); row.appendChild(info);
      const actions = make("div", "paper-actions"); addResourceActions(actions, resource); row.appendChild(actions); materials.appendChild(row);
    }); body.appendChild(materials);
  }
  session.papers.sort((a, b) => Number(a.paperNumber) - Number(b.paperNumber) || Number(a.variant) - Number(b.variant)).forEach((paper) => body.appendChild(paperRow(paper)));
  card.appendChild(body); return card;
}
function addResourceActions(target, resource) {
  if ((resource.mimeType || resource.contentType) === "application/pdf") {
    const open = make("button", "btn-secondary", t("subjectOpenResource")); open.type = "button"; open.addEventListener("click", () => resourceDownload(resource, open, true)); target.appendChild(open);
  }
  const download = make("button", "btn-secondary", t("subjectDownloadResource")); download.type = "button"; download.addEventListener("click", () => resourceDownload(resource, download)); target.appendChild(download);
}
function paperRow(paper) {
  const card = make("article", "paper-card paper-card--session"); card.appendChild(make("h4", "", `${t("subjectPaperLabel", { number: paper.paperNumber })} · ${t("subjectVariant", { value: paper.variant })}`));
  card.appendChild(make("p", "paper-source-code", paper.slug));
  const metadata = [paper.durationMinutes ? t("subjectMinutes", { count: paper.durationMinutes }) : "", paper.totalMarks ? t("subjectMarks", { count: paper.totalMarks }) : ""].filter(Boolean); if (metadata.length) card.appendChild(make("p", "paper-meta", metadata.join(" · ")));
  const practical = Number(paper.paperNumber) === 4; if (practical) card.appendChild(make("p", "subject-muted", t("subjectPracticalMaterials")));
  const actions = make("div", "paper-actions"); ["qp", "ms"].forEach((type) => {
    if (!paperHasFile(paper, type)) return;
    const href = `${api.getBaseUrl?.() || ""}/api/catalog/papers/${encodeURIComponent(paper.slug)}/download/${type}`;
    const read = make("a", "btn-secondary", t("subjectOpenFile", { type: type.toUpperCase() })); read.href = `${href}?inline=1`; read.target = "_blank"; read.rel = "noopener";
    const link = make("a", "btn-secondary", t("subjectDownloadFile", { type: type.toUpperCase() })); link.href = href; link.target = "_blank"; link.rel = "noopener"; actions.append(read, link);
  });
  const hasQuestions = Number(paper.validQuestionCount) > 0 || state.questions.some((question) => question.paperSlug === paper.slug);
  if (!practical && hasQuestions) { const button = make("button", "btn-primary", t("subjectViewQuestions")); button.type = "button"; button.addEventListener("click", () => openQuestions(paper, button)); actions.appendChild(button); }
  card.appendChild(actions);
  state.resources.filter((resource) => resource.paperSlug === paper.slug).forEach((resource) => {
    const row = make("div", "paper-attachment"); row.appendChild(make("p", "", localized(resource))); const resourceActions = make("div", "paper-actions"); addResourceActions(resourceActions, resource); row.appendChild(resourceActions); card.appendChild(row);
  }); return card;
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
