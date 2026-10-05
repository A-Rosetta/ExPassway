import { orderedImages, pairedMarkScheme, structuredDisplayBlocks } from "../shared/structured-content.js";
import { STRUCTURED_ANSWER_MAX_LENGTH, STRUCTURED_ANSWER_TOTAL_MAX_LENGTH, structuredAnswerParts } from "../shared/structured-practice.js";

const { getLanguage, setLanguage, t, applyPage } = window.ALevelI18n;
const api = window.ALevelApi;
const token = localStorage.getItem("alevel.authToken") || "";
const paperSlug = new URLSearchParams(location.search).get("paper") || "";
const byId = (id) => document.getElementById(id);
const list = (value) => Array.isArray(value) ? value : [];
const node = (tag, className = "", text = null) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text != null) element.textContent = String(text);
  return element;
};
const state = { paper: null, questions: [], responses: new Map(), currentId: "", openId: "", draftKey: "", draftFailed: false, statusKey: "structuredPracticeLoading", statusError: false };
const answerParts = (question) => structuredAnswerParts(question);
const answersFor = (question) => answerParts(question).map(({ partId }) => ({ partId, text: state.responses.get(question.id)?.answers?.[partId] || "" }));
const fingerprint = (answers) => JSON.stringify(answers);
const matchingGrade = (question) => {
  const response = state.responses.get(question.id);
  return response?.grade && response.gradeFingerprint === fingerprint(answersFor(question)) ? response.grade : null;
};

function requireLogin(error) {
  if (error?.status !== 401) return false;
  window.ALevelChatSession?.clear();
  localStorage.removeItem("alevel.authToken"); location.href = "./login.html"; return true;
}
function persistDraft() {
  if (!state.draftKey) return;
  const responses = Object.fromEntries([...state.responses].map(([id, response]) => [id, {
    answers: response.answers, request: response.request, stale: response.stale,
  }]));
  try { localStorage.setItem(state.draftKey, JSON.stringify({ version: 1, responses })); state.draftFailed = false; }
  catch { state.draftFailed = true; }
  byId("practiceDraftStatus").textContent = t(state.draftFailed ? "structuredPracticeDraftUnavailable" : "structuredPracticeDraftSaved");
}
function restoreResponses(attempts) {
  let stored = {};
  try {
    const draft = JSON.parse(localStorage.getItem(state.draftKey) || "null");
    if (draft?.version === 1 && draft.responses && typeof draft.responses === "object") stored = draft.responses;
  } catch { /* A damaged local draft must not prevent opening a published paper. */ }
  const latest = new Map(list(attempts).map((attempt) => [attempt.questionId, attempt]));
  state.questions.forEach((question) => {
    const previous = stored[question.id]; const attempt = latest.get(question.id);
    const sourceAnswers = previous?.answers && typeof previous.answers === "object" ? previous.answers : Object.fromEntries(list(attempt?.answers).map(({ partId, text }) => [partId, text]));
    const answers = Object.fromEntries(answerParts(question).map(({ partId }) => [partId, typeof sourceAnswers[partId] === "string" ? sourceAnswers[partId].slice(0, STRUCTURED_ANSWER_MAX_LENGTH) : ""]));
    const response = { answers, grade: null, gradeFingerprint: "", request: previous?.request || null, stale: Boolean(previous?.stale), pending: false, error: null };
    state.responses.set(question.id, response);
    const attemptAnswers = answerParts(question).map(({ partId }) => ({ partId, text: list(attempt?.answers).find((answer) => answer.partId === partId)?.text || "" }));
    if (attempt && fingerprint(attemptAnswers) === fingerprint(answersFor(question))) {
      response.grade = attempt; response.gradeFingerprint = fingerprint(attemptAnswers); response.stale = false; response.request = null;
    }
  });
}
function renderImages(target, images) {
  orderedImages(images).forEach((image, index) => {
    const source = image.url.startsWith("/api/") ? `${api.getBaseUrl?.() || ""}${image.url}` : image.url;
    let url;
    try { url = new URL(source, location.href); if (!["http:", "https:"].includes(url.protocol)) return; } catch { return; }
    const figure = node("figure", "practice-image"); const img = node("img");
    img.src = url.href; img.loading = "lazy"; img.alt = image.alt || t("subjectImagePage", { page: image.page || index + 1 });
    figure.appendChild(img);
    if (image.caption) figure.appendChild(node("figcaption", "", image.caption));
    target.appendChild(figure);
  });
}
function renderBlocks(target, blocks) {
  list(blocks).forEach((block) => {
    if (block.type === "image") { renderImages(target, [block]); return; }
    if (block.type === "table") {
      const wrap = node("div", "practice-table-wrap"); const table = node("table", "practice-table");
      if (block.caption) table.appendChild(node("caption", "", block.caption));
      if (list(block.headers).length) { const head = node("thead"); const row = node("tr"); block.headers.forEach((cell) => row.appendChild(node("th", "", cell))); head.appendChild(row); table.appendChild(head); }
      const body = node("tbody"); list(block.rows).forEach((cells) => { const row = node("tr"); list(cells).forEach((cell) => row.appendChild(node("td", "", typeof cell === "object" ? cell.text : cell))); body.appendChild(row); });
      table.appendChild(body); wrap.appendChild(table); target.appendChild(wrap); return;
    }
    if (["code", "pseudocode"].includes(block.type)) { const pre = node("pre", "practice-content-code"); pre.appendChild(node("code", "", block.text || "")); target.appendChild(pre); }
    else if (block.text) target.appendChild(node("p", "practice-content-text", block.text));
  });
}
function renderDocument(target, content) {
  if (orderedImages(content?.images).length) renderImages(target, content.images);
  else renderBlocks(target, structuredDisplayBlocks(content));
}
function renderPaperSummary() {
  const grades = state.questions.map((question) => matchingGrade(question)).filter(Boolean);
  const maxMarks = Number(state.paper?.totalMarks) || state.questions.reduce((sum, question) => sum + Number(question.maxMarks || 0), 0);
  const earned = grades.reduce((sum, grade) => sum + Number(grade.earnedMarks || 0), 0);
  const markedMax = grades.reduce((sum, grade) => sum + Number(grade.maxMarks || 0), 0);
  byId("practiceScoreSummary").replaceChildren(node("p", "practice-score-label", t("structuredPracticeScoreLabel")), node("strong", "", `${earned} / ${maxMarks}`), node("p", "practice-muted", t("structuredPracticeScoreProgress", { count: grades.length, total: state.questions.length, marks: markedMax })));
}
function gradeErrorText(error) {
  if (error?.code === "AI_GRADING_RATE_LIMITED") return t("aiCallCooldown", { seconds: error.retryAfterSeconds || 30 });
  const key = {
    GRADING_IN_PROGRESS: "structuredPracticeGradePending", GRADING_REQUEST_CONFLICT: "structuredPracticeGradeConflict",
    AI_GRADING_NOT_CONFIGURED: "structuredPracticeGradeUnavailable", AI_GRADING_RATE_LIMITED: "structuredPracticeGradeRateLimited",
    AI_GRADING_TIMEOUT: "structuredPracticeGradeFailed", AI_GRADING_UNAVAILABLE: "structuredPracticeGradeFailed", AI_GRADING_INVALID_RESULT: "structuredPracticeGradeFailed", AI_GRADING_INTERRUPTED: "structuredPracticeGradeFailed",
    REQUEST_TIMEOUT: "structuredPracticeNetworkUnknown", MARK_SCHEME_UNAVAILABLE: "structuredPracticeMarkSchemeMissing", GRADING_CONTENT_INVALID: "structuredPracticeContentUnavailable",
    GRADING_ASSET_INVALID: "structuredPracticeContentUnavailable", GRADING_ASSET_UNAVAILABLE: "structuredPracticeContentUnavailable", GRADING_ASSET_TOO_LARGE: "structuredPracticeContentUnavailable",
    LOCAL_ANSWER_TOO_LONG: "structuredPracticeAnswerTooLong",
  }[error?.code] || (error?.status === 403 ? "structuredPracticeAccessDenied" : "structuredPracticeNetworkUnknown");
  return t(key);
}
function renderQuestionResult(question) {
  const response = state.responses.get(question.id); const card = [...document.querySelectorAll(".practice-question")].find((item) => item.dataset.questionId === question.id);
  if (!card) return;
  const grade = matchingGrade(question); const result = card.querySelector(".practice-grade-result"); result.replaceChildren();
  const button = card.querySelector("[data-grade-question]"); button.disabled = response.pending;
  button.textContent = t(response.pending ? "structuredPracticeGrading" : grade ? "structuredPracticeGradeAgain" : response.error ? "structuredPracticeRetryGrade" : "structuredPracticeGradeQuestion");
  card.querySelector(".practice-question-error").textContent = response.error ? gradeErrorText(response.error) : "";
  card.querySelector(".practice-grade-stale").textContent = response.stale && !grade ? t("structuredPracticeGradeStale") : "";
  const summaryScore = card.querySelector(".practice-question-summary-score"); summaryScore.hidden = !grade; summaryScore.textContent = grade ? `${grade.earnedMarks} / ${grade.maxMarks}` : "";
  if (grade) {
    result.appendChild(node("h3", "", `${t("structuredPracticeScoreLabel")} · ${grade.earnedMarks} / ${grade.maxMarks}`));
    if (grade.model === null) result.appendChild(node("p", "practice-grade-feedback", t("structuredPracticeUnanswered")));
    else if (grade.feedback) result.appendChild(node("p", "practice-grade-feedback", grade.feedback));
    list(grade.parts).forEach((part) => {
      const section = node("section", "practice-part-feedback"); section.appendChild(node("h4", "", `${part.label || t("structuredPracticeWholeQuestion")} · ${part.earnedMarks} / ${part.maxMarks}`));
      if (part.feedback) section.appendChild(node("p", "practice-grade-feedback", part.feedback)); result.appendChild(section);
    });
  }
  renderPaperSummary();
}
function updateAnswer(question, partId, value) {
  const response = state.responses.get(question.id); const changed = response.answers[partId] !== value;
  if (!changed) return;
  response.answers[partId] = value; response.stale ||= Boolean(response.grade || response.pending); response.grade = null; response.gradeFingerprint = ""; response.error = null;
  persistDraft(); renderQuestionResult(question);
}
async function gradeQuestion(question) {
  const response = state.responses.get(question.id); if (response.pending) return;
  const answers = answersFor(question); const language = getLanguage(); const answerFingerprint = fingerprint(answers);
  if (answers.some((answer) => answer.text.length > STRUCTURED_ANSWER_MAX_LENGTH) || answers.reduce((sum, answer) => sum + answer.text.length, 0) > STRUCTURED_ANSWER_TOTAL_MAX_LENGTH) {
    response.error = { code: "LOCAL_ANSWER_TOO_LONG" }; renderQuestionResult(question); return;
  }
  const requestFingerprint = JSON.stringify({ answers, language });
  if (response.request?.fingerprint !== requestFingerprint) response.request = { id: crypto.randomUUID(), fingerprint: requestFingerprint };
  const requestId = response.request.id; response.pending = true; response.error = null; persistDraft(); renderQuestionResult(question);
  try {
    const grade = await api.gradeStructuredQuestion(token, question.id, { requestId, answers, language });
    if (fingerprint(answersFor(question)) === answerFingerprint) { response.grade = grade; response.gradeFingerprint = answerFingerprint; response.stale = false; }
    else { response.grade = null; response.gradeFingerprint = ""; response.stale = true; }
    response.request = null;
  } catch (error) {
    if (requireLogin(error)) return;
    response.error = { code: error.code, status: error.status, retryAfterSeconds: error.payload?.error?.details?.retryAfterSeconds };
    const completedFailure = error.payload?.error?.details?.retryAllowed === true || ["AI_GRADING_TIMEOUT", "AI_GRADING_UNAVAILABLE", "AI_GRADING_INVALID_RESULT", "AI_GRADING_INTERRUPTED", "GRADING_REQUEST_CONFLICT"].includes(error.code);
    if (completedFailure) response.request = null;
  } finally { response.pending = false; persistDraft(); renderQuestionResult(question); }
}
function questionCard(question, index) {
  const card = node("details", "practice-question"); card.dataset.questionId = question.id; card.open = state.openId === question.id;
  const summary = node("summary"); const score = node("span", "practice-question-summary-score"); score.hidden = true;
  summary.append(node("span", "practice-question-summary-title", t("subjectQuestionNumber", { number: question.questionNo || index + 1 })), node("span", "practice-question-summary-meta", t("subjectMarks", { count: question.maxMarks })), score); card.appendChild(summary);
  summary.addEventListener("click", (event) => { event.preventDefault(); if (card.open) { card.open = false; state.openId = ""; } else selectQuestion(question.id, false); });
  card.addEventListener("toggle", () => { if (card.open && state.openId !== question.id) selectQuestion(question.id, false); });
  const body = node("div", "practice-question-body"); const workspace = node("div", "practice-question-workspace");
  const original = node("section", "practice-original-content"); original.appendChild(node("h2", "practice-section-title", t("structuredPracticeOriginalQuestion")));
  renderDocument(original, question.content);
  if (!original.querySelector("img") && !structuredDisplayBlocks(question.content).length) { if (list(question.images).length) renderImages(original, question.images); else original.appendChild(node("p", "practice-content-text", question.stem || t("subjectQuestionUnavailable"))); }
  const panel = node("section", "practice-answer-panel"); panel.appendChild(node("h2", "practice-section-title", t("structuredPracticeYourAnswers")));
  const inputHint = node("p", "practice-input-hint practice-muted", t("structuredPracticeInputHint")); inputHint.id = `practiceInputHint-${index}`; panel.appendChild(inputHint);
  answerParts(question).forEach((part, partIndex) => {
    const item = node("div", "practice-answer-part"); const label = node("label"); const inputId = `practice-answer-${index}-${partIndex}`; label.htmlFor = inputId;
    label.append(node("span", "", part.label || t("structuredPracticeWholeQuestion")), node("span", "", t("subjectMarks", { count: part.maxMarks })));
    const prompt = node("div", "practice-part-prompt"); renderBlocks(prompt, part.prompt); const textarea = node("textarea");
    textarea.id = inputId; textarea.dataset.partId = part.partId; textarea.rows = 5; textarea.maxLength = STRUCTURED_ANSWER_MAX_LENGTH; textarea.spellcheck = false;
    textarea.setAttribute("aria-describedby", inputHint.id);
    textarea.placeholder = t("structuredPracticeAnswerPlaceholder"); textarea.value = state.responses.get(question.id).answers[part.partId] || "";
    textarea.addEventListener("input", () => updateAnswer(question, part.partId, textarea.value));
    textarea.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      const start = textarea.selectionStart; const end = textarea.selectionEnd;
      if (textarea.value.length - (end - start) + 4 > STRUCTURED_ANSWER_MAX_LENGTH) return;
      textarea.setRangeText("    ", start, end, "end"); updateAnswer(question, part.partId, textarea.value);
    });
    item.append(label, prompt, textarea); panel.appendChild(item);
  });
  const actions = node("div", "practice-answer-actions"); const grade = node("button", "btn-primary", t("structuredPracticeGradeQuestion")); grade.type = "button"; grade.dataset.gradeQuestion = question.id; grade.addEventListener("click", () => gradeQuestion(question)); actions.appendChild(grade); panel.appendChild(actions);
  const error = node("p", "practice-question-error"); error.setAttribute("role", "alert"); panel.appendChild(error);
  const stale = node("p", "practice-grade-stale"); stale.setAttribute("role", "status"); panel.appendChild(stale);
  const result = node("div", "practice-grade-result"); result.setAttribute("role", "status"); result.setAttribute("aria-live", "polite"); panel.appendChild(result);
  workspace.append(original, panel); body.appendChild(workspace);
  const markScheme = question.markScheme || {};
  if (Object.keys(markScheme).length) {
    const details = node("details", "practice-mark-scheme"); details.appendChild(node("summary", "", t("subjectMarkScheme")));
    const schemeBody = node("div", "practice-mark-scheme-body"); renderDocument(schemeBody, pairedMarkScheme(markScheme, question.content)); details.appendChild(schemeBody); body.appendChild(details);
  } else body.appendChild(node("p", "practice-muted", t("subjectNoMarkScheme")));
  card.appendChild(body); return card;
}
function renderNavigation() {
  const index = Math.max(0, state.questions.findIndex((question) => question.id === state.currentId));
  byId("practicePrevious").disabled = index <= 0; byId("practiceNext").disabled = index >= state.questions.length - 1; byId("practiceQuestionPicker").value = state.currentId;
}
function selectQuestion(id, scroll = true) {
  if (!state.questions.some((question) => question.id === id)) return;
  const changed = state.currentId !== id; state.currentId = id; state.openId = id;
  document.querySelectorAll(".practice-question").forEach((card) => {
    card.open = card.dataset.questionId === id;
    if (changed) card.querySelectorAll(".practice-mark-scheme").forEach((scheme) => { scheme.open = false; });
  });
  renderNavigation();
  if (scroll) { const card = [...document.querySelectorAll(".practice-question")].find((item) => item.dataset.questionId === id); card?.scrollIntoView({ block: "start", behavior: "auto" }); card?.querySelector("summary")?.focus({ preventScroll: true }); }
}
function render() {
  applyPage(); byId("practiceLanguage").textContent = getLanguage() === "en" ? "中文" : "EN";
  byId("practiceStatus").textContent = state.statusKey ? t(state.statusKey) : ""; byId("practiceStatus").classList.toggle("is-error", state.statusError);
  byId("practiceBack").href = `./subject.html?subject=${encodeURIComponent(state.paper?.subjectCode || "9618")}&view=papers&paper=${encodeURIComponent(paperSlug)}`;
  byId("practicePaperCode").textContent = paperSlug;
  byId("practicePaperMeta").textContent = state.paper ? [t("subjectPaperLabel", { number: state.paper.paperNumber }), t("subjectMinutes", { count: state.paper.durationMinutes }), t("subjectMarks", { count: state.paper.totalMarks })].join(" · ") : "";
  document.title = `${t("structuredPracticeTitle")} · ${paperSlug || "9618"}`;
  byId("practiceQuestionNavigation").hidden = !state.questions.length;
  byId("practiceQuestionPicker").replaceChildren(...state.questions.map((question, index) => new Option(t("subjectQuestionNumber", { number: question.questionNo || index + 1 }), question.id)));
  const target = byId("practiceQuestions"); target.replaceChildren(...state.questions.map(questionCard));
  if (state.paper && !state.questions.length) { const empty = node("div", "practice-empty"); empty.append(node("h2", "", t("structuredPracticeEmptyTitle")), node("p", "", t("structuredPracticeEmptyBody"))); target.appendChild(empty); }
  renderNavigation(); state.questions.forEach(renderQuestionResult); renderPaperSummary();
  if (state.draftKey) byId("practiceDraftStatus").textContent = t(state.draftFailed ? "structuredPracticeDraftUnavailable" : "structuredPracticeDraftSaved");
}
async function init() {
  if (!token) { location.href = "./login.html"; return; }
  byId("practiceLanguage").addEventListener("click", () => { setLanguage(getLanguage() === "en" ? "zh-CN" : "en"); render(); });
  byId("practiceQuestionPicker").addEventListener("change", (event) => selectQuestion(event.target.value));
  byId("practicePrevious").addEventListener("click", () => { const index = state.questions.findIndex((question) => question.id === state.currentId); if (index > 0) selectQuestion(state.questions[index - 1].id); });
  byId("practiceNext").addEventListener("click", () => { const index = state.questions.findIndex((question) => question.id === state.currentId); if (index < state.questions.length - 1) selectQuestion(state.questions[index + 1].id); });
  render();
  if (!/^\d{4}_[msw]\d{2}_qp_[1-3][1-9]$/.test(paperSlug)) { state.statusKey = "structuredPracticeInvalidPaper"; state.statusError = true; render(); return; }
  try {
    const user = await api.getCurrentUser(token); const data = await api.getStructuredPracticePaper(token, paperSlug); state.paper = data.paper;
    state.questions = list(data.questions).filter((question) => question.questionType === "structured").sort((a, b) => Number(a.questionNo) - Number(b.questionNo));
    state.draftKey = `alevel.structuredPractice.v1.${encodeURIComponent(user.id)}.${encodeURIComponent(paperSlug)}`;
    restoreResponses(data.attempts); state.currentId = state.questions[0]?.id || ""; state.openId = state.currentId; state.statusKey = ""; persistDraft();
  } catch (error) { if (requireLogin(error)) return; state.statusKey = error.status === 403 ? "structuredPracticeAccessDenied" : "structuredPracticeLoadFailed"; state.statusError = true; }
  render();
}
init();
