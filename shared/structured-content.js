import { supportsPreparedPractice } from "./subject-catalogue.js";

/** Version 1 structured-resource contract shared by import validation and readers. */
export const RESOURCE_PACKAGE_VERSION = 1;

export function questionType(value) {
  const type = String(value || "mcq").toLowerCase();
  return ["mcq", "structured", "practical"].includes(type) ? type : "mcq";
}

export function parseContent(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || ""); } catch { return fallback; }
}

export function orderedImages(value) {
  return (Array.isArray(value) ? value : []).map((image, index) => (
    typeof image === "string" ? { url: image, order: index } : { ...image, order: image?.order ?? index }
  )).filter((image) => typeof image.url === "string" && image.url)
    .sort((left, right) => Number(left.order) - Number(right.order));
}

export function normalizeStructuredDocument(value) {
  const content = parseContent(value);
  return {
    blocks: Array.isArray(content.blocks) ? content.blocks : [],
    sharedMaterials: Array.isArray(content.sharedMaterials) ? content.sharedMaterials : [],
    parts: Array.isArray(content.parts) ? content.parts : [],
    images: orderedImages(content.images),
  };
}

/** Student question views use original image fragments, never extracted text. */
export function questionPresentationImages(value) {
  const question = parseContent(value);
  const content = normalizeStructuredDocument(question.content ?? question);
  const images = [...content.images];
  const collectBlocks = (blocks) => {
    for (const block of Array.isArray(blocks) ? blocks : []) {
      if (block?.type === "image") images.push(block);
    }
  };
  collectBlocks(content.sharedMaterials);
  collectBlocks(content.blocks);
  function visit(parts, depth = 0) {
    if (!Array.isArray(parts) || depth > 64) return;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      images.push(...orderedImages(part.images));
      collectBlocks(part.prompt);
      collectBlocks(part.blocks);
      visit(part.children, depth + 1);
    }
  }
  visit(content.parts);
  images.push(...orderedImages(question.images));
  const seen = new Set();
  return orderedImages(images).filter((image) => {
    const key = image.storageKey || image.url;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Pair official MS blocks with the original QP labels without reordering them. */
export function pairedMarkScheme(scheme, content) {
  const markScheme = parseContent(scheme);
  const question = parseContent(content);
  const partsById = new Map();
  function indexParts(parts, depth = 0) {
    if (!Array.isArray(parts) || depth > 64) return;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      if (typeof part.id === "string") partsById.set(part.id, { part, depth });
      indexParts(part.children, depth + 1);
    }
  }
  indexParts(question?.parts);
  return {
    ...markScheme,
    parts: (Array.isArray(markScheme?.parts) ? markScheme.parts : []).map((schemePart) => {
      const match = partsById.get(schemePart?.partId);
      if (!match) return { ...schemePart };
      return {
        ...schemePart,
        label: match.part.label,
        maxMarks: match.part.maxMarks,
        depth: match.depth,
      };
    }),
  };
}

/** Flatten only display blocks, retaining part labels and indentation. */
export function structuredDisplayBlocks(value) {
  const content = normalizeStructuredDocument(value);
  const result = [...content.sharedMaterials, ...content.blocks];
  function visit(parts, depth = 0) {
    for (const part of parts) {
      const label = part.label || part.partId || "";
      const displayDepth = Number.isInteger(part.depth) && part.depth >= 0 ? part.depth : depth;
      if (label) result.push({ type: "text", text: `${label}${part.maxMarks ? ` [${part.maxMarks}]` : ""}`, depth: displayDepth });
      result.push(...(part.prompt || part.blocks || []).map((block) => ({ ...block, depth: displayDepth })));
      visit(part.children || [], displayDepth + 1);
    }
  }
  visit(content.parts);
  return result;
}

export function hasStructuredContent(value) {
  const content = normalizeStructuredDocument(value);
  return content.images.length > 0 || structuredDisplayBlocks(content).some((block) => (
    block.type === "table" ? Array.isArray(block.rows) && block.rows.length > 0
      : block.type === "image" ? Boolean(block.url) : Boolean(String(block.text || "").trim())
  ));
}

export function stableStructuredQuestionId(subjectCode, paperSlug, questionNo) {
  return `CIE-ASAL-${subjectCode}-${paperSlug}-${String(questionNo).padStart(2, "0")}`;
}

export function validateResourcePackage(bundle) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });
  const record = (value, path) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      fail(path, "Expected an object.");
      return false;
    }
    return true;
  };
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const array = (value, path, optional = true) => {
    if (value === undefined && optional) return [];
    if (!Array.isArray(value)) { fail(path, "Expected an array."); return []; }
    return value;
  };
  const unique = (value, seen, path, label) => {
    if (!text(value)) { fail(path, `Expected a nonempty ${label}.`); return; }
    if (seen.has(value)) fail(path, `Duplicate ${label}.`);
    seen.add(value);
  };
  const status = (value, path, allowed) => {
    if (value !== undefined && !allowed.includes(value)) fail(path, "Unsupported status.");
  };
  const relativeKey = (key) => text(key) && !key.includes("..") && !key.startsWith("/") && !key.includes("\\");
  if (!record(bundle, "$")) return { valid: false, errors };
  if (bundle?.schemaVersion !== RESOURCE_PACKAGE_VERSION) fail("schemaVersion", "Expected resource package version 1.");
  const code = bundle?.subjectCode;
  if (typeof code !== "string" || !/^\d{4}$/.test(code)) fail("subjectCode", "Expected a four-digit subject code.");
  const papers = array(bundle.papers, "papers", false);
  const resources = array(bundle.resources, "resources", false);
  const questions = array(bundle.questions, "questions", false);
  const files = new Set();
  const fileIds = new Set();
  for (const [index, file] of array(bundle.files, "files", false).entries()) {
    const path = `files[${index}]`;
    if (!record(file, path)) continue;
    if (!relativeKey(file.storageKey)) fail(`${path}.storageKey`, "Expected a relative R2 storage key.");
    unique(file.storageKey, files, `${path}.storageKey`, "file storage key");
    if (file.id !== undefined) unique(file.id, fileIds, `${path}.id`, "file ID");
    if (file.localPath !== undefined && !relativeKey(file.localPath)) fail(`${path}.localPath`, "Expected a relative package file path.");
  }
  const paperIds = new Set();
  const resourceIds = new Set();
  const resourceKeys = new Set();
  const questionIds = new Set();
  function fileRef(key, path) {
    if (!relativeKey(key)) fail(path, "Expected a relative R2 storage key.");
    else if (!files.has(key)) fail(path, "File is not declared in files.");
  }
  function imageRefs(images, path) {
    let readable = false;
    for (const [index, image] of array(images, path).entries()) {
      const current = `${path}[${index}]`;
      if (!record(image, current)) continue;
      fileRef(image.storageKey, `${current}.storageKey`);
      if (!Number.isInteger(image.page) || image.page < 1) fail(`${current}.page`, "Expected a one-based original PDF page.");
      if (!image.crop || typeof image.crop !== "object" || Array.isArray(image.crop) || ["x", "y", "width", "height"].some((key) => !Number.isFinite(image.crop[key])) || image.crop.width <= 0 || image.crop.height <= 0) fail(`${current}.crop`, "Expected a positive PDF crop rectangle in points.");
      if (typeof image.url !== "string" || !image.url.startsWith("/api/content/")) fail(`${current}.url`, "Expected an authenticated or published content API URL.");
      else readable = true;
      if (image.order !== undefined && (!Number.isInteger(image.order) || image.order < 0)) fail(`${current}.order`, "Expected a non-negative fragment order.");
    }
    return readable;
  }
  function blocks(value, path) {
    let readable = false;
    for (const [index, block] of array(value, path).entries()) {
      const current = `${path}[${index}]`;
      if (!record(block, current)) continue;
      if (["text", "code"].includes(block.type)) {
        if (typeof block.text !== "string") fail(`${current}.text`, "Expected text.");
        else if (text(block.text)) readable = true;
      } else if (block.type === "table") {
        array(block.headers, `${current}.headers`);
        const rows = array(block.rows, `${current}.rows`, false);
        for (const [rowIndex, row] of rows.entries()) array(row, `${current}.rows[${rowIndex}]`, false);
        if (rows.some((row) => Array.isArray(row) && row.length)) readable = true;
      } else if (block.type === "image") {
        if (typeof block.url !== "string" || !block.url.startsWith("/api/content/")) fail(`${current}.url`, "Expected a content API image URL.");
        else readable = true;
        if (block.storageKey !== undefined) fileRef(block.storageKey, `${current}.storageKey`);
      } else fail(`${current}.type`, "Unsupported display block type.");
    }
    return readable;
  }
  for (const [index, paper] of papers.entries()) {
    const path = `papers[${index}]`;
    if (!record(paper, path)) continue;
    unique(paper.slug, paperIds, `${path}.slug`, "paper slug");
    const slug = typeof paper.slug === "string" ? paper.slug.match(/^(\d{4})_([msw])(\d{2})_qp_([1-5])([1-9])$/) : null;
    if (!slug || slug[1] !== code) fail(`${path}.slug`, "Invalid source paper slug.");
    if (slug) {
      for (const [field, expected] of Object.entries({ paperNumber: Number(slug[4]), year: 2000 + Number(slug[3]), season: slug[2], variant: Number(slug[5]) })) {
        if (paper[field] !== undefined && paper[field] !== expected) fail(`${path}.${field}`, "Value does not match the source paper slug.");
      }
    }
    if (![1, 2, 3, 4, 5].includes(paper.paperNumber) || !Number.isInteger(paper.totalMarks) || paper.totalMarks <= 0 || !Number.isInteger(paper.durationMinutes) || paper.durationMinutes <= 0) fail(path, "Paper must supply actual paper number, marks, and duration.");
    status(paper.status, `${path}.status`, ["draft", "published", "rejected"]);
    if (paper.metadata !== undefined) record(paper.metadata, `${path}.metadata`);
    const discounted = array(paper.discountedQuestions, `${path}.discountedQuestions`);
    const discountedNumbers = new Set();
    for (const [questionIndex, questionNo] of discounted.entries()) {
      if (!Number.isInteger(questionNo) || questionNo < 1 || !Number.isInteger(paper.sourceQuestionCount)
        || questionNo > paper.sourceQuestionCount || discountedNumbers.has(questionNo)) {
        fail(`${path}.discountedQuestions[${questionIndex}]`, "Expected a unique positive original question number within the source question count.");
      }
      discountedNumbers.add(questionNo);
    }
    for (const type of ["qp", "ms"]) if (paper[`${type}StorageKey`] !== undefined) fileRef(paper[`${type}StorageKey`], `${path}.${type}StorageKey`);
  }
  for (const [index, resource] of resources.entries()) {
    const path = `resources[${index}]`;
    if (!record(resource, path)) continue;
    unique(resource.id, resourceIds, `${path}.id`, "resource ID");
    if (!text(resource.title) || !["syllabus", "textbook", "insert", "source", "other"].includes(resource.kind)) fail(path, "Resource needs a title and supported kind.");
    fileRef(resource.storageKey, `${path}.storageKey`);
    unique(resource.storageKey, resourceKeys, `${path}.storageKey`, "resource storage key");
    status(resource.status, `${path}.status`, ["draft", "published", "archived"]);
    if (resource.metadata !== undefined) record(resource.metadata, `${path}.metadata`);
  }
  for (const [index, question] of questions.entries()) {
    const path = `questions[${index}]`;
    if (!record(question, path)) continue;
    if (!paperIds.has(question.paperSlug)) fail(`${path}.paperSlug`, "Question source paper is not declared.");
    if (!Number.isInteger(question.questionNo) || question.questionNo < 1) fail(`${path}.questionNo`, "Expected a positive original question number.");
    if (typeof code !== "string" || typeof question.paperSlug !== "string" || !Number.isInteger(question.questionNo)
      || question.id !== stableStructuredQuestionId(code, question.paperSlug, question.questionNo)) {
      fail(`${path}.id`, "Question ID must derive from subject, paper slug, and original question number.");
    }
    unique(question.id, questionIds, `${path}.id`, "question ID");
    const sourcePaper = papers.find((paper) => paper?.slug === question.paperSlug);
    if (question.questionType !== "structured" || !sourcePaper
      || !supportsPreparedPractice(code, sourcePaper.paperNumber, sourcePaper.paperType || "structured")) {
      fail(path, "Only complete questions from supported subject practice papers enter the bank.");
    }
    if (!Number.isInteger(question.maxMarks) || question.maxMarks <= 0) fail(`${path}.maxMarks`, "Official parent-question marks are required.");
    const partIds = new Set();
    const dependencies = [];
    function parts(nodes, partPath, depth = 0) {
      if (depth > 64) { fail(partPath, "Parts exceed the supported nesting depth."); return false; }
      let readable = false;
      for (const [partIndex, part] of array(nodes, partPath).entries()) {
        const current = `${partPath}[${partIndex}]`;
        if (!record(part, current)) continue;
        if (!text(part.id) || partIds.has(part.id) || !text(part.label)) fail(current, "Parts need unique stable IDs and original labels.");
        partIds.add(part.id);
        dependencies.push(...array(part.dependsOn, `${current}.dependsOn`).map((id) => ({ id, path: current })));
        if (!Number.isInteger(part.maxMarks) || part.maxMarks < 0) fail(`${current}.maxMarks`, "Part marks must be non-negative integers.");
        if (part.answerFormat !== undefined && part.answerFormat !== "choice") fail(`${current}.answerFormat`, "Unsupported answer format.");
        if (part.answerFormat === "choice" && (JSON.stringify(part.choices) !== '["A","B","C","D"]' || part.maxMarks !== 1)) {
          fail(current, "Official MCQ parts need A–D choices and one mark.");
        }
        const promptReadable = blocks(part.prompt, `${current}.prompt`);
        const childrenReadable = parts(part.children, `${current}.children`, depth + 1);
        readable ||= promptReadable || childrenReadable;
      }
      return readable;
    }
    if (record(question.content, `${path}.content`)) {
      const content = question.content;
      const readable = [parts(content.parts, `${path}.content.parts`), blocks(content.blocks, `${path}.content.blocks`), blocks(content.sharedMaterials, `${path}.content.sharedMaterials`), imageRefs(content.images, `${path}.content.images`)];
      if (!readable.some(Boolean)) fail(`${path}.content`, "Question must contain readable blocks or QP fragments.");
    }
    for (const dependency of dependencies) if (!text(dependency.id) || !partIds.has(dependency.id)) fail(dependency.path, "Part dependency must refer to a part in this parent question.");
    if (record(question.markScheme, `${path}.markScheme`)) {
      const scheme = question.markScheme;
      const readable = [blocks(scheme.blocks, `${path}.markScheme.blocks`), imageRefs(scheme.images, `${path}.markScheme.images`)];
      for (const [partIndex, part] of array(scheme.parts, `${path}.markScheme.parts`).entries()) {
        const current = `${path}.markScheme.parts[${partIndex}]`;
        if (!record(part, current)) continue;
        if (!text(part.partId) || !partIds.has(part.partId)) fail(`${current}.partId`, "Mark scheme part must refer to a content part.");
        readable.push(blocks(part.blocks, `${current}.blocks`));
      }
      if (!readable.some(Boolean)) fail(`${path}.markScheme`, "Official mark scheme blocks or fragments are required.");
      if (question.content?.gradingMode === "official-mcq") {
        const choices = question.content.parts;
        const criteria = scheme.parts;
        if (sourcePaper?.paperType !== "mcq" || question.maxMarks !== 1 || choices?.length !== 1
          || choices[0]?.answerFormat !== "choice" || criteria?.length !== 1
          || criteria[0]?.partId !== choices[0]?.id || !["A", "B", "C", "D"].includes(criteria[0]?.correctChoice)) {
          fail(path, "Official MCQ grading requires a matching single-part official answer key.");
        }
      } else if (sourcePaper?.paperType === "mcq") fail(path, "MCQ source papers require their official answer-key grading mode.");
    }
  }
  return { valid: errors.length === 0, errors };
}
