import { query } from "../client.js";

function mapChapter(row) {
  return {
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
  };
}

function mapCoursebookSection(row) {
  return {
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
}

function toAccuracy(correct, total) {
  return total > 0 ? Number(((correct / total) * 100).toFixed(1)) : null;
}

export async function listCurriculumVersions(subjectCode) {
  const result = await query(`
    select *
    from curriculum_versions
    where subject_code = $1
    order by active desc, exam_year_start desc, version desc
  `, [subjectCode]);
  return result.rows.map((row) => ({
    id: row.id,
    subjectCode: row.subject_code,
    qualification: row.qualification,
    examYearStart: Number(row.exam_year_start),
    examYearEnd: Number(row.exam_year_end),
    version: row.version,
    active: Boolean(row.active),
  }));
}

export async function getCurriculumVersion(subjectCode, versionId = "") {
  const result = await query(`
    select *
    from curriculum_versions
    where subject_code = $1
      and ($2 = '' or id = $2)
      and ($2 <> '' or active = true)
    order by active desc
    limit 1
  `, [subjectCode, versionId]);
  return result.rows[0] || null;
}

export async function listChapterCatalog(subjectCode, versionId, userId) {
  const version = await getCurriculumVersion(subjectCode, versionId);
  if (!version) return null;

  const [chapterResult, sectionResult, mappingResult, poolResult, attemptResult, latestResult] = await Promise.all([
    query(`
      select distinct chapter.*
      from coursebook_chapters chapter
      join coursebook_sections book_section on book_section.coursebook_chapter_id = chapter.id
      join coursebook_section_mappings book_mapping on book_mapping.coursebook_section_id = book_section.id
      join curriculum_sections syllabus_section on syllabus_section.id = book_mapping.curriculum_section_id
      where syllabus_section.curriculum_version_id = $1
      order by chapter.sort_order
    `, [version.id]),
    query(`
      select distinct book_section.*
      from coursebook_sections book_section
      join coursebook_section_mappings book_mapping on book_mapping.coursebook_section_id = book_section.id
      join curriculum_sections syllabus_section on syllabus_section.id = book_mapping.curriculum_section_id
      where syllabus_section.curriculum_version_id = $1
      order by book_section.sort_order
    `, [version.id]),
    query(`
      select
        book_mapping.coursebook_section_id,
        syllabus_section.id,
        syllabus_section.syllabus_code,
        syllabus_section.title_en,
        syllabus_section.title_zh,
        syllabus_section.core_level
      from coursebook_section_mappings book_mapping
      join curriculum_sections syllabus_section on syllabus_section.id = book_mapping.curriculum_section_id
      where syllabus_section.curriculum_version_id = $1
      order by syllabus_section.sort_order
    `, [version.id]),
    query(`
      select
        mapping.coursebook_section_id,
        count(distinct coalesce(nullif(mapping.similar_question_group, ''), mapping.question_id))::int as available_questions
      from question_section_mappings mapping
      join curriculum_sections syllabus_section on syllabus_section.id = mapping.curriculum_section_id
      join question_bank question on question.id = mapping.question_id
      where mapping.status = 'reviewed'
        and mapping.is_primary = true
        and mapping.coursebook_section_id is not null
        and syllabus_section.curriculum_version_id = $1
        and question.active = true
        and question.subject_code = '0610'
        and question.year ~ '^\\d{4}$'
        and question.year::integer between 2019 and 2023
      group by mapping.coursebook_section_id
    `, [version.id]),
    query(`
      select
        coursebook_section_id,
        count(*) filter (where first_exposure)::int as first_attempts,
        count(*) filter (where first_exposure and correct)::int as first_correct,
        count(*) filter (where not first_exposure)::int as review_attempts,
        count(*) filter (where not first_exposure and correct)::int as review_correct,
        count(distinct coalesce(nullif(similar_question_group, ''), question_id))::int as seen_questions
      from question_attempts attempt
      join curriculum_sections syllabus_section on syllabus_section.id = attempt.curriculum_section_id
      where attempt.user_id = $1 and syllabus_section.curriculum_version_id = $2
      group by coursebook_section_id
    `, [userId, version.id]),
    query(`
      select coursebook_section_id, count(*) filter (where not correct)::int as needs_review
      from (
        select distinct on (coursebook_section_id, coalesce(nullif(similar_question_group, ''), question_id))
          coursebook_section_id,
          coalesce(nullif(similar_question_group, ''), question_id) as question_group,
          correct
        from question_attempts attempt
        join curriculum_sections syllabus_section on syllabus_section.id = attempt.curriculum_section_id
        where attempt.user_id = $1 and syllabus_section.curriculum_version_id = $2
        order by
          coursebook_section_id,
          coalesce(nullif(similar_question_group, ''), question_id),
          attempted_at desc
      ) latest
      group by coursebook_section_id
    `, [userId, version.id]),
  ]);

  const chapters = chapterResult.rows.map(mapChapter);
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const sectionById = new Map();

  sectionResult.rows.forEach((row) => {
    const section = mapCoursebookSection(row);
    sectionById.set(section.id, section);
    chapterById.get(row.coursebook_chapter_id)?.sections.push(section);
  });
  mappingResult.rows.forEach((row) => {
    sectionById.get(row.coursebook_section_id)?.syllabusStatements.push({
      id: row.id,
      syllabusCode: row.syllabus_code,
      titleEn: row.title_en,
      titleZh: row.title_zh,
      coreLevel: row.core_level,
    });
  });
  poolResult.rows.forEach((row) => {
    const section = sectionById.get(row.coursebook_section_id);
    if (section) section.progress.availableQuestions = Number(row.available_questions || 0);
  });
  attemptResult.rows.forEach((row) => {
    const section = sectionById.get(row.coursebook_section_id);
    if (!section) return;
    const firstAttempts = Number(row.first_attempts || 0);
    const firstCorrect = Number(row.first_correct || 0);
    const reviewAttempts = Number(row.review_attempts || 0);
    const reviewCorrect = Number(row.review_correct || 0);
    section.progress.firstAttempts = firstAttempts;
    section.progress.firstCorrect = firstCorrect;
    section.progress.firstAccuracy = toAccuracy(firstCorrect, firstAttempts);
    section.progress.reviewAttempts = reviewAttempts;
    section.progress.reviewCorrect = reviewCorrect;
    section.progress.reviewAccuracy = toAccuracy(reviewCorrect, reviewAttempts);
    section.progress.unseenQuestions = Math.max(
      0,
      section.progress.availableQuestions - Number(row.seen_questions || 0)
    );
  });
  latestResult.rows.forEach((row) => {
    const section = sectionById.get(row.coursebook_section_id);
    if (section) section.progress.needsReview = Number(row.needs_review || 0);
  });
  sectionById.forEach((section) => {
    if (section.progress.firstAttempts === 0) {
      section.progress.unseenQuestions = section.progress.availableQuestions;
    }
  });

  return {
    version: {
      id: version.id,
      subjectCode: version.subject_code,
      qualification: version.qualification,
      examYearStart: Number(version.exam_year_start),
      examYearEnd: Number(version.exam_year_end),
      version: version.version,
    },
    chapters,
  };
}

export async function getCoursebookSection(sectionId, versionId) {
  const result = await query(`
    select distinct
      book_section.*,
      chapter.chapter_no,
      chapter.title_en as chapter_title_en,
      chapter.title_zh as chapter_title_zh
    from coursebook_sections book_section
    join coursebook_chapters chapter on chapter.id = book_section.coursebook_chapter_id
    join coursebook_section_mappings book_mapping on book_mapping.coursebook_section_id = book_section.id
    join curriculum_sections syllabus_section on syllabus_section.id = book_mapping.curriculum_section_id
    where book_section.id = $1 and syllabus_section.curriculum_version_id = $2
    limit 1
  `, [sectionId, versionId]);
  return result.rows[0] || null;
}

export async function listCurriculumReviewOptions(versionId) {
  const [sections, bookSections] = await Promise.all([
    query(`
      select id, syllabus_code, title_en, title_zh, core_level
      from curriculum_sections
      where curriculum_version_id = $1 and level = 'statement'
      order by sort_order
    `, [versionId]),
    query(`
      select
        book_section.id,
        book_section.section_code,
        book_section.title_en,
        book_section.title_zh,
        chapter.chapter_no,
        chapter.title_en as chapter_title_en,
        chapter.title_zh as chapter_title_zh,
        array_agg(book_mapping.curriculum_section_id order by syllabus_section.sort_order) as curriculum_section_ids
      from coursebook_sections book_section
      join coursebook_chapters chapter on chapter.id = book_section.coursebook_chapter_id
      join coursebook_section_mappings book_mapping on book_mapping.coursebook_section_id = book_section.id
      join curriculum_sections syllabus_section on syllabus_section.id = book_mapping.curriculum_section_id
      where syllabus_section.curriculum_version_id = $1
      group by book_section.id, chapter.chapter_no, chapter.title_en, chapter.title_zh
      order by book_section.sort_order
    `, [versionId]),
  ]);
  return {
    curriculumSections: sections.rows.map((row) => ({
      id: row.id,
      syllabusCode: row.syllabus_code,
      titleEn: row.title_en,
      titleZh: row.title_zh,
      coreLevel: row.core_level,
    })),
    coursebookSections: bookSections.rows.map((row) => ({
      id: row.id,
      chapterNo: Number(row.chapter_no),
      chapterTitleEn: row.chapter_title_en,
      chapterTitleZh: row.chapter_title_zh,
      sectionCode: row.section_code,
      titleEn: row.title_en,
      titleZh: row.title_zh,
      curriculumSectionIds: row.curriculum_section_ids || [],
    })),
  };
}
