import { query } from "../client.js";

const INSERT_BATCH_SIZE = 200;

function mapRow(row) {
  return {
    id: row.id,
    board: row.board,
    subject: row.subject,
    paper: row.paper,
    difficulty: row.difficulty,
    topic: row.topic,
    year: row.year,
    stem: row.stem,
    options: row.options || [],
    answer: row.answer,
    mistakeType: row.mistake_type || "unknown",
    templateId: row.template_id,
    skills: row.skills || [],
    hints: row.hints || [],
    images: row.images || [],
    source: row.source || null,
    subjectCode: row.subject_code || "",
    paperSlug: row.paper_slug || "",
    questionNo: row.question_no == null ? null : Number(row.question_no),
    active: row.active !== false,
  };
}

export async function getQuestionBankById(questionId) {
  const result = await query(`
    select * from question_bank where id = $1 limit 1
  `, [questionId]);
  return result.rows[0] ? mapRow(result.rows[0]) : null;
}

export async function listQuestionBankByPaperSlug(paperSlug) {
  const result = await query(`
    select * from question_bank
    where active = true and paper_slug = $1
    order by question_no
  `, [paperSlug]);
  return result.rows.map(mapRow);
}

export async function replaceQuestionBank(rows) {
  await query("begin");
  try {
    await query("truncate table question_bank");

    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
      const values = [];
      const params = [];

      batch.forEach((row, rowIndex) => {
        const offset = rowIndex * 16;
        values.push(`(
          $${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4},
          $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8},
          $${offset + 9}::jsonb, $${offset + 10}, $${offset + 11}, $${offset + 12},
          $${offset + 13}::jsonb, $${offset + 14}::jsonb, $${offset + 15}::jsonb, $${offset + 16}::jsonb
        )`);
        params.push(
          row.id,
          row.board,
          row.subject,
          row.paper,
          row.difficulty || null,
          row.topic || null,
          row.year || null,
          row.stem,
          JSON.stringify(row.options || []),
          Number.isInteger(row.answer) ? row.answer : 0,
          row.mistakeType || "unknown",
          row.templateId || row.id,
          JSON.stringify(row.skills || []),
          JSON.stringify(row.hints || []),
          JSON.stringify(row.images || []),
          JSON.stringify(row.source || null)
        );
      });

      const sql = `
        insert into question_bank (
          id, board, subject, paper, difficulty, topic, year,
          stem, options, answer, mistake_type, template_id, skills, hints, images, source
        ) values
        ${values.join(",")}
      `;

      // eslint-disable-next-line no-await-in-loop
      await query(sql, params);
    }
    await query("commit");
  } catch (err) {
    await query("rollback");
    throw err;
  }
}

export async function listQuestionBankBySelection(selection) {
  const sql = `
    select *
    from question_bank
    where active = true and board = $1 and subject = $2 and paper = $3
  `;
  const res = await query(sql, [selection.board, selection.subject, selection.paper]);
  return res.rows.map(mapRow);
}

export async function listQuestionBankByBoardSubject(selection) {
  const sql = `
    select *
    from question_bank
    where active = true and board = $1 and subject = $2
  `;
  const res = await query(sql, [selection.board, selection.subject]);
  return res.rows.map(mapRow);
}

export async function countQuestionBankRows() {
  const res = await query("select count(*)::int as c from question_bank");
  return res.rows[0]?.c || 0;
}
