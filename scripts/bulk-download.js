const bulkDownloadRoot = typeof window !== "undefined" ? window : globalThis;

(function (root) {
  const encoder = new TextEncoder();

  function sanitizeZipPart(value) {
    return String(value || "")
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\.+$/g, "") || "untitled";
  }

  function toUint8Array(data) {
    return data instanceof Uint8Array ? data : encoder.encode(String(data ?? ""));
  }

  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function createZip(entries) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

    entries.forEach((entry) => {
      const name = encoder.encode(entry.name);
      const data = toUint8Array(entry.data);
      const crc = crc32(data);
      const local = new ArrayBuffer(30 + name.length);
      const localView = new DataView(local);
      write32(localView, 0, 0x04034b50);
      write16(localView, 4, 20);
      write16(localView, 6, 0x800);
      write16(localView, 8, 0);
      write16(localView, 10, dosTime);
      write16(localView, 12, dosDate);
      write32(localView, 14, crc);
      write32(localView, 18, data.length);
      write32(localView, 22, data.length);
      write16(localView, 26, name.length);
      write16(localView, 28, 0);
      new Uint8Array(local, 30).set(name);
      localParts.push(new Uint8Array(local), data);

      const central = new ArrayBuffer(46 + name.length);
      const centralView = new DataView(central);
      write32(centralView, 0, 0x02014b50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, 0x800);
      write16(centralView, 10, 0);
      write16(centralView, 12, dosTime);
      write16(centralView, 14, dosDate);
      write32(centralView, 16, crc);
      write32(centralView, 20, data.length);
      write32(centralView, 24, data.length);
      write16(centralView, 28, name.length);
      write16(centralView, 30, 0);
      write16(centralView, 32, 0);
      write16(centralView, 34, 0);
      write16(centralView, 36, 0);
      write32(centralView, 38, 0);
      write32(centralView, 42, offset);
      new Uint8Array(central, 46).set(name);
      centralParts.push(new Uint8Array(central));
      offset += local.byteLength + data.length;
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = new ArrayBuffer(22);
    const endView = new DataView(end);
    write32(endView, 0, 0x06054b50);
    write16(endView, 8, entries.length);
    write16(endView, 10, entries.length);
    write32(endView, 12, centralSize);
    write32(endView, 16, offset);
    return new Blob([...localParts, ...centralParts, new Uint8Array(end)], { type: "application/zip" });
  }

  function imageUrl(image) {
    return typeof image === "string" ? image : image?.detailUrl || image?.url || image?.thumbnailUrl || "";
  }

  function buildBulkDownloadEntries(subjects) {
    const entries = [];
    const manifest = { generatedAt: new Date().toISOString(), papers: [], failedImages: [] };
    (subjects || []).forEach((subject) => {
      const { papers: _subjectPapers, ...subjectMetadata } = subject;
      const subjectDir = `${sanitizeZipPart(subject.code)}-${sanitizeZipPart(subject.name || subject.nameZh)}`;
      (subject.papers || []).forEach((paper) => {
        const paperDir = `${subjectDir}/${sanitizeZipPart(paper.slug)}`;
        const { questions: _paperQuestions, ...paperMetadata } = paper;
        const questions = (paper.questions || []).map((question, index) => ({
          ...question,
          images: (question.images || []).map((image, imageIndex) => {
            const imageMetadata = typeof image === "object" && image ? { ...image } : {};
            delete imageMetadata.detailUrl;
            delete imageMetadata.thumbnailUrl;
            delete imageMetadata.url;
            return {
              ...imageMetadata,
              url: `images/q${String(question.questionNo || index + 1).padStart(2, "0")}-${String(imageIndex + 1).padStart(2, "0")}.png`,
            };
          }),
        }));
        entries.push({
          name: `${paperDir}/questions.json`,
          data: JSON.stringify({ subject: subjectMetadata, paper: paperMetadata, questions }, null, 2),
        });
        manifest.papers.push({ subjectCode: subject.code, slug: paper.slug, questionCount: questions.length });
        questions.forEach((question, index) => {
          (paper.questions[index]?.images || []).forEach((image, imageIndex) => {
            entries.push({
              name: `${paperDir}/images/q${String(question.questionNo || index + 1).padStart(2, "0")}-${String(imageIndex + 1).padStart(2, "0")}.png`,
              sourceUrl: imageUrl(image),
              data: new Uint8Array(),
            });
          });
        });
      });
    });
    entries.push({ name: "manifest.json", data: JSON.stringify(manifest, null, 2) });
    return { entries, manifest };
  }

  async function downloadAllSubjects(api, onProgress = () => {}) {
    const subjects = await api.getCatalogSubjects();
    const grouped = [];
    const failures = [];
    let paperCount = 0;
    let questionCount = 0;
    for (const subject of subjects || []) {
      const papers = [];
      for (const paper of await api.getCatalogPapers(subject.code)) {
        const questions = await api.getCatalogPaperQuestions(paper.slug);
        papers.push({ ...paper, questions });
        paperCount += 1;
        questionCount += questions.length;
        onProgress({ subject, paper, paperCount, questionCount });
      }
      grouped.push({ ...subject, papers });
    }
    const built = buildBulkDownloadEntries(grouped);
    const imageEntries = built.entries.filter((entry) => entry.sourceUrl);
    let imageIndex = 0;
    for (const entry of imageEntries) {
      imageIndex += 1;
      try {
        const response = await fetch(entry.sourceUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        entry.data = new Uint8Array(await response.arrayBuffer());
      } catch (error) {
        failures.push({ path: entry.name, sourceUrl: entry.sourceUrl, error: error.message });
        entry.data = new Uint8Array();
      }
      onProgress({ imageIndex, imageTotal: imageEntries.length, failures: failures.length });
    }
    const manifestEntry = built.entries.find((entry) => entry.name === "manifest.json");
    const manifest = JSON.parse(manifestEntry.data);
    manifest.failedImages = failures;
    manifestEntry.data = JSON.stringify(manifest, null, 2);
    return { blob: createZip(built.entries), manifest };
  }

  root.BulkDownload = { buildBulkDownloadEntries, createZip, sanitizeZipPart, downloadAllSubjects };
})(bulkDownloadRoot);
