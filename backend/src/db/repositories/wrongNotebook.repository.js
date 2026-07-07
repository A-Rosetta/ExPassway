import { query } from "../client.js";

function mapEntry(row) {
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
    answer: row.answer,
    answerText: row.answer_text,
    lastSelected: row.last_selected,
    lastSelectedText: row.last_selected_text,
    wrongCount: row.wrong_count,
    firstWrongAt: row.first_wrong_at,
    lastWrongAt: row.last_wrong_at,
    mastered: Boolean(row.mastered),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function buildOptionText(question, optionIndex) {
  return Number.isInteger(optionIndex) && optionIndex >= 0
    ? `${String.fromCharCode(65 + optionIndex)}. ${question?.options?.[optionIndex] || ""}`
    : "Unanswered";
}

export async function upsertWrongNotebookEntries(userId, questions, details, selection) {
  if (!userId || !Array.isArray(questions) || !Array.isArray(details)) {
    return [];
  }

  const sql = `
    insert into wrong_notebook_entries (
      user_id,
      question_key,
      board,
      subject,
      paper,
      topic,
      year,
      stem,
      answer,
      answer_text,
      last_selected,
      last_selected_text,
      wrong_count,
      first_wrong_at,
      last_wrong_at,
      mastered,
      updated_at
    )
    values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 1, now(), now(), false, now()
    )
    on conflict (user_id, question_key)
    do update set
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
      last_wrong_at = now(),
      updated_at = now()
    returning *
  `;

  const saved = [];
  for (let idx = 0; idx < details.length; idx += 1) {
    const detail = details[idx];
    if (detail?.correct) continue;

    const question = questions[idx] || {};
    const questionKey = question.id || `${selection?.subject || "unknown"}-${idx + 1}`;
    const params = [
      userId,
      questionKey,
      question.board || selection?.board || null,
      question.subject || selection?.subject || null,
      question.paper || selection?.paper || null,
      question.topic || null,
      question.year || null,
      question.stem || null,
      Number.isInteger(detail.answer) ? detail.answer : null,
      buildOptionText(question, detail.answer),
      Number.isInteger(detail.selectedIndex) ? detail.selectedIndex : -1,
      buildOptionText(question, detail.selectedIndex),
    ];
    const result = await query(sql, params);
    if (result.rows[0]) {
      saved.push(mapEntry(result.rows[0]));
    }
  }

  return saved;
}

export async function listWrongNotebookEntriesByUserId(userId) {
  const sql = `
    select *
    from wrong_notebook_entries
    where user_id = $1
    order by last_wrong_at desc
  `;
  const result = await query(sql, [userId]);
  return result.rows.map(mapEntry);
}

export async function updateWrongNotebookEntryMastered(userId, entryId, mastered) {
  const sql = `
    update wrong_notebook_entries
    set
      mastered = $3,
      updated_at = now()
    where user_id = $1 and id = $2
    returning *
  `;
  const result = await query(sql, [userId, entryId, Boolean(mastered)]);
  return result.rows[0] ? mapEntry(result.rows[0]) : null;
}

export async function deleteWrongNotebookEntriesByUserId(userId) {
  const sql = `
    delete from wrong_notebook_entries
    where user_id = $1
  `;
  const result = await query(sql, [userId]);
  return Number(result.rowCount || 0);
}
