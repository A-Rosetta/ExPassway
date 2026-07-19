import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDbEnabled, query } from "../src/db/client.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(
  SCRIPT_DIR,
  "../../assets/exam-question-images/cie-igcse-coordinated-sciences-0654/data"
);

function paperMeta(slug) {
  const match = slug.match(/^0654_([msw])(\d{2})_qp_(2[123])$/i);
  if (!match) throw new Error(`Unexpected paper slug: ${slug}`);
  const seasonCode = match[1].toLowerCase();
  const seasonNames = { m: "March", s: "Summer", w: "Winter" };
  return {
    year: `20${match[2]}`,
    topic: `Past Paper ${seasonNames[seasonCode]}`,
  };
}

async function loadRows() {
  const files = (await fs.readdir(DATA_DIR)).filter((file) => file.endsWith(".json")).sort();
  const rows = [];
  for (const file of files) {
    const slug = file.replace(/\.json$/i, "");
    const meta = paperMeta(slug);
    const payload = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8"));
    for (const item of payload.rows || []) {
      if (!Number.isInteger(item.answer)) continue;
      const questionNo = Number(item.questionNo);
      const parsedOptions = item.options?.A && item.options?.B && item.options?.C && item.options?.D;
      rows.push({
        id: `CIE-IGCOORD-SET-${slug}-${String(questionNo).padStart(2, "0")}`,
        board: "CIE",
        subject: "IGCSE Co-ordinated Sciences",
        paper: "MCQ",
        difficulty: questionNo <= 14 ? "基础" : questionNo <= 28 ? "中等" : "冲刺",
        topic: meta.topic,
        year: meta.year,
        stem: item.stem || item.rawText || `Question ${questionNo}`,
        options: parsedOptions
          ? [item.options.A, item.options.B, item.options.C, item.options.D]
          : ["A", "B", "C", "D"],
        answer: item.answer,
        mistakeType: "unknown",
        templateId: `${slug}-${questionNo}`,
        skills: ["coordinated-sciences", "mcq", "past-paper"],
        hints: [],
        images: [{ url: item.imageUrl, position: "stem", order: 1 }],
        source: {
          type: "pymupdf_structured_import",
          fileName: payload.questionPaper ? path.basename(payload.questionPaper) : `${slug}.pdf`,
          markScheme: payload.markScheme ? path.basename(payload.markScheme) : "",
          questionNo,
          answerStatus: item.answerStatus || "valid",
        },
      });
    }
  }
  return rows;
}

async function main() {
  if (!isDbEnabled()) throw new Error("DB disabled: set DATABASE_URL first");
  const rows = await loadRows();
  if (rows.length !== 839) {
    throw new Error(`Expected 839 valid questions, found ${rows.length}`);
  }

  const sql = `
    insert into question_bank (
      id, board, subject, paper, difficulty, topic, year, stem, options, answer,
      mistake_type, template_id, skills, hints, images, source
    )
    select
      x.id, x.board, x.subject, x.paper, x.difficulty, x.topic, x.year, x.stem,
      x.options, x.answer, x.mistake_type, x.template_id, x.skills, x.hints,
      x.images, x.source
    from jsonb_to_recordset($1::jsonb) as x(
      id text, board text, subject text, paper text, difficulty text, topic text,
      year text, stem text, options jsonb, answer integer, mistake_type text,
      template_id text, skills jsonb, hints jsonb, images jsonb, source jsonb
    )
    on conflict (id) do update set
      board = excluded.board,
      subject = excluded.subject,
      paper = excluded.paper,
      difficulty = excluded.difficulty,
      topic = excluded.topic,
      year = excluded.year,
      stem = excluded.stem,
      options = excluded.options,
      answer = excluded.answer,
      mistake_type = excluded.mistake_type,
      template_id = excluded.template_id,
      skills = excluded.skills,
      hints = excluded.hints,
      images = excluded.images,
      source = excluded.source
  `;

  const dbRows = rows.map((row) => ({
    ...row,
    mistake_type: row.mistakeType,
    template_id: row.templateId,
  }));
  await query("begin");
  try {
    await query(sql, [JSON.stringify(dbRows)]);
    await query("commit");
  } catch (error) {
    await query("rollback");
    throw error;
  }
  console.log(`Imported ${rows.length} Co-ordinated Sciences questions without replacing existing subjects.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
