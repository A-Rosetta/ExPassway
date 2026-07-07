(function () {
  const { t, applyPage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  function safeText(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }

  function setStatus(text, isBad) {
    const el = byId("mapperStatus");
    if (!el) return;
    el.textContent = text;
    el.className = isBad ? "tip bad" : "tip good";
  }

  function normalizeUrl(url, basePrefix) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    if (raw.startsWith("/") || raw.startsWith("http://") || raw.startsWith("https://")) {
      return raw;
    }
    const prefix = String(basePrefix || "").trim().replace(/\/+$/, "");
    if (!prefix) return raw;
    return `${prefix}/${raw}`;
  }

  function parseInput(input, basePrefix) {
    const rows = String(input || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const out = {};
    rows.forEach((line) => {
      const firstSpace = line.indexOf(" ");
      if (firstSpace <= 0) return;

      const qNo = line.slice(0, firstSpace).trim();
      const rest = line.slice(firstSpace + 1).trim();
      if (!/^\d{1,2}$/.test(qNo) || !rest) return;

      const urls = rest
        .split(",")
        .map((x) => normalizeUrl(x.trim(), basePrefix))
        .filter(Boolean);

      if (urls.length) {
        out[qNo] = urls;
      }
    });

    return out;
  }

  function renderPreview(map) {
    const wrap = byId("previewWrap");
    if (!wrap) return;

    const keys = Object.keys(map).sort((a, b) => Number(a) - Number(b));
    if (!keys.length) {
      wrap.innerHTML = `<p class='tip'>${t("noPreviewContent")}</p>`;
      return;
    }

    wrap.innerHTML = keys
      .map((qNo) => {
        const images = map[qNo] || [];
        const imgs = images
          .map(
            (url, idx) => `
          <figure class="question-image" style="margin-top:0.4rem;">
            <figcaption class="tip">Q${safeText(qNo)} image ${idx + 1}</figcaption>
            <img src="${safeText(url)}" alt="Q${safeText(qNo)} image ${idx + 1}" loading="lazy" />
          </figure>
        `
          )
          .join("");

        return `
          <article class="question">
            <h4>Q${safeText(qNo)}</h4>
            <div class="tip mono">${safeText(images.join(" | "))}</div>
            <div class="question-images-wrap">${imgs}</div>
          </article>
        `;
      })
      .join("");
  }

  function update() {
    const basePrefix = byId("basePrefix").value || "";
    const input = byId("mappingInput").value || "";
    const map = parseInput(input, basePrefix);
    byId("jsonOutput").textContent = JSON.stringify(map, null, 2);
    renderPreview(map);
    setStatus(t("parsedImageMappings", { count: Object.keys(map).length }), false);
    return map;
  }

  byId("previewBtn").addEventListener("click", () => {
    try {
      update();
    } catch (err) {
      setStatus(t("parseFailed", { message: err.message || t("unknownError") }), true);
    }
  });

  byId("downloadBtn").addEventListener("click", () => {
    const map = update();
    const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "image-map.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  byId("copyBtn").addEventListener("click", async () => {
    const map = update();
    try {
      await navigator.clipboard.writeText(JSON.stringify(map, null, 2));
      setStatus(t("jsonCopied"), false);
    } catch (_err) {
      setStatus(t("copyFailed"), true);
    }
  });

  byId("backAdmin").addEventListener("click", () => {
    location.href = "./admin.html";
  });

  byId("mappingInput").value = "1 q01_fig1.png\n2 q02_fig1.png,q02_fig2.png\n3 q03_fig1.png";
  applyPage();
  update();
})();
