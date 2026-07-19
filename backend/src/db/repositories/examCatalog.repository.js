import { query } from "../client.js";

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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
    discountedQuestions: row.discounted_questions || [],
    qpFileName: row.qp_file_name,
    msFileName: row.ms_file_name,
    dataUrl: row.data_url || "",
    status: row.status,
    metadata: row.metadata || {},
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const PAPER_SELECT = `
  select
    p.*,
    s.name as subject_name,
    s.name_zh as subject_name_zh,
    s.asset_key,
    s.board,
    s.qualification
  from exam_papers p
  join exam_subjects s on s.code = p.subject_code
`;

export async function listPublishedSubjects() {
  const result = await query(`
    select
      s.*,
      count(distinct p.slug)::int as paper_count,
      coalesce(sum(p.valid_question_count), 0)::int as question_count
    from exam_subjects s
    join exam_papers p on p.subject_code = s.code and p.status = 'published'
    where s.active = true
    group by s.code
    order by s.qualification, s.name
  `);
  return result.rows.map(mapSubject);
}

export async function listAllSubjects() {
  const result = await query(`
    select
      s.*,
      count(distinct p.slug)::int as paper_count,
      coalesce(sum(p.valid_question_count) filter (where p.status = 'published'), 0)::int as question_count
    from exam_subjects s
    left join exam_papers p on p.subject_code = s.code
    group by s.code
    order by s.qualification, s.name
  `);
  return result.rows.map(mapSubject);
}

export async function getSubjectByCode(code) {
  const result = await query("select * from exam_subjects where code = $1 limit 1", [code]);
  return result.rows[0] ? mapSubject(result.rows[0]) : null;
}

export async function upsertSubject(input) {
  const result = await query(`
    insert into exam_subjects (
      code, board, qualification, name, name_zh, asset_key, active
    ) values ($1, $2, $3, $4, $5, $6, $7)
    on conflict (code) do update set
      board = excluded.board,
      qualification = excluded.qualification,
      name = excluded.name,
      name_zh = excluded.name_zh,
      asset_key = excluded.asset_key,
      active = excluded.active,
      updated_at = now()
    returning *
  `, [
    input.code,
    input.board,
    input.qualification,
    input.name,
    input.nameZh || null,
    input.assetKey,
    input.active !== false,
  ]);
  return mapSubject(result.rows[0]);
}

export async function listPublishedPapers(subjectCode) {
  const result = await query(`
    ${PAPER_SELECT}
    where p.subject_code = $1 and p.status = 'published'
    order by p.year, array_position(array['m','s','w'], p.season), p.paper_number, p.variant
  `, [subjectCode]);
  return result.rows.map(mapPaper);
}

export async function getPublishedPaper(slug) {
  const result = await query(`
    ${PAPER_SELECT}
    where p.slug = $1 and p.status = 'published'
    limit 1
  `, [slug]);
  return result.rows[0] ? mapPaper(result.rows[0]) : null;
}

export async function listPaperSlugsByFilter(input) {
  const params = [];
  const filters = ["p.status = 'published'"];
  const add = (sql, value) => {
    if (value == null || value === "") return;
    params.push(value);
    filters.push(`${sql} $${params.length}`);
  };
  add("p.subject_code =", input.subjectCode);
  add("p.year =", input.year ? Number(input.year) : null);
  add("p.season =", input.season);
  add("p.paper_number =", input.paperNumber ? Number(input.paperNumber) : null);
  add("p.variant =", input.variant ? Number(input.variant) : null);
  const result = await query(`
    select p.slug from exam_papers p
    where ${filters.join(" and ")}
    order by p.slug
  `, params);
  return result.rows.map((row) => row.slug);
}
