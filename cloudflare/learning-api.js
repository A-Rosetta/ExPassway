import {
  AuthError,
  failure,
  readJsonBody,
  requireCurrentUser,
  requireString,
  routeNotFound,
  success,
} from "./auth-api.js";
import { buildPaperBlueprint, buildBlueprintIssues } from "../shared/paper-blueprint.js";

const CORS_PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Origin": "*",
};

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch (_error) {
    return fallback;
  }
}

function toInteger(value, fallback, min, max, field = "value") {
  const number = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new AuthError(400, `Field "${field}" must be an integer from ${min} to ${max}.`, "INVALID_INPUT");
  }
  return number;
}

function requireArray(value, field) {
  if (!Array.isArray(value)) {
    throw new AuthError(400, `Field "${field}" must be an array.`, "INVALID_INPUT");
  }
  return value;
}

function normalizeSelection(body) {
  const selection = body.selection || body;
  return {
    grade: typeof selection.grade === "string" ? selection.grade.trim() : "",
    board: requireString(selection.board, "selection.board"),
    subject: requireString(selection.subject, "selection.subject"),
    paper: requireString(selection.paper, "selection.paper"),
  };
}

function normalizeAnswers(value) {
  return requireArray(value, "answers").map((answer) => {
    if (Number.isInteger(answer)) return answer;
    if (answer && Number.isInteger(answer.selectedIndex)) return answer.selectedIndex;
    return -1;
  });
}

function mapQuestion(row, includeAnswer = false) {
  const question = {
    id: row.id,
    board: row.board,
    subject: row.subject,
    subjectCode: row.subject_code || "",
    paper: row.paper,
    paperSlug: row.paper_slug || "",
    questionNo: row.question_no == null ? null : Number(row.question_no),
    difficulty: row.difficulty,
    topic: row.syllabus_code || row.topic,
    year: row.year || "",
    skills: parseJson(row.skills, []),
    hints: parseJson(row.hints, []),
    stem: row.stem,
    options: parseJson(row.options, []),
    images: parseJson(row.images, []),
  };
  if (row.curriculum_section_id) question.curriculumSectionId = row.curriculum_section_id;
  if (row.coursebook_section_id) question.coursebookSectionId = row.coursebook_section_id;
  if (row.syllabus_code) question.syllabusCode = row.syllabus_code;
  if (row.similar_question_group) question.similarQuestionGroup = row.similar_question_group;
  if (includeAnswer) {
    question.answer = Number(row.answer);
    question.mistakeType = row.mistake_type || "concept";
  }
  return question;
}

function mapSession(row) {
  return {
    paperId: row.id,
    userId: row.user_id,
    selection: {
      grade: row.grade || "",
      board: row.board,
      subject: row.subject,
      paper: row.paper,
    },
    options: {
      count: Number(row.requested_count),
      difficulty: row.difficulty || "",
      topics: parseJson(row.topics, []),
    },
    questions: parseJson(row.generated_questions, []),
    answers: parseJson(row.answers, null),
    result: parseJson(row.result, null),
    wrongLog: parseJson(row.wrong_log, null),
    fallbackApplied: Boolean(row.fallback_applied),
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
    status: row.status,
    practiceMode: row.practice_mode,
  };
}

function mapNotebookEntry(row) {
  return {
    id: row.id,
    userId: row.user_id,
    questionKey: row.question_key,
    board: row.board,
    subject: row.subject,
    paper: row.paper,
    topic: row.topic,
    year: row.year,
    stem: row.stem,
    answer: row.answer == null ? null : Number(row.answer),
    answerText: row.answer_text,
    lastSelected: row.last_selected == null ? null : Number(row.last_selected),
    lastSelectedText: row.last_selected_text,
    wrongCount: Number(row.wrong_count),
    firstWrongAt: row.first_wrong_at,
    lastWrongAt: row.last_wrong_at,
    mastered: Boolean(row.mastered),
    starred: Boolean(row.starred),
    mistakeType: row.mistake_type || "unknown",
    mistakeReasons: (() => {
      try {
        const parsed = JSON.parse(row.mistake_reasons || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch (_e) { return []; }
    })(),
    note: row.note || "",
    lastRedoneAt: row.last_redone_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildOptionText(question, optionIndex) {
  return Number.isInteger(optionIndex) && optionIndex >= 0
    ? `${String.fromCharCode(65 + optionIndex)}. ${question.options?.[optionIndex] || ""}`
    : "Unanswered";
}

function evaluateQuestions(questions, answerInput) {
  const answers = normalizeAnswers(answerInput);
  if (answers.length !== questions.length) {
    throw new AuthError(
      400,
      `Answers length (${answers.length}) does not match question count (${questions.length}).`,
      "INVALID_ANSWERS_LENGTH"
    );
  }
  const details = questions.map((question, index) => {
    const source = answerInput[index];
    const selectedIndex = answers[index];
    return {
      id: question.id,
      topic: question.topic,
      skills: question.skills || [],
      mistakeType: question.mistakeType || "concept",
      correct: selectedIndex === question.answer,
      starred: Boolean(source && typeof source === "object" && source.starred),
      selectedIndex,
      answer: question.answer,
      hintsUsed: Number(source && typeof source === "object" ? source.hintsUsed || 0 : 0),
    };
  });
  const correct = details.filter((detail) => detail.correct).length;
  const hintUsedQuestions = details.filter((detail) => detail.hintsUsed > 0).length;
  return {
    answers,
    result: {
      total: questions.length,
      correct,
      wrong: questions.length - correct,
      accuracy: questions.length ? (correct / questions.length) * 100 : 0,
      details,
      submittedAt: new Date().toISOString(),
      hintUsedQuestions,
      totalHintClicks: details.reduce((sum, detail) => sum + detail.hintsUsed, 0),
    },
  };
}

function buildWrongLog(details) {
  const topics = new Map();
  for (const detail of details) {
    const key = detail.topic || "Unclassified";
    if (!topics.has(key)) {
      topics.set(key, { topic: key, mistake: detail.mistakeType || "concept", correct: 0, wrong: 0 });
    }
    topics.get(key)[detail.correct ? "correct" : "wrong"] += 1;
  }
  return [...topics.values()];
}

function buildAnalysis(input = {}) {
  const language = input.language === "zh-CN" ? "zh-CN" : "en";
  const logs = Array.isArray(input.wrongLog) ? input.wrongLog : [];
  const rate = (row) => {
    const total = Number(row.correct || 0) + Number(row.wrong || 0);
    return total ? (Number(row.wrong || 0) / total) * 100 : 0;
  };
  const bars = logs.map((row) => ({
    topic: row.topic,
    mistake: row.mistake,
    wrongRate: Number(rate(row).toFixed(1)),
  }));
  const weakTopics = [...logs]
    .sort((left, right) => rate(right) - rate(left))
    .slice(0, 2)
    .map((row) => row.topic)
    .join(language === "zh-CN" ? "、" : ", ") || (language === "zh-CN" ? "基础模块" : "core topics");
  const advices = language === "zh-CN"
    ? [
      `未来 7 天：优先复习 ${weakTopics}，每天进行 20 分钟概念回顾和 4 道定向练习。`,
      "未来 30 天：每周完成一次限时测验，并按概念、计算和审题错误复盘。",
      "策略：MCQ 试卷按难度递增，第 1-14 题为基础、15-28 题为中等、29 题之后为冲刺。先把基础段正确率稳定在 80% 以上，再逐步把冲刺题比例提高到 40%。",
    ]
    : [
      `Next 7 days: prioritize ${weakTopics} with 20 minutes of concept review and 4 targeted questions each day.`,
      "Next 30 days: take one timed quiz each week and review mistakes by concept, calculation, and question-reading errors.",
      "Strategy: MCQ papers get harder as they go - questions 1-14 are basic, 15-28 medium, 29 onwards challenge. Hold basic accuracy above 80% first, then raise the share of challenge questions to 40%.",
    ];
  const lastResult = input.lastResult || null;
  if (typeof lastResult?.accuracy === "number" && lastResult.accuracy < 60) {
    advices.unshift(language === "zh-CN"
      ? "本周先只做每份卷的第 1-28 题（基础与中等段），正确率稳定到 70% 以上后再往后推进；错题本可按难度筛选，也可只组基础题练习卷。"
      : "This week, stick to questions 1-28 of each paper (basic and medium) until your accuracy is consistently above 70%. The notebook can filter by difficulty, and you can build a basic-only practice paper from it.");
  }
  const total = Number(lastResult?.total || 0);
  const hintRate = total ? (Number(lastResult?.hintUsedQuestions || 0) / total) * 100 : 0;
  if (hintRate >= 50) {
    advices.unshift(language === "zh-CN"
      ? "提示使用率较高：本周完成两次无提示限时练习，再仅在复盘时使用提示。"
      : "Hint use is high: complete two timed sessions without hints this week, then use hints only when reviewing your work.");
  } else if (hintRate > 0) {
    advices.push(language === "zh-CN"
      ? "提示使用适中：先独立作答，卡住两分钟后再查看下一条提示。"
      : "Hint use is moderate: work independently first and reveal another hint only after being stuck for more than two minutes.");
  }
  return { bars, weakTopics, advices, hintRate: Number(hintRate.toFixed(1)) };
}

async function loadQuestionsByIds(db, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const result = await db.prepare(`
    SELECT * FROM question_bank WHERE active = 1 AND id IN (${placeholders})
  `).bind(...ids).all();
  const byId = new Map(result.results.map((row) => [row.id, mapQuestion(row, true)]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

async function saveWrongNotebook(db, userId, questions, details, selection) {
  const now = new Date().toISOString();
  const statements = [];
  details.forEach((detail, index) => {
    if (detail.correct) return;
    const question = questions[index];
    statements.push(db.prepare(`
      INSERT INTO wrong_notebook_entries (
        id, user_id, question_key, board, subject, paper, topic, year, stem,
        answer, answer_text, last_selected, last_selected_text, wrong_count,
        first_wrong_at, last_wrong_at, mastered, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?)
      ON CONFLICT (user_id, question_key) DO UPDATE SET
        board = excluded.board,
        subject = excluded.subject,
        paper = excluded.paper,
        topic = excluded.topic,
        year = excluded.year,
        stem = excluded.stem,
        answer = excluded.answer,
        answer_text = excluded.answer_text,
        last_selected = excluded.last_selected,
        last_selected_text = excluded.last_selected_text,
        wrong_count = wrong_notebook_entries.wrong_count + 1,
        last_wrong_at = excluded.last_wrong_at,
        updated_at = excluded.updated_at
    `).bind(
      crypto.randomUUID(),
      userId,
      question.id,
      question.board || selection.board || null,
      question.subject || selection.subject || null,
      question.paper || selection.paper || null,
      question.topic || null,
      question.year || null,
      question.stem || null,
      detail.answer,
      buildOptionText(question, detail.answer),
      detail.selectedIndex,
      buildOptionText(question, detail.selectedIndex),
      now,
      now,
      now,
      now
    ));
  });
  if (statements.length) await db.batch(statements);
}

async function markNotebookRedone(db, userId, questions, details) {
  const now = new Date().toISOString();
  const statements = [];
  details.forEach((detail, index) => {
    const question = questions[index];
    if (!question) return;
    // Correct on the retry clears the entry; getting it wrong again reopens it,
    // and saveWrongNotebook has already bumped wrong_count for that case.
    statements.push(db.prepare(`
      UPDATE wrong_notebook_entries
      SET mastered = ?, last_redone_at = ?, updated_at = ?
      WHERE user_id = ? AND question_key = ?
    `).bind(detail.correct ? 1 : 0, now, now, userId, question.id));
  });
  if (statements.length) await db.batch(statements);
}

async function submitStoredSession(db, userId, session, rawAnswers) {
  if (session.status === "submitted") {
    throw new AuthError(409, "This paper has already been submitted.", "PAPER_ALREADY_SUBMITTED");
  }
  const stored = parseJson(session.generated_questions, []);
  const questions = await loadQuestionsByIds(db, stored.map((question) => question.id));
  if (questions.length !== stored.length) {
    throw new AuthError(409, "This practice contains a missing question.", "QUESTION_NOT_FOUND");
  }
  const { answers, result } = evaluateQuestions(questions, rawAnswers);
  const wrongLog = buildWrongLog(result.details);
  const now = new Date().toISOString();
  const updated = await db.prepare(`
    UPDATE practice_sessions
    SET answers = ?, result = ?, wrong_log = ?, status = 'submitted', submitted_at = ?
    WHERE id = ? AND user_id = ? AND status = 'generated'
  `).bind(JSON.stringify(answers), JSON.stringify(result), JSON.stringify(wrongLog), now, session.id, userId).run();
  if (!Number(updated.meta?.changes || 0)) {
    throw new AuthError(409, "This paper has already been submitted.", "PAPER_ALREADY_SUBMITTED");
  }
  await saveWrongNotebook(db, userId, questions, result.details, {
    board: session.board,
    subject: session.subject,
    paper: session.paper,
  });
  if (session.practice_mode === "review") {
    await markNotebookRedone(db, userId, questions, result.details);
  }
  return { paperId: session.id, result, wrongLog };
}

async function generatePaper(request, env) {
  const { user } = await requireCurrentUser(request, env);
  const body = await readJsonBody(request);
  const selection = normalizeSelection(body);
  const options = body.options || body;
  const count = toInteger(options.count, 8, 1, 40, "options.count");
  const difficulty = typeof options.difficulty === "string" ? options.difficulty.trim() : "";
  const topics = Array.isArray(options.topics)
    ? options.topics.filter((topic) => typeof topic === "string" && topic.trim()).map((topic) => topic.trim())
    : [];
  const year = typeof options.year === "string" ? options.year.trim() : "";
  const clauses = ["active = 1", "board = ?", "subject = ?", "paper = ?"];
  const bindings = [selection.board, selection.subject, selection.paper];
  if (difficulty) {
    clauses.push("difficulty = ?");
    bindings.push(difficulty);
  }
  if (year) {
    clauses.push("year = ?");
    bindings.push(year);
  }
  if (topics.length) {
    clauses.push(`topic IN (${topics.map(() => "?").join(", ")})`);
    bindings.push(...topics);
  }
  let result = await env.DB.prepare(`
    SELECT * FROM question_bank
    WHERE ${clauses.join(" AND ")}
    ORDER BY random()
    LIMIT ?
  `).bind(...bindings, count).all();
  let fallbackApplied = false;
  if (!result.results.length) {
    fallbackApplied = true;
    result = await env.DB.prepare(`
      SELECT * FROM question_bank
      WHERE active = 1 AND board = ? AND subject = ?
      ORDER BY random()
      LIMIT ?
    `).bind(selection.board, selection.subject, count).all();
  }
  const questions = result.results.map((row) => mapQuestion(row));
  const paperId = questions.length ? crypto.randomUUID() : null;
  if (paperId) {
    await env.DB.prepare(`
      INSERT INTO practice_sessions (
        id, user_id, grade, board, subject, paper, difficulty, topics,
        requested_count, generated_questions, fallback_applied, status, practice_mode
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'generated', 'paper')
    `).bind(
      paperId,
      user.id,
      selection.grade || null,
      selection.board,
      selection.subject,
      selection.paper,
      difficulty || null,
      JSON.stringify(topics),
      count,
      JSON.stringify(questions),
      fallbackApplied ? 1 : 0
    ).run();
  }
  return {
    paperId,
    userId: user.id,
    selection,
    requestedCount: count,
    totalCandidates: questions.length,
    fallbackApplied,
    source: "db-bank",
    questions,
  };
}

const NOTEBOOK_MISTAKE_REASONS = new Set([
  "concept", "calculation", "question_reading", "careless", "time_pressure", "unknown",
]);

// CIE MCQ papers are ordered by difficulty, which is the only difficulty signal
// the data actually carries. question_bank.difficulty exists but the importer
// writes localized Chinese strings into it, so filtering on question_no keeps
// this language-neutral and matches what the front end shows.
const DIFFICULTY_BANDS = {
  basic: { min: 1, max: 14 },
  medium: { min: 15, max: 28 },
  challenge: { min: 29, max: 999 },
};

async function createNotebookPractice(request, env, userId) {
  await assertOwnUser(request, env, userId);
  const body = await readJsonBody(request);
  const count = toInteger(body.count, 10, 1, 40, "count");
  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const onlyUnmastered = body.onlyUnmastered !== false;
  const onlyStarred = body.onlyStarred === true;
  const reasons = (Array.isArray(body.mistakeReasons) ? body.mistakeReasons : [])
    .filter((reason) => typeof reason === "string" && NOTEBOOK_MISTAKE_REASONS.has(reason));

  const clauses = ["entry.user_id = ?", "question.active = 1"];
  const bindings = [userId];
  if (subject) {
    clauses.push("entry.subject = ?");
    bindings.push(subject);
  }
  if (onlyUnmastered) clauses.push("entry.mastered = 0");
  if (onlyStarred) clauses.push("entry.starred = 1");
  const band = DIFFICULTY_BANDS[typeof body.difficulty === "string" ? body.difficulty : ""];
  if (band) {
    clauses.push("question.question_no BETWEEN ? AND ?");
    bindings.push(band.min, band.max);
  }
  if (reasons.length) {
    // Values are whitelisted above, so the LIKE patterns carry no user-controlled wildcards.
    clauses.push(`(${reasons.map(() => "entry.mistake_reasons LIKE ?").join(" OR ")})`);
    bindings.push(...reasons.map((reason) => `%"${reason}"%`));
  }

  const rows = await env.DB.prepare(`
    SELECT question.* FROM wrong_notebook_entries entry
    JOIN question_bank question ON question.id = entry.question_key
    WHERE ${clauses.join(" AND ")}
    ORDER BY random()
    LIMIT ?
  `).bind(...bindings, count).all();

  const questions = rows.results.map((row) => mapQuestion(row));
  if (!questions.length) {
    throw new AuthError(
      404,
      "No wrong-notebook questions match these filters.",
      "NOTEBOOK_PRACTICE_EMPTY"
    );
  }

  // practice_sessions.board/subject/paper are NOT NULL; a notebook paper can span
  // several of them, so anchor the row on the first drawn question.
  const anchor = rows.results[0];
  const paperId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO practice_sessions (
      id, user_id, grade, board, subject, paper, difficulty, topics,
      requested_count, generated_questions, fallback_applied, status, practice_mode
    ) VALUES (?, ?, NULL, ?, ?, ?, NULL, '[]', ?, ?, 0, 'generated', 'review')
  `).bind(
    paperId,
    userId,
    anchor.board,
    anchor.subject,
    anchor.paper,
    count,
    JSON.stringify(questions)
  ).run();

  return {
    paperId,
    userId,
    selection: {
      grade: "",
      board: anchor.board,
      subject: anchor.subject,
      paper: anchor.paper,
    },
    requestedCount: count,
    totalCandidates: questions.length,
    fallbackApplied: false,
    source: "wrong-notebook",
    questions,
  };
}

async function submitLocalPaper(request, env) {
  const { user } = await requireCurrentUser(request, env);
  const body = await readJsonBody(request);
  const selection = normalizeSelection(body);
  const submittedQuestions = requireArray(body.questions, "questions");
  const questionIds = submittedQuestions.map((question) => requireString(question?.id, "questions.id"));
  const questions = await loadQuestionsByIds(env.DB, questionIds);
  if (questions.length !== questionIds.length) {
    throw new AuthError(400, "One or more questions were not found.", "QUESTION_NOT_FOUND");
  }
  const paperId = crypto.randomUUID();
  await env.DB.prepare(`
    INSERT INTO practice_sessions (
      id, user_id, grade, board, subject, paper, difficulty, topics,
      requested_count, generated_questions, fallback_applied, status, practice_mode
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, 0, 'generated', 'paper')
  `).bind(
    paperId,
    user.id,
    selection.grade || null,
    selection.board,
    selection.subject,
    selection.paper,
    questions.length,
    JSON.stringify(submittedQuestions)
  ).run();
  const session = await env.DB.prepare("SELECT * FROM practice_sessions WHERE id = ?").bind(paperId).first();
  const submitted = await submitStoredSession(env.DB, user.id, session, body.answers);
  return { ...submitted, analysis: buildAnalysis({ wrongLog: submitted.wrongLog, lastResult: submitted.result, language: body.language }) };
}

function requireCurriculumCode(value) {
  const subjectCode = String(value || "").trim();
  if (!/^\d{4}$/.test(subjectCode)) {
    throw new AuthError(400, "Subject code must contain four digits.", "INVALID_INPUT");
  }
  return subjectCode;
}

function optionalSearchInteger(url, name, min, max) {
  const value = url.searchParams.get(name);
  return value === null || value === "" ? null : toInteger(value, null, min, max, name);
}

function mapPaperBuilderQuestion(row) {
  const question = mapQuestion(row, true);
  return {
    ...question,
    active: Boolean(row.active),
    sourceStatus: row.source_status || "published",
    year: row.exam_year == null ? question.year : Number(row.exam_year),
    season: row.season || "",
    paperNumber: row.paper_number == null ? null : Number(row.paper_number),
    variant: row.variant == null ? null : Number(row.variant),
    sectionId: row.coursebook_section_id || "",
    sectionCode: row.section_code || "",
    sectionTitleEn: row.section_title_en || "",
    sectionTitleZh: row.section_title_zh || "",
    mappingStatus: row.mapping_status || "unmapped",
    mappingConfidence: row.mapping_confidence == null ? null : Number(row.mapping_confidence),
    mappingSource: row.mapping_source || "",
    sourceGroup: row.similar_question_group || "",
    estimatedSeconds: row.duration_minutes && row.source_question_count
      ? Number(row.duration_minutes) * 60 / Number(row.source_question_count)
      : null,
  };
}

async function fillEstimatedDurations(db, subjectCode, items) {
  if (!items.some((item) => !item.estimatedSeconds)) return items;
  const rows = await db.prepare(`
    SELECT duration_minutes * 60.0 / source_question_count AS seconds
    FROM exam_papers
    WHERE subject_code = ? AND status = 'published'
      AND duration_minutes > 0 AND source_question_count > 0
    ORDER BY seconds
  `).bind(subjectCode).all();
  const durations = rows.results.map((row) => Number(row.seconds));
  const middle = Math.floor(durations.length / 2);
  const median = durations.length
    ? durations.length % 2 ? durations[middle] : (durations[middle - 1] + durations[middle]) / 2
    : null;
  return items.map((item) => ({ ...item, estimatedSeconds: item.estimatedSeconds || median }));
}

async function listPaperBuilderSubjects(db) {
  const [rows, curriculum] = await Promise.all([
    db.prepare("SELECT code, name, name_zh FROM exam_subjects WHERE active = 1 ORDER BY name").all(),
    listCurriculumSubjects(db),
  ]);
  return rows.results.map((row) => ({
    code: row.code, name: row.name, nameZh: row.name_zh || "",
    version: curriculum.find((subject) => subject.code === row.code)?.version || null,
  }));
}

async function searchPaperBuilderQuestions(request, env) {
  await requireCurrentUser(request, env);
  const url = new URL(request.url);
  const subjectCode = requireCurriculumCode(url.searchParams.get("subjectCode"));
  const page = toInteger(url.searchParams.get("page"), 1, 1, 100000, "page");
  const pageSize = toInteger(url.searchParams.get("pageSize"), 20, 1, 50, "pageSize");
  const year = optionalSearchInteger(url, "year", 2000, 2099);
  const paperNumber = optionalSearchInteger(url, "paperNumber", 1, 2);
  const variant = optionalSearchInteger(url, "variant", 1, 9);
  const questionNo = optionalSearchInteger(url, "questionNo", 1, 200);
  const season = String(url.searchParams.get("season") || "").trim().toLowerCase();
  const paperSlug = String(url.searchParams.get("paperSlug") || "").trim();
  const sectionId = String(url.searchParams.get("sectionId") || "").trim();

  if (season && !new Set(["m", "s", "w"]).has(season)) {
    throw new AuthError(400, 'Field "season" must be one of m, s, or w.', "INVALID_INPUT");
  }

  const where = [
    "question.active = 1",
    "question.subject_code = ?",
    "paper.status = 'published'",
    "question.answer BETWEEN 0 AND 3",
    "question.question_no > 0",
    "EXISTS (SELECT 1 FROM exam_subjects subject WHERE subject.code = question.subject_code AND subject.active = 1)",
    "(length(trim(question.stem)) > 0 OR json_array_length(question.images) > 0)",
  ];
  const params = [subjectCode];
  const addFilter = (sql, value) => {
    if (value === null || value === "") return;
    where.push(sql);
    params.push(value);
  };

  addFilter("paper.year = ?", year);
  addFilter("paper.season = ?", season);
  addFilter("paper.paper_number = ?", paperNumber);
  addFilter("paper.variant = ?", variant);
  addFilter("question.paper_slug = ?", paperSlug);
  addFilter("question.question_no = ?", questionNo);
  if (sectionId) {
    where.push("mapping.coursebook_section_id = ?", "mapping.status = 'reviewed'");
    params.push(sectionId);
  }

  const joins = `
    JOIN exam_papers paper ON paper.slug = question.paper_slug
    LEFT JOIN question_section_mappings mapping ON mapping.rowid = (
      SELECT selected_mapping.rowid
      FROM question_section_mappings selected_mapping
      WHERE selected_mapping.question_id = question.id
        AND selected_mapping.is_primary = 1
        AND selected_mapping.status <> 'rejected'
      ORDER BY CASE selected_mapping.status WHEN 'reviewed' THEN 0 ELSE 1 END,
        selected_mapping.confidence DESC,
        selected_mapping.curriculum_section_id
      LIMIT 1
    )
    LEFT JOIN coursebook_sections section ON section.id = mapping.coursebook_section_id
  `;
  const whereSql = where.join(" AND ");
  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS total
    FROM question_bank question
    ${joins}
    WHERE ${whereSql}
  `).bind(...params).first();
  const total = Number(countRow?.total || 0);
  const offset = (page - 1) * pageSize;
  const rows = await env.DB.prepare(`
    SELECT question.*,
      paper.year AS exam_year,
      paper.season,
      paper.paper_number,
      paper.variant,
      paper.duration_minutes,
      paper.source_question_count,
      mapping.curriculum_section_id,
      mapping.coursebook_section_id,
      mapping.status AS mapping_status,
      mapping.confidence AS mapping_confidence,
      mapping.source AS mapping_source,
      mapping.similar_question_group,
      section.section_code,
      section.title_en AS section_title_en,
      section.title_zh AS section_title_zh
    FROM question_bank question
    ${joins}
    WHERE ${whereSql}
    ORDER BY paper.year DESC, paper.season, paper.paper_number, paper.variant,
      question.question_no, question.id
    LIMIT ? OFFSET ?
  `).bind(...params, pageSize, offset).all();

  return {
    items: await fillEstimatedDurations(env.DB, subjectCode, rows.results.map(mapPaperBuilderQuestion)),
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

function mapSavedPaper(row, items = null) {
  const paper = {
    id: row.id,
    paperCode: row.paper_code,
    title: row.title,
    subjectCode: row.subject_code,
    curriculumVersionId: row.curriculum_version_id || "",
    buildMode: row.build_mode,
    buildSeed: row.build_seed || "",
    status: row.status,
    questionCount: Number(row.question_count),
    totalMarks: Number(row.total_marks),
    settings: parseJson(row.settings, {}),
    blueprint: parseJson(row.blueprint, {}),
    parentPaperId: row.parent_paper_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (items) paper.items = items;
  return paper;
}

function mapSavedPaperItem(row) {
  const question = mapPaperBuilderQuestion(row);
  return {
    ...question,
    questionId: row.saved_question_id,
    position: Number(row.saved_position),
    marks: Number(row.saved_marks),
    sectionId: row.saved_section_id || "",
    sourceGroup: row.saved_source_group || "",
  };
}

async function getOwnedSavedPaperRow(db, userId, paperId) {
  const row = await db.prepare(`
    SELECT * FROM saved_papers WHERE id = ? AND user_id = ? LIMIT 1
  `).bind(paperId, userId).first();
  if (!row) throw new AuthError(404, "Saved paper not found.", "PAPER_NOT_FOUND");
  return row;
}

async function loadSavedPaper(db, userId, paperId) {
  const paper = await getOwnedSavedPaperRow(db, userId, paperId);
  const rows = await db.prepare(`
    SELECT question.*,
      source.year AS exam_year,
      source.season,
      source.paper_number,
      source.variant,
      source.duration_minutes,
      source.source_question_count,
      COALESCE(source.status, 'unavailable') AS source_status,
      item.question_id AS saved_question_id,
      item.position AS saved_position,
      item.marks AS saved_marks,
      item.section_id AS saved_section_id,
      item.source_group AS saved_source_group,
      item.section_id AS coursebook_section_id,
      section.section_code,
      section.title_en AS section_title_en,
      section.title_zh AS section_title_zh,
      CASE WHEN EXISTS (
        SELECT 1 FROM question_section_mappings mapping
        WHERE mapping.question_id = question.id AND mapping.is_primary = 1
          AND mapping.status = 'reviewed' AND mapping.coursebook_section_id = item.section_id
      ) THEN 'reviewed' ELSE 'unmapped' END AS mapping_status,
      item.source_group AS similar_question_group
    FROM saved_paper_items item
    JOIN question_bank question ON question.id = item.question_id
    LEFT JOIN exam_papers source ON source.slug = question.paper_slug
    LEFT JOIN coursebook_sections section ON section.id = item.section_id
    WHERE item.paper_id = ?
    ORDER BY item.position
  `).bind(paperId).all();
  const items = await fillEstimatedDurations(db, paper.subject_code, rows.results.map(mapSavedPaperItem));
  return mapSavedPaper(paper, items);
}

function normalizePaperObject(value, field, fallback = {}) {
  if (value === undefined) return fallback;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthError(400, `Field "${field}" must be an object.`, "INVALID_INPUT");
  }
  return value;
}

async function normalizeSavedPaperItems(db, subjectCode, value) {
  const items = requireArray(value, "items");
  if (items.length > 200) {
    throw new AuthError(400, 'Field "items" cannot contain more than 200 questions.', "INVALID_INPUT");
  }
  const requests = items.map((item, position) => ({
    questionId: requireString(item?.questionId, `items[${position}].questionId`),
    marks: toInteger(item?.marks, 1, 1, 100, `items[${position}].marks`),
    sectionId: String(item?.sectionId || "").trim(),
    position,
  }));
  if (new Set(requests.map((item) => item.questionId)).size !== requests.length) {
    throw new AuthError(400, "A question cannot be added to the same paper twice.", "DUPLICATE_QUESTION");
  }
  if (requests.length === 0) return { items: [], blueprint: buildPaperBlueprint([]) };

  const rows = await db.prepare(`
    SELECT question.*,
      source.slug AS source_paper_slug,
      source.year AS exam_year,
      source.season,
      source.paper_number,
      source.variant,
      source.duration_minutes,
      source.source_question_count,
      source.status AS source_status,
      mapping.coursebook_section_id,
      mapping.status AS mapping_status,
      mapping.similar_question_group,
      section.section_code
    FROM question_bank question
    LEFT JOIN exam_papers source ON source.slug = question.paper_slug
    LEFT JOIN question_section_mappings mapping ON mapping.rowid = (
      SELECT selected_mapping.rowid
      FROM question_section_mappings selected_mapping
      WHERE selected_mapping.question_id = question.id
        AND selected_mapping.is_primary = 1
        AND selected_mapping.status <> 'rejected'
      ORDER BY CASE selected_mapping.status WHEN 'reviewed' THEN 0 ELSE 1 END,
        selected_mapping.confidence DESC,
        selected_mapping.curriculum_section_id
      LIMIT 1
    )
    LEFT JOIN coursebook_sections section ON section.id = mapping.coursebook_section_id
    WHERE question.id IN (SELECT value FROM json_each(?))
  `).bind(JSON.stringify(requests.map((item) => item.questionId))).all();
  const byId = new Map(rows.results.map((row) => [row.id, row]));
  const normalized = requests.map((item) => {
    const row = byId.get(item.questionId);
    const images = parseJson(row?.images, []);
    if (!row
      || !row.active
      || row.subject_code !== subjectCode
      || !Number.isInteger(Number(row.answer))
      || Number(row.answer) < 0
      || Number(row.answer) > 3
      || (!String(row.stem || "").trim() && images.length === 0)
      || !row.source_paper_slug
      || !row.question_no
      || row.source_status !== "published") {
      throw new AuthError(400, `Question "${item.questionId}" is not available for this paper.`, "INVALID_QUESTION");
    }
    const reviewedSectionId = row.mapping_status === "reviewed" ? row.coursebook_section_id || "" : "";
    if (item.sectionId && item.sectionId !== reviewedSectionId) {
      throw new AuthError(
        400,
        `Question "${item.questionId}" is not reviewed for section "${item.sectionId}".`,
        "INVALID_SECTION"
      );
    }
    return {
      id: row.id,
      questionId: row.id,
      position: item.position,
      marks: item.marks,
      sectionId: item.sectionId || reviewedSectionId,
      sectionCode: item.sectionId || reviewedSectionId ? row.section_code || "" : "",
      sourceGroup: row.similar_question_group || "",
      answer: Number(row.answer),
      paperSlug: row.paper_slug,
      year: Number(row.exam_year),
      season: row.season,
      paperNumber: row.paper_number == null ? null : Number(row.paper_number),
      difficulty: row.difficulty || "",
      estimatedSeconds: row.duration_minutes && row.source_question_count
        ? Number(row.duration_minutes) * 60 / Number(row.source_question_count)
        : null,
    };
  });
  const timed = await fillEstimatedDurations(db, subjectCode, normalized);
  return { items: timed, blueprint: buildPaperBlueprint(timed) };
}

async function normalizeSavedPaperPayload(db, body, existing = null, existingItems = []) {
  const suppliedSubjectCode = body.subjectCode === undefined
    ? existing?.subject_code
    : requireCurriculumCode(body.subjectCode);
  const subjectCode = requireCurriculumCode(suppliedSubjectCode);
  const subject = await db.prepare("SELECT code FROM exam_subjects WHERE code = ? AND active = 1")
    .bind(subjectCode).first();
  if (!subject) throw new AuthError(400, "Subject is not available for paper building.", "INVALID_INPUT");
  if (existing && subjectCode !== existing.subject_code) {
    throw new AuthError(400, "A saved paper's subject cannot be changed.", "INVALID_INPUT");
  }
  const title = requireString(body.title === undefined ? existing?.title : body.title, "title");
  if (title.length > 160) throw new AuthError(400, "Paper title is too long.", "INVALID_INPUT");
  const buildMode = String(body.buildMode === undefined ? existing?.build_mode || "manual" : body.buildMode).trim();
  const status = String(body.status === undefined ? existing?.status || "draft" : body.status).trim();
  if (!new Set(["manual", "smart", "equivalent"]).has(buildMode)) {
    throw new AuthError(400, 'Field "buildMode" is invalid.', "INVALID_INPUT");
  }
  if (!new Set(["draft", "final"]).has(status)) {
    throw new AuthError(400, 'Field "status" is invalid.', "INVALID_INPUT");
  }

  const curriculumVersionId = String(
    body.curriculumVersionId === undefined ? existing?.curriculum_version_id || "" : body.curriculumVersionId || ""
  ).trim();
  if (curriculumVersionId) {
    const version = await db.prepare(`
      SELECT id FROM curriculum_versions WHERE id = ? AND subject_code = ? LIMIT 1
    `).bind(curriculumVersionId, subjectCode).first();
    if (!version) throw new AuthError(400, "Curriculum version does not match the subject.", "INVALID_INPUT");
  }

  const settings = normalizePaperObject(
    body.settings,
    "settings",
    existing ? parseJson(existing.settings, {}) : {}
  );
  settings.targetSections = normalizePaperObject(settings.targetSections, "settings.targetSections", {});
  if (Object.keys(settings.targetSections).length > 200) {
    throw new AuthError(400, "Too many section targets.", "INVALID_INPUT");
  }
  for (const [sectionId, count] of Object.entries(settings.targetSections)) {
    settings.targetSections[sectionId] = toInteger(count, 0, 0, 200, "settings.targetSections");
  }
  const buildSeed = String(
    body.buildSeed === undefined ? existing?.build_seed || "" : body.buildSeed || ""
  ).trim();
  const rawItems = body.items === undefined ? existingItems : body.items;
  const normalized = await normalizeSavedPaperItems(db, subjectCode, rawItems);
  if (status === "final") {
    const blockers = buildBlueprintIssues(normalized.blueprint, { targetSections: settings.targetSections })
      .filter((issue) => issue.blocking);
    if (!normalized.items.length || blockers.length) {
      throw new AuthError(409, "Section targets must be met before finalizing a paper.", "BLUEPRINT_BLOCKED", { issues: blockers });
    }
  }
  return {
    title,
    subjectCode,
    curriculumVersionId,
    buildMode,
    buildSeed,
    status,
    settings,
    items: normalized.items,
    blueprint: normalized.blueprint,
  };
}

function savedPaperItemStatements(db, paperId, items) {
  if (!items.length) return [];
  return [db.prepare(`
    INSERT INTO saved_paper_items (
      paper_id, question_id, position, marks, section_id, source_group
    )
    SELECT ?, json_extract(value, '$.questionId'), json_extract(value, '$.position'),
      json_extract(value, '$.marks'), NULLIF(json_extract(value, '$.sectionId'), ''),
      NULLIF(json_extract(value, '$.sourceGroup'), '')
    FROM json_each(?)
  `).bind(
    paperId,
    JSON.stringify(items)
  )];
}

async function persistSavedPaper(db, userId, value, parentPaperId = "") {
  const id = crypto.randomUUID();
  const paperCode = `${value.subjectCode}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  const statements = [db.prepare(`
    INSERT INTO saved_papers (
      id, user_id, paper_code, title, subject_code, curriculum_version_id,
      build_mode, build_seed, status, question_count, total_marks, settings,
      blueprint, parent_paper_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    userId,
    paperCode,
    value.title,
    value.subjectCode,
    value.curriculumVersionId || null,
    value.buildMode,
    value.buildSeed || null,
    value.status,
    value.blueprint.questionCount,
    value.blueprint.totalMarks,
    JSON.stringify(value.settings),
    JSON.stringify(value.blueprint),
    parentPaperId || null
  ), ...savedPaperItemStatements(db, id, value.items)];
  await db.batch(statements);
  return loadSavedPaper(db, userId, id);
}

async function createSavedPaper(request, env) {
  const { user } = await requireCurrentUser(request, env);
  const body = await readJsonBody(request);
  const value = await normalizeSavedPaperPayload(env.DB, body);
  return persistSavedPaper(env.DB, user.id, value);
}

async function listSavedPapers(request, env) {
  const { user } = await requireCurrentUser(request, env);
  const rows = await env.DB.prepare(`
    SELECT * FROM saved_papers WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC
  `).bind(user.id).all();
  return rows.results.map((row) => mapSavedPaper(row));
}

async function updateSavedPaper(request, env, paperId) {
  const { user } = await requireCurrentUser(request, env);
  const existing = await getOwnedSavedPaperRow(env.DB, user.id, paperId);
  const current = await loadSavedPaper(env.DB, user.id, paperId);
  const body = await readJsonBody(request);
  const value = await normalizeSavedPaperPayload(env.DB, body, existing, current.items);
  const statements = [
    env.DB.prepare(`
      UPDATE saved_papers SET
        title = ?, curriculum_version_id = ?, build_mode = ?, build_seed = ?,
        status = ?, question_count = ?, total_marks = ?, settings = ?, blueprint = ?,
        updated_at = ?
      WHERE id = ? AND user_id = ?
    `).bind(
      value.title,
      value.curriculumVersionId || null,
      value.buildMode,
      value.buildSeed || null,
      value.status,
      value.blueprint.questionCount,
      value.blueprint.totalMarks,
      JSON.stringify(value.settings),
      JSON.stringify(value.blueprint),
      new Date().toISOString(),
      paperId,
      user.id
    ),
    env.DB.prepare("DELETE FROM saved_paper_items WHERE paper_id = ?").bind(paperId),
    ...savedPaperItemStatements(env.DB, paperId, value.items),
  ];
  await env.DB.batch(statements);
  return loadSavedPaper(env.DB, user.id, paperId);
}

async function deleteSavedPaper(request, env, paperId) {
  const { user } = await requireCurrentUser(request, env);
  await getOwnedSavedPaperRow(env.DB, user.id, paperId);
  await env.DB.prepare("DELETE FROM saved_papers WHERE id = ? AND user_id = ?")
    .bind(paperId, user.id).run();
  return { deleted: true };
}

async function generateEquivalentPaper(request, env, paperId) {
  const { user } = await requireCurrentUser(request, env);
  const sourceRow = await getOwnedSavedPaperRow(env.DB, user.id, paperId);
  const source = await loadSavedPaper(env.DB, user.id, paperId);
  const body = await readJsonBody(request);
  if (body.allowSimilarGroups !== undefined && typeof body.allowSimilarGroups !== "boolean") {
    throw new AuthError(400, 'Field "allowSimilarGroups" must be a boolean.', "INVALID_INPUT");
  }
  const allowSimilarGroups = body.allowSimilarGroups === true;
  const sourceNormalized = await normalizeSavedPaperItems(
    env.DB,
    source.subjectCode,
    source.items.map((item) => ({
      questionId: item.questionId,
      marks: item.marks,
      sectionId: item.sectionId,
    }))
  );
  if (!sourceNormalized.items.length) throw new AuthError(400, "The A paper must contain questions.", "INVALID_INPUT");
  const sourceIds = new Set(sourceNormalized.items.map((item) => item.questionId));
  const sourceGroups = new Set(sourceNormalized.items.map((item) => item.sourceGroup).filter(Boolean));
  const sectionIds = [...new Set(sourceNormalized.items.map((item) => item.sectionId).filter(Boolean))];
  const candidatesBySection = new Map(sectionIds.map((sectionId) => [sectionId, []]));

  if (sectionIds.length) {
    const rows = await env.DB.prepare(`
      SELECT question.id,
        mapping.coursebook_section_id AS section_id,
        mapping.similar_question_group AS source_group,
        source.paper_number, source.year, question.difficulty
      FROM question_bank question
      JOIN exam_papers source ON source.slug = question.paper_slug AND source.status = 'published'
      JOIN question_section_mappings mapping
        ON mapping.rowid = (
          SELECT selected.rowid FROM question_section_mappings selected
          WHERE selected.question_id = question.id AND selected.is_primary = 1 AND selected.status <> 'rejected'
          ORDER BY CASE selected.status WHEN 'reviewed' THEN 0 ELSE 1 END,
            selected.confidence DESC, selected.curriculum_section_id
          LIMIT 1
        )
        AND mapping.status = 'reviewed'
      WHERE question.active = 1
        AND question.subject_code = ?
        AND question.answer BETWEEN 0 AND 3
        AND question.question_no > 0
        AND (length(trim(question.stem)) > 0 OR json_array_length(question.images) > 0)
        AND mapping.coursebook_section_id IN (SELECT value FROM json_each(?))
      ORDER BY question.id
    `).bind(source.subjectCode, JSON.stringify(sectionIds)).all();
    for (const row of rows.results) {
      if (sourceIds.has(row.id)) continue;
      const sourceGroup = row.source_group || "";
      if (!allowSimilarGroups && sourceGroup && sourceGroups.has(sourceGroup)) continue;
      candidatesBySection.get(row.section_id)?.push({
        questionId: row.id,
        sectionId: row.section_id,
        sourceGroup,
        paperNumber: row.paper_number == null ? null : Number(row.paper_number),
        year: Number(row.year),
        difficulty: row.difficulty || "",
      });
    }
  }

  const reliableDifficulty = sourceNormalized.blueprint.difficulty.coverage >= 0.7;
  const buildSeed = crypto.randomUUID();
  const rank = (id) => {
    let hash = 2166136261;
    for (const character of buildSeed + id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  const slots = sourceNormalized.items.map((item) => ({
    source: item,
    candidates: (candidatesBySection.get(item.sectionId) || []).filter((candidate) => (
      !item.paperNumber || !candidate.paperNumber || item.paperNumber === candidate.paperNumber
    )).sort((left, right) => (
      (reliableDifficulty && item.difficulty
        ? Number(right.difficulty === item.difficulty) - Number(left.difficulty === item.difficulty) : 0)
      || Math.abs(left.year - item.year) - Math.abs(right.year - item.year)
      || rank(left.questionId) - rank(right.questionId)
    )),
    selected: null,
  }));
  const assigned = new Map();
  const findMatch = (slot, visited) => {
    for (const candidate of slot.candidates) {
      const key = !allowSimilarGroups && candidate.sourceGroup
        ? "group:" + candidate.sourceGroup : "question:" + candidate.questionId;
      if (visited.has(key)) continue;
      visited.add(key);
      const previous = assigned.get(key);
      if (!previous || findMatch(previous, visited)) {
        assigned.set(key, slot);
        slot.selected = candidate;
        return true;
      }
    }
    return false;
  };
  for (const slot of [...slots].sort((left, right) => left.candidates.length - right.candidates.length)) {
    findMatch(slot, new Set());
  }
  const requirements = new Map();
  for (const slot of slots) {
    const sectionId = slot.source.sectionId || "unmapped";
    const deficit = requirements.get(sectionId) || { sectionId, required: 0, available: 0 };
    deficit.required += 1;
    if (slot.selected) deficit.available += 1;
    requirements.set(sectionId, deficit);
  }
  const deficits = [...requirements.values()].filter((value) => value.available < value.required);
  if (deficits.length) {
    throw new AuthError(
      409,
      "The reviewed question pool cannot produce an equivalent paper.",
      "EQUIVALENT_POOL_INSUFFICIENT",
      { allowSimilarGroups, sections: deficits }
    );
  }

  const selectedItems = slots.map((slot) => ({
    questionId: slot.selected.questionId,
    marks: slot.source.marks,
    sectionId: slot.source.sectionId,
  }));
  const value = await normalizeSavedPaperPayload(env.DB, {
    title: `${source.title.slice(0, 158)} B`,
    subjectCode: source.subjectCode,
    curriculumVersionId: source.curriculumVersionId,
    buildMode: "equivalent",
    buildSeed,
    status: "draft",
    settings: { ...source.settings, allowSimilarGroups },
    items: selectedItems,
  });
  return persistSavedPaper(env.DB, user.id, value, sourceRow.id);
}

function questionYearFilter(subjectCode, tableAlias = "question") {
  if (subjectCode === "0610") {
    return `AND ${tableAlias}.year GLOB '[0-9][0-9][0-9][0-9]' AND CAST(${tableAlias}.year AS INTEGER) BETWEEN 2019 AND 2023`;
  }
  return `AND ${tableAlias}.year GLOB '[0-9][0-9][0-9][0-9]' AND CAST(${tableAlias}.year AS INTEGER) BETWEEN 2023 AND 2025`;
}

function mapCurriculumVersion(row) {
  return {
    id: row.id,
    subjectCode: row.subject_code,
    qualification: row.qualification,
    examYearStart: Number(row.exam_year_start),
    examYearEnd: Number(row.exam_year_end),
    version: row.version,
    active: Boolean(row.active),
  };
}

async function getCurriculumVersion(db, subjectCode, versionId = "") {
  return db.prepare(`
    SELECT * FROM curriculum_versions
    WHERE subject_code = ? AND (? = '' OR id = ?) AND (? <> '' OR active = 1)
    ORDER BY active DESC
    LIMIT 1
  `).bind(subjectCode, versionId, versionId, versionId).first();
}

async function listCurriculumSubjects(db) {
  const rows = await db.prepare(`
    SELECT subject.code, subject.name, subject.name_zh,
      version.id AS version_id, version.qualification,
      version.exam_year_start, version.exam_year_end, version.version
    FROM curriculum_versions version
    JOIN exam_subjects subject ON subject.code = version.subject_code
    WHERE version.active = 1
      AND EXISTS (
        SELECT 1
        FROM curriculum_sections syllabus_section
        JOIN coursebook_section_mappings book_mapping
          ON book_mapping.curriculum_section_id = syllabus_section.id
        WHERE syllabus_section.curriculum_version_id = version.id
      )
    ORDER BY subject.name
  `).all();
  return rows.results.map((row) => ({
    code: row.code,
    name: row.name,
    nameZh: row.name_zh || "",
    version: mapCurriculumVersion({
      id: row.version_id,
      subject_code: row.code,
      qualification: row.qualification,
      exam_year_start: row.exam_year_start,
      exam_year_end: row.exam_year_end,
      version: row.version,
      active: 1,
    }),
  }));
}

async function listChapterCatalog(db, userId, version) {
  const [chapterRows, sectionRows, mappingRows, poolRows, attemptRows, latestRows] = await Promise.all([
    db.prepare(`
      SELECT DISTINCT chapter.*
      FROM coursebook_chapters chapter
      JOIN coursebook_sections book_section ON book_section.coursebook_chapter_id = chapter.id
      JOIN coursebook_section_mappings book_mapping ON book_mapping.coursebook_section_id = book_section.id
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = book_mapping.curriculum_section_id
      WHERE syllabus_section.curriculum_version_id = ?
      ORDER BY chapter.sort_order
    `).bind(version.id).all(),
    db.prepare(`
      SELECT DISTINCT book_section.*
      FROM coursebook_sections book_section
      JOIN coursebook_section_mappings book_mapping ON book_mapping.coursebook_section_id = book_section.id
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = book_mapping.curriculum_section_id
      WHERE syllabus_section.curriculum_version_id = ?
      ORDER BY book_section.sort_order
    `).bind(version.id).all(),
    db.prepare(`
      SELECT book_mapping.coursebook_section_id, syllabus_section.id,
        syllabus_section.syllabus_code, syllabus_section.title_en,
        syllabus_section.title_zh, syllabus_section.core_level
      FROM coursebook_section_mappings book_mapping
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = book_mapping.curriculum_section_id
      WHERE syllabus_section.curriculum_version_id = ?
      ORDER BY syllabus_section.sort_order
    `).bind(version.id).all(),
    db.prepare(`
      SELECT mapping.coursebook_section_id,
        COUNT(DISTINCT COALESCE(NULLIF(mapping.similar_question_group, ''), mapping.question_id)) AS available_questions
      FROM question_section_mappings mapping
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = mapping.curriculum_section_id
      JOIN question_bank question ON question.id = mapping.question_id
      WHERE mapping.status = 'reviewed' AND mapping.is_primary = 1
        AND mapping.coursebook_section_id IS NOT NULL
        AND syllabus_section.curriculum_version_id = ?
        AND question.active = 1 AND question.subject_code = ?
        ${questionYearFilter(version.subject_code)}
      GROUP BY mapping.coursebook_section_id
    `).bind(version.id, version.subject_code).all(),
    db.prepare(`
      SELECT attempt.coursebook_section_id,
        SUM(CASE WHEN attempt.first_exposure = 1 THEN 1 ELSE 0 END) AS first_attempts,
        SUM(CASE WHEN attempt.first_exposure = 1 AND attempt.correct = 1 THEN 1 ELSE 0 END) AS first_correct,
        SUM(CASE WHEN attempt.first_exposure = 0 THEN 1 ELSE 0 END) AS review_attempts,
        SUM(CASE WHEN attempt.first_exposure = 0 AND attempt.correct = 1 THEN 1 ELSE 0 END) AS review_correct,
        COUNT(DISTINCT COALESCE(NULLIF(attempt.similar_question_group, ''), attempt.question_id)) AS seen_questions
      FROM question_attempts attempt
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = attempt.curriculum_section_id
      WHERE attempt.user_id = ? AND syllabus_section.curriculum_version_id = ?
      GROUP BY attempt.coursebook_section_id
    `).bind(userId, version.id).all(),
    db.prepare(`
      SELECT latest.coursebook_section_id, SUM(CASE WHEN latest.correct = 0 THEN 1 ELSE 0 END) AS needs_review
      FROM question_attempts latest
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = latest.curriculum_section_id
      WHERE latest.user_id = ? AND syllabus_section.curriculum_version_id = ?
        AND latest.attempted_at = (
          SELECT MAX(previous.attempted_at)
          FROM question_attempts previous
          WHERE previous.user_id = latest.user_id
            AND previous.coursebook_section_id = latest.coursebook_section_id
            AND COALESCE(NULLIF(previous.similar_question_group, ''), previous.question_id)
              = COALESCE(NULLIF(latest.similar_question_group, ''), latest.question_id)
        )
      GROUP BY latest.coursebook_section_id
    `).bind(userId, version.id).all(),
  ]);
  const chapters = chapterRows.results.map((row) => ({
    id: row.id,
    bookKey: row.book_key,
    chapterNo: Number(row.chapter_no),
    titleEn: row.title_en,
    titleZh: row.title_zh,
    pdfStartPage: row.pdf_start_page == null ? null : Number(row.pdf_start_page),
    pdfEndPage: row.pdf_end_page == null ? null : Number(row.pdf_end_page),
    printedStartPage: row.printed_start_page == null ? null : Number(row.printed_start_page),
    printedEndPage: row.printed_end_page == null ? null : Number(row.printed_end_page),
    sections: [],
  }));
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const sectionById = new Map();
  sectionRows.results.forEach((row) => {
    const section = {
      id: row.id,
      sectionCode: row.section_code,
      titleEn: row.title_en,
      titleZh: row.title_zh,
      pdfStartPage: row.pdf_start_page == null ? null : Number(row.pdf_start_page),
      pdfEndPage: row.pdf_end_page == null ? null : Number(row.pdf_end_page),
      printedStartPage: row.printed_start_page == null ? null : Number(row.printed_start_page),
      printedEndPage: row.printed_end_page == null ? null : Number(row.printed_end_page),
      syllabusStatements: [],
      progress: {
        availableQuestions: 0,
        unseenQuestions: 0,
        firstAttempts: 0,
        firstCorrect: 0,
        firstAccuracy: null,
        reviewAttempts: 0,
        reviewCorrect: 0,
        reviewAccuracy: null,
        needsReview: 0,
      },
    };
    sectionById.set(row.id, section);
    chapterById.get(row.coursebook_chapter_id)?.sections.push(section);
  });
  mappingRows.results.forEach((row) => sectionById.get(row.coursebook_section_id)?.syllabusStatements.push({
    id: row.id,
    syllabusCode: row.syllabus_code,
    titleEn: row.title_en,
    titleZh: row.title_zh,
    coreLevel: row.core_level,
  }));
  poolRows.results.forEach((row) => {
    const progress = sectionById.get(row.coursebook_section_id)?.progress;
    if (progress) progress.availableQuestions = Number(row.available_questions || 0);
  });
  attemptRows.results.forEach((row) => {
    const progress = sectionById.get(row.coursebook_section_id)?.progress;
    if (!progress) return;
    progress.firstAttempts = Number(row.first_attempts || 0);
    progress.firstCorrect = Number(row.first_correct || 0);
    progress.firstAccuracy = progress.firstAttempts ? Number(((progress.firstCorrect / progress.firstAttempts) * 100).toFixed(1)) : null;
    progress.reviewAttempts = Number(row.review_attempts || 0);
    progress.reviewCorrect = Number(row.review_correct || 0);
    progress.reviewAccuracy = progress.reviewAttempts ? Number(((progress.reviewCorrect / progress.reviewAttempts) * 100).toFixed(1)) : null;
    progress.unseenQuestions = Math.max(0, progress.availableQuestions - Number(row.seen_questions || 0));
  });
  latestRows.results.forEach((row) => {
    const progress = sectionById.get(row.coursebook_section_id)?.progress;
    if (progress) progress.needsReview = Number(row.needs_review || 0);
  });
  sectionById.forEach((section) => {
    if (!section.progress.firstAttempts) section.progress.unseenQuestions = section.progress.availableQuestions;
  });
  return { version: mapCurriculumVersion(version), chapters };
}

async function createChapterPractice(request, env) {
  const { user } = await requireCurrentUser(request, env);
  const body = await readJsonBody(request);
  const versionId = requireString(body.curriculumVersion, "curriculumVersion");
  const sectionId = requireString(body.coursebookSectionId, "coursebookSectionId");
  const count = toInteger(body.count, 10, 1, 20, "count");
  const versionRow = await env.DB.prepare("SELECT * FROM curriculum_versions WHERE id = ? LIMIT 1").bind(versionId).first();
  const version = versionRow && await getCurriculumVersion(env.DB, versionRow.subject_code, versionId);
  if (!version) throw new AuthError(404, "Curriculum version not found.", "CURRICULUM_NOT_FOUND");
  const section = await env.DB.prepare(`
    SELECT DISTINCT book_section.*, chapter.chapter_no,
      chapter.title_en AS chapter_title_en, chapter.title_zh AS chapter_title_zh
    FROM coursebook_sections book_section
    JOIN coursebook_chapters chapter ON chapter.id = book_section.coursebook_chapter_id
    JOIN coursebook_section_mappings book_mapping ON book_mapping.coursebook_section_id = book_section.id
    JOIN curriculum_sections syllabus_section ON syllabus_section.id = book_mapping.curriculum_section_id
    WHERE book_section.id = ? AND syllabus_section.curriculum_version_id = ?
    LIMIT 1
  `).bind(sectionId, version.id).first();
  if (!section) throw new AuthError(404, "Coursebook section not found.", "SECTION_NOT_FOUND");
  const candidates = await env.DB.prepare(`
    WITH candidate_rows AS (
      SELECT question.*, mapping.curriculum_section_id, mapping.coursebook_section_id,
        mapping.similar_question_group, syllabus_section.syllabus_code,
        (SELECT MAX(attempt.attempted_at) FROM question_attempts attempt
          WHERE attempt.user_id = ?
            AND COALESCE(NULLIF(attempt.similar_question_group, ''), attempt.question_id)
              = COALESCE(NULLIF(mapping.similar_question_group, ''), mapping.question_id)) AS latest_attempted_at,
        (SELECT attempt.correct FROM question_attempts attempt
          WHERE attempt.user_id = ?
            AND COALESCE(NULLIF(attempt.similar_question_group, ''), attempt.question_id)
              = COALESCE(NULLIF(mapping.similar_question_group, ''), mapping.question_id)
          ORDER BY attempt.attempted_at DESC LIMIT 1) AS latest_correct,
        ROW_NUMBER() OVER (
          PARTITION BY COALESCE(NULLIF(mapping.similar_question_group, ''), mapping.question_id)
          ORDER BY random()
        ) AS group_rank
      FROM question_section_mappings mapping
      JOIN question_bank question ON question.id = mapping.question_id
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = mapping.curriculum_section_id
      WHERE mapping.coursebook_section_id = ? AND mapping.status = 'reviewed'
        AND mapping.is_primary = 1 AND question.active = 1 AND question.subject_code = ?
        ${questionYearFilter(version.subject_code)}
    )
    SELECT * FROM candidate_rows WHERE group_rank = 1
    ORDER BY (latest_attempted_at IS NOT NULL), latest_correct, latest_attempted_at, random()
    LIMIT ?
  `).bind(user.id, user.id, sectionId, version.subject_code, count).all();
  const questions = candidates.results.map((row) => mapQuestion(row));
  if (!questions.length) {
    throw new AuthError(409, "This section has no reviewed questions yet.", "NO_REVIEWED_QUESTIONS");
  }
  const sessionId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const subject = await env.DB.prepare("SELECT name FROM exam_subjects WHERE code = ? LIMIT 1").bind(version.subject_code).first();
  await env.DB.prepare(`
    INSERT INTO practice_sessions (
      id, user_id, grade, board, subject, paper, difficulty, topics,
      requested_count, generated_questions, fallback_applied, status, created_at, practice_mode
    ) VALUES (?, ?, 'IGCSE', 'CIE', ?, 'MCQ', NULL, ?, ?, ?, 0, 'generated', ?, 'chapter')
  `).bind(sessionId, user.id, `IGCSE ${subject?.name || version.subject_code}`, JSON.stringify([sectionId]), questions.length, JSON.stringify(questions), createdAt).run();
  return {
    sessionId,
    createdAt,
    section: {
      id: section.id,
      sectionCode: section.section_code,
      titleEn: section.title_en,
      titleZh: section.title_zh,
      chapterNo: Number(section.chapter_no),
      chapterTitleEn: section.chapter_title_en,
      chapterTitleZh: section.chapter_title_zh,
    },
    questions,
  };
}

async function createChapterPaper(request, env) {
  await requireCurrentUser(request, env);
  const body = await readJsonBody(request);
  const versionId = requireString(body.curriculumVersion, "curriculumVersion");
  const excludeQuestionIds = requireArray(body.excludeQuestionIds || [], "excludeQuestionIds");
  if (excludeQuestionIds.length > 200) throw new AuthError(400, "Too many excluded questions.", "INVALID_INPUT");
  const excludedIds = excludeQuestionIds.map((id) => requireString(id, "excludeQuestionIds"));
  const buildSeed = String(body.buildSeed || crypto.randomUUID());
  if (buildSeed.length > 160) throw new AuthError(400, "Build seed is too long.", "INVALID_INPUT");
  const rawSelections = requireArray(body.sections, "sections");
  if (!rawSelections.length || rawSelections.length > 20) {
    throw new AuthError(400, "Select between 1 and 20 sections.", "INVALID_INPUT");
  }
  const selections = rawSelections.map((row) => ({
    coursebookSectionId: requireString(row?.coursebookSectionId, "sections.coursebookSectionId"),
    count: toInteger(row?.count, 0, 1, 20, "sections.count"),
  }));
  if (new Set(selections.map((row) => row.coursebookSectionId)).size !== selections.length) {
    throw new AuthError(400, "Each section can only be selected once.", "INVALID_INPUT");
  }
  if (selections.reduce((sum, row) => sum + row.count, 0) > 80) {
    throw new AuthError(400, "A paper can contain at most 80 questions.", "INVALID_INPUT");
  }

  const versionRow = await env.DB.prepare("SELECT * FROM curriculum_versions WHERE id = ? LIMIT 1")
    .bind(versionId).first();
  const version = versionRow && await getCurriculumVersion(env.DB, versionRow.subject_code, versionId);
  if (!version) throw new AuthError(404, "Curriculum version not found.", "CURRICULUM_NOT_FOUND");

  const groups = [];
  const usedGroups = new Set();
  if (excludedIds.length) {
    const rows = await env.DB.prepare(`
      SELECT question.id, mapping.similar_question_group
      FROM question_bank question
      LEFT JOIN question_section_mappings mapping ON mapping.question_id = question.id AND mapping.is_primary = 1
      WHERE question.subject_code = ? AND question.id IN (SELECT value FROM json_each(?))
    `).bind(version.subject_code, JSON.stringify(excludedIds)).all();
    for (const row of rows.results) usedGroups.add(row.similar_question_group || row.id);
  }
  const rank = (id) => {
    let hash = 2166136261;
    for (const character of buildSeed + id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
    return hash >>> 0;
  };
  for (const selection of selections) {
    const section = await env.DB.prepare(`
      SELECT DISTINCT book_section.*, chapter.chapter_no,
        chapter.title_en AS chapter_title_en, chapter.title_zh AS chapter_title_zh
      FROM coursebook_sections book_section
      JOIN coursebook_chapters chapter ON chapter.id = book_section.coursebook_chapter_id
      JOIN coursebook_section_mappings book_mapping ON book_mapping.coursebook_section_id = book_section.id
      JOIN curriculum_sections syllabus_section ON syllabus_section.id = book_mapping.curriculum_section_id
      WHERE book_section.id = ? AND syllabus_section.curriculum_version_id = ?
      LIMIT 1
    `).bind(selection.coursebookSectionId, version.id).first();
    if (!section) throw new AuthError(404, "Coursebook section not found.", "SECTION_NOT_FOUND");

    const exclusionGroups = [...usedGroups];
    const exclusionSql = exclusionGroups.length
      ? `AND COALESCE(NULLIF(mapping.similar_question_group, ''), mapping.question_id)
          NOT IN (SELECT value FROM json_each(?))`
      : "";
    const candidates = await env.DB.prepare(`
        SELECT question.*, mapping.curriculum_section_id, mapping.coursebook_section_id,
          mapping.similar_question_group, syllabus_section.syllabus_code,
          source.year AS exam_year, source.season, source.paper_number, source.variant,
          source.duration_minutes, source.source_question_count,
          'reviewed' AS mapping_status
        FROM question_section_mappings mapping
        JOIN question_bank question ON question.id = mapping.question_id
        JOIN curriculum_sections syllabus_section ON syllabus_section.id = mapping.curriculum_section_id
        JOIN exam_papers source ON source.slug = question.paper_slug AND source.status = 'published'
        WHERE mapping.coursebook_section_id = ? AND mapping.status = 'reviewed'
          AND mapping.is_primary = 1 AND question.active = 1
          AND mapping.rowid = (
            SELECT selected.rowid FROM question_section_mappings selected
            WHERE selected.question_id = question.id AND selected.is_primary = 1 AND selected.status <> 'rejected'
            ORDER BY CASE selected.status WHEN 'reviewed' THEN 0 ELSE 1 END,
              selected.confidence DESC, selected.curriculum_section_id
            LIMIT 1
          )
          AND question.subject_code = ? AND question.answer BETWEEN 0 AND 3
          AND question.question_no > 0
          AND (length(trim(COALESCE(question.stem, ''))) > 0 OR json_array_length(question.images) > 0)
          AND syllabus_section.curriculum_version_id = ?
          ${questionYearFilter(version.subject_code)}
          ${exclusionSql}
        ORDER BY question.id
    `).bind(
      selection.coursebookSectionId,
      version.subject_code,
      version.id,
      ...(exclusionGroups.length ? [JSON.stringify(exclusionGroups)] : [])
    ).all();
    const selected = [];
    for (const row of candidates.results.sort((left, right) => rank(left.id) - rank(right.id) || left.id.localeCompare(right.id))) {
      const group = row.similar_question_group || row.id;
      if (usedGroups.has(group) || excludedIds.includes(row.id)) continue;
      usedGroups.add(group);
      selected.push(row);
      if (selected.length === selection.count) break;
    }
    if (selected.length < selection.count) {
      throw new AuthError(
        409,
        `Not enough eligible questions in ${section.section_code}.`,
        "INSUFFICIENT_QUESTIONS",
        { sectionId: selection.coursebookSectionId, required: selection.count, available: selected.length }
      );
    }

    const questions = await fillEstimatedDurations(env.DB, version.subject_code, selected.map(mapPaperBuilderQuestion));
    groups.push({
      section: {
        id: section.id,
        sectionCode: section.section_code,
        titleEn: section.title_en,
        titleZh: section.title_zh,
        chapterNo: Number(section.chapter_no),
        chapterTitleEn: section.chapter_title_en,
        chapterTitleZh: section.chapter_title_zh,
      },
      requestedCount: selection.count,
      questions,
    });
  }

  return { subjectCode: version.subject_code, curriculumVersion: mapCurriculumVersion(version), buildSeed, groups };
}

async function submitChapterPractice(request, env, sessionId) {
  const { user } = await requireCurrentUser(request, env);
  const body = await readJsonBody(request);
  const rawAnswers = requireArray(body.answers, "answers");
  const answers = rawAnswers.map((answer) => ({
    selectedIndex: toInteger(answer?.selectedIndex, -1, -1, 20, "selectedIndex"),
    elapsedSeconds: toInteger(answer?.elapsedSeconds, 0, 0, 86400, "elapsedSeconds"),
    hintsUsed: toInteger(answer?.hintsUsed, 0, 0, 20, "hintsUsed"),
  }));
  const session = await env.DB.prepare(`
    SELECT * FROM practice_sessions
    WHERE id = ? AND user_id = ? AND practice_mode = 'chapter'
    LIMIT 1
  `).bind(sessionId, user.id).first();
  if (!session) throw new AuthError(404, "Chapter practice session not found.", "PRACTICE_NOT_FOUND");
  if (session.status === "submitted") {
    throw new AuthError(409, "This chapter practice has already been submitted.", "PRACTICE_ALREADY_SUBMITTED");
  }
  const storedQuestions = parseJson(session.generated_questions, []);
  if (storedQuestions.length !== answers.length) {
    throw new AuthError(400, `Answers length must be ${storedQuestions.length}.`, "INVALID_ANSWERS_LENGTH");
  }
  const answerQuestions = await loadQuestionsByIds(env.DB, storedQuestions.map((question) => question.id));
  if (answerQuestions.length !== storedQuestions.length) {
    throw new AuthError(409, "Chapter practice contains a missing question.", "QUESTION_NOT_FOUND");
  }
  const groups = storedQuestions.map((question) => question.similarQuestionGroup || question.id);
  const groupPlaceholders = groups.map(() => "?").join(", ");
  const seenRows = await env.DB.prepare(`
    SELECT DISTINCT COALESCE(NULLIF(similar_question_group, ''), question_id) AS question_group
    FROM question_attempts
    WHERE user_id = ? AND COALESCE(NULLIF(similar_question_group, ''), question_id) IN (${groupPlaceholders})
  `).bind(user.id, ...groups).all();
  const seen = new Set(seenRows.results.map((row) => row.question_group));
  let correctCount = 0;
  const details = [];
  const attemptedAt = new Date().toISOString();
  const statements = [];
  storedQuestions.forEach((storedQuestion, index) => {
    const source = answerQuestions[index];
    const answer = answers[index];
    const correct = answer.selectedIndex === source.answer;
    const group = storedQuestion.similarQuestionGroup || storedQuestion.id;
    const firstExposure = !seen.has(group);
    if (correct) correctCount += 1;
    statements.push(env.DB.prepare(`
      INSERT INTO question_attempts (
        id, user_id, question_id, practice_session_id, curriculum_section_id,
        coursebook_section_id, mode, selected_index, correct, first_exposure,
        elapsed_seconds, hints_used, attempted_at, similar_question_group
      ) VALUES (?, ?, ?, ?, ?, ?, 'chapter', ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      crypto.randomUUID(), user.id, storedQuestion.id, sessionId,
      storedQuestion.curriculumSectionId, storedQuestion.coursebookSectionId,
      answer.selectedIndex, correct ? 1 : 0, firstExposure ? 1 : 0,
      answer.elapsedSeconds, answer.hintsUsed, attemptedAt,
      storedQuestion.similarQuestionGroup || null
    ));
    details.push({
      id: storedQuestion.id,
      topic: source.topic,
      skills: source.skills,
      mistakeType: source.mistakeType,
      selectedIndex: answer.selectedIndex,
      answer: source.answer,
      correct,
      firstExposure,
      hintsUsed: answer.hintsUsed,
      curriculumSectionId: storedQuestion.curriculumSectionId,
      coursebookSectionId: storedQuestion.coursebookSectionId,
    });
  });
  const total = details.length;
  const result = {
    total,
    correct: correctCount,
    wrong: total - correctCount,
    accuracy: total ? (correctCount / total) * 100 : 0,
    details,
    submittedAt: attemptedAt,
  };
  statements.push(env.DB.prepare(`
    UPDATE practice_sessions
    SET answers = ?, result = ?, status = 'submitted', submitted_at = ?
    WHERE id = ? AND user_id = ? AND status = 'generated'
  `).bind(JSON.stringify(answers.map((answer) => answer.selectedIndex)), JSON.stringify(result), attemptedAt, sessionId, user.id));
  try {
    await env.DB.batch(statements);
  } catch (error) {
    const latest = await env.DB.prepare("SELECT status FROM practice_sessions WHERE id = ?").bind(sessionId).first();
    if (latest?.status === "submitted") {
      throw new AuthError(409, "This chapter practice has already been submitted.", "PRACTICE_ALREADY_SUBMITTED");
    }
    throw error;
  }
  await saveWrongNotebook(env.DB, user.id, answerQuestions, details, {
    board: "CIE",
    subject: session.subject,
    paper: "Chapter Practice",
  });
  return result;
}

async function assertOwnUser(request, env, requestedUserId) {
  const { user } = await requireCurrentUser(request, env);
  if (user.id !== requestedUserId) {
    throw new AuthError(403, "You cannot access another user's learning records.", "FORBIDDEN");
  }
  return user;
}

export async function handleLearningApiRequest(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_PREFLIGHT_HEADERS });
  }
  try {
    if (request.method === "POST" && url.pathname === "/api/papers/generate") {
      return success(await generatePaper(request, env), request.method);
    }
    if (request.method === "POST" && url.pathname === "/api/papers/submit-local") {
      return success(await submitLocalPaper(request, env), request.method);
    }
    if (request.method === "POST" && url.pathname === "/api/papers/submit") {
      const { user } = await requireCurrentUser(request, env);
      const body = await readJsonBody(request);
      const paperId = requireString(body.paperId, "paperId");
      const session = await env.DB.prepare(`
        SELECT * FROM practice_sessions WHERE id = ? AND user_id = ? LIMIT 1
      `).bind(paperId, user.id).first();
      if (!session) throw new AuthError(404, "Paper not found or expired. Please generate a new paper.", "PAPER_NOT_FOUND");
      const submitted = await submitStoredSession(env.DB, user.id, session, body.answers);
      return success({
        ...submitted,
        analysis: buildAnalysis({ wrongLog: submitted.wrongLog, lastResult: submitted.result, language: body.language }),
      }, request.method);
    }
    if (request.method === "POST" && url.pathname === "/api/analysis") {
      const body = await readJsonBody(request);
      return success(buildAnalysis(body), request.method);
    }

    const userPractices = url.pathname.match(/^\/api\/users\/([^/]+)\/practices$/);
    if (userPractices && request.method === "GET") {
      const userId = decodeURIComponent(userPractices[1]);
      await assertOwnUser(request, env, userId);
      const limit = toInteger(url.searchParams.get("limit"), 20, 1, 100, "limit");
      const rows = await env.DB.prepare(`
        SELECT * FROM practice_sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?
      `).bind(userId, limit).all();
      return success(rows.results.map(mapSession), request.method);
    }
    if (userPractices && request.method === "DELETE") {
      const userId = decodeURIComponent(userPractices[1]);
      await assertOwnUser(request, env, userId);
      const results = await env.DB.batch([
        env.DB.prepare("DELETE FROM question_attempts WHERE user_id = ?").bind(userId),
        env.DB.prepare("DELETE FROM wrong_notebook_entries WHERE user_id = ?").bind(userId),
        env.DB.prepare("DELETE FROM practice_sessions WHERE user_id = ?").bind(userId),
      ]);
      return success({
        deleted: Number(results[2]?.meta?.changes || 0),
        deletedNotebook: Number(results[1]?.meta?.changes || 0),
      }, request.method);
    }

    const notebookList = url.pathname.match(/^\/api\/users\/([^/]+)\/notebook$/);
    if (notebookList && request.method === "GET") {
      const userId = decodeURIComponent(notebookList[1]);
      await assertOwnUser(request, env, userId);
      const rows = await env.DB.prepare(`
        SELECT * FROM wrong_notebook_entries WHERE user_id = ? ORDER BY last_wrong_at DESC
      `).bind(userId).all();
      return success(rows.results.map(mapNotebookEntry), request.method);
    }
    const notebookPractice = url.pathname.match(/^\/api\/users\/([^/]+)\/notebook\/practice$/);
    if (notebookPractice && request.method === "POST") {
      const userId = decodeURIComponent(notebookPractice[1]);
      return success(await createNotebookPractice(request, env, userId), request.method);
    }
    const notebookEntry = url.pathname.match(/^\/api\/users\/([^/]+)\/notebook\/([^/]+)$/);
    if (notebookEntry && request.method === "PATCH") {
      const userId = decodeURIComponent(notebookEntry[1]);
      const entryId = decodeURIComponent(notebookEntry[2]);
      await assertOwnUser(request, env, userId);
      const body = await readJsonBody(request);
      const allowedKeysNotebook = ["mastered", "starred", "note", "mistakeType", "mistakeReasons", "lastRedoneAt"];
      const sets = [];
      const params = [];
      const allowedMistakeTypes = new Set([
        "concept", "calculation", "question_reading", "careless", "time_pressure", "unknown",
      ]);
      for (const key of allowedKeysNotebook) {
        if (!(key in body)) continue;
        const value = body[key];
        if (key === "mastered") {
          sets.push("mastered = ?");
          params.push(value ? 1 : 0);
        } else if (key === "starred") {
          sets.push("starred = ?");
          params.push(value ? 1 : 0);
        } else if (key === "note") {
          sets.push("note = ?");
          params.push(typeof value === "string" ? value : "");
        } else if (key === "mistakeType") {
          sets.push("mistake_type = ?");
          params.push(allowedMistakeTypes.has(value) ? value : "unknown");
        } else if (key === "mistakeReasons") {
          const arr = Array.isArray(value) ? value.filter((x) => typeof x === "string") : [];
          sets.push("mistake_reasons = ?");
          params.push(JSON.stringify(arr));
        } else if (key === "lastRedoneAt") {
          sets.push("last_redone_at = ?");
          const iso = value ? new Date(value).toISOString() : new Date().toISOString();
          params.push(iso);
        }
      }
      if (sets.length === 0) {
        throw new AuthError(400, "No valid fields to update.", "NO_VALID_FIELDS");
      }
      sets.push("updated_at = ?");
      params.push(new Date().toISOString());
      params.push(entryId);
      params.push(userId);
      await env.DB.prepare(`
        UPDATE wrong_notebook_entries SET ${sets.join(", ")} WHERE id = ? AND user_id = ?
      `).bind(...params).run();
      const row = await env.DB.prepare(`
        SELECT * FROM wrong_notebook_entries WHERE id = ? AND user_id = ? LIMIT 1
      `).bind(entryId, userId).first();
      if (!row) throw new AuthError(404, "Wrong notebook entry not found.", "NOTEBOOK_ENTRY_NOT_FOUND");
      return success(mapNotebookEntry(row), request.method);
    }

    if (request.method === "GET" && url.pathname === "/api/curriculum/subjects") {
      await requireCurrentUser(request, env);
      return success(await listCurriculumSubjects(env.DB), request.method);
    }
    if (request.method === "GET" && url.pathname === "/api/paper-builder/subjects") {
      await requireCurrentUser(request, env);
      return success(await listPaperBuilderSubjects(env.DB), request.method);
    }
    if (request.method === "GET" && url.pathname === "/api/paper-builder/questions") {
      return success(await searchPaperBuilderQuestions(request, env), request.method);
    }
    if (url.pathname === "/api/paper-builder/papers" && request.method === "GET") {
      return success(await listSavedPapers(request, env), request.method);
    }
    if (url.pathname === "/api/paper-builder/papers" && request.method === "POST") {
      return success(await createSavedPaper(request, env), request.method, 201);
    }
    const savedPaper = url.pathname.match(/^\/api\/paper-builder\/papers\/([^/]+)$/);
    if (savedPaper && request.method === "GET") {
      const { user } = await requireCurrentUser(request, env);
      return success(
        await loadSavedPaper(env.DB, user.id, decodeURIComponent(savedPaper[1])),
        request.method
      );
    }
    if (savedPaper && request.method === "PATCH") {
      return success(
        await updateSavedPaper(request, env, decodeURIComponent(savedPaper[1])),
        request.method
      );
    }
    if (savedPaper && request.method === "DELETE") {
      return success(
        await deleteSavedPaper(request, env, decodeURIComponent(savedPaper[1])),
        request.method
      );
    }
    const equivalentPaper = url.pathname.match(/^\/api\/paper-builder\/papers\/([^/]+)\/equivalent$/);
    if (equivalentPaper && request.method === "POST") {
      return success(
        await generateEquivalentPaper(request, env, decodeURIComponent(equivalentPaper[1])),
        request.method,
        201
      );
    }
    if (request.method === "POST" && url.pathname === "/api/paper-builder/generate") {
      return success(await createChapterPaper(request, env), request.method, 201);
    }
    const versions = url.pathname.match(/^\/api\/curriculum\/([^/]+)\/versions$/);
    if (versions && request.method === "GET") {
      await requireCurrentUser(request, env);
      const subjectCode = requireCurriculumCode(decodeURIComponent(versions[1]));
      const rows = await env.DB.prepare(`
        SELECT * FROM curriculum_versions WHERE subject_code = ?
        ORDER BY active DESC, exam_year_start DESC, version DESC
      `).bind(subjectCode).all();
      return success(rows.results.map(mapCurriculumVersion), request.method);
    }
    const chapters = url.pathname.match(/^\/api\/curriculum\/([^/]+)\/chapters$/);
    if (chapters && request.method === "GET") {
      const { user } = await requireCurrentUser(request, env);
      const subjectCode = requireCurriculumCode(decodeURIComponent(chapters[1]));
      const version = await getCurriculumVersion(env.DB, subjectCode, url.searchParams.get("version") || "");
      if (!version) throw new AuthError(404, "Curriculum version not found.", "CURRICULUM_NOT_FOUND");
      return success(await listChapterCatalog(env.DB, user.id, version), request.method);
    }
    if (request.method === "POST" && url.pathname === "/api/chapter-practice/sessions") {
      return success(await createChapterPractice(request, env), request.method, 201);
    }
    const chapterSubmit = url.pathname.match(/^\/api\/chapter-practice\/sessions\/([^/]+)\/submit$/);
    if (chapterSubmit && request.method === "POST") {
      return success(
        await submitChapterPractice(request, env, decodeURIComponent(chapterSubmit[1])),
        request.method
      );
    }
    return routeNotFound(request, url);
  } catch (error) {
    if (error instanceof AuthError) {
      return failure(error.status, error.code, error.message, request.method, error.details);
    }
    console.error("D1 learning API failed", error);
    return failure(500, "INTERNAL_SERVER_ERROR", "Unexpected server error.", request.method);
  }
}
