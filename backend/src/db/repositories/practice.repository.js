import { query } from "../client.js";

function mapSession(row) {
  return {
    id: row.id,
    userId: row.user_id,
    grade: row.grade,
    board: row.board,
    subject: row.subject,
    paper: row.paper,
    difficulty: row.difficulty,
    topics: row.topics || [],
    requestedCount: row.requested_count,
    generatedQuestions: row.generated_questions || [],
    answers: row.answers || null,
    result: row.result || null,
    wrongLog: row.wrong_log || null,
    status: row.status,
    fallbackApplied: row.fallback_applied,
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
  };
}

export async function createPracticeSession(input) {
  const sql = `
    insert into practice_sessions (
      user_id,
      grade,
      board,
      subject,
      paper,
      difficulty,
      topics,
      requested_count,
      generated_questions,
      fallback_applied,
      status
    )
    values ($1, $2, $3, $4, $5, $6, $7::text[], $8, $9::jsonb, $10, 'generated')
    returning *
  `;
  const params = [
    input.userId || null,
    input.selection.grade || null,
    input.selection.board,
    input.selection.subject,
    input.selection.paper,
    input.options.difficulty || null,
    input.options.topics || [],
    input.options.count,
    JSON.stringify(input.questions),
    Boolean(input.fallbackApplied),
  ];
  const result = await query(sql, params);
  return mapSession(result.rows[0]);
}

export async function getPracticeSessionById(sessionId) {
  const sql = `
    select *
    from practice_sessions
    where id = $1
    limit 1
  `;
  const result = await query(sql, [sessionId]);
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function submitPracticeSession(input) {
  const sql = `
    update practice_sessions
    set
      answers = $2::int[],
      result = $3::jsonb,
      wrong_log = $4::jsonb,
      status = 'submitted',
      submitted_at = now()
    where id = $1
    returning *
  `;
  const params = [
    input.sessionId,
    input.answers,
    JSON.stringify(input.result),
    JSON.stringify(input.wrongLog),
  ];
  const result = await query(sql, params);
  return result.rows[0] ? mapSession(result.rows[0]) : null;
}

export async function listPracticeSessionsByUserId(userId, limit = 20) {
  const sql = `
    select *
    from practice_sessions
    where user_id = $1
    order by created_at desc
    limit $2
  `;
  const result = await query(sql, [userId, limit]);
  return result.rows.map(mapSession);
}

export async function deletePracticeSessionsByUserId(userId) {
  const sql = `
    delete from practice_sessions
    where user_id = $1
  `;
  const result = await query(sql, [userId]);
  return Number(result.rowCount || 0);
}

export async function listRecentPracticeSessions(limit = 20) {
  const sql = `
    select
      p.id,
      p.user_id,
      u.display_name as user_display_name,
      u.email as user_email,
      p.grade,
      p.board,
      p.subject,
      p.paper,
      p.difficulty,
      p.topics,
      p.requested_count,
      p.status,
      p.created_at,
      p.submitted_at,
      (p.result ->> 'accuracy')::numeric as accuracy
    from practice_sessions p
    left join users u on u.id = p.user_id
    order by p.created_at desc
    limit $1
  `;
  const result = await query(sql, [limit]);
  return result.rows.map((row) => ({
    id: row.id,
    userId: row.user_id,
    userDisplayName: row.user_display_name,
    userEmail: row.user_email,
    grade: row.grade,
    board: row.board,
    subject: row.subject,
    paper: row.paper,
    difficulty: row.difficulty,
    topics: row.topics || [],
    requestedCount: row.requested_count,
    status: row.status,
    accuracy: row.accuracy == null ? null : Number(row.accuracy),
    createdAt: row.created_at,
    submittedAt: row.submitted_at,
  }));
}

export async function getPracticeSummaryCounts() {
  const sql = `
    select
      (select count(*)::int from users) as users_count,
      (select count(*)::int from practice_sessions) as practice_count,
      (select count(*)::int from practice_sessions where status = 'submitted') as submitted_count
  `;
  const result = await query(sql);
  const row = result.rows[0];
  return {
    usersCount: row.users_count,
    practiceCount: row.practice_count,
    submittedCount: row.submitted_count,
  };
}
