import {
  CHINA_COMPONENT_SOURCES,
  chinaSubjects,
  getChinaComponentSession,
  groupChinaRows,
} from "./china-components.js";

const subjects = chinaSubjects();
const isZh = () => window.ALevelI18n?.getLanguage?.() === "zh-CN";
const text = (en, zh) => isZh() ? zh : en;
const query = new URLSearchParams(window.location.search);
const pageSubject = query.get("subject");
const knownSubject = subjects.some((subject) => subject.code === pageSubject) ? pageSubject : "";
const state = { code: knownSubject, year: 2026, season: "May/June", thresholdRequest: 0 };

function create(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content != null) node.textContent = content;
  return node;
}

function makeDialog() {
  const dialog = create("dialog", "china-component-dialog");
  dialog.id = "chinaComponentDialog";
  dialog.setAttribute("aria-labelledby", "chinaComponentDialogTitle");
  const shell = create("div", "china-component-dialog__shell");
  const header = create("header", "china-component-dialog__header");
  const heading = create("div");
  heading.append(
    create("p", "home-eyebrow", text("REGISTRATION REFERENCE", "报名参考")),
    create("h2", "", text("China component quick lookup", "中国卷别快查")),
  );
  heading.querySelector("h2").id = "chinaComponentDialogTitle";
  const close = create("button", "profile-dialog__close", "×");
  close.type = "button";
  close.setAttribute("aria-label", text("Close component lookup", "关闭卷别快查"));
  close.addEventListener("click", () => dialog.close());
  header.append(heading, close);

  const intro = create("p", "china-component-dialog__intro");
  intro.id = "chinaComponentDialogIntro";

  const controls = create("div", "china-component-controls");
  const subjectLabel = create("label");
  const subjectLabelText = create("span", "china-component-control-label");
  subjectLabel.appendChild(subjectLabelText);
  const subjectSelect = document.createElement("select");
  subjectSelect.id = "chinaComponentSubject";
  subjectSelect.addEventListener("change", () => { state.code = subjectSelect.value; render(); });
  subjectLabel.appendChild(subjectSelect);

  const yearLabel = create("label");
  const yearLabelText = create("span", "china-component-control-label");
  yearLabel.appendChild(yearLabelText);
  const yearSelect = document.createElement("select");
  yearSelect.id = "chinaComponentYear";
  [2026, 2025, 2024].forEach((year) => {
    const option = create("option", "", String(year));
    option.value = String(year);
    yearSelect.appendChild(option);
  });
  yearSelect.addEventListener("change", () => { state.year = Number(yearSelect.value); render(); });
  yearLabel.appendChild(yearSelect);

  const seasonLabel = create("label");
  const seasonLabelText = create("span", "china-component-control-label");
  seasonLabel.appendChild(seasonLabelText);
  const seasonSelect = document.createElement("select");
  seasonSelect.id = "chinaComponentSeason";
  ["May/June", "February/March", "October/November"].forEach((season) => {
    const option = create("option", "", season);
    option.value = season;
    seasonSelect.appendChild(option);
  });
  seasonSelect.addEventListener("change", () => { state.season = seasonSelect.value; render(); });
  seasonLabel.appendChild(seasonSelect);
  controls.append(subjectLabel, yearLabel, seasonLabel);

  const status = create("p", "china-component-status");
  status.id = "chinaComponentStatus";
  status.setAttribute("role", "status");
  const tableWrap = create("div", "china-component-table-wrap");
  tableWrap.id = "chinaComponentTableWrap";
  const note = create("p", "china-component-note");
  note.id = "chinaComponentNote";
  const sources = create("div", "china-component-sources");
  sources.id = "chinaComponentSources";
  const thresholds = create("section", "china-component-thresholds");
  thresholds.id = "chinaComponentThresholds";
  thresholds.setAttribute("aria-labelledby", "chinaComponentThresholdsTitle");
  const thresholdHeading = create("h3", "", text("China component grade thresholds", "中国组件等级分数线"));
  thresholdHeading.id = "chinaComponentThresholdsTitle";
  const thresholdIntro = create("p", "china-component-threshold-intro");
  thresholdIntro.id = "chinaComponentThresholdIntro";
  const thresholdStatus = create("p", "china-component-threshold-status");
  thresholdStatus.id = "chinaComponentThresholdStatus";
  thresholdStatus.setAttribute("role", "status");
  thresholdStatus.setAttribute("aria-live", "polite");
  const thresholdTables = create("div", "china-component-threshold-tables");
  thresholdTables.id = "chinaComponentThresholdTables";
  thresholdTables.setAttribute("aria-busy", "false");
  const thresholdNotes = create("div", "china-component-threshold-notes");
  thresholdNotes.id = "chinaComponentThresholdNotes";
  const thresholdSources = create("div", "china-component-threshold-sources");
  thresholdSources.id = "chinaComponentThresholdSources";
  thresholds.append(thresholdHeading, thresholdIntro, thresholdStatus, thresholdTables, thresholdNotes, thresholdSources);
  shell.append(header, intro, controls, status, tableWrap, note, thresholds, sources);
  dialog.appendChild(shell);
  document.body.appendChild(dialog);

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); dialog.close(); });
  return dialog;
}

function renderTable(session) {
  const target = document.getElementById("chinaComponentTableWrap");
  target.replaceChildren();
  if (!session) {
    target.appendChild(create("div", "china-component-empty", text(
      "No verified China component mapping is available for this season in this reference.",
      "此季节暂无已核实的中国卷别映射。",
    )));
    return;
  }
  const table = document.createElement("table");
  table.className = "china-component-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  [text("Paper", "试卷"), text("Level", "阶段"), text("Component", "组件"), text("Paper title", "试卷名称")]
    .forEach((label) => headerRow.appendChild(create("th", "", label)));
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  groupChinaRows(session).forEach((row) => {
    const tr = document.createElement("tr");
    [
      `Paper ${row.paper}`,
      row.level,
      row.component,
      isZh() ? row.titleZh : row.title,
    ].forEach((value) => tr.appendChild(create("td", "", value)));
    body.appendChild(tr);
  });
  table.appendChild(body);
  target.appendChild(table);
}

function renderThresholdTable(title, rows) {
  const section = create("section", "china-component-threshold-group");
  section.appendChild(create("h4", "", title));
  const wrap = create("div", "china-component-table-wrap china-component-threshold-table-wrap");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", title);
  const table = document.createElement("table");
  table.className = "china-component-table china-component-threshold-table";
  const head = document.createElement("thead");
  const headerRow = document.createElement("tr");
  [
    text("Component / combination", "组件 / 组合"),
    text("Maximum", "满分"),
    "A*", "A", "B", "C", "D", "E",
  ].forEach((label) => headerRow.appendChild(create("th", "", label)));
  head.appendChild(headerRow);
  table.appendChild(head);
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    const label = row.component || `${row.option ? `${row.option} · ` : ""}${Array.isArray(row.components) ? row.components.join(" + ") : ""}`;
    [label || "—", row.maxMarks ?? "—", ...["A*", "A", "B", "C", "D", "E"].map((grade) => row.grades?.[grade] ?? "—")]
      .forEach((value) => tr.appendChild(create("td", "", String(value))));
    body.appendChild(tr);
  });
  table.appendChild(body);
  wrap.appendChild(table);
  section.appendChild(wrap);
  return section;
}

function renderThresholdSources(data) {
  const target = document.getElementById("chinaComponentThresholdSources");
  target.replaceChildren();
  const sources = [
    data.sourceUrl && { label: text("Official grade threshold PDF", "官方等级分数线 PDF"), url: data.sourceUrl },
    data.sourcePage && { label: text("Source page", "来源页面"), url: data.sourcePage },
  ].filter((source) => source?.url);
  const safeSources = sources.filter((source) => {
    try {
      return ["http:", "https:"].includes(new URL(source.url, window.location.href).protocol);
    } catch {
      return false;
    }
  });
  if (!safeSources.length) return;
  target.appendChild(create("h4", "", text("Threshold source", "分数线来源")));
  const list = create("ul", "china-component-source-list");
  safeSources.forEach((source) => {
    const item = create("li");
    const link = create("a", "", source.label);
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.appendChild(link);
    list.appendChild(item);
  });
  target.appendChild(list);
}

function renderThresholdData(data) {
  const status = document.getElementById("chinaComponentThresholdStatus");
  const tables = document.getElementById("chinaComponentThresholdTables");
  const notes = document.getElementById("chinaComponentThresholdNotes");
  tables.replaceChildren();
  notes.replaceChildren();
  renderThresholdSources(data || {});

  if (!data?.available) {
    status.textContent = text(
      "No verified grade threshold data is available for this subject and examination series.",
      "该科目和考试季暂无已核实的等级分数线数据。",
    );
    return;
  }

  const componentRows = Array.isArray(data.componentThresholds) ? data.componentThresholds : [];
  const optionRows = Array.isArray(data.optionThresholds) ? data.optionThresholds : [];
  if (!componentRows.length && !optionRows.length) {
    status.textContent = text(
      "No threshold rows are available for this examination series.",
      "该考试季暂无可显示的分数线表格。",
    );
    return;
  }

  status.textContent = `${data.year} ${data.season} · ${text("verified threshold data", "已核实的分数线数据")}`;
  if (componentRows.length) {
    tables.appendChild(renderThresholdTable(text("Individual components (raw marks)", "单个组件（原始分）"), componentRows));
  }
  if (optionRows.length) {
    tables.appendChild(renderThresholdTable(text("Examination combinations (weighted marks)", "考试组合（加权分）"), optionRows));
  }
  const localizedNotes = isZh()
    ? [
      data.displayNote && "单个组件分数线按原始分计；考纲组合按加权分计。单个组件和 AS Level 不设 A*。请核对具体组件和评估路线，不应推导通用分数线。",
      data.carryForwardNote && "分阶段组合保留原有 carry-forward 组件代码。没有考生报名选项或 carry-forward 记录支持时，不会自动将其认定为中国大陆组合。",
    ]
    : [data.displayNote, data.carryForwardNote];
  localizedNotes.filter(Boolean).forEach((note) => {
    notes.appendChild(create("p", "", note));
  });
}

async function loadThresholds(code, year, season) {
  const request = ++state.thresholdRequest;
  const target = document.getElementById("chinaComponentThresholdTables");
  const status = document.getElementById("chinaComponentThresholdStatus");
  const notes = document.getElementById("chinaComponentThresholdNotes");
  const sources = document.getElementById("chinaComponentThresholdSources");
  target.replaceChildren();
  target.setAttribute("aria-busy", "true");
  notes.replaceChildren();
  sources.replaceChildren();
  status.textContent = text("Loading verified threshold data…", "正在加载已核实的分数线数据…");
  try {
    const data = await window.ALevelApi?.getChinaComponentThresholds?.(code, year, season);
    if (request !== state.thresholdRequest) return;
    renderThresholdData(data);
  } catch {
    if (request !== state.thresholdRequest) return;
    renderThresholdData(null);
    status.textContent = text(
      "Threshold data could not be loaded. Please try changing the selection again.",
      "无法加载分数线数据。请重新选择科目或考试季后重试。",
    );
  } finally {
    if (request === state.thresholdRequest) target.setAttribute("aria-busy", "false");
  }
}

function renderSources() {
  const target = document.getElementById("chinaComponentSources");
  target.replaceChildren(create("h3", "", text("Sources", "来源")));
  const list = create("ul", "china-component-source-list");
  CHINA_COMPONENT_SOURCES.forEach((source) => {
    const item = create("li");
    const link = create("a", "", isZh() ? source.labelZh : source.label);
    link.href = source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    item.appendChild(link);
    item.appendChild(create("span", "china-component-source-note", isZh() ? source.noteZh : source.note));
    list.appendChild(item);
  });
  target.appendChild(list);
}

function render() {
  document.querySelectorAll("#openChinaComponentGuide").forEach((button) => {
    button.textContent = text("China components", "中国卷别快查");
  });
  const subjectSelect = document.getElementById("chinaComponentSubject");
  const yearSelect = document.getElementById("chinaComponentYear");
  const seasonSelect = document.getElementById("chinaComponentSeason");
  if (!subjectSelect) return;
  subjectSelect.replaceChildren(...subjects.map((subject) => {
    const option = create("option", "", `${subject.code} · ${isZh() ? subject.nameZh : subject.name}`);
    option.value = subject.code;
    return option;
  }));
  if (state.code) subjectSelect.value = state.code;
  state.code = subjectSelect.value;
  yearSelect.value = String(state.year);
  seasonSelect.value = state.season;

  const subject = subjects.find((entry) => entry.code === state.code) || subjects[0];
  const session = getChinaComponentSession(state.code, state.year, state.season);
  document.getElementById("chinaComponentDialogIntro").textContent = text(
    "China mainland entry components for Cambridge International AS & A Level. Confirm the component assigned by your centre before registering.",
    "剑桥国际 AS & A Level 中国大陆报名组件。正式报名之前，请以考点分配的组件为准。",
  );
  document.querySelector("#chinaComponentSubject").previousElementSibling.textContent = text("Subject", "科目");
  document.querySelector("#chinaComponentYear").previousElementSibling.textContent = text("Year", "年份");
  document.querySelector("#chinaComponentSeason").previousElementSibling.textContent = text("Series", "季节");
  document.getElementById("chinaComponentThresholdIntro").textContent = text(
    "Thresholds are grouped by subject, year and examination series. Raw component marks and weighted examination combinations use separate scales.",
    "分数线按科目、年份和考试季查询。单个组件原始分与考试组合加权分使用不同分数尺度。",
  );
  document.getElementById("chinaComponentThresholdsTitle").textContent = text(
    "China component grade thresholds",
    "中国组件等级分数线",
  );
  const status = document.getElementById("chinaComponentStatus");
  status.textContent = session
    ? `${subject.code} · ${isZh() ? subject.nameZh : subject.name} · ${state.year} ${state.season} · ${session.zone}`
    : text("This season is outside the verified May/June reference.", "该季节不在已核实的 May/June 参考范围内。");
  renderTable(session);
  document.getElementById("chinaComponentNote").textContent = session
    ? (isZh() ? session.noticeZh : session.notice)
    : text("Only the displayed May/June mappings are verified in this quick lookup.", "本快查仅核实并显示 May/June 映射。");
  renderSources();
  loadThresholds(state.code, state.year, state.season);
}

function setup() {
  const buttons = [...document.querySelectorAll("#openChinaComponentGuide")];
  if (!buttons.length) return;
  const dialog = makeDialog();
  buttons.forEach((button) => {
    button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", () => {
      const code = button.dataset.subjectCode || knownSubject;
      if (code && subjects.some((subject) => subject.code === code)) state.code = code;
      render();
      dialog.showModal();
    });
  });
  window.addEventListener("alevel:languagechange", render);
  render();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", setup, { once: true });
else setup();
