(function () {
  const AUTH_TOKEN_KEY = "alevel.authToken";
  const USER_PROFILE_KEY = "alevel.userProfile";
  const USER_ID_KEY = "alevel.userId";
  const VISITOR_MODE_KEY = "alevel.visitorMode";
  const { t, applyPage, getLanguage } = window.ALevelI18n;
  if (window.marked?.use && window.markedKatex) {
    window.marked.use(window.markedKatex({
      nonStandard: true,
      throwOnError: false,
    }));
  }
  if (window.marked?.use && window.katex?.renderToString) {
    window.marked.use({
      extensions: [
        {
          name: "katexParentheses",
          level: "inline",
          start(src) {
            const index = src.indexOf("\\(");
            return index >= 0 ? index : undefined;
          },
          tokenizer(src) {
            const match = src.match(/^\\\(([\s\S]+?)\\\)/);
            if (!match) return undefined;
            return { type: "katexParentheses", raw: match[0], text: match[1] };
          },
          renderer(token) {
            return window.katex.renderToString(token.text, {
              displayMode: false,
              throwOnError: false,
            });
          },
        },
        {
          name: "katexBrackets",
          level: "block",
          start(src) {
            const index = src.indexOf("\\[");
            return index >= 0 ? index : undefined;
          },
          tokenizer(src) {
            const match = src.match(/^\\\[([\s\S]+?)\\\](?:\n|$)/);
            if (!match) return undefined;
            return { type: "katexBrackets", raw: match[0], text: match[1].trim() };
          },
          renderer(token) {
            return window.katex.renderToString(token.text, {
              displayMode: true,
              throwOnError: false,
            });
          },
        },
      ],
    });
  }

  const state = {
    token: localStorage.getItem(AUTH_TOKEN_KEY) || "",
    user: null,
    currentThreadId: "",
    context: readContext(),
    threads: [],
    catalogSubjects: [],
    catalogPapers: [],
    followedOnly: false,
    questionReferences: new Map(),
    mathKeyboardGroup: "common",
    lastFormulaDisplayMode: false,
    activeEditorId: "communityBodyEditor",
    editorRanges: new Map(),
    activeMathField: null,
    formattingRange: null,
    formattingEditorId: "",
    listScrollY: 0,
    toastTimer: null,
  };

  const MATH_KEY_GROUPS = [
    {
      id: "common",
      labelKey: "communityMathGroupCommon",
      keys: [
        ["x²", "^{#0}", "communityMathKeyPower"],
        ["xₙ", "_{#0}", "communityMathKeySubscript"],
        ["a/b", "\\frac{#0}{#1}", "communityMathKeyFraction"],
        ["√", "\\sqrt{#0}", "communityMathKeySquareRoot"],
        ["ⁿ√", "\\sqrt[#0]{#1}", "communityMathKeyNthRoot"],
        ["( )", "\\left(#0\\right)", "communityMathKeyParentheses"],
        ["±", "\\pm", "communityMathKeyPlusMinus"],
        ["×", "\\times", "communityMathKeyMultiply"],
        ["÷", "\\div", "communityMathKeyDivide"],
        ["=", "=", "communityMathKeyEquals"],
        ["≤", "\\le", "communityMathKeyLessEqual"],
        ["≥", "\\ge", "communityMathKeyGreaterEqual"],
      ],
    },
    {
      id: "algebra",
      labelKey: "communityMathGroupAlgebra",
      keys: [
        ["|x|", "\\left|#0\\right|", "communityMathKeyAbsolute"],
        ["≠", "\\ne", "communityMathKeyNotEqual"],
        ["≈", "\\approx", "communityMathKeyApproximately"],
        ["∞", "\\infty", "communityMathKeyInfinity"],
        ["log", "\\log\\left(#0\\right)", "communityMathKeyLog"],
        ["ln", "\\ln\\left(#0\\right)", "communityMathKeyNaturalLog"],
        ["eˣ", "e^{#0}", "communityMathKeyExponential"],
        ["aⁿ", "#@^{#0}", "communityMathKeyPower"],
        ["∝", "\\propto", "communityMathKeyProportional"],
        ["∈", "\\in", "communityMathKeyElement"],
        ["∪", "\\cup", "communityMathKeyUnion"],
        ["∩", "\\cap", "communityMathKeyIntersection"],
      ],
    },
    {
      id: "functions",
      labelKey: "communityMathGroupFunctions",
      keys: [
        ["sin", "\\sin\\left(#0\\right)", "communityMathKeySin"],
        ["cos", "\\cos\\left(#0\\right)", "communityMathKeyCos"],
        ["tan", "\\tan\\left(#0\\right)", "communityMathKeyTan"],
        ["sin⁻¹", "\\sin^{-1}\\left(#0\\right)", "communityMathKeyArcSin"],
        ["d/dx", "\\frac{d}{dx}#0", "communityMathKeyDerivative"],
        ["∫", "\\int_{#0}^{#1}#2\\,dx", "communityMathKeyIntegral"],
        ["Σ", "\\sum_{#0}^{#1}#2", "communityMathKeySum"],
        ["Π", "\\prod_{#0}^{#1}#2", "communityMathKeyProduct"],
        ["lim", "\\lim_{#0\\to#1}#2", "communityMathKeyLimit"],
        ["→", "\\to", "communityMathKeyTo"],
        ["°", "^{\\circ}", "communityMathKeyDegree"],
        ["π", "\\pi", "communityMathKeyPi"],
      ],
    },
    {
      id: "greek",
      labelKey: "communityMathGroupGreek",
      keys: [
        ["α", "\\alpha", "communityMathKeyAlpha"],
        ["β", "\\beta", "communityMathKeyBeta"],
        ["γ", "\\gamma", "communityMathKeyGamma"],
        ["δ", "\\delta", "communityMathKeyDelta"],
        ["θ", "\\theta", "communityMathKeyTheta"],
        ["λ", "\\lambda", "communityMathKeyLambda"],
        ["μ", "\\mu", "communityMathKeyMu"],
        ["ρ", "\\rho", "communityMathKeyRho"],
        ["σ", "\\sigma", "communityMathKeySigma"],
        ["φ", "\\phi", "communityMathKeyPhi"],
        ["ω", "\\omega", "communityMathKeyOmega"],
        ["Δ", "\\Delta", "communityMathKeyUpperDelta"],
      ],
    },
    {
      id: "chemistry",
      labelKey: "communityMathGroupChemistry",
      keys: [
        ["H", "\\mathrm{H}", "communityMathKeyHydrogen"],
        ["O", "\\mathrm{O}", "communityMathKeyOxygen"],
        ["C", "\\mathrm{C}", "communityMathKeyCarbon"],
        ["N", "\\mathrm{N}", "communityMathKeyNitrogen"],
        ["→", "\\rightarrow", "communityMathKeyReactionArrow"],
        ["⇌", "\\rightleftharpoons", "communityMathKeyEquilibrium"],
        ["(aq)", "\\mathrm{(aq)}", "communityMathKeyAqueous"],
        ["(s)", "\\mathrm{(s)}", "communityMathKeySolid"],
        ["(l)", "\\mathrm{(l)}", "communityMathKeyLiquid"],
        ["(g)", "\\mathrm{(g)}", "communityMathKeyGas"],
        ["⁺", "^{+}", "communityMathKeyPositiveCharge"],
        ["⁻", "^{-}", "communityMathKeyNegativeCharge"],
      ],
    },
  ];

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function renderMarkdown(value) {
    if (!window.marked?.parse || !window.DOMPurify?.sanitize) {
      return escapeHtml(value).replace(/\n/g, "<br />");
    }
    const html = window.marked.parse(String(value || ""), {
      breaks: true,
      gfm: true,
    });
    const fragment = window.DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      RETURN_DOM_FRAGMENT: true,
    });
    fragment.querySelectorAll("img").forEach((image) => {
      const src = image.getAttribute("src") || "";
      if (!src) {
        image.remove();
        return;
      }
      try {
        const url = new URL(src, location.href);
        if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) image.remove();
      } catch (_err) {
        image.remove();
      }
    });
    const template = document.createElement("template");
    template.content.append(fragment);
    return template.innerHTML;
  }

  function resolveImageUrl(value) {
    const url = String(value || "").trim();
    if (url.startsWith("/assets/") && location.pathname.startsWith("/alevel/")) {
      return `/alevel${url}`;
    }
    return url;
  }

  function renderQuestionReference(reference) {
    if (!reference?.imageUrl) return "";
    const paperUrl = `./generate.html?paper=${encodeURIComponent(reference.paperSlug)}&question=${reference.questionNo}`;
    const answerUrl = `./review.html?paper=${encodeURIComponent(reference.paperSlug)}&question=${reference.questionNo}`;
    return `
      <figure class="discussion-question-reference">
        <img
          src="${escapeHtml(resolveImageUrl(reference.imageUrl))}"
          alt="${escapeHtml(t("communityQuestionImageAlt", { number: reference.questionNo }))}"
          loading="lazy"
          decoding="async"
        />
        <details class="discussion-question-menu">
          <summary aria-label="${escapeHtml(t("communityQuestionActions"))}" title="${escapeHtml(t("communityQuestionActions"))}">...</summary>
          <div class="discussion-question-menu-list">
            <a href="${paperUrl}">${t("communityReturnToPaper")}</a>
            <a href="${answerUrl}">${t("communityOpenAnswerIndex")}</a>
          </div>
        </details>
        <figcaption>${escapeHtml(t("communityQuestionCaption", {
          paper: reference.paperSlug,
          number: reference.questionNo,
        }))}</figcaption>
      </figure>
    `;
  }

  async function getQuestionReference(questionKey) {
    const key = String(questionKey || "").trim();
    if (!key) return null;
    if (state.questionReferences.has(key)) return state.questionReferences.get(key);
    try {
      const reference = await window.ALevelApi.getQuestionReference(state.token, key);
      state.questionReferences.set(key, reference);
      return reference;
    } catch (_err) {
      state.questionReferences.set(key, null);
      return null;
    }
  }

  function configureMathField(mathField) {
    mathField.mathVirtualKeyboardPolicy = "manual";
    mathField.menuItems = [];
    mathField.setAttribute("smart-fence", "");
    const activate = () => {
      const editor = mathField.closest(".rich-text-editor");
      if (editor) state.activeEditorId = editor.id;
      activateMathField(mathField);
    };
    mathField.addEventListener("focus", activate);
    mathField.addEventListener("pointerdown", activate);
    mathField.addEventListener("click", activate);
    mathField.addEventListener("input", () => {
      const editor = mathField.closest(".rich-text-editor");
      if (editor) {
        syncEditor(editor);
        clearEditorFeedback(editor, "math");
      }
    });
  }

  function updateFormulaModeMenu(wrapper) {
    const displayMode = wrapper.dataset.display === "1";
    wrapper.querySelectorAll("[data-formula-display]").forEach((button) => {
      const active = button.dataset.formulaDisplay === (displayMode ? "1" : "0");
      button.setAttribute("aria-checked", active ? "true" : "false");
      button.classList.toggle("is-active", active);
    });
  }

  function positionFormulaMenu(details) {
    if (!details.open) return;
    const summary = details.querySelector("summary");
    const menu = details.querySelector(".rich-editor-math-menu-list");
    if (!summary || !menu) return;
    const summaryRect = summary.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const left = Math.max(8, Math.min(
      summaryRect.right - menuWidth,
      window.innerWidth - menuWidth - 8
    ));
    const below = summaryRect.bottom + 6;
    const top = below + menuHeight <= window.innerHeight - 8
      ? below
      : Math.max(8, summaryRect.top - menuHeight - 6);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  function activateMathField(mathField) {
    if (!mathField?.isConnected) return;
    document.querySelectorAll(".rich-editor-math.is-active").forEach((wrapper) => {
      if (!wrapper.contains(mathField)) {
        wrapper.classList.remove("is-active");
        wrapper.querySelector("details")?.removeAttribute("open");
      }
    });
    state.activeMathField = mathField;
    const wrapper = mathField.closest(".rich-editor-math");
    wrapper?.classList.add("is-active");
    if (byId("communityMathKeyboard").hidden) setMathKeyboardOpen(true);
  }

  function restoreCaretAfterFormula(wrapper, editor) {
    const marker = document.createTextNode("\u200b");
    wrapper.replaceWith(marker);
    editor.focus();
    const range = document.createRange();
    range.setStartAfter(marker);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    state.editorRanges.set(editor.id, range.cloneRange());
    state.activeEditorId = editor.id;
    syncEditor(editor);
  }

  function deleteFormula(wrapper) {
    const mathField = wrapper.querySelector("math-field");
    const rawLatex = mathField?.getValue("latex").trim() || "";
    if (rawLatex && !window.confirm(t("communityFormulaDeleteConfirm"))) {
      mathField.focus();
      return;
    }
    const editor = wrapper.closest(".rich-text-editor");
    if (!editor) return;
    state.activeMathField = null;
    setMathKeyboardOpen(false);
    restoreCaretAfterFormula(wrapper, editor);
    clearEditorFeedback(editor, "math");
  }

  function setFormulaDisplayMode(wrapper, displayMode) {
    wrapper.dataset.display = displayMode ? "1" : "0";
    wrapper.classList.toggle("is-display", displayMode);
    state.lastFormulaDisplayMode = displayMode;
    updateFormulaModeMenu(wrapper);
    wrapper.querySelector("details")?.removeAttribute("open");
    const editor = wrapper.closest(".rich-text-editor");
    if (editor) {
      syncEditor(editor);
      clearEditorFeedback(editor, "math");
    }
    wrapper.querySelector("math-field")?.focus();
  }

  function configureFormulaActions(wrapper) {
    updateFormulaModeMenu(wrapper);
    wrapper.querySelector("[data-delete-formula]")?.addEventListener("click", () => {
      deleteFormula(wrapper);
    });
    wrapper.querySelectorAll("[data-formula-display]").forEach((button) => {
      button.addEventListener("click", () => {
        setFormulaDisplayMode(wrapper, button.dataset.formulaDisplay === "1");
      });
    });
    const details = wrapper.querySelector("details");
    details?.addEventListener("toggle", () => {
      if (!details.open) return;
      document.querySelectorAll(".rich-editor-math-menu[open]").forEach((other) => {
        if (other !== details) other.removeAttribute("open");
      });
      positionFormulaMenu(details);
    });
    wrapper.addEventListener("mousedown", (event) => {
      if (event.target.closest(".rich-editor-math-actions")) return;
      const mathField = wrapper.querySelector("math-field");
      if (mathField) activateMathField(mathField);
    });
    wrapper.addEventListener("focusin", () => {
      const mathField = wrapper.querySelector("math-field");
      if (mathField) activateMathField(mathField);
    });
  }

  function createMathNode(latex, displayMode) {
    const wrapper = document.createElement("span");
    wrapper.className = `rich-editor-math${displayMode ? " is-display" : ""}`;
    wrapper.contentEditable = "false";
    wrapper.dataset.display = displayMode ? "1" : "0";
    wrapper.dataset.latex = latex || "";
    const actions = document.createElement("span");
    actions.className = "rich-editor-math-actions";
    actions.setAttribute("role", "toolbar");
    actions.setAttribute("aria-label", t("communityFormulaActions"));
    actions.innerHTML = `
      <button
        type="button"
        class="rich-editor-math-action"
        data-delete-formula
        aria-label="${escapeHtml(t("communityFormulaDelete"))}"
        title="${escapeHtml(t("communityFormulaDelete"))}"
      >x</button>
      <details class="rich-editor-math-menu">
        <summary
          aria-label="${escapeHtml(t("communityFormulaMore"))}"
          title="${escapeHtml(t("communityFormulaMore"))}"
        >...</summary>
        <div class="rich-editor-math-menu-list" role="menu" aria-label="${escapeHtml(t("communityFormulaMode"))}">
          <button type="button" role="menuitemradio" data-formula-display="0">
            ${escapeHtml(t("communityFormulaInline"))}
          </button>
          <button type="button" role="menuitemradio" data-formula-display="1">
            ${escapeHtml(t("communityFormulaDisplay"))}
          </button>
        </div>
      </details>
    `;
    const mathField = document.createElement("math-field");
    mathField.contentEditable = "true";
    mathField.setAttribute("aria-label", t("communityMathFieldLabel"));
    wrapper.appendChild(actions);
    wrapper.appendChild(mathField);
    return wrapper;
  }

  function mountMathNode(wrapper) {
    const mathField = wrapper.querySelector("math-field");
    configureFormulaActions(wrapper);
    configureMathField(mathField);
    mathField.setValue(wrapper.dataset.latex || "");
    delete wrapper.dataset.latex;
    return mathField;
  }

  function replaceMathPlaceholders(editor, formulas) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((textNode) => {
      const matches = [...textNode.data.matchAll(/MATHFORMULA(\d+)PLACEHOLDER/g)];
      if (!matches.length) return;
      const fragment = document.createDocumentFragment();
      let offset = 0;
      matches.forEach((match) => {
        fragment.append(textNode.data.slice(offset, match.index));
        const formula = formulas[Number(match[1])];
        if (formula) fragment.append(createMathNode(formula.latex, formula.displayMode));
        offset = match.index + match[0].length;
      });
      fragment.append(textNode.data.slice(offset));
      textNode.replaceWith(fragment);
    });
    editor.querySelectorAll(".rich-editor-math[data-latex]").forEach(mountMathNode);
  }

  function markdownToEditor(editor, value) {
    const formulas = [];
    const masked = String(value || "").replace(
      /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g,
      (_match, dollars, brackets, parentheses, inline) => {
        formulas.push({
          latex: String(dollars || brackets || parentheses || inline || "").trim(),
          displayMode: Boolean(dollars || brackets),
        });
        return `MATHFORMULA${formulas.length - 1}PLACEHOLDER`;
      }
    );
    editor.innerHTML = masked.trim() ? renderMarkdown(masked) : "";
    replaceMathPlaceholders(editor, formulas);
  }

  function escapeMarkdownText(value) {
    return String(value || "")
      .replace(/\u200b/g, "")
      .replace(/\\/g, "\\\\")
      .replace(/([*_[\]~])/g, "\\$1")
      .replace(/\$/g, "\\$");
  }

  function serializeTableCell(cell) {
    return Array.from(cell.childNodes)
      .map(serializeEditorNode)
      .join("")
      .trim()
      .replace(/\n/g, "<br>")
      .replace(/\|/g, "\\|");
  }

  function serializeEditorNode(node) {
    if (node.nodeType === Node.TEXT_NODE) return escapeMarkdownText(node.data);
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const element = node;
    const tag = element.tagName.toLowerCase();
    if (element.classList.contains("rich-editor-math")) {
      const mathField = element.querySelector("math-field");
      const latex = mathField?.getValue("latex-without-placeholders")?.trim() || "";
      if (!latex) return "";
      return element.dataset.display === "1"
        ? `\n\n$$\n${latex}\n$$\n\n`
        : `$${latex}$`;
    }

    const content = Array.from(element.childNodes).map(serializeEditorNode).join("");
    if (tag === "br") return "\n";
    if (tag === "strong" || tag === "b") return `**${content}**`;
    if (tag === "em" || tag === "i") return `*${content}*`;
    if (tag === "del" || tag === "s" || tag === "strike") return `~~${content}~~`;
    if (tag === "code" && element.parentElement?.tagName.toLowerCase() !== "pre") {
      return `\`${String(element.textContent || "").replace(/`/g, "\\`")}\``;
    }
    if (tag === "a") {
      const href = element.getAttribute("href") || "";
      return href ? `[${content}](${href})` : content;
    }
    if (tag === "img") {
      const src = element.getAttribute("src") || "";
      const alt = element.getAttribute("alt") || "";
      const title = element.getAttribute("title");
      return src ? `![${alt}](${src}${title ? ` "${title}"` : ""})` : "";
    }
    if (tag === "hr") return "\n---\n\n";
    if (tag === "table") {
      const rows = Array.from(element.querySelectorAll("tr")).map((row) =>
        Array.from(row.children).map(serializeTableCell)
      );
      if (!rows.length) return "";
      const columnCount = Math.max(...rows.map((row) => row.length));
      const normalizedRows = rows.map((row) => [
        ...row,
        ...Array(Math.max(0, columnCount - row.length)).fill(""),
      ]);
      const lines = [
        `| ${normalizedRows[0].join(" | ")} |`,
        `| ${Array(columnCount).fill("---").join(" | ")} |`,
        ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`),
      ];
      return `${lines.join("\n")}\n\n`;
    }
    if (/^h[1-6]$/.test(tag)) return `${"#".repeat(Number(tag[1]))} ${content.trim()}\n\n`;
    if (tag === "blockquote") {
      return `${content.trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    if (tag === "pre") return `\`\`\`\n${element.textContent || ""}\n\`\`\`\n\n`;
    if (tag === "li") return `${content.trim()}\n`;
    if (tag === "ul") {
      return `${Array.from(element.children).map((item) => `- ${serializeEditorNode(item)}`).join("")}\n`;
    }
    if (tag === "ol") {
      return `${Array.from(element.children).map((item, index) => `${index + 1}. ${serializeEditorNode(item)}`).join("")}\n`;
    }
    if (tag === "p") return `${content.trim()}\n\n`;
    if (tag === "div") return `${content}\n`;
    return content;
  }

  function editorToMarkdown(editor) {
    return Array.from(editor.childNodes)
      .map(serializeEditorNode)
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function syncEditor(editor) {
    const source = byId(editor.dataset.sourceId);
    if (!source) return "";
    source.value = editorToMarkdown(editor);
    editor.classList.toggle("is-empty", !source.value);
    return source.value;
  }

  function setEditorValue(editorId, value) {
    const editor = byId(editorId);
    if (!editor) return;
    markdownToEditor(editor, value);
    syncEditor(editor);
  }

  function editorForNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.(".rich-text-editor") || null;
  }

  function rangeBelongsToEditor(range, editor) {
    return Boolean(range && editor && editor.contains(range.commonAncestorContainer));
  }

  function rangeAtEditorEnd(editor) {
    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    return range;
  }

  function rememberEditorRange(editor) {
    if (state.activeMathField?.isConnected) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!rangeBelongsToEditor(range, editor)) return;
    if (
      closestWithin(range.startContainer, ".rich-editor-math", editor)
      || closestWithin(range.endContainer, ".rich-editor-math", editor)
    ) return;
    state.editorRanges.set(editor.id, range.cloneRange());
    state.activeEditorId = editor.id;
  }

  function placeCaretAfter(node, editor) {
    const spacer = document.createTextNode("\u200b");
    node.after(spacer);
    const range = document.createRange();
    range.setStartAfter(spacer);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    state.editorRanges.set(editor.id, range.cloneRange());
  }

  function insertImageAtSavedRange(editor, url) {
    if (!editor || editor.contentEditable === "false") return;
    setMathKeyboardOpen(false);
    editor.focus();
    const storedRange = state.editorRanges.get(editor.id);
    const range = rangeBelongsToEditor(storedRange, editor)
      ? storedRange.cloneRange()
      : rangeAtEditorEnd(editor);
    range.deleteContents();
    const image = document.createElement("img");
    image.src = url;
    image.alt = t("communityUploadedImageAlt");
    image.loading = "lazy";
    image.contentEditable = "false";
    range.insertNode(image);
    placeCaretAfter(image, editor);
    syncEditor(editor);
    image.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")));
      reader.addEventListener("error", () => reject(reader.error || new Error("File read failed")));
      reader.readAsDataURL(file);
    });
  }

  function initImageUploads() {
    document.querySelectorAll("[data-image-editor-target]").forEach((button) => {
      const editor = byId(button.dataset.imageEditorTarget);
      const input = byId(button.dataset.imageInput);
      if (!editor || !input) return;

      button.addEventListener("mousedown", (event) => {
        event.preventDefault();
        state.activeEditorId = editor.id;
      });
      button.addEventListener("click", () => {
        if (button.disabled || editor.contentEditable === "false") return;
        state.activeEditorId = editor.id;
        input.click();
      });
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        input.value = "";
        if (!file) return;
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024) {
          setEditorFeedback(editor, t("communityPhotoInvalid"));
          return;
        }

        button.disabled = true;
        setEditorFeedback(editor, t("communityPhotoUploading"), { isBad: false });
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const uploaded = await window.ALevelApi.uploadDiscussionImage(state.token, dataUrl);
          insertImageAtSavedRange(editor, uploaded.url);
          setEditorFeedback(editor, t("communityPhotoAdded"), { isBad: false });
        } catch (err) {
          setEditorFeedback(editor, t("communityPhotoUploadFailed", {
            message: err?.message || t("unknownError"),
          }));
        } finally {
          button.disabled = editor.contentEditable === "false";
        }
      });
    });
  }

  function addMathField(displayMode = state.lastFormulaDisplayMode) {
    const editor = byId(state.activeEditorId);
    if (!editor || editor.contentEditable === "false") return null;
    const previousWrapper = state.activeMathField?.isConnected
      && editor.contains(state.activeMathField)
      ? state.activeMathField.closest(".rich-editor-math")
      : null;
    const storedRange = state.editorRanges.get(editor.id);
    state.activeMathField?.blur();
    editor.focus();
    const range = document.createRange();
    if (previousWrapper) {
      range.setStartAfter(previousWrapper);
      range.collapse(true);
    } else if (rangeBelongsToEditor(storedRange, editor)) {
      range.setStart(storedRange.startContainer, storedRange.startOffset);
      range.setEnd(storedRange.endContainer, storedRange.endOffset);
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.deleteContents();
    const wrapper = createMathNode("", displayMode);
    range.insertNode(wrapper);
    placeCaretAfter(wrapper, editor);
    const mathField = mountMathNode(wrapper);
    syncEditor(editor);
    activateMathField(mathField);
    window.requestAnimationFrame(() => {
      if (!mathField.isConnected) return;
      mathField.focus();
      activateMathField(mathField);
    });
    return mathField;
  }

  function activeMathField() {
    const field = state.activeMathField;
    const editor = byId(state.activeEditorId);
    return field?.isConnected && editor?.contains(field) ? field : null;
  }

  function renderMathKeyboard() {
    const tabs = byId("communityMathKeyboardTabs");
    const keys = byId("communityMathKeyboardKeys");
    if (!tabs || !keys) return;
    const group = MATH_KEY_GROUPS.find((item) => item.id === state.mathKeyboardGroup) || MATH_KEY_GROUPS[0];

    tabs.innerHTML = MATH_KEY_GROUPS.map((item) => `
      <button
        type="button"
        role="tab"
        class="math-keyboard-tab ${item.id === group.id ? "is-active" : ""}"
        data-math-group="${item.id}"
        aria-selected="${item.id === group.id ? "true" : "false"}"
      >${t(item.labelKey)}</button>
    `).join("");
    keys.innerHTML = group.keys.map(([label, latex, titleKey]) => `
      <button
        type="button"
        class="math-key"
        data-math-latex="${escapeHtml(latex)}"
        aria-label="${escapeHtml(t(titleKey) === titleKey ? label : t(titleKey))}"
        title="${escapeHtml(t(titleKey) === titleKey ? label : t(titleKey))}"
      >${escapeHtml(label)}</button>
    `).join("");

    tabs.querySelectorAll("[data-math-group]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        state.mathKeyboardGroup = button.getAttribute("data-math-group") || "common";
        renderMathKeyboard();
        activeMathField()?.focus();
      });
    });
    keys.querySelectorAll("[data-math-latex]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const mathField = activeMathField();
        mathField?.insert(button.getAttribute("data-math-latex") || "", {
          selectionMode: "placeholder",
          focus: true,
        });
      });
    });
  }

  function setMathKeyboardOpen(open, { preserveActive = false } = {}) {
    const panel = byId("communityMathKeyboard");
    if (!panel) return;
    panel.hidden = !open;
    if (open) {
      renderMathKeyboard();
      panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else if (!preserveActive) {
      state.activeMathField = null;
      document.querySelectorAll(".rich-editor-math.is-active").forEach((wrapper) => {
        wrapper.classList.remove("is-active");
        wrapper.querySelector("details")?.removeAttribute("open");
      });
    }
  }

  function firstIncompleteMath(editor) {
    return Array.from(editor.querySelectorAll("math-field")).find((mathField) => {
      const rawLatex = mathField.getValue("latex").trim();
      return !rawLatex || /\\placeholder\b/.test(rawLatex);
    })?.closest(".rich-editor-math") || null;
  }

  function initMathInput() {
    if (window.MathfieldElement) {
      window.MathfieldElement.soundsDirectory = null;
      window.MathfieldElement.keypressSound = null;
      window.MathfieldElement.plonkSound = null;
    }
    renderMathKeyboard();
    document.querySelectorAll("[data-editor-target]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        state.activeEditorId = button.dataset.editorTarget;
        addMathField();
      });
    });
    byId("communityMathKeyboard").addEventListener("mousedown", (event) => {
      if (!event.target.closest("#communityMathKeyboardClose")) event.preventDefault();
    });
    byId("communityMathKeyboardClose").addEventListener("click", () => {
      state.activeMathField?.blur();
      setMathKeyboardOpen(false, { preserveActive: true });
    });
    byId("communityMathClear").addEventListener("click", () => {
      const mathField = activeMathField();
      mathField?.setValue("");
      const editor = mathField?.closest(".rich-text-editor");
      if (editor) syncEditor(editor);
      mathField?.focus();
    });
    document.querySelectorAll("[data-math-command]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => {
        const mathField = activeMathField();
        mathField?.executeCommand(button.getAttribute("data-math-command"));
        mathField?.focus();
      });
    });
    document.addEventListener("focusin", (event) => {
      const focusedWrapper = document.activeElement?.closest?.(".rich-editor-math");
      const focusedMathField = focusedWrapper?.querySelector("math-field");
      if (focusedMathField) {
        activateMathField(focusedMathField);
        return;
      }
      if (
        event.target.closest?.(".rich-editor-math")
        || event.target.closest?.("#communityMathKeyboard")
      ) return;
      state.activeMathField = null;
      setMathKeyboardOpen(false);
    });
    document.addEventListener("mousedown", (event) => {
      if (
        event.target.closest?.(".rich-editor-math")
        || event.target.closest?.("#communityMathKeyboard")
        || event.target.closest?.("[data-editor-target]")
      ) return;
      setMathKeyboardOpen(false);
    });
    const repositionFormulaMenus = () => {
      document.querySelectorAll(".rich-editor-math-menu[open]").forEach(positionFormulaMenu);
    };
    window.addEventListener("resize", repositionFormulaMenus);
    window.addEventListener("scroll", repositionFormulaMenus, true);
  }

  function selectedTextNodes(range, editor) {
    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!range.intersectsNode(node)) continue;
      const start = node === range.startContainer ? range.startOffset : 0;
      const end = node === range.endContainer ? range.endOffset : node.data.length;
      if (node.data.slice(start, end).trim()) nodes.push(node);
    }
    return nodes;
  }

  function closestWithin(node, selector, editor) {
    const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    const match = element?.closest?.(selector);
    return match && editor.contains(match) ? match : null;
  }

  function selectionIntersectsMath(range, editor) {
    const startMath = closestWithin(range.startContainer, ".rich-editor-math", editor);
    const endMath = closestWithin(range.endContainer, ".rich-editor-math", editor);
    return Boolean(
      startMath
      || endMath
      || range.cloneContents().querySelector?.(".rich-editor-math")
    );
  }

  function selectionFormatState(range, editor) {
    const nodes = selectedTextNodes(range, editor);
    const allInside = (selector) => (
      nodes.length > 0 && nodes.every((node) => closestWithin(node, selector, editor))
    );
    const links = nodes.map((node) => closestWithin(node, "a", editor));
    const link = links.length > 0
      && links[0]
      && links.every((item) => item === links[0])
      ? links[0]
      : null;
    return {
      bold: allInside("strong, b"),
      italic: allInside("em, i"),
      strike: allInside("del, s, strike"),
      code: allInside("code"),
      link: Boolean(link),
      linkElement: link,
    };
  }

  function updateFormattingButtons(formatState) {
    byId("communityFormattingToolbar").querySelectorAll("[data-format-command]").forEach((button) => {
      const active = Boolean(formatState[button.dataset.formatCommand]);
      button.setAttribute("aria-pressed", active ? "true" : "false");
      button.classList.toggle("is-active", active);
    });
  }

  function hideFormattingToolbar() {
    byId("communityFormattingToolbar").hidden = true;
  }

  function updateFormattingToolbar() {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed || !selection.toString().trim()) {
      hideFormattingToolbar();
      return;
    }
    const range = selection.getRangeAt(0);
    const editor = editorForNode(range.commonAncestorContainer);
    if (!editor || selectionIntersectsMath(range, editor)) {
      hideFormattingToolbar();
      return;
    }
    const formatState = selectionFormatState(range, editor);
    state.formattingRange = range.cloneRange();
    state.formattingEditorId = editor.id;
    updateFormattingButtons(formatState);
    const toolbar = byId("communityFormattingToolbar");
    const rect = range.getBoundingClientRect();
    toolbar.hidden = false;
    const left = Math.max(8, Math.min(
      rect.left + (rect.width - toolbar.offsetWidth) / 2,
      window.innerWidth - toolbar.offsetWidth - 8
    ));
    const top = rect.top > toolbar.offsetHeight + 12
      ? rect.top - toolbar.offsetHeight - 8
      : rect.bottom + 8;
    toolbar.style.left = `${left}px`;
    toolbar.style.top = `${Math.max(8, top)}px`;
  }

  function restoreFormattingSelection() {
    const editor = byId(state.formattingEditorId);
    if (!editor || !rangeBelongsToEditor(state.formattingRange, editor)) return null;
    editor.focus();
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(state.formattingRange);
    return editor;
  }

  function fragmentHasContent(fragment) {
    return Boolean(fragment.textContent || fragment.querySelector?.("*"));
  }

  function unwrapSelectedInline(range, wrapper) {
    const beforeRange = document.createRange();
    beforeRange.selectNodeContents(wrapper);
    beforeRange.setEnd(range.startContainer, range.startOffset);
    const before = beforeRange.cloneContents();
    const afterRange = document.createRange();
    afterRange.selectNodeContents(wrapper);
    afterRange.setStart(range.endContainer, range.endOffset);
    const after = afterRange.cloneContents();
    const selected = range.cloneContents();
    const replacement = document.createDocumentFragment();
    if (fragmentHasContent(before)) {
      const beforeWrapper = wrapper.cloneNode(false);
      beforeWrapper.append(before);
      replacement.append(beforeWrapper);
    }
    replacement.append(selected);
    if (fragmentHasContent(after)) {
      const afterWrapper = wrapper.cloneNode(false);
      afterWrapper.append(after);
      replacement.append(afterWrapper);
    }
    wrapper.replaceWith(replacement);
  }

  function toggleCodeFormat(editor) {
    const selection = window.getSelection();
    const range = selection.getRangeAt(0);
    const formatState = selectionFormatState(range, editor);
    if (formatState.code) {
      const code = closestWithin(range.startContainer, "code", editor);
      const sameCode = code && code === closestWithin(range.endContainer, "code", editor);
      if (sameCode) unwrapSelectedInline(range, code);
      return;
    }
    const code = document.createElement("code");
    code.append(range.extractContents());
    range.insertNode(code);
  }

  function applyTextFormat(command) {
    const savedEditor = byId(state.formattingEditorId);
    const savedState = savedEditor && state.formattingRange
      ? selectionFormatState(state.formattingRange, savedEditor)
      : {};
    if (command === "link") {
      const currentHref = savedState.linkElement?.getAttribute("href") || "";
      const response = window.prompt(t("communityFormatLinkPrompt"), currentHref);
      if (response === null) return;
      const href = response.trim();
      if (!href && !savedState.linkElement) return;
      if (!/^(https?:\/\/|mailto:)/i.test(href)) {
        if (!href && savedState.linkElement) {
          const editor = restoreFormattingSelection();
          if (!editor) return;
          unwrapSelectedInline(window.getSelection().getRangeAt(0), savedState.linkElement);
          syncEditor(editor);
          hideFormattingToolbar();
          return;
        }
        if (savedEditor) setEditorFeedback(savedEditor, t("communityFormatLinkInvalid"));
        else showToast(t("communityFormatLinkInvalid"));
        return;
      }
      const editor = restoreFormattingSelection();
      if (!editor) return;
      if (savedState.linkElement) savedState.linkElement.setAttribute("href", href);
      else document.execCommand("createLink", false, href);
      syncEditor(editor);
    } else {
      const editor = restoreFormattingSelection();
      if (!editor) return;
      if (command === "code") {
        toggleCodeFormat(editor);
      } else {
        const browserCommand = command === "strike" ? "strikeThrough" : command;
        document.execCommand(browserCommand, false);
      }
      syncEditor(editor);
      rememberEditorRange(editor);
    }
    hideFormattingToolbar();
  }

  function initRichEditors() {
    [
      ["communityBodyEditor", "communityBodyPlaceholder"],
      ["communityReplyEditor", "communityReplyPlaceholder"],
    ].forEach(([editorId, placeholderKey]) => {
      const editor = byId(editorId);
      editor.dataset.placeholder = t(placeholderKey);
      editor.addEventListener("input", () => {
        syncEditor(editor);
        clearEditorFeedback(editor, "editor");
      });
      editor.addEventListener("focus", () => {
        state.activeEditorId = editor.id;
        state.activeMathField = null;
      });
      editor.addEventListener("mousedown", (event) => {
        if (!event.target.closest?.(".rich-editor-math")) state.activeMathField = null;
      });
      ["keyup", "mouseup"].forEach((eventName) => {
        editor.addEventListener(eventName, () => rememberEditorRange(editor));
      });
      editor.addEventListener("paste", (event) => {
        event.preventDefault();
        document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") || "");
      });
      setEditorValue(editorId, "");
    });

    document.addEventListener("selectionchange", () => {
      const selection = window.getSelection();
      const editor = selection?.rangeCount
        ? editorForNode(selection.getRangeAt(0).commonAncestorContainer)
        : null;
      if (editor) rememberEditorRange(editor);
      updateFormattingToolbar();
    });
    window.addEventListener("resize", hideFormattingToolbar);
    window.addEventListener("scroll", hideFormattingToolbar, true);
    byId("communityFormattingToolbar").querySelectorAll("[data-format-command]").forEach((button) => {
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", () => applyTextFormat(button.dataset.formatCommand));
    });
  }

  function readJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_err) {
      return fallback;
    }
  }

  function readContext() {
    const params = new URLSearchParams(location.search);
    const selection = readJson("alevel.selection", {}) || {};
    return {
      questionKey: params.get("questionKey") || "",
      board: params.get("board") || selection.board || "CIE",
      subject: params.get("subject") || selection.subject || "IGCSE Chemistry",
      subjectCode: params.get("subjectCode") || selection.subjectCode || "",
      paper: params.get("paper") || selection.paper || "MCQ",
      topic: params.get("topic") || "",
      stem: params.get("stem") || "",
    };
  }

  function setStatus(message, isBad) {
    const el = byId("communityStatus");
    if (!el) return;
    el.textContent = message || "";
    el.className = isBad ? "tip bad" : "tip good";
  }

  function hideToast() {
    if (state.toastTimer) window.clearTimeout(state.toastTimer);
    state.toastTimer = null;
    const toast = byId("communityToast");
    if (toast) toast.hidden = true;
  }

  function showToast(message, isBad = true) {
    const toast = byId("communityToast");
    const text = byId("communityToastMessage");
    if (!toast || !text || !message) return;
    hideToast();
    text.textContent = message;
    toast.classList.toggle("is-success", !isBad);
    toast.hidden = false;
    if (!isBad) {
      state.toastTimer = window.setTimeout(hideToast, 3500);
    }
  }

  function errorIdForEditor(editor) {
    return editor?.id === "communityReplyEditor"
      ? "communityReplyError"
      : "communityComposerError";
  }

  function clearEditorFeedback(editor, changedTarget = "") {
    if (!editor) return;
    const feedback = byId(errorIdForEditor(editor));
    if (changedTarget && feedback?.dataset.targetKind && feedback.dataset.targetKind !== changedTarget) {
      return;
    }
    if (feedback) {
      feedback.textContent = "";
      feedback.hidden = true;
      feedback.classList.remove("is-success");
      delete feedback.dataset.targetKind;
    }
    editor.classList.remove("is-invalid");
    editor.removeAttribute("aria-invalid");
    editor.removeAttribute("aria-describedby");
    editor.querySelectorAll(".rich-editor-math.is-invalid").forEach((wrapper) => {
      wrapper.classList.remove("is-invalid");
      const mathField = wrapper.querySelector("math-field");
      mathField?.removeAttribute("aria-invalid");
      mathField?.removeAttribute("aria-describedby");
    });
    if (editor.id === "communityBodyEditor") {
      byId("communityTitle")?.classList.remove("is-invalid");
      byId("communityTitle")?.removeAttribute("aria-invalid");
      byId("communityTitle")?.removeAttribute("aria-describedby");
    }
  }

  function setEditorFeedback(editor, message, { target = editor, isBad = true } = {}) {
    const feedback = byId(errorIdForEditor(editor));
    if (!feedback) return;
    clearEditorFeedback(editor);
    feedback.textContent = message;
    feedback.hidden = false;
    feedback.classList.toggle("is-success", !isBad);
    feedback.dataset.targetKind = target?.id === "communityTitle"
      ? "title"
      : target?.matches?.(".rich-editor-math") ? "math" : "editor";
    if (!isBad) return;
    target?.classList?.add("is-invalid");
    target?.setAttribute?.("aria-invalid", "true");
    target?.setAttribute?.("aria-describedby", feedback.id);
    const mathField = target?.matches?.(".rich-editor-math")
      ? target.querySelector("math-field")
      : null;
    mathField?.setAttribute("aria-invalid", "true");
    mathField?.setAttribute("aria-describedby", feedback.id);
    window.requestAnimationFrame(() => {
      if (feedback.hidden || target?.getAttribute?.("aria-invalid") !== "true") return;
      target?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
      if (!mathField) target?.focus?.();
    });
  }

  function showCommunityView(view, { restoreScroll = false } = {}) {
    const listPanel = byId("communityListPanel");
    const composerPanel = byId("communityComposerPanel");
    const detailPanel = byId("communityDetailPanel");
    if (view !== "list" && !listPanel.hidden) state.listScrollY = window.scrollY;
    listPanel.hidden = view !== "list";
    composerPanel.hidden = view !== "composer";
    detailPanel.hidden = view !== "detail";
    if (view === "list" && restoreScroll) {
      window.requestAnimationFrame(() => window.scrollTo({ top: state.listScrollY }));
    }
  }

  function authHeaderMissing() {
    if (!state.token && localStorage.getItem(VISITOR_MODE_KEY) !== "1") {
      location.href = "./login.html";
      return true;
    }
    return false;
  }

  function paperPartsFromKey(questionKey) {
    const key = String(questionKey || "");
    const standard = key.match(/^CIE-IGCHEM-(\d{4})-([SMW])-(\d)(\d)-/i);
    if (standard) {
      return {
        season: standard[2].toLowerCase(),
        year: standard[1].slice(-2),
        paperNumber: standard[3],
        variant: standard[4],
      };
    }

    const paperSet = key.match(/(\d{4})_([msw])(\d{2})_qp_(\d)(\d)/i);
    if (paperSet) {
      return {
        syllabus: paperSet[1],
        season: paperSet[2].toLowerCase(),
        year: paperSet[3],
        paperNumber: paperSet[4],
        variant: paperSet[5],
      };
    }

    return { syllabus: "", season: "", year: "", paperNumber: "", variant: "" };
  }

  function readPaperFilter() {
    return {
      syllabus: byId("communitySyllabusCode").value,
      examSeason: byId("communityExamSeason").value,
      examYear: byId("communityExamYear").value,
      paperNumber: byId("communityPaperNumber").value,
      variant: byId("communityVariant").value,
    };
  }

  function renderPaperReferencePreview() {
    const filter = readPaperFilter();
    const reference = `${filter.syllabus}_${filter.examSeason || "*"}${filter.examYear || "**"}_qp_${filter.paperNumber || "*"}${filter.variant || "*"}`;
    byId("communityPaperReferencePreview").textContent = t("communityPaperReferencePreview", { reference });
  }

  function fillSelectOptions(selectId, values, allLabel, formatLabel) {
    const select = byId(selectId);
    const current = select.value;
    select.innerHTML = `${allLabel == null ? "" : `<option value="">${escapeHtml(allLabel)}</option>`}${values.map((value) => `
      <option value="${escapeHtml(value)}">${escapeHtml(formatLabel(value))}</option>
    `).join("")}`;
    if ([...select.options].some((option) => option.value === current)) select.value = current;
  }

  function papersForSelectedSubject() {
    const code = byId("communitySyllabusCode").value;
    return state.catalogPapers.filter((paper) => paper.subjectCode === code);
  }

  function localizedSubjectName(subject) {
    return getLanguage() === "zh-CN" ? (subject.nameZh || subject.name) : subject.name;
  }

  function localizedThreadTitle(thread) {
    const title = String(thread.title || "");
    const questionKey = String(thread.questionKey || "");
    const chineseMatch = title.match(/^关于题目\s+(.+?)\s+的疑问$/);
    const englishMatch = title.match(/^Question about\s+(.+)$/);
    const templateKey = chineseMatch?.[1] || englishMatch?.[1] || "";
    return questionKey && templateKey === questionKey
      ? t("communityDefaultQuestionTitle", { key: questionKey })
      : title;
  }

  function refreshCatalogFilterOptions() {
    const papers = papersForSelectedSubject();
    const unique = (items) => [...new Set(items)].sort((a, b) => String(a).localeCompare(String(b)));
    fillSelectOptions("communityExamSeason", unique(papers.map((paper) => paper.season)), t("communityAllExamSeasons"), (value) => ({
      m: t("communityExamSeasonMarch"),
      s: t("communityExamSeasonSummer"),
      w: t("communityExamSeasonWinter"),
    }[value] || value));
    fillSelectOptions("communityExamYear", unique(papers.map((paper) => String(paper.year).slice(-2))), t("communityAllExamYears"), (value) => `20${value}`);
    fillSelectOptions("communityPaperNumber", unique(papers.map((paper) => String(paper.paperNumber))), t("communityAllPaperNumbers"), (value) => `Paper ${value}`);
    fillSelectOptions("communityVariant", unique(papers.map((paper) => String(paper.variant))), t("communityAllVariants"), (value) => `Variant ${value}`);
  }

  async function loadCatalogFilters() {
    const subjects = await window.ALevelApi.getCatalogSubjects();
    state.catalogSubjects = Array.isArray(subjects) ? subjects : [];
    byId("communitySyllabusCode").innerHTML = state.catalogSubjects.map((subject) => `
      <option value="${escapeHtml(subject.code)}">${escapeHtml(`${subject.code} - ${localizedSubjectName(subject)}`)}</option>
    `).join("");
    const paperLists = await Promise.all(state.catalogSubjects.map((subject) => (
      window.ALevelApi.getCatalogPapers(subject.code)
    )));
    state.catalogPapers = paperLists.flat();
  }

  async function fillFilters() {
    const parts = paperPartsFromKey(state.context.questionKey);
    const contextSyllabus = state.context.subjectCode
      || state.catalogSubjects.find((subject) => `${subject.qualification} ${subject.name}` === state.context.subject)?.code
      || state.catalogSubjects[0]?.code
      || "0620";
    byId("communitySyllabusCode").value = parts.syllabus || contextSyllabus;
    refreshCatalogFilterOptions();
    byId("communityExamSeason").value = parts.season;
    byId("communityExamYear").value = parts.year;
    byId("communityPaperNumber").value = parts.paperNumber;
    byId("communityVariant").value = parts.variant;
    renderPaperReferencePreview();
  }

  async function renderContext() {
    const box = byId("communityQuestionContext");
    if (!state.context.questionKey && !state.context.topic) {
      box.innerHTML = "";
      return;
    }
    const reference = await getQuestionReference(state.context.questionKey);
    box.innerHTML = `
      ${renderQuestionReference(reference)}
      <div class="tag-row">
        ${state.context.questionKey ? `<span class="tag">${t("communityQuestionTag", { key: escapeHtml(state.context.questionKey) })}</span>` : ""}
        ${state.context.topic ? `<span class="tag">${escapeHtml(state.context.topic)}</span>` : ""}
        <span class="tag">${escapeHtml(state.context.subject || "IGCSE Chemistry")}</span>
        <span class="tag">${escapeHtml(state.context.paper || "MCQ")}</span>
      </div>
      ${state.context.stem ? `<p class="tip">${escapeHtml(state.context.stem)}</p>` : ""}
    `;
  }

  function buildFilterInput() {
    const paperFilter = readPaperFilter();
    return {
      ...paperFilter,
      subject: selectedDiscussionSubject(),
      paper: state.context.paper || "MCQ",
      status: byId("communityStatusFilter").value,
      search: byId("communityFeedSearch").value.trim(),
      topic: byId("communityFeedTopic").value,
      sort: byId("communityFeedSort").value,
      followedOnly: state.followedOnly ? "1" : "",
      limit: 30,
    };
  }

  function selectedDiscussionSubject() {
    const subject = state.catalogSubjects.find((item) => item.code === byId("communitySyllabusCode")?.value);
    return subject ? `${subject.qualification} ${subject.name}` : state.context.subject || "IGCSE Chemistry";
  }

  function renderFollowedToggle() {
    const button = byId("communityFollowedToggle");
    button.textContent = state.followedOnly ? t("communityShowAll") : t("communityShowFollowed");
    button.className = state.followedOnly ? "btn-primary" : "btn-secondary";
    button.setAttribute("aria-pressed", state.followedOnly ? "true" : "false");
  }

  function statusLabel(status) {
    if (status === "solved") return t("communityStatusSolved");
    if (status === "locked") return t("communityStatusLocked");
    if (status === "hidden") return t("communityStatusHidden");
    return t("communityStatusOpen");
  }

  function renderFeedTopicOptions() {
    const select = byId("communityFeedTopic");
    const selected = select.value;
    const topics = [...new Set(state.threads.map((thread) => thread.topic).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    select.innerHTML = `<option value="">${escapeHtml(t("communityAllTopics"))}</option>${topics.map((topic) => `
      <option value="${escapeHtml(topic)}">${escapeHtml(topic)}</option>
    `).join("")}`;
    if (topics.includes(selected)) select.value = selected;
  }

  function renderThreads() {
    const wrap = byId("communityThreadList");
    renderFeedTopicOptions();
    if (!state.threads.length) {
      wrap.innerHTML = `<p class="tip community-feed-empty">${t("communityNoThreads")}</p>`;
      return;
    }
    wrap.innerHTML = state.threads.map((thread) => `
      <article class="discussion-thread community-feed-card ${thread.sticky ? "is-sticky" : ""}" data-thread-id="${escapeHtml(thread.id)}">
        <div class="discussion-thread-head">
          <button class="thread-title-button" data-open-thread="${escapeHtml(thread.id)}">
            ${thread.sticky ? `<span class="status-pill">${t("communitySticky")}</span>` : ""}
            <span>${escapeHtml(localizedThreadTitle(thread))}</span>
          </button>
          <span class="status-pill status-${escapeHtml(thread.status)}">${statusLabel(thread.status)}</span>
        </div>
        ${thread.preview ? `<p class="community-feed-preview">${escapeHtml(thread.preview.replace(/\s+/g, " ").trim().slice(0, 240))}</p>` : ""}
        <div class="tag-row">
          ${thread.subject ? `<span class="tag">${escapeHtml(thread.subject)}</span>` : ""}
          ${(thread.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
          ${thread.topic ? `<span class="tag">${escapeHtml(thread.topic)}</span>` : ""}
          ${thread.questionKey ? `<span class="tag">${t("communityQuestionTag", { key: escapeHtml(thread.questionKey) })}</span>` : ""}
        </div>
        <p class="tip">${t("communityThreadMeta", {
          author: thread.authorName || t("unknownUser"),
          answers: Math.max(0, Number(thread.postCount || 0) - 1),
          likes: thread.likeCount,
          time: thread.lastPostAt ? new Date(thread.lastPostAt).toLocaleString() : "-",
        })}</p>
      </article>
    `).join("");

    wrap.querySelectorAll("[data-open-thread]").forEach((button) => {
      button.addEventListener("click", () => openThread(
        button.getAttribute("data-open-thread"),
        { scrollIntoView: true }
      ));
    });
  }

  async function loadThreads() {
    if (authHeaderMissing()) return;
    setStatus(t("communityLoading"), false);
    try {
      state.threads = await window.ALevelApi.getDiscussions(state.token, buildFilterInput());
      renderThreads();
      setStatus(t("communityLoaded", { count: state.threads.length }), false);
    } catch (err) {
      const message = t("communityLoadFailed", { message: err.message || t("unknownError") });
      setStatus(message, true);
      showToast(message);
    }
  }

  function renderPosts(payload, questionReference) {
    const thread = payload.thread;
    const posts = payload.posts || [];
    const detail = byId("communityThreadDetail");
    const canModerate = state.user?.role === "teacher" || state.user?.role === "admin";
    const visitorMode = state.user?.role === "visitor";
    const replyDisabled = visitorMode || thread.status === "locked" || thread.status === "hidden";
    byId("communityReplyComposer").hidden = visitorMode;
    byId("communityReplyBody").disabled = replyDisabled;
    byId("communityReplyEditor").contentEditable = replyDisabled ? "false" : "true";
    byId("communityReplyAddPhoto").disabled = replyDisabled;
    byId("communityReplyInsertFormula").disabled = replyDisabled;
    byId("communitySubmitReply").disabled = thread.status === "locked" || thread.status === "hidden";

    detail.innerHTML = `
      <div class="discussion-detail-head">
        <div>
          <h2>${escapeHtml(localizedThreadTitle(thread))}</h2>
          <div class="tag-row">
            <span class="status-pill status-${escapeHtml(thread.status)}">${statusLabel(thread.status)}</span>
            ${(thread.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
            ${thread.followed ? `<span class="tag">${t("communityFollowing")}</span>` : ""}
          </div>
        </div>
        ${visitorMode ? "" : `<button id="communityFollowToggle" class="btn-secondary">${thread.followed ? t("communityUnfollow") : t("communityFollow")}</button>`}
      </div>
      ${canModerate ? `
        <div class="moderation-row">
          <label><span>${t("communityStatusLabel")}</span>
            <select id="communityModerationStatus">
              <option value="open">${t("communityStatusOpen")}</option>
              <option value="solved">${t("communityStatusSolved")}</option>
              <option value="locked">${t("communityStatusLocked")}</option>
              <option value="hidden">${t("communityStatusHidden")}</option>
            </select>
          </label>
          <label class="inline-check"><input id="communityModerationSticky" type="checkbox" /> <span>${t("communitySticky")}</span></label>
          <button id="communitySaveModeration" class="btn-secondary">${t("communitySaveModeration")}</button>
        </div>
      ` : ""}
      ${renderQuestionReference(questionReference)}
      <div class="discussion-posts">
        ${posts.map((post, postIndex) => `
          <article class="discussion-post" data-post-id="${escapeHtml(post.id)}">
            <div class="discussion-post-meta">
              <strong>${escapeHtml(post.authorName || t("unknownUser"))}</strong>
              <span>${post.createdAt ? new Date(post.createdAt).toLocaleString() : "-"}</span>
              <span class="discussion-post-kind">${postIndex === 0
                ? t("communityQuestionPost")
                : t("communityAnswerNumber", { number: postIndex })}</span>
            </div>
            <div class="markdown-body">${renderMarkdown(post.body)}</div>
            ${visitorMode ? "" : `<div class="actions compact-actions">
              <button type="button" class="btn-secondary" data-like-post="${escapeHtml(post.id)}" data-liked="${post.liked ? "1" : "0"}">${post.liked ? t("communityLiked") : t("communityHelpful")} (${post.likeCount})</button>
              ${String(post.authorId) !== String(state.user?.id)
                ? `<button type="button" class="btn-secondary" data-flag-post="${escapeHtml(post.id)}">${t("communityFlag")}</button>`
                : ""}
              ${postIndex > 0 && (state.user?.role === "admin" || String(post.authorId) === String(state.user?.id))
                ? `<button type="button" class="btn-danger" data-delete-post="${escapeHtml(post.id)}">${t("communityDeleteReply")}</button>`
                : ""}
              ${canModerate ? `<span class="tip">${t("communityFlagCount", { count: post.flagCount })}</span>` : ""}
            </div>`}
          </article>
        `).join("")}
      </div>
    `;

    const followToggle = byId("communityFollowToggle");
    if (followToggle) {
      followToggle.addEventListener("click", async () => {
        followToggle.disabled = true;
        try {
          if (thread.followed) await window.ALevelApi.unfollowDiscussion(state.token, thread.id);
          else await window.ALevelApi.followDiscussion(state.token, thread.id);
          await openThread(thread.id);
          await loadThreads();
        } catch (err) {
          showToast(t("communityActionFailed", { message: err.message || t("unknownError") }));
        } finally {
          if (followToggle.isConnected) followToggle.disabled = false;
        }
      });
    }

    detail.querySelectorAll("[data-like-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        const postId = button.getAttribute("data-like-post");
        const liked = button.getAttribute("data-liked") === "1";
        button.disabled = true;
        try {
          if (liked) await window.ALevelApi.unlikeDiscussionPost(state.token, postId);
          else await window.ALevelApi.likeDiscussionPost(state.token, postId);
          await openThread(thread.id);
          await loadThreads();
        } catch (err) {
          showToast(t("communityActionFailed", { message: err.message || t("unknownError") }));
          if (button.isConnected) button.disabled = false;
        }
      });
    });

    detail.querySelectorAll("[data-flag-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        const reason = window.prompt(t("communityFlagReason")) || "";
        if (!reason.trim()) return;
        button.disabled = true;
        try {
          await window.ALevelApi.flagDiscussionPost(state.token, button.getAttribute("data-flag-post"), { reason });
          showToast(t("communityFlagged"), false);
          await openThread(thread.id);
        } catch (err) {
          showToast(t("communityActionFailed", { message: err.message || t("unknownError") }));
          if (button.isConnected) button.disabled = false;
        }
      });
    });

    detail.querySelectorAll("[data-delete-post]").forEach((button) => {
      button.addEventListener("click", async () => {
        if (!window.confirm(t("communityDeleteReplyConfirm"))) return;
        button.disabled = true;
        try {
          await window.ALevelApi.deleteDiscussionPost(
            state.token,
            button.getAttribute("data-delete-post")
          );
          showToast(t("communityReplyDeleted"), false);
          await openThread(thread.id);
          await loadThreads();
        } catch (err) {
          button.disabled = false;
          showToast(t("communityDeleteReplyFailed", {
            message: err.message || t("unknownError"),
          }));
        }
      });
    });

    if (canModerate) {
      byId("communityModerationStatus").value = thread.status;
      byId("communityModerationSticky").checked = Boolean(thread.sticky);
      byId("communitySaveModeration").addEventListener("click", async () => {
        const button = byId("communitySaveModeration");
        button.disabled = true;
        try {
          await window.ALevelApi.moderateDiscussion(state.token, thread.id, {
            status: byId("communityModerationStatus").value,
            sticky: byId("communityModerationSticky").checked,
          });
          showToast(t("communityModerationSaved"), false);
          await openThread(thread.id);
          await loadThreads();
        } catch (err) {
          showToast(t("communityActionFailed", { message: err.message || t("unknownError") }));
          if (button.isConnected) button.disabled = false;
        }
      });
    }
  }

  async function openThread(threadId, { scrollIntoView = false } = {}) {
    state.currentThreadId = threadId;
    try {
      const payload = await window.ALevelApi.getDiscussion(state.token, threadId);
      const questionReference = await getQuestionReference(payload.thread?.questionKey);
      renderPosts(payload, questionReference);
      setMathKeyboardOpen(false);
      clearEditorFeedback(byId("communityReplyEditor"));
      showCommunityView("detail");
      if (scrollIntoView) {
        window.requestAnimationFrame(() => {
          byId("communityDetailPanel").scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }
    } catch (err) {
      showToast(t("communityLoadFailed", { message: err.message || t("unknownError") }));
    }
  }

  function openComposer() {
    setMathKeyboardOpen(false);
    showCommunityView("composer");
    byId("communityTitle").value = state.context.questionKey
      ? t("communityDefaultQuestionTitle", { key: state.context.questionKey })
      : "";
    setEditorValue(
      "communityBodyEditor",
      state.context.stem ? `${state.context.stem}\n\n` : ""
    );
    state.activeEditorId = "communityBodyEditor";
    state.activeMathField = null;
    byId("communityTagSelect").value = state.context.questionKey ? "question" : "topic";
    clearEditorFeedback(byId("communityBodyEditor"));
    byId("communityTitle").focus();
  }

  async function submitThread() {
    const titleInput = byId("communityTitle");
    const title = titleInput.value.trim();
    const editor = byId("communityBodyEditor");
    const body = syncEditor(editor).trim();
    const incompleteMath = firstIncompleteMath(editor);
    if (incompleteMath) {
      setEditorFeedback(editor, t("communityMathIncomplete"), { target: incompleteMath });
      return;
    }
    if (!title) {
      setEditorFeedback(editor, t("communityTitleRequired"), { target: titleInput });
      return;
    }
    if (!body) {
      setEditorFeedback(editor, t("communityBodyRequired"));
      return;
    }
    if (body.length > Number(byId("communityBody").maxLength || 4000)) {
      setEditorFeedback(editor, t("communityMathTooLong"));
      return;
    }
    clearEditorFeedback(editor);
    byId("communitySubmitThread").disabled = true;
    try {
      const thread = await window.ALevelApi.createDiscussion(state.token, {
        questionKey: state.context.questionKey || null,
        title,
        body,
        board: state.context.board || "CIE",
        subjectCode: byId("communitySyllabusCode").value,
        subject: selectedDiscussionSubject(),
        paper: state.context.paper || "MCQ",
        topic: state.context.topic || null,
        tags: [byId("communityTagSelect").value],
      });
      await loadThreads();
      await openThread(thread.id);
      showToast(t("communityCreated"), false);
    } catch (err) {
      setEditorFeedback(editor, t("communityCreateFailed", {
        message: err.message || t("unknownError"),
      }));
    } finally {
      byId("communitySubmitThread").disabled = false;
    }
  }

  async function submitReply() {
    const editor = byId("communityReplyEditor");
    const body = syncEditor(editor).trim();
    const incompleteMath = firstIncompleteMath(editor);
    if (incompleteMath) {
      setEditorFeedback(editor, t("communityMathIncomplete"), { target: incompleteMath });
      return;
    }
    if (!state.currentThreadId || !body) {
      setEditorFeedback(editor, t("communityReplyRequired"));
      return;
    }
    if (body.length > Number(byId("communityReplyBody").maxLength || 4000)) {
      setEditorFeedback(editor, t("communityMathTooLong"));
      return;
    }
    clearEditorFeedback(editor);
    byId("communitySubmitReply").disabled = true;
    try {
      await window.ALevelApi.replyDiscussion(state.token, state.currentThreadId, { body });
      setEditorValue("communityReplyEditor", "");
      await openThread(state.currentThreadId);
      await loadThreads();
      showToast(t("communityReplyCreated"), false);
    } catch (err) {
      setEditorFeedback(editor, t("communityReplyFailed", {
        message: err.message || t("unknownError"),
      }));
    } finally {
      byId("communitySubmitReply").disabled = false;
    }
  }

  async function initUser() {
    if (!state.token && localStorage.getItem(VISITOR_MODE_KEY) === "1") {
      state.user = { id: "", role: "visitor", displayName: t("visitorMode") };
      return true;
    }
    const saved = readJson(USER_PROFILE_KEY, null);
    state.user = saved || null;
    if (state.token && window.ALevelApi?.getCurrentUser) {
      try {
        state.user = await window.ALevelApi.getCurrentUser(state.token);
        localStorage.setItem(USER_PROFILE_KEY, JSON.stringify(state.user));
      } catch (err) {
        if (err?.status === 401 || err?.status === 403) {
          window.ALevelChatSession?.clear();
          localStorage.removeItem(USER_PROFILE_KEY);
          localStorage.removeItem(USER_ID_KEY);
          localStorage.removeItem(AUTH_TOKEN_KEY);
          location.href = "./login.html";
          return false;
        }
        setStatus(t("communityLoadFailed", {
          message: err?.message || t("unknownError"),
        }), true);
        showToast(t("communityLoadFailed", {
          message: err?.message || t("unknownError"),
        }));
      }
    }
    return true;
  }

  async function init() {
    applyPage();
    byId("communityToastClose").addEventListener("click", hideToast);
    const filterCard = document.querySelector(".community-filter-card");
    filterCard.open = !window.matchMedia("(max-width: 900px)").matches;
    if (authHeaderMissing()) return;
    if (!await initUser()) return;
    const visitorMode = state.user?.role === "visitor";
    if (visitorMode) {
      byId("communityNewThread").hidden = true;
      byId("communityFollowedToggle").hidden = true;
      byId("communityLogout").dataset.i18n = "visitorLogIn";
      byId("communityLogout").textContent = t("visitorLogIn");
      setStatus(t("communityVisitorNotice"), false);
    }
    await loadCatalogFilters();
    await fillFilters();
    await renderContext();
    byId("communityFeedSearchForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      await loadThreads();
      showCommunityView("list");
    });
    byId("communityFeedTopic").addEventListener("change", loadThreads);
    byId("communityFeedSort").addEventListener("change", loadThreads);
    ["communitySyllabusCode", "communityExamSeason", "communityExamYear", "communityPaperNumber", "communityVariant"].forEach((id) => {
      byId(id).addEventListener("change", () => {
        if (id === "communitySyllabusCode") refreshCatalogFilterOptions();
        renderPaperReferencePreview();
      });
    });
    byId("communityApplyFilters").addEventListener("click", async () => {
      await loadThreads();
      showCommunityView("list");
      if (window.matchMedia("(max-width: 900px)").matches) {
        byId("communityApplyFilters").closest("details")?.removeAttribute("open");
      }
    });
    byId("communityResetFilters").addEventListener("click", async () => {
      byId("communitySyllabusCode").value = state.context.subjectCode
        || state.catalogSubjects.find((subject) => `${subject.qualification} ${subject.name}` === state.context.subject)?.code
        || state.catalogSubjects[0]?.code
        || "0620";
      refreshCatalogFilterOptions();
      byId("communityExamSeason").value = "";
      byId("communityExamYear").value = "";
      byId("communityPaperNumber").value = "";
      byId("communityVariant").value = "";
      byId("communityStatusFilter").value = "";
      byId("communityFeedSearch").value = "";
      byId("communityFeedTopic").value = "";
      byId("communityFeedSort").value = "latest";
      renderPaperReferencePreview();
      await loadThreads();
      showCommunityView("list");
    });
    byId("communityFollowedToggle").addEventListener("click", async () => {
      state.followedOnly = !state.followedOnly;
      renderFollowedToggle();
      await loadThreads();
      showCommunityView("list");
    });
    if (!visitorMode) byId("communityNewThread").addEventListener("click", openComposer);
    byId("communityCancelComposer").addEventListener("click", () => {
      setMathKeyboardOpen(false);
      clearEditorFeedback(byId("communityBodyEditor"));
      showCommunityView("list", { restoreScroll: true });
    });
    if (!visitorMode) byId("communitySubmitThread").addEventListener("click", submitThread);
    if (!visitorMode) byId("communitySubmitReply").addEventListener("click", submitReply);
    if (!visitorMode) initRichEditors();
    byId("communityTitle").addEventListener("input", () => {
      clearEditorFeedback(byId("communityBodyEditor"), "title");
    });
    if (!visitorMode) initMathInput();
    if (!visitorMode) initImageUploads();
    byId("communityCloseDetail").addEventListener("click", () => {
      setMathKeyboardOpen(false);
      clearEditorFeedback(byId("communityReplyEditor"));
      state.currentThreadId = "";
      showCommunityView("list", { restoreScroll: true });
    });
    byId("communityBackHome").addEventListener("click", () => {
      location.href = "../index.html";
    });
    byId("communityLogout").addEventListener("click", () => {
      window.ALevelChatSession?.clear();
      localStorage.removeItem(USER_PROFILE_KEY);
      localStorage.removeItem(USER_ID_KEY);
      localStorage.removeItem(AUTH_TOKEN_KEY);
      localStorage.removeItem(VISITOR_MODE_KEY);
      location.replace("./login.html");
    });
    await loadThreads();
    if (!visitorMode && state.context.questionKey && !state.threads.length) {
      openComposer();
    }
  }

  init().catch((err) => {
    const message = t("communityLoadFailed", { message: err.message || t("unknownError") });
    setStatus(message, true);
    showToast(message);
  });
})();
