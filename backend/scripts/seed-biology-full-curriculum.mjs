import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const { Pool } = pg;
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const dataDirectory = path.resolve(scriptDirectory, "../db/data");
const syllabus = JSON.parse(fs.readFileSync(
  path.join(dataDirectory, "biology-0610-syllabus-2026-2028.json"),
  "utf8"
));
const coursebook = JSON.parse(fs.readFileSync(
  path.join(dataDirectory, "biology-coursebook-4e.json"),
  "utf8"
));

const VERSION_ID = "0610-2026-2028-v2";

function sectionId(code) {
  return `0610-2026-${code}`;
}

function statementSortOrder(code) {
  const [topic, section, statement] = code.split(".").map(Number);
  return topic * 10000 + section * 100 + statement;
}

function bookSectionId(code) {
  return `bio-igcse-4e-${code}`;
}

async function upsertCurriculum(client) {
  await client.query(`
    update curriculum_versions
    set active = false, updated_at = now()
    where subject_code = '0610' and id <> $1
  `, [VERSION_ID]);
  await client.query(`
    insert into curriculum_versions (
      id, subject_code, qualification, exam_year_start, exam_year_end, version, active
    ) values ($1, '0610', 'Cambridge IGCSE Biology', 2026, 2028, 'v2', true)
    on conflict (id) do update set
      qualification = excluded.qualification,
      exam_year_start = excluded.exam_year_start,
      exam_year_end = excluded.exam_year_end,
      version = excluded.version,
      active = excluded.active,
      updated_at = now()
  `, [VERSION_ID]);

  for (const topic of syllabus.topics) {
    await client.query(`
      insert into curriculum_sections (
        id, curriculum_version_id, syllabus_code, title_en, level,
        parent_id, core_level, sort_order
      ) values ($1, $2, $3, $4, 'topic', null, null, $5)
      on conflict (id) do update set
        title_en = excluded.title_en,
        level = excluded.level,
        parent_id = excluded.parent_id,
        core_level = excluded.core_level,
        sort_order = excluded.sort_order,
        updated_at = now()
    `, [sectionId(topic.code), VERSION_ID, topic.code, topic.title, Number(topic.code) * 10000]);
  }

  for (const section of syllabus.sections) {
    const [topicNumber, sectionNumber] = section.code.split(".").map(Number);
    await client.query(`
      insert into curriculum_sections (
        id, curriculum_version_id, syllabus_code, title_en, level,
        parent_id, core_level, sort_order
      ) values ($1, $2, $3, $4, 'section', $5, null, $6)
      on conflict (id) do update set
        title_en = excluded.title_en,
        level = excluded.level,
        parent_id = excluded.parent_id,
        core_level = excluded.core_level,
        sort_order = excluded.sort_order,
        updated_at = now()
    `, [
      sectionId(section.code),
      VERSION_ID,
      section.code,
      section.title,
      sectionId(String(topicNumber)),
      topicNumber * 10000 + sectionNumber * 100,
    ]);
  }

  for (const statement of syllabus.statements) {
    await client.query(`
      insert into curriculum_sections (
        id, curriculum_version_id, syllabus_code, title_en, level,
        parent_id, core_level, sort_order
      ) values ($1, $2, $3, $4, 'statement', $5, $6, $7)
      on conflict (id) do update set
        title_en = excluded.title_en,
        level = excluded.level,
        parent_id = excluded.parent_id,
        core_level = excluded.core_level,
        sort_order = excluded.sort_order,
        updated_at = now()
    `, [
      sectionId(statement.code),
      VERSION_ID,
      statement.code,
      statement.title,
      sectionId(statement.sectionCode),
      statement.level,
      statementSortOrder(statement.code),
    ]);
  }
}

async function upsertCoursebook(client) {
  const statementByCode = new Map(syllabus.statements.map((statement) => [statement.code, statement]));
  const statementCodesBySection = new Map();
  for (const statement of syllabus.statements) {
    const codes = statementCodesBySection.get(statement.sectionCode) || [];
    codes.push(statement.code);
    statementCodesBySection.set(statement.sectionCode, codes);
  }

  await client.query(`
    delete from coursebook_section_mappings mapping
    using coursebook_sections book_section, coursebook_chapters chapter
    where mapping.coursebook_section_id = book_section.id
      and book_section.coursebook_chapter_id = chapter.id
      and chapter.book_key = $1
  `, [coursebook.bookKey]);

  for (const chapter of coursebook.chapters) {
    const chapterId = `bio-igcse-4e-ch${chapter.chapterNo}`;
    await client.query(`
      insert into coursebook_chapters (
        id, book_key, chapter_no, title_en, title_zh, sort_order
      ) values ($1, $2, $3, $4, $5, $3)
      on conflict (id) do update set
        title_en = excluded.title_en,
        title_zh = excluded.title_zh,
        sort_order = excluded.sort_order,
        updated_at = now()
    `, [chapterId, coursebook.bookKey, chapter.chapterNo, chapter.titleEn, chapter.titleZh]);

    for (const [code, titleEn, titleZh, syllabusReferences] of chapter.sections) {
      const coursebookSectionId = bookSectionId(code);
      const sectionNumber = Number(code.split(".")[1]);
      await client.query(`
        insert into coursebook_sections (
          id, coursebook_chapter_id, section_code, title_en, title_zh, sort_order
        ) values ($1, $2, $3, $4, $5, $6)
        on conflict (id) do update set
          coursebook_chapter_id = excluded.coursebook_chapter_id,
          section_code = excluded.section_code,
          title_en = excluded.title_en,
          title_zh = excluded.title_zh,
          sort_order = excluded.sort_order,
          updated_at = now()
      `, [
        coursebookSectionId,
        chapterId,
        code,
        titleEn,
        titleZh,
        chapter.chapterNo * 100 + sectionNumber,
      ]);

      const statementCodes = new Set();
      for (const reference of syllabusReferences) {
        if (statementByCode.has(reference)) {
          statementCodes.add(reference);
          continue;
        }
        const sectionCodes = statementCodesBySection.get(reference);
        if (!sectionCodes) throw new Error(`Unknown syllabus reference ${reference} for ${code}.`);
        sectionCodes.forEach((statementCode) => statementCodes.add(statementCode));
      }
      for (const statementCode of statementCodes) {
        await client.query(`
          insert into coursebook_section_mappings (
            coursebook_section_id, curriculum_section_id
          ) values ($1, $2)
          on conflict do nothing
        `, [coursebookSectionId, sectionId(statementCode)]);
      }
    }
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
  });
  const client = await pool.connect();
  try {
    await client.query("begin");
    await upsertCurriculum(client);
    await upsertCoursebook(client);
    const result = await client.query(`
      select
        (select count(*)::int from curriculum_sections where curriculum_version_id = $1 and level = 'topic') as syllabus_topics,
        (select count(*)::int from curriculum_sections where curriculum_version_id = $1 and level = 'section') as syllabus_sections,
        (select count(*)::int from curriculum_sections where curriculum_version_id = $1 and level = 'statement') as syllabus_statements,
        (select count(*)::int from coursebook_chapters where book_key = $2) as coursebook_chapters,
        (select count(*)::int from coursebook_sections book_section join coursebook_chapters chapter on chapter.id = book_section.coursebook_chapter_id where chapter.book_key = $2) as coursebook_sections
    `, [VERSION_ID, coursebook.bookKey]);
    const counts = result.rows[0];
    const expected = {
      syllabus_topics: 21,
      syllabus_sections: 61,
      syllabus_statements: 389,
      coursebook_chapters: 20,
      coursebook_sections: 58,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (Number(counts[key]) !== value) {
        throw new Error(`Expected ${key}=${value}, found ${counts[key]}.`);
      }
    }
    if (process.env.BIOLOGY_CURRICULUM_DRY_RUN === "true") {
      await client.query("rollback");
    } else {
      await client.query("commit");
    }
    console.log(JSON.stringify({ ...counts, dryRun: process.env.BIOLOGY_CURRICULUM_DRY_RUN === "true" }));
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
