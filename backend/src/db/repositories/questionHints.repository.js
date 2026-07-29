import { query } from "../client.js";

function mapHintSet(row) {
  return row ? {
    id: row.id,
    questionId: row.question_id,
    language: row.language,
    promptVersion: row.prompt_version,
    questionFingerprint: row.question_fingerprint,
    hints: Array.isArray(row.hints) ? row.hints : [],
    status: row.status,
    model: row.model,
    responseId: row.response_id || null,
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

export async function getQuestionHintSet(input) {
  const result = await query(`
    select *
    from question_hint_sets
    where question_id = $1
      and language = $2
      and prompt_version = $3
      and question_fingerprint = $4
    limit 1
  `, [input.questionId, input.language, input.promptVersion, input.questionFingerprint]);
  return mapHintSet(result.rows[0]);
}

export async function upsertQuestionHintSet(input) {
  const result = await query(`
    insert into question_hint_sets (
      question_id, language, prompt_version, question_fingerprint,
      hints, status, model, response_id
    ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
    on conflict (question_id, language, prompt_version, question_fingerprint)
    do update set
      hints = excluded.hints,
      status = excluded.status,
      model = excluded.model,
      response_id = excluded.response_id,
      reviewed_by = null,
      reviewed_at = null,
      updated_at = now()
    returning *
  `, [
    input.questionId,
    input.language,
    input.promptVersion,
    input.questionFingerprint,
    JSON.stringify(input.hints),
    input.status,
    input.model,
    input.responseId || null,
  ]);
  return mapHintSet(result.rows[0]);
}

export async function listQuestionHintSetsForReview(input = {}) {
  const params = [];
  const conditions = [];
  if (input.status) {
    params.push(input.status);
    conditions.push(`hint.status = $${params.length}`);
  }
  if (input.subjectCode) {
    params.push(input.subjectCode);
    conditions.push(`question.subject_code = $${params.length}`);
  }
  params.push(input.limit || 50);
  const result = await query(`
    select
      hint.*,
      question.paper_slug,
      question.question_no,
      question.subject_code,
      question.stem,
      question.options,
      question.images
    from question_hint_sets hint
    join question_bank question on question.id = hint.question_id
    ${conditions.length ? `where ${conditions.join(" and ")}` : ""}
    order by hint.created_at desc
    limit $${params.length}
  `, params);
  return result.rows.map((row) => ({
    ...mapHintSet(row),
    question: {
      paperSlug: row.paper_slug,
      questionNo: Number(row.question_no),
      subjectCode: row.subject_code,
      stem: row.stem,
      options: row.options || [],
      images: row.images || [],
    },
  }));
}

export async function reviewQuestionHintSet(input) {
  const result = await query(`
    update question_hint_sets
    set
      status = $2,
      reviewed_by = $3,
      reviewed_at = now(),
      updated_at = now()
    where id = $1
    returning *
  `, [input.id, input.status, input.reviewerId]);
  return mapHintSet(result.rows[0]);
}
