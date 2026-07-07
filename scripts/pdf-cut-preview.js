(function () {
  const { t, applyPage } = window.ALevelI18n;

  function byId(id) {
    return document.getElementById(id);
  }

  async function init() {
    const summary = byId("cutSummary");
    const list = byId("cutPreviewList");

    try {
      const base = window.location.pathname.startsWith("/alevel/") ? "/alevel" : "..";
      const res = await fetch(`${base}/backend/src/data/pymupdf-cut-0620_s23_qp_21.json`);
      const data = await res.json();
      const rows = Array.isArray(data.rows) ? data.rows : [];

      summary.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card"><div class="stat-label">${t("pdfLabel")}</div><div class="stat-value" style="font-size:1rem;">0620_s23_qp_21.pdf</div></div>
          <div class="stat-card"><div class="stat-label">${t("anchorCountLabel")}</div><div class="stat-value">${data.anchorCount || 0}</div></div>
          <div class="stat-card"><div class="stat-label">${t("cutCountLabel")}</div><div class="stat-value">${rows.length}</div></div>
        </div>
      `;

      list.innerHTML = rows.map((row) => `
        <article class="question">
          <h4>第 ${row.questionNo} 题</h4>
          <div class="tag-row">
            <span class="tag">page ${Number(row.pageIndex || 0) + 1}</span>
            <span class="tag">top ${row.top}</span>
            <span class="tag">bottom ${row.bottom}</span>
            <span class="tag">textLength ${row.textLength}</span>
          </div>
          <div class="question-images-wrap">
            <figure class="question-image">
              <img src="${row.imageUrl}" alt="Question ${row.questionNo}" loading="lazy" />
            </figure>
          </div>
          <div class="text-view-box" style="white-space:pre-wrap;">${row.text || ""}</div>
        </article>
      `).join("");
    } catch (err) {
      summary.innerHTML = `<p class="bad">${t("previewLoadFailed", { message: err.message || t("unknownError") })}</p>`;
      list.innerHTML = "";
    }
  }

  applyPage();
  init();
})();
