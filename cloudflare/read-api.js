const JSON_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json; charset=utf-8",
};

const CORS_PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

const PAPER_SELECT = `
  SELECT
    p.*,
    s.name AS subject_name,
    s.name_zh AS subject_name_zh,
    s.asset_key,
    s.board,
    s.qualification
  FROM exam_papers p
  JOIN exam_subjects s ON s.code = p.subject_code
`;

function jsonResponse(status, payload, requestMethod = "GET") {
  const body = requestMethod === "HEAD" ? null : JSON.stringify(payload);
  return new Response(body, { status, headers: JSON_HEADERS });
}

function success(data, requestMethod) {
  return jsonResponse(200, { ok: true, data }, requestMethod);
}

function failure(status, code, message, requestMethod, details = null) {
  return jsonResponse(status, {
    ok: false,
    error: { code, message, details },
  }, requestMethod);
}

function routeNotFound(request, url) {
  return failure(
    404,
    "NOT_FOUND",
    `Route not found: ${request.method} ${url.pathname}${url.search}`,
    request.method
  );
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function apiTimestamp(value) {
  if (!value) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function mapSubject(row) {
  return {
    code: row.code,
    board: row.board,
    qualification: row.qualification,
    name: row.name,
    nameZh: row.name_zh || "",
    assetKey: row.asset_key,
    active: Boolean(row.active),
    paperCount: Number(row.paper_count || 0),
    questionCount: Number(row.question_count || 0),
    createdAt: apiTimestamp(row.created_at),
    updatedAt: apiTimestamp(row.updated_at),
  };
}

function mapPaper(row) {
  return {
    slug: row.slug,
    subjectCode: row.subject_code,
    subjectName: row.subject_name,
    subjectNameZh: row.subject_name_zh || "",
    assetKey: row.asset_key,
    board: row.board,
    qualification: row.qualification,
    year: Number(row.year),
    season: row.season,
    paperNumber: Number(row.paper_number),
    variant: Number(row.variant),
    paperType: row.paper_type,
    durationMinutes: Number(row.duration_minutes),
    sourceQuestionCount: Number(row.source_question_count),
    validQuestionCount: Number(row.valid_question_count),
    discountedQuestions: parseJson(row.discounted_questions, []),
    qpFileName: row.qp_file_name,
    msFileName: row.ms_file_name,
    dataUrl: row.data_url || "",
    status: row.status,
    metadata: parseJson(row.metadata, {}),
    publishedAt: apiTimestamp(row.published_at),
    createdAt: apiTimestamp(row.created_at),
    updatedAt: apiTimestamp(row.updated_at),
  };
}

function mapQuestion(row) {
  return {
    id: row.id,
    board: row.board,
    subject: row.subject,
    subjectCode: row.subject_code || "",
    paper: row.paper,
    paperSlug: row.paper_slug || "",
    questionNo: row.question_no == null ? null : Number(row.question_no),
    difficulty: row.difficulty,
    topic: row.topic,
    year: row.year,
    stem: row.stem,
    options: parseJson(row.options, []),
    answer: Number(row.answer),
    images: parseJson(row.images, []),
    skills: parseJson(row.skills, []),
    hints: parseJson(row.hints, []),
  };
}

function firstImageUrl(images) {
  const firstImage = Array.isArray(images) ? images[0] : null;
  return typeof firstImage === "string" ? firstImage : firstImage?.url || "";
}

async function listPublishedSubjects(db) {
  const result = await db.prepare(`
    SELECT
      s.*,
      COUNT(DISTINCT p.slug) AS paper_count,
      COALESCE(SUM(p.valid_question_count), 0) AS question_count
    FROM exam_subjects s
    JOIN exam_papers p ON p.subject_code = s.code AND p.status = 'published'
    WHERE s.active = 1
    GROUP BY s.code
    ORDER BY s.qualification, s.name
  `).all();
  return result.results.map(mapSubject);
}

async function listPublishedPapers(db, subjectCode) {
  const result = await db.prepare(`
    ${PAPER_SELECT}
    WHERE p.subject_code = ? AND p.status = 'published' AND s.active = 1
    ORDER BY
      p.year,
      CASE p.season WHEN 'm' THEN 1 WHEN 's' THEN 2 WHEN 'w' THEN 3 ELSE 4 END,
      p.paper_number,
      p.variant
  `).bind(subjectCode).all();
  return result.results.map(mapPaper);
}

async function getPublishedPaper(db, paperSlug) {
  const row = await db.prepare(`
    ${PAPER_SELECT}
    WHERE p.slug = ? AND p.status = 'published' AND s.active = 1
    LIMIT 1
  `).bind(paperSlug).first();
  return row ? mapPaper(row) : null;
}

async function listPaperQuestions(db, paperSlug) {
  const result = await db.prepare(`
    SELECT *
    FROM question_bank
    WHERE active = 1 AND paper_slug = ?
    ORDER BY question_no
  `).bind(paperSlug).all();
  return result.results.map(mapQuestion);
}

function legacyQuestionParts(questionKey) {
  const chemistrySet = questionKey.match(
    /^CIE-IGCHEM-SET-(0620_[sw]\d{2}_qp_\d{2})-(\d{1,2})$/i
  );
  if (chemistrySet) {
    return {
      source: "chemistry",
      paperSlug: chemistrySet[1].toLowerCase(),
      questionNo: Number(chemistrySet[2]),
    };
  }

  const coordinatedSet = questionKey.match(
    /^CIE-IGCOORD-SET-(0654_[msw]\d{2}_qp_\d{2})-(\d{1,2})$/i
  );
  if (coordinatedSet) {
    return {
      source: "coordinated-sciences",
      paperSlug: coordinatedSet[1].toLowerCase(),
      questionNo: Number(coordinatedSet[2]),
    };
  }

  const chemistryStandard = questionKey.match(
    /^CIE-IGCHEM-(\d{4})-([SW])-(\d{2})-(\d{1,2})$/i
  );
  if (!chemistryStandard) return null;
  return {
    source: "chemistry",
    paperSlug: `0620_${chemistryStandard[2].toLowerCase()}${chemistryStandard[1].slice(-2)}_qp_${chemistryStandard[3]}`,
    questionNo: Number(chemistryStandard[4]),
  };
}

async function getQuestionReference(db, questionKey) {
  let row = await db.prepare(`
    SELECT question.* FROM question_bank question
    JOIN exam_papers paper ON paper.slug = question.paper_slug
    JOIN exam_subjects subject ON subject.code = paper.subject_code
    WHERE question.id = ? AND question.active = 1
      AND paper.status = 'published' AND subject.active = 1 LIMIT 1
  `).bind(questionKey).first();
  let legacy = null;

  if (!row) {
    legacy = legacyQuestionParts(questionKey);
    if (!legacy || !Number.isInteger(legacy.questionNo) || legacy.questionNo < 1) return null;
    row = await db.prepare(`
      SELECT question.*
      FROM question_bank question
      JOIN exam_papers paper ON paper.slug = question.paper_slug
      JOIN exam_subjects subject ON subject.code = paper.subject_code
      WHERE question.paper_slug = ? AND question.question_no = ? AND question.active = 1
        AND paper.status = 'published' AND subject.active = 1
      LIMIT 1
    `).bind(legacy.paperSlug, legacy.questionNo).first();
  }

  if (!row?.paper_slug || row.question_no == null) return null;
  const images = parseJson(row.images, []);
  const reference = {
    id: legacy?.source === "coordinated-sciences" ? questionKey : row.id,
    questionKey,
    paperSlug: row.paper_slug,
    questionNo: Number(row.question_no),
    imageUrl: firstImageUrl(images),
    board: row.board,
    subject: row.subject,
    paper: row.paper,
  };
  if (!legacy) reference.subjectCode = row.subject_code || "";
  return reference;
}

async function getCurriculum(db) {
  const subjects = await listPublishedSubjects(db);
  const boards = {};
  for (const subject of subjects) {
    const board = subject.board || "CIE";
    boards[board] ||= {};
    boards[board][`${subject.qualification} ${subject.name}`] = ["MCQ"];
  }
  return {
    grades: [...new Set(subjects.map((subject) => subject.qualification))],
    boards,
    subjectCodes: Object.fromEntries(subjects.map((subject) => [
      `${subject.qualification} ${subject.name}`,
      subject.code,
    ])),
  };
}

export async function handleReadApiRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
  }
  const method = request.method === "HEAD" ? "GET" : request.method;

  if (method !== "GET") return routeNotFound(request, url);

  try {
    if (url.pathname === "/api/catalog/subjects") {
      return success(await listPublishedSubjects(env.DB), request.method);
    }

    const subjectPapersMatch = url.pathname.match(/^\/api\/catalog\/subjects\/([^/]+)\/papers$/);
    if (subjectPapersMatch) {
      const subjectCode = decodeURIComponent(subjectPapersMatch[1]).trim();
      if (!/^\d{4}$/.test(subjectCode)) {
        return failure(
          400,
          "INVALID_INPUT",
          "Subject code must contain four digits.",
          request.method
        );
      }
      return success(await listPublishedPapers(env.DB, subjectCode), request.method);
    }

    const paperQuestionsMatch = url.pathname.match(/^\/api\/catalog\/papers\/([^/]+)\/questions$/);
    if (paperQuestionsMatch) {
      const paperSlug = decodeURIComponent(paperQuestionsMatch[1]).toLowerCase();
      const paper = await getPublishedPaper(env.DB, paperSlug);
      if (!paper) {
        return failure(404, "PAPER_NOT_FOUND", "Published paper not found.", request.method);
      }
      return success(await listPaperQuestions(env.DB, paperSlug), request.method);
    }

    const paperMatch = url.pathname.match(/^\/api\/catalog\/papers\/([^/]+)$/);
    if (paperMatch) {
      const paperSlug = decodeURIComponent(paperMatch[1]).toLowerCase();
      const paper = await getPublishedPaper(env.DB, paperSlug);
      if (!paper) {
        return failure(404, "PAPER_NOT_FOUND", "Published paper not found.", request.method);
      }
      return success(paper, request.method);
    }

    const questionMatch = url.pathname.match(/^\/api\/questions\/([^/]+)$/);
    if (questionMatch) {
      const questionKey = decodeURIComponent(questionMatch[1]);
      const reference = await getQuestionReference(env.DB, questionKey);
      if (!reference) {
        return failure(404, "QUESTION_NOT_FOUND", "Question not found.", request.method);
      }
      return success(reference, request.method);
    }

    if (url.pathname === "/api/meta/curriculum") {
      return success(await getCurriculum(env.DB), request.method);
    }

    if (url.pathname === "/api/meta/storage") {
      return success({ mode: "d1" }, request.method);
    }

    return routeNotFound(request, url);
  } catch (error) {
    console.error("D1 read API failed", error);
    return failure(
      500,
      "INTERNAL_SERVER_ERROR",
      "Unexpected server error.",
      request.method
    );
  }
}
