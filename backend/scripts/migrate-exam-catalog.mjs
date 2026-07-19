import { isDbEnabled, query } from "../src/db/client.js";

function normalizePaperSlug(fileName) {
  const match = String(fileName || "").match(/^(\d{4})_([msw])(\d{2})_qp_(\d+)/i);
  if (!match) return "";
  let component = match[4];
  if (match[1] === "0620" && component.length === 3 && component.endsWith("1")) {
    component = component.slice(0, 2);
  }
  return `${match[1]}_${match[2].toLowerCase()}${match[3]}_qp_${component.slice(0, 2)}`;
}

function parsePaperSlug(slug) {
  const match = slug.match(/^(\d{4})_([msw])(\d{2})_qp_(\d)(\d)$/i);
  if (!match) throw new Error(`Invalid paper slug: ${slug}`);
  return {
    subjectCode: match[1],
    season: match[2].toLowerCase(),
    year: 2000 + Number(match[3]),
    paperNumber: Number(match[4]),
    variant: Number(match[5]),
  };
}

async function main() {
  if (!isDbEnabled()) throw new Error("DB disabled: set DATABASE_URL first");

  await query(`
    insert into exam_subjects (code, board, qualification, name, name_zh, asset_key)
    values
      ('0620', 'CIE', 'IGCSE', 'Chemistry', '化学', 'chemistry-0620'),
      ('0654', 'CIE', 'IGCSE', 'Co-ordinated Sciences', '协调科学', 'coordinated-sciences-0654')
    on conflict (code) do nothing
  `);

  const sourceRows = await query(`
    select distinct subject, source ->> 'fileName' as file_name
    from question_bank
    where source ->> 'fileName' is not null
      and subject in ('IGCSE Chemistry', 'IGCSE Co-ordinated Sciences')
    order by file_name
  `);

  for (const row of sourceRows.rows) {
    const slug = normalizePaperSlug(row.file_name);
    if (!slug) continue;
    const meta = parsePaperSlug(slug);
    const counts = await query(`
      select count(*)::int as valid_count
      from question_bank
      where source ->> 'fileName' = $1
        and active = true
    `, [row.file_name]);
    const validCount = counts.rows[0]?.valid_count || 0;
    const discounted = validCount === 39 && slug === "0654_s23_qp_22" ? [17] : [];
    const legacyDataSlug = String(row.file_name).replace(/\.pdf$/i, "");
    const dataUrl = meta.subjectCode === "0654"
      ? `/assets/exam-question-images/cie-igcse-coordinated-sciences-0654/data/${slug}.json`
      : `/backend/src/data/pymupdf-batch/${legacyDataSlug}.structured.json`;

    await query(`
      insert into exam_papers (
        slug, subject_code, year, season, paper_number, variant, paper_type,
        duration_minutes, source_question_count, valid_question_count,
        discounted_questions, qp_file_name, ms_file_name, data_url, status,
        metadata, published_at
      ) values (
        $1,$2,$3,$4,$5,$6,'MCQ',45,40,$7,$8,$9,$10,$11,'published',$12::jsonb,now()
      )
      on conflict (slug) do nothing
    `, [
      slug,
      meta.subjectCode,
      meta.year,
      meta.season,
      meta.paperNumber,
      meta.variant,
      validCount,
      discounted,
      `${slug}.pdf`,
      `${slug.replace("_qp_", "_ms_")}.pdf`,
      dataUrl,
      JSON.stringify({ legacySourceFile: row.file_name, legacyDataSlug }),
    ]);
  }

  await query(`
    update question_bank q
    set
      subject_code = case
        when q.subject = 'IGCSE Chemistry' then '0620'
        when q.subject = 'IGCSE Co-ordinated Sciences' then '0654'
        else q.subject_code
      end,
      paper_slug = case
        when q.source ->> 'fileName' ~ '^0620_[msw][0-9]{2}_qp_(21|22|23)1\\.pdf$'
          then regexp_replace(q.source ->> 'fileName', '1\\.pdf$', '')
        else regexp_replace(q.source ->> 'fileName', '\\.pdf$', '')
      end,
      question_no = (q.source ->> 'questionNo')::int
    where q.subject in ('IGCSE Chemistry', 'IGCSE Co-ordinated Sciences')
      and q.source ->> 'fileName' is not null
      and q.source ->> 'questionNo' ~ '^[0-9]+$'
  `);

  await query(`
    update discussion_threads t
    set
      subject_code = q.subject_code,
      paper_slug = q.paper_slug,
      question_no = q.question_no
    from question_bank q
    where t.question_key = q.id
      and (t.paper_slug is null or t.question_no is null)
  `);

  await query(`
    update discussion_threads
    set subject_code = case
      when subject = 'IGCSE Chemistry' then '0620'
      when subject = 'IGCSE Co-ordinated Sciences' then '0654'
      else subject_code
    end
    where subject_code is null
      and subject in ('IGCSE Chemistry', 'IGCSE Co-ordinated Sciences')
  `);

  const summary = await query(`
    select
      (select count(*) from exam_subjects) as subjects,
      (select count(*) from exam_papers where status = 'published') as papers,
      (select count(*) from question_bank where active = true and paper_slug is not null) as questions
  `);
  console.log(summary.rows[0]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
