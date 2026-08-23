import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const database = "expassway-db";
const assetRoot = "assets/exam-question-images/cie-igcse-physics-0625";
const manifest = JSON.parse(await readFile(`${assetRoot}/manifest.json`, "utf8"));
const execute = process.argv.includes("--execute");

await mkdir(".d1-export", { recursive: true });

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  return `'${String(value).replaceAll("'", "''")}'`;
}

function jsonValue(value) {
  return sqlValue(JSON.stringify(value));
}

function questionId(paperSlug, questionNo) {
  return `CIE-IGCSE-0625-${paperSlug}-${String(questionNo).padStart(2, "0")}`;
}

function difficulty(questionNo) {
  if (questionNo <= 14) return "foundation";
  if (questionNo <= 28) return "standard";
  return "challenge";
}

function paperSql(paper, payload, publishedAt) {
  const rows = payload.rows.filter((row) => Number.isInteger(row.answer) && row.answer >= 0 && row.answer <= 3);
  if (rows.length !== paper.validQuestionCount) {
    throw new Error(`${paper.slug}: expected ${paper.validQuestionCount} valid questions, found ${rows.length}`);
  }

  const questions = rows.map((row) => {
    const number = Number(row.questionNo);
    const parsedOptions = row.options?.A && row.options?.B && row.options?.C && row.options?.D;
    const options = parsedOptions ? [row.options.A, row.options.B, row.options.C, row.options.D] : ["A", "B", "C", "D"];
    const imageUrl = `/${assetRoot}/papers/${paper.slug}/q${String(number).padStart(2, "0")}.png`;
    const source = {
      type: "static_physics_0625_import",
      questionPaper: paper.qpFileName,
      markScheme: paper.msFileName,
      questionNo: number,
      answerStatus: row.answerStatus || "valid",
    };
    return `
      INSERT INTO question_bank (
        id, board, subject, paper, difficulty, topic, year, stem, options,
        answer, mistake_type, template_id, skills, hints, images, source,
        subject_code, paper_slug, question_no, active
      ) VALUES (
        ${sqlValue(questionId(paper.slug, number))}, 'CIE', 'IGCSE Physics', 'MCQ',
        ${sqlValue(difficulty(number))}, ${sqlValue(`Past Paper ${paper.season.toUpperCase()}`)}, ${sqlValue(String(paper.year))},
        ${sqlValue(row.stem || row.rawText || `Question ${number}`)}, ${jsonValue(options)},
        ${Number(row.answer)}, 'unknown', ${sqlValue(`${paper.slug}-${number}`)},
        ${jsonValue(["physics-0625", "mcq", "past-paper"])}, '[]',
        ${jsonValue([{ url: imageUrl, position: "stem", order: 1 }])}, ${jsonValue(source)},
        '0625', ${sqlValue(paper.slug)}, ${number}, 1
      )
      ON CONFLICT (id) DO UPDATE SET
        board = excluded.board, subject = excluded.subject, paper = excluded.paper,
        difficulty = excluded.difficulty, topic = excluded.topic, year = excluded.year,
        stem = excluded.stem, options = excluded.options, answer = excluded.answer,
        template_id = excluded.template_id, skills = excluded.skills, images = excluded.images,
        source = excluded.source, subject_code = excluded.subject_code,
        paper_slug = excluded.paper_slug, question_no = excluded.question_no, active = 1;
    `;
  }).join("\n");

  const metadata = { contentStorage: "static-assets", assetRoot };
  return `
    UPDATE question_bank SET active = 0 WHERE paper_slug = ${sqlValue(paper.slug)};
    ${questions}
    INSERT INTO exam_papers (
      slug, subject_code, year, season, paper_number, variant, paper_type,
      duration_minutes, source_question_count, valid_question_count,
      discounted_questions, qp_file_name, ms_file_name, data_url,
      status, metadata, published_at
    ) VALUES (
      ${sqlValue(paper.slug)}, '0625', ${Number(paper.year)}, ${sqlValue(paper.season)},
      ${Number(paper.paperNumber)}, ${Number(paper.variant)}, 'MCQ', 45,
      ${Number(paper.sourceQuestionCount)}, ${Number(paper.validQuestionCount)},
      ${jsonValue(paper.discountedQuestions || [])}, ${sqlValue(paper.qpFileName)}, ${sqlValue(paper.msFileName)},
      ${sqlValue(`/${assetRoot}/data/${paper.slug}.json`)}, 'published', ${jsonValue(metadata)}, ${sqlValue(publishedAt)}
    )
    ON CONFLICT (slug) DO UPDATE SET
      subject_code = excluded.subject_code, year = excluded.year, season = excluded.season,
      paper_number = excluded.paper_number, variant = excluded.variant,
      source_question_count = excluded.source_question_count,
      valid_question_count = excluded.valid_question_count,
      discounted_questions = excluded.discounted_questions,
      qp_file_name = excluded.qp_file_name, ms_file_name = excluded.ms_file_name,
      data_url = excluded.data_url, status = 'published', metadata = excluded.metadata,
      published_at = excluded.published_at, updated_at = excluded.published_at;
  `;
}

const papers = manifest.papers.filter((paper) => paper.status === "validated");
if (!papers.length) throw new Error("No validated Physics papers found");

let questionCount = 0;
const publishedAt = new Date().toISOString();
for (const paper of papers) {
  const payload = JSON.parse(await readFile(`${assetRoot}/data/${paper.slug}.json`, "utf8"));
  const sql = paperSql(paper, payload, publishedAt);
  questionCount += Number(paper.validQuestionCount);
  const sqlFile = `.d1-export/${paper.slug}.sql`;
  await writeFile(sqlFile, sql, "utf8");
  if (execute) {
    await execFileAsync("npx", ["wrangler", "d1", "execute", database, "--remote", "--yes", "--file", sqlFile], {
      maxBuffer: 10 * 1024 * 1024,
    });
  }
}

console.log(`${execute ? "Published" : "Prepared"} ${papers.length} Physics papers and ${questionCount} questions.`);
console.log(execute ? "Static PNG and JSON assets remain served from Cloudflare Assets." : "Run again with --execute to write to production D1.");
