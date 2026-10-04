function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveMarks(value) {
  const marks = Math.trunc(finiteNumber(value, 1));
  return marks > 0 ? marks : 1;
}

function answerLetter(answer) {
  const index = Number(answer);
  return Number.isInteger(index) && index >= 0 && index <= 3
    ? String.fromCharCode(65 + index)
    : "unknown";
}

function isStructured(item) {
  return String(item?.questionType ?? item?.question_type ?? "mcq").trim().toLowerCase() === "structured";
}

function questionMarks(item) {
  if (!isStructured(item)) return positiveMarks(item?.marks);
  if (!Number.isInteger(item?.maxMarks) || item.maxMarks <= 0) {
    const questionId = String(item?.id || item?.questionId || "unknown");
    const error = new Error(`Question "${questionId}" requires official maxMarks as a positive integer.`);
    error.code = "STRUCTURED_OFFICIAL_MARKS_REQUIRED";
    error.questionId = questionId;
    throw error;
  }
  return item.maxMarks;
}

function incrementRecord(record, key, amount = 1) {
  record[key] = finiteNumber(record[key]) + amount;
  return record[key];
}

function normalizedDistribution(items, key) {
  const distribution = {};
  for (const item of items) {
    const value = String(item?.[key] ?? "").trim();
    if (value) incrementRecord(distribution, value);
  }
  return distribution;
}

export function buildPaperBlueprint(items = []) {
  const answerDistribution = { A: 0, B: 0, C: 0, D: 0, unknown: 0 };
  const sections = {};
  const sources = {};
  const sourceGroups = {};
  const difficultyDistribution = {};
  let totalMarks = 0;
  let estimatedSeconds = 0;
  let knownDifficulty = 0;
  let mcqQuestionCount = 0;
  let structuredQuestionCount = 0;
  const questionTypes = { mcq: 0, structured: 0 };

  for (const item of items) {
    const id = String(item?.id ?? "");
    const structured = isStructured(item);
    const marks = questionMarks(item);
    const seconds = Math.max(0, finiteNumber(item?.estimatedSeconds));
    const sectionId = String(item?.sectionId ?? "").trim() || "unmapped";
    const sectionCode = String(item?.sectionCode ?? "").trim();
    const paperSlug = String(item?.paperSlug ?? "").trim() || "unknown";
    const sourceGroup = String(item?.sourceGroup ?? "").trim();
    const difficulty = String(item?.difficulty ?? "").trim();
    const letter = answerLetter(item?.answer);

    totalMarks += marks;
    estimatedSeconds += seconds;
    questionTypes[structured ? "structured" : "mcq"] += 1;
    if (structured) structuredQuestionCount += 1;
    else {
      mcqQuestionCount += 1;
      answerDistribution[letter] += 1;
    }

    if (!sections[sectionId]) {
      sections[sectionId] = {
        id: sectionId,
        code: sectionCode,
        count: 0,
        marks: 0,
        questionIds: [],
      };
    }
    sections[sectionId].count += 1;
    sections[sectionId].marks += marks;
    sections[sectionId].questionIds.push(id);

    if (!sources[paperSlug]) sources[paperSlug] = { paperSlug, count: 0, questionIds: [] };
    sources[paperSlug].count += 1;
    sources[paperSlug].questionIds.push(id);

    if (sourceGroup) {
      if (!sourceGroups[sourceGroup]) sourceGroups[sourceGroup] = { sourceGroup, count: 0, questionIds: [] };
      sourceGroups[sourceGroup].count += 1;
      sourceGroups[sourceGroup].questionIds.push(id);
    }

    if (difficulty) {
      knownDifficulty += 1;
      incrementRecord(difficultyDistribution, difficulty);
    }
  }

  const questionCount = items.length;
  return {
    questionCount,
    totalMarks,
    estimatedSeconds,
    answerDistribution,
    sections,
    sources,
    sourceGroups,
    years: normalizedDistribution(items, "year"),
    seasons: normalizedDistribution(items, "season"),
    difficulty: {
      known: knownDifficulty,
      unknown: questionCount - knownDifficulty,
      coverage: questionCount ? knownDifficulty / questionCount : 0,
      distribution: difficultyDistribution,
    },
    mcqQuestionCount,
    structuredQuestionCount,
    questionTypes,
  };
}

export function buildBlueprintIssues(blueprint, options = {}) {
  const issues = [];
  const questionCount = Math.max(0, finiteNumber(blueprint?.questionCount));
  const targetSections = options.targetSections || {};
  const difficultyCoverageMinimum = finiteNumber(options.difficultyCoverageMinimum, 0.7);

  for (const [sectionId, requiredValue] of Object.entries(targetSections)) {
    const required = Math.max(0, Math.trunc(finiteNumber(requiredValue)));
    const actual = Math.max(0, Math.trunc(finiteNumber(blueprint?.sections?.[sectionId]?.count)));
    if (actual < required) {
      issues.push({
        code: "SECTION_TARGET_MISSING",
        severity: "error",
        blocking: true,
        questionIds: blueprint?.sections?.[sectionId]?.questionIds || [],
        details: { sectionId, required, actual, missing: required - actual },
      });
    }
  }

  for (const group of Object.values(blueprint?.sourceGroups || {})) {
    if (group.count > 1) {
      issues.push({
        code: "SIMILAR_GROUP_REPEAT",
        severity: "warning",
        blocking: false,
        questionIds: [...group.questionIds],
        details: { sourceGroup: group.sourceGroup, count: group.count },
      });
    }
  }

  for (const source of Object.values(blueprint?.sources || {})) {
    const ratio = questionCount ? source.count / questionCount : 0;
    if (ratio > 0.25) {
      issues.push({
        code: "SOURCE_CONCENTRATION",
        severity: "warning",
        blocking: false,
        questionIds: [...source.questionIds],
        details: { paperSlug: source.paperSlug, count: source.count, ratio },
      });
    }
  }

  const answerableQuestionCount = Math.max(0, finiteNumber(blueprint?.mcqQuestionCount, questionCount));
  if (answerableQuestionCount >= 20) {
    for (const letter of ["A", "B", "C", "D"]) {
      const count = finiteNumber(blueprint?.answerDistribution?.[letter]);
      const ratio = count / answerableQuestionCount;
      if (ratio > 0.4) {
        issues.push({
          code: "ANSWER_DISTRIBUTION_IMBALANCE",
          severity: "warning",
          blocking: false,
          questionIds: [],
          details: { answer: letter, count, ratio },
        });
      }
    }
  }

  const difficultyCoverage = finiteNumber(blueprint?.difficulty?.coverage);
  if (questionCount && difficultyCoverage < difficultyCoverageMinimum) {
    issues.push({
      code: "DIFFICULTY_DATA_INSUFFICIENT",
      severity: "info",
      blocking: false,
      questionIds: [],
      details: { coverage: difficultyCoverage, minimum: difficultyCoverageMinimum },
    });
  }

  return issues;
}

function sortedRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

export function compareEquivalentPapers(sourceItems = [], equivalentItems = []) {
  const source = buildPaperBlueprint(sourceItems);
  const equivalent = buildPaperBlueprint(equivalentItems);
  const sourceIds = new Set(sourceItems.map((item) => item.id));
  const equivalentIds = new Set(equivalentItems.map((item) => item.id));
  const sourceGroups = new Set(sourceItems.map((item) => String(item.sourceGroup || "")).filter(Boolean));
  const equivalentGroups = new Set(equivalentItems.map((item) => String(item.sourceGroup || "")).filter(Boolean));
  const sourceSectionCounts = Object.fromEntries(Object.entries(source.sections).map(([id, section]) => [id, section.count]));
  const equivalentSectionCounts = Object.fromEntries(Object.entries(equivalent.sections).map(([id, section]) => [id, section.count]));

  return {
    questionCountMatch: source.questionCount === equivalent.questionCount,
    totalMarksMatch: source.totalMarks === equivalent.totalMarks,
    sectionCountsMatch: JSON.stringify(sortedRecord(sourceSectionCounts)) === JSON.stringify(sortedRecord(equivalentSectionCounts)),
    repeatedQuestionIds: [...sourceIds].filter((id) => equivalentIds.has(id)),
    repeatedSourceGroups: [...sourceGroups].filter((group) => equivalentGroups.has(group)),
    estimatedSecondsDifference: Math.abs(source.estimatedSeconds - equivalent.estimatedSeconds),
    sourceYears: source.years,
    equivalentYears: equivalent.years,
    sourceDifficulty: source.difficulty,
    equivalentDifficulty: equivalent.difficulty,
  };
}
