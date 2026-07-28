import { getPool, query } from "../client.js";

function mapQuestion(row) {
  return {
    id: row.id,
    board: row.board,
    subject: row.subject,
    subjectCode: row.subject_code,
    paper: row.paper,
    paperSlug: row.paper_slug,
    questionNo: row.question_no == null ? null : Number(row.question_no),
    year: row.year,
    topic: row.syllabus_code,
    stem: row.stem,
    options: row.options || [],
    images: row.images || [],
    skills: row.skills || [],
    hints: row.hints || [],
    curriculumSectionId: row.curriculum_section_id,
    coursebookSectionId: row.coursebook_section_id,
    syllabusCode: row.syllabus_code,
    similarQuestionGroup: row.similar_question_group || null,
  };
}

export async function createChapterPracticeSession(input) {
  const candidates = await query(`
    with latest_group_attempt as (
      select distinct on (coalesce(nullif(attempt.similar_question_group, ''), attempt.question_id))
        coalesce(nullif(attempt.similar_question_group, ''), attempt.question_id) as question_group,
        attempt.correct,
        attempt.attempted_at
      from question_attempts attempt
      where attempt.user_id = $2
      order by
        coalesce(nullif(attempt.similar_question_group, ''), attempt.question_id),
        attempt.attempted_at desc
    ), grouped_candidates as (
      select
        question.*,
        mapping.curriculum_section_id,
        mapping.coursebook_section_id,
        mapping.similar_question_group,
        syllabus_section.syllabus_code,
        latest_group_attempt.correct as latest_correct,
        latest_group_attempt.attempted_at as latest_attempted_at,
        row_number() over (
          partition by coalesce(nullif(mapping.similar_question_group, ''), question.id)
          order by random()
        ) as group_rank
      from question_section_mappings mapping
      join question_bank question on question.id = mapping.question_id
      join curriculum_sections syllabus_section on syllabus_section.id = mapping.curriculum_section_id
      left join latest_group_attempt
        on latest_group_attempt.question_group = coalesce(nullif(mapping.similar_question_group, ''), question.id)
      where mapping.coursebook_section_id = $1
        and mapping.status = 'reviewed'
        and mapping.is_primary = true
        and question.active = true
        and question.subject_code = '0610'
        and question.year ~ '^\\d{4}$'
        and question.year::integer between 2019 and 2023
    )
    select *
    from grouped_candidates
    where group_rank = 1
    order by
      (latest_attempted_at is not null),
      latest_correct nulls first,
      latest_attempted_at,
      random()
    limit $3
  `, [input.coursebookSectionId, input.userId, input.count]);
  const questions = candidates.rows.map(mapQuestion);
  if (!questions.length) return null;

  const result = await query(`
    insert into practice_sessions (
      user_id, grade, board, subject, paper, difficulty, topics,
      requested_count, generated_questions, fallback_applied, status, practice_mode
    ) values (
      $1, 'IGCSE', 'CIE', 'IGCSE Biology', 'MCQ', null, $2::text[],
      $3, $4::jsonb, false, 'generated', 'chapter'
    )
    returning id, created_at
  `, [
    input.userId,
    [input.coursebookSectionId],
    questions.length,
    JSON.stringify(questions),
  ]);
  return {
    id: result.rows[0].id,
    createdAt: result.rows[0].created_at,
    questions,
  };
}

export async function submitChapterPracticeSession(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [String(input.userId)]);
    const sessionResult = await client.query(`
      select *
      from practice_sessions
      where id = $1 and user_id = $2 and practice_mode = 'chapter'
      for update
    `, [input.sessionId, input.userId]);
    const session = sessionResult.rows[0];
    if (!session) {
      await client.query("rollback");
      return { status: "not_found" };
    }
    if (session.status === "submitted") {
      await client.query("rollback");
      return { status: "already_submitted" };
    }

    const storedQuestions = Array.isArray(session.generated_questions)
      ? session.generated_questions
      : [];
    if (storedQuestions.length !== input.answers.length) {
      await client.query("rollback");
      return { status: "invalid_length", expected: storedQuestions.length };
    }

    const questionIds = storedQuestions.map((question) => question.id);
    const answerResult = await client.query(`
      select id, answer, options, topic, mistake_type, skills
      from question_bank
      where id = any($1::text[])
    `, [questionIds]);
    const answerByQuestion = new Map(answerResult.rows.map((row) => [row.id, row]));
    if (answerByQuestion.size !== questionIds.length) {
      throw new Error("Chapter practice contains a missing question.");
    }

    const questionGroups = storedQuestions.map((question) => (
      question.similarQuestionGroup || question.id
    ));
    const seenResult = await client.query(`
      select distinct coalesce(nullif(similar_question_group, ''), question_id) as question_group
      from question_attempts
      where user_id = $1
        and coalesce(nullif(similar_question_group, ''), question_id) = any($2::text[])
    `, [input.userId, questionGroups]);
    const seen = new Set(seenResult.rows.map((row) => row.question_group));
    const details = [];
    let correctCount = 0;

    for (let index = 0; index < storedQuestions.length; index += 1) {
      const storedQuestion = storedQuestions[index];
      const answerRow = answerByQuestion.get(storedQuestion.id);
      const submitted = input.answers[index];
      const selectedIndex = submitted.selectedIndex;
      const correct = selectedIndex === Number(answerRow.answer);
      const questionGroup = storedQuestion.similarQuestionGroup || storedQuestion.id;
      const firstExposure = !seen.has(questionGroup);
      if (correct) correctCount += 1;
      await client.query(`
        insert into question_attempts (
          user_id, question_id, practice_session_id, curriculum_section_id,
          coursebook_section_id, mode, selected_index, correct, first_exposure,
          elapsed_seconds, hints_used, similar_question_group
        ) values ($1, $2, $3, $4, $5, 'chapter', $6, $7, $8, $9, $10, $11)
      `, [
        input.userId,
        storedQuestion.id,
        input.sessionId,
        storedQuestion.curriculumSectionId,
        storedQuestion.coursebookSectionId,
        selectedIndex,
        correct,
        firstExposure,
        submitted.elapsedSeconds,
        submitted.hintsUsed,
        storedQuestion.similarQuestionGroup,
      ]);
      details.push({
        id: storedQuestion.id,
        topic: answerRow.topic,
        skills: answerRow.skills || [],
        mistakeType: answerRow.mistake_type || "concept",
        selectedIndex,
        answer: Number(answerRow.answer),
        correct,
        firstExposure,
        hintsUsed: submitted.hintsUsed,
        curriculumSectionId: storedQuestion.curriculumSectionId,
        coursebookSectionId: storedQuestion.coursebookSectionId,
      });
    }

    const total = storedQuestions.length;
    const result = {
      total,
      correct: correctCount,
      wrong: total - correctCount,
      accuracy: total ? (correctCount / total) * 100 : 0,
      details,
      submittedAt: new Date().toISOString(),
    };
    await client.query(`
      update practice_sessions
      set answers = $2::int[], result = $3::jsonb, status = 'submitted', submitted_at = now()
      where id = $1
    `, [input.sessionId, input.answers.map((answer) => answer.selectedIndex), JSON.stringify(result)]);
    await client.query("commit");

    return {
      status: "submitted",
      result,
      questions: storedQuestions.map((question) => ({
        ...question,
        answer: Number(answerByQuestion.get(question.id).answer),
        mistakeType: answerByQuestion.get(question.id).mistake_type || "concept",
      })),
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function listQuestionMappingsForReview(input) {
  const [result, countResult] = await Promise.all([query(`
    select
      mapping.*,
      question.stem,
      question.year,
      question.paper_slug,
      question.question_no,
      question.images,
      syllabus_section.syllabus_code,
      syllabus_section.title_en as syllabus_title_en,
      syllabus_section.title_zh as syllabus_title_zh,
      book_section.section_code as book_section_code,
      book_section.title_en as book_title_en,
      book_section.title_zh as book_title_zh
    from question_section_mappings mapping
    join question_bank question on question.id = mapping.question_id
    join curriculum_sections syllabus_section on syllabus_section.id = mapping.curriculum_section_id
    left join coursebook_sections book_section on book_section.id = mapping.coursebook_section_id
    where ($1 = '' or mapping.status = $1)
      and syllabus_section.curriculum_version_id = $3
      and ($4 = '' or question.year = $4)
      and ($5 = 0 or book_section.section_code like $5::text || '.%')
    order by mapping.created_at, question.year desc, question.paper_slug, question.question_no
    limit $2
    offset $6
  `, [input.status, input.limit, input.versionId, input.year, input.chapterNo, input.offset]), query(`
    select count(*)::int as count
    from question_section_mappings mapping
    join question_bank question on question.id = mapping.question_id
    join curriculum_sections syllabus_section on syllabus_section.id = mapping.curriculum_section_id
    left join coursebook_sections book_section on book_section.id = mapping.coursebook_section_id
    where ($1 = '' or mapping.status = $1)
      and syllabus_section.curriculum_version_id = $2
      and ($3 = '' or question.year = $3)
      and ($4 = 0 or book_section.section_code like $4::text || '.%')
  `, [input.status, input.versionId, input.year, input.chapterNo])]);
  return {
    total: Number(countResult.rows[0]?.count || 0),
    mappings: result.rows.map((row) => ({
    questionId: row.question_id,
    curriculumSectionId: row.curriculum_section_id,
    coursebookSectionId: row.coursebook_section_id,
    isPrimary: Boolean(row.is_primary),
    confidence: row.confidence == null ? null : Number(row.confidence),
    status: row.status,
    source: row.source,
    similarQuestionGroup: row.similar_question_group,
    stem: row.stem,
    year: row.year,
    paperSlug: row.paper_slug,
    questionNo: row.question_no == null ? null : Number(row.question_no),
    images: row.images || [],
    syllabusCode: row.syllabus_code,
    syllabusTitleEn: row.syllabus_title_en,
    syllabusTitleZh: row.syllabus_title_zh,
    bookSectionCode: row.book_section_code,
    bookTitleEn: row.book_title_en,
    bookTitleZh: row.book_title_zh,
    })),
  };
}

export async function reviewQuestionMapping(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const validMapping = await client.query(`
      select 1
      from coursebook_section_mappings
      where coursebook_section_id = $1 and curriculum_section_id = $2
    `, [input.coursebookSectionId, input.curriculumSectionId]);
    if (!validMapping.rowCount) {
      await client.query("rollback");
      return { status: "invalid_mapping" };
    }
    const current = await client.query(`
      select *
      from question_section_mappings
      where question_id = $1 and curriculum_section_id = $2
      for update
    `, [input.questionId, input.currentCurriculumSectionId]);
    if (!current.rowCount) {
      await client.query("rollback");
      return { status: "not_found" };
    }
    if (input.status === "reviewed" && input.isPrimary) {
      await client.query(`
        update question_section_mappings
        set is_primary = false, updated_at = now()
        where question_id = $1
          and status = 'reviewed'
          and is_primary = true
          and curriculum_section_id <> $2
      `, [input.questionId, input.curriculumSectionId]);
      await client.query(`
        update question_section_mappings
        set
          status = 'rejected',
          is_primary = false,
          reviewed_by = $3,
          reviewed_at = now(),
          updated_at = now()
        where question_id = $1
          and curriculum_section_id not in ($2, $4)
          and status = 'suggested'
      `, [
        input.questionId,
        input.curriculumSectionId,
        input.adminId,
        input.currentCurriculumSectionId,
      ]);
    }
    await client.query(`
      delete from question_section_mappings
      where question_id = $1 and curriculum_section_id = $2
    `, [input.questionId, input.currentCurriculumSectionId]);
    const result = await client.query(`
      insert into question_section_mappings (
        question_id, curriculum_section_id, coursebook_section_id,
        is_primary, confidence, status, reviewed_by, reviewed_at,
        source, similar_question_group, updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, now())
      on conflict (question_id, curriculum_section_id) do update set
        coursebook_section_id = excluded.coursebook_section_id,
        is_primary = excluded.is_primary,
        confidence = excluded.confidence,
        status = excluded.status,
        reviewed_by = excluded.reviewed_by,
        reviewed_at = excluded.reviewed_at,
        source = excluded.source,
        similar_question_group = excluded.similar_question_group,
        updated_at = now()
      returning *
    `, [
      input.questionId,
      input.curriculumSectionId,
      input.coursebookSectionId,
      input.isPrimary,
      current.rows[0].confidence,
      input.status,
      input.adminId,
      input.status === "reviewed" ? "manual" : current.rows[0].source,
      current.rows[0].similar_question_group,
    ]);
    await client.query("commit");
    return { status: "updated", mapping: result.rows[0] };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
