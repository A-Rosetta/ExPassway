import { createAnswerKeyPdf, createQuestionPaperPdf } from "./paper-export.js";

window.PaperExport = { createAnswerKeyPdf, createQuestionPaperPdf };

(() => {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const byId = (id) => document.getElementById(id);
  const state = {
    token: "",
    subjects: [],
    subject: null,
    catalog: null,
    sections: [],
    counts: new Map(),
    groups: null,
  };

  function t(key, vars) {
    return window.ALevelI18n?.t?.(key, vars) || key;
  }

  function isChinese() {
    return window.ALevelI18n?.getLanguage?.() === "zh-CN";
  }

  function setStatus(message = "", isError = false) {
    const status = byId("paperBuilderStatus");
    status.textContent = message;
    status.classList.toggle("paper-builder-status-error", isError);
  }

  function sectionLabel(section) {
    const title = isChinese() ? section.titleZh || section.titleEn : section.titleEn || section.titleZh;
    return [section.sectionCode, title].filter(Boolean).join(" ");
  }

  function chapterLabel(chapter) {
    const title = isChinese() ? chapter.titleZh || chapter.titleEn : chapter.titleEn || chapter.titleZh;
    return title
      ? t("paperBuilderChapter", { number: chapter.chapterNo, title })
      : t("paperBuilderChapterFallback", { number: chapter.chapterNo });
  }

  function selectedTotal() {
    return [...state.counts.values()].reduce((sum, count) => sum + count, 0);
  }

  function updateTotal() {
    byId("paperBuilderTotal").textContent = t("paperBuilderTotal", { count: selectedTotal() });
    byId("generateChapterPaper").disabled = selectedTotal() === 0 || !state.sections.length;
  }

  function clearPreview() {
    state.groups = null;
    byId("paperBuilderPreviewSection").hidden = true;
    byId("paperBuilderPreview").replaceChildren();
    byId("downloadChapterPaper").disabled = true;
  }

  function updateCount(input, section) {
    const id = section.id;
    const othersTotal = selectedTotal() - (state.counts.get(id) || 0);
    const maximum = Math.max(0, Math.min(section.progress?.availableQuestions || 0, 20, 80 - othersTotal));
    const requested = Number.parseInt(input.value, 10);
    const count = Number.isFinite(requested) ? Math.max(0, Math.min(requested, maximum)) : 0;
    input.value = String(count);
    input.max = String(maximum);
    if (count) state.counts.set(id, count);
    else state.counts.delete(id);
    clearPreview();
    updateTotal();
  }

  function renderSections() {
    const root = byId("paperBuilderChapters");
    root.replaceChildren();
    state.sections = [];
    state.counts.clear();

    const chapters = state.catalog?.chapters || [];
    chapters.forEach((chapter, chapterIndex) => {
      const details = document.createElement("details");
      details.className = "paper-builder-chapter";
      details.open = chapterIndex === 0;
      const summary = document.createElement("summary");
      summary.className = "paper-builder-chapter-summary";
      summary.textContent = chapterLabel(chapter);
      details.append(summary);

      for (const section of chapter.sections || []) {
        const available = Number(section.progress?.availableQuestions || 0);
        const selection = { ...section, chapterNo: chapter.chapterNo, chapterTitleEn: chapter.titleEn, chapterTitleZh: chapter.titleZh };
        state.sections.push(selection);

        const row = document.createElement("div");
        row.className = "paper-builder-section-row";
        const name = document.createElement("div");
        name.className = "paper-builder-section-name";
        const title = document.createElement("strong");
        title.textContent = sectionLabel(section);
        name.append(title);

        const availableText = document.createElement("span");
        availableText.className = "paper-builder-available";
        availableText.textContent = t("paperBuilderAvailable", { count: available });

        const countLabel = document.createElement("label");
        countLabel.className = "paper-builder-section-count";
        const countText = document.createElement("span");
        countText.textContent = t("paperBuilderCount");
        const input = document.createElement("input");
        input.type = "number";
        input.min = "0";
        input.max = String(Math.min(available, 20));
        input.step = "1";
        input.value = "0";
        input.disabled = available === 0;
        input.setAttribute("aria-label", sectionLabel(section));
        input.addEventListener("input", () => updateCount(input, selection));
        countLabel.append(countText, input);
        row.append(name, availableText, countLabel);
        details.append(row);
      }
      root.append(details);
    });

    if (!state.sections.length) {
      const empty = document.createElement("p");
      empty.className = "paper-builder-empty";
      empty.textContent = t("paperBuilderNoSections");
      root.append(empty);
    }
    clearPreview();
    updateTotal();
  }

  async function loadCatalog(subjectCode) {
    const subject = state.subjects.find((item) => item.code === subjectCode);
    if (!subject) return;
    state.subject = subject;
    state.catalog = null;
    byId("paperBuilderSubject").disabled = true;
    byId("generateChapterPaper").disabled = true;
    clearPreview();
    setStatus(t("paperBuilderLoading"));
    try {
      state.catalog = await window.ALevelApi.getChapterCatalog(state.token, subject.code, subject.version.id);
      renderSections();
      setStatus("");
    } catch (error) {
      renderSections();
      setStatus(t("paperBuilderFailed", { message: error.message }), true);
    } finally {
      byId("paperBuilderSubject").disabled = false;
    }
  }

  function renderSubjects() {
    const select = byId("paperBuilderSubject");
    const previousValue = state.subject?.code || "";
    select.replaceChildren();
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = t("paperBuilderChooseSubject");
    select.append(placeholder);
    for (const subject of state.subjects) {
      const option = document.createElement("option");
      option.value = subject.code;
      option.textContent = isChinese() ? subject.nameZh || subject.name : subject.name;
      select.append(option);
    }
    select.value = state.subjects.some((item) => item.code === previousValue)
      ? previousValue
      : state.subjects[0]?.code || "";
  }

  function imageUrl(image) {
    const value = typeof image === "string" ? image : image?.detailUrl || image?.url || image?.thumbnailUrl || "";
    return value ? new URL(value, window.location.origin).href : "";
  }

  function appendQuestionContent(parent, question) {
    const images = (question.images || []).map(imageUrl).filter(Boolean);
    if (images.length) {
      for (const source of images) {
        const image = document.createElement("img");
        image.src = source;
        image.alt = t("paperBuilderOpenImage");
        image.addEventListener("error", () => {
          const message = document.createElement("p");
          message.className = "paper-builder-empty";
          message.textContent = t("paperBuilderImageUnavailable");
          image.replaceWith(message);
        }, { once: true });
        parent.append(image);
      }
      return;
    }

    if (question.stem) {
      const stem = document.createElement("p");
      stem.textContent = question.stem;
      parent.append(stem);
    }
    const options = Array.isArray(question.options)
      ? question.options.map((text, index) => [String.fromCharCode(65 + index), text])
      : Object.entries(question.options || {});
    if (options.length) {
      const list = document.createElement("div");
      list.className = "paper-builder-options";
      for (const [letter, text] of options) {
        const option = document.createElement("div");
        option.textContent = `${letter}. ${text}`;
        list.append(option);
      }
      parent.append(list);
    }
  }

  function renderPreview() {
    const root = byId("paperBuilderPreview");
    root.replaceChildren();
    let number = 0;
    for (const group of state.groups || []) {
      const section = group.section || {};
      const container = document.createElement("section");
      container.className = "paper-builder-preview-group";
      const heading = document.createElement("h3");
      const chapterTitle = isChinese() ? section.chapterTitleZh || section.chapterTitleEn : section.chapterTitleEn || section.chapterTitleZh;
      const chapter = chapterTitle
        ? t("paperBuilderChapter", { number: section.chapterNo, title: chapterTitle })
        : t("paperBuilderChapterFallback", { number: section.chapterNo });
      const sectionTitle = isChinese() ? section.titleZh || section.titleEn : section.titleEn || section.titleZh;
      heading.textContent = [chapter, section.sectionCode, sectionTitle].filter(Boolean).join(" · ");
      container.append(heading);

      for (const question of group.questions || []) {
        number += 1;
        const article = document.createElement("article");
        article.className = "paper-builder-preview-question";
        const title = document.createElement("h4");
        title.className = "paper-builder-question-title";
        title.textContent = `${t("paperBuilderQuestion", { number })}${question.questionNo ? ` · Q${question.questionNo}` : ""}`;
        article.append(title);
        appendQuestionContent(article, question);
        container.append(article);
      }
      root.append(container);
    }
    byId("paperBuilderPreviewSummary").textContent = t("paperBuilderSelectedCount", { count: number });
    byId("paperBuilderPreviewSection").hidden = false;
    byId("downloadChapterPaper").disabled = number === 0;
  }

  async function generatePaper() {
    const selected = state.sections
      .map((section) => ({ coursebookSectionId: section.id, count: state.counts.get(section.id) || 0 }))
      .filter((section) => section.count > 0);
    if (!selected.length) {
      setStatus(t("paperBuilderNoSelection"), true);
      return;
    }

    const button = byId("generateChapterPaper");
    button.disabled = true;
    setStatus(t("paperBuilderGenerating"));
    clearPreview();
    try {
      const result = await window.ALevelApi.generateChapterPaper(state.token, {
        curriculumVersion: state.catalog.version.id,
        sections: selected,
      });
      state.groups = result.groups || [];
      renderPreview();
      setStatus("");
    } catch (error) {
      const message = error.code === "INSUFFICIENT_QUESTIONS"
        ? t("paperBuilderNoQuestionPool", { message: error.message })
        : t("paperBuilderFailed", { message: error.message });
      setStatus(message, true);
    } finally {
      updateTotal();
    }
  }

  async function loadImage(source) {
    const response = await fetch(imageUrl(source));
    if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function downloadPaper() {
    if (!state.groups?.length) return;
    const button = byId("downloadChapterPaper");
    button.disabled = true;
    setStatus(t("paperBuilderBuildingPdf"));
    try {
      const subjectName = state.subject?.name || state.subject?.nameZh || "";
      const questionPdf = await createQuestionPaperPdf(state.groups, { subjectName, loadImage });
      const answerPdf = await createAnswerKeyPdf(state.groups, { subjectName });
      const archive = window.BulkDownload.createZip([
        { name: "试卷.pdf", data: questionPdf.bytes },
        { name: "答案.pdf", data: answerPdf.bytes },
      ]);
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = url;
      link.download = "ExPassway-章节组卷.zip";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus(t("paperBuilderDownloadReady", {
        questions: questionPdf.questionCount,
        answers: answerPdf.answerCount,
      }));
    } catch (error) {
      setStatus(t("paperBuilderFailed", { message: error.message }), true);
    } finally {
      button.disabled = false;
    }
  }

  async function initialize() {
    const token = localStorage.getItem(AUTH_TOKEN_KEY) || "";
    if (!token) {
      window.location.href = "./login.html";
      return;
    }
    state.token = token;
    byId("paperBuilderSubject").addEventListener("change", (event) => loadCatalog(event.target.value));
    byId("generateChapterPaper").addEventListener("click", generatePaper);
    byId("downloadChapterPaper").addEventListener("click", downloadPaper);
    setStatus(t("paperBuilderLoading"));

    try {
      await window.ALevelApi.getCurrentUser(token);
      state.subjects = await window.ALevelApi.getCurriculumSubjects(token);
      if (!state.subjects.length) {
        byId("paperBuilderSubject").disabled = true;
        setStatus(t("paperBuilderNoSubjects"));
        return;
      }
      renderSubjects();
      byId("paperBuilderSubject").disabled = false;
      await loadCatalog(byId("paperBuilderSubject").value);
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        window.location.href = "./login.html";
        return;
      }
      setStatus(t("paperBuilderFailed", { message: error.message }), true);
    }
  }

  initialize();
})();
