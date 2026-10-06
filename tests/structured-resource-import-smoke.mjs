import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { loadImportPlan, buildImportSql, applyImportPlan, wranglerInvocation } from "../tools/import-structured-resource-package.mjs";
import { stableStructuredQuestionId } from "../shared/structured-content.js";

const packageRoot = await mkdtemp(join(tmpdir(), "expassway-structured-import-"));
const manifestPath = join(packageRoot, "package.json");
const paperSlug = "9618_s26_qp_31";
const files = [
  { storageKey: "resources/9618/syllabus.pdf", localPath: "files/syllabus.pdf", contentType: "application/pdf" },
  { storageKey: "papers/9618_s26_qp_31/qp.pdf", localPath: "files/qp.pdf", contentType: "application/pdf" },
  { storageKey: "papers/9618_s26_qp_31/ms.pdf", localPath: "files/ms.pdf", contentType: "application/pdf" },
];
const bundle = {
  schemaVersion: 1,
  subjectCode: "9618",
  subjectName: "Computer Science",
  board: "CIE",
  files,
  resources: [{ id: "9618-syllabus-v1", kind: "syllabus", title: "9618 syllabus", version: "2026", storageKey: files[0].storageKey, examYearStart: null, examYearEnd: null, metadata: { directory: [] } }],
  papers: [{
    slug: paperSlug, paperNumber: 3, season: "s", variant: 1, paperType: "structured",
    durationMinutes: 90, totalMarks: 75, sourceQuestionCount: 10, validQuestionCount: 1,
    qpFileName: "qp.pdf", msFileName: "ms.pdf", qpStorageKey: files[1].storageKey, msStorageKey: files[2].storageKey,
  }],
  questions: [{
    id: stableStructuredQuestionId("9618", paperSlug, 1), paperSlug, questionNo: 1,
    questionType: "structured", maxMarks: 8, stem: "Trace the algorithm.",
    content: { blocks: [{ type: "code", text: "Total <- 0\nOUTPUT Total" }], parts: [{ id: "q1-a", label: "(a)", maxMarks: 8, prompt: [{ type: "text", text: "Give the output." }], children: [] }] },
    markScheme: { blocks: [{ type: "text", text: "Award up to 8 marks." }], parts: [{ partId: "q1-a", blocks: [{ type: "text", text: "Correct output." }] }] },
  }],
};

async function execute(db, sql) {
  for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
}

try {
  for (const file of files) {
    await (await import("node:fs/promises")).mkdir(join(packageRoot, "files"), { recursive: true });
    await writeFile(join(packageRoot, file.localPath), `${file.storageKey}\nfixture`);
  }
  await writeFile(manifestPath, JSON.stringify(bundle, null, 2));

  const plan = await loadImportPlan(manifestPath);
  assert.equal(plan.files.length, 3);
  assert(plan.files.every((file) => /^[a-f0-9]{64}$/.test(file.sha256)));
  assert.match(plan.sql, /answer = NULL/);
  assert.match(plan.sql, /question_type = 'structured'/);
  assert.doesNotMatch(plan.sql, /BEGIN TRANSACTION|COMMIT;/);
  assert.equal(unstable_splitSqlQuery(plan.sql).length,
    1 + bundle.papers.length + bundle.resources.length + bundle.questions.length,
    "Wrangler must split each UPSERT independently even when CASE ends before a comma.");
  const invocation = wranglerInvocation(["d1", "execute", "expassway-db", "--help"]);
  assert.equal(invocation.executable, process.execPath, "Wrangler must launch through Node, including on Windows");
  assert.match(invocation.args[0].replaceAll("\\", "/"), /node_modules\/wrangler\/bin\/wrangler\.js$/);

  const mf = new Miniflare({ compatibilityDate: "2026-07-29", d1Databases: { DB: "structured-import-test" }, modules: true, script: "export default { fetch() { return new Response('ok'); } };" });
  try {
    const db = await mf.getD1Database("DB");
    for (const migration of ["0001_initial.sql", "0002_supabase_auth.sql", "0003_admin_platform.sql", "0011_saved_papers.sql", "0019_9618_structured_content.sql"]) {
      await execute(db, await readFile(new URL(`../migrations/${migration}`, import.meta.url), "utf8"));
    }
    await execute(db, plan.sql);
    const first = await db.prepare("SELECT status, paper_number, year, total_marks, valid_question_count, source_question_count, metadata FROM exam_papers WHERE slug = ?").bind(paperSlug).first();
    assert.equal(first.status, "draft");
    assert.equal(first.paper_number, 3);
    assert.equal(first.total_marks, 75);
    assert.equal(first.year, 2026);
    assert.equal(first.source_question_count, 10);
    assert.equal(first.valid_question_count, 1);
    assert.equal(JSON.parse(first.metadata).qpStorageKey, files[1].storageKey);
    const question = await db.prepare("SELECT answer, active, year, question_type, max_marks, structured_content, mark_scheme FROM question_bank WHERE id = ?").bind(bundle.questions[0].id).first();
    assert.equal(question.answer, null);
    assert.equal(question.active, 0);
    assert.equal(question.year, "2026", "questions inherit the real year encoded by their source paper");
    assert.equal(question.question_type, "structured");
    assert.equal(question.max_marks, 8);
    assert.equal(JSON.parse(question.structured_content).parts[0].id, "q1-a");
    assert.equal(JSON.parse(question.mark_scheme).parts[0].partId, "q1-a");
    const resource = await db.prepare("SELECT exam_year_start, exam_year_end, content_type FROM subject_resources WHERE id = ?").bind(bundle.resources[0].id).first();
    assert.equal(resource.exam_year_start, null);
    assert.equal(resource.exam_year_end, null);
    assert.equal(resource.content_type, "application/pdf", "resources inherit their declared file MIME type");

    await execute(db, await readFile(new URL("../migrations/0020_structured_practice.sql", import.meta.url), "utf8"));
    await db.prepare("INSERT INTO users (id, display_name) VALUES (?, ?)").bind("archive-migration-user", "Migration fixture").run();
    await db.prepare(`INSERT INTO structured_practice_attempts
      (id, user_id, request_id, question_id, paper_slug, input_hash, question_fingerprint,
       language, answers, status, ai_called, result, model, response_id, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind("archive-migration-attempt", "archive-migration-user", "request-1", bundle.questions[0].id,
        paperSlug, "input-fixture", "question-fixture", "en", '{"q1-a":"0"}', "succeeded", 1,
        '{"marks":8}', "fixture-model", "response-1", "2026-10-05T00:00:00Z").run();
    const preserved = {};
    for (const table of ["exam_papers", "structured_practice_attempts", "exam_subject_components", "users", "question_bank", "subject_resources"]) {
      preserved[table] = (await db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()).results;
    }
    await execute(db, await readFile(new URL("../migrations/0028_as_a_level_subject_archives.sql", import.meta.url), "utf8"));
    for (const table of Object.keys(preserved)) {
      const current = (await db.prepare(`SELECT * FROM ${table} ORDER BY 1, 2`).all()).results;
      assert.deepEqual(current.filter((row) => table !== "exam_subject_components" || row.subject_code === "9618"),
        preserved[table], `${table}: expanding archive support preserves existing rows in full`);
    }
    assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
    const attemptForeignKeys = (await db.prepare("PRAGMA foreign_key_list(structured_practice_attempts)").all()).results;
    assert.equal(attemptForeignKeys.find((row) => row.from === "paper_slug").table, "exam_papers", "Practice attempts must reference the final live paper table.");
    assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '%_0028'").first()).n, 0);
    await assert.rejects(() => db.prepare("DELETE FROM exam_papers WHERE slug = ?").bind(paperSlug).run(), /FOREIGN KEY/,
      "Existing attempt records still prevent deletion of their source paper.");
    const archiveSubjects = (await db.prepare("SELECT code, qualification FROM exam_subjects WHERE code IN ('9702','9701','9708','9700','9696')").all()).results;
    assert.equal(archiveSubjects.length, 5);
    assert(archiveSubjects.every((subject) => subject.qualification === "AS & A Level"));
    const archiveComponents = (await db.prepare("SELECT * FROM exam_subject_components WHERE subject_code <> '9618'").all()).results;
    assert.equal(archiveComponents.length, 23);
    assert(archiveComponents.every((component) => Object.values(JSON.parse(component.capabilities)).every((value) => value === false)),
      "Original archives must not advertise question-bank tools before questions are imported.");
    assert.equal(archiveComponents.filter((component) => component.paper_number === 5).length, 3);

    const scienceArchive = {
      ...structuredClone(bundle), subjectCode: "9702", subjectName: "Physics", resources: [], questions: [],
      papers: [{ ...structuredClone(bundle.papers[0]), slug: "9702_s26_qp_54", paperNumber: 5,
        variant: 4, durationMinutes: 75, totalMarks: 30, sourceQuestionCount: 2, validQuestionCount: 0 }],
    };
    await execute(db, buildImportSql(scienceArchive, { publish: true }));
    const paperFive = await db.prepare("SELECT paper_number, year, paper_type, valid_question_count FROM exam_papers WHERE slug = '9702_s26_qp_54'").first();
    assert.deepEqual(paperFive, { paper_number: 5, year: 2026, paper_type: "structured", valid_question_count: 0 });
    const sciencePaperFour = structuredClone(scienceArchive);
    sciencePaperFour.papers[0].slug = "9702_s26_qp_44";
    sciencePaperFour.papers[0].paperNumber = 4;
    delete sciencePaperFour.papers[0].paperType;
    await execute(db, buildImportSql(sciencePaperFour));
    assert.equal((await db.prepare("SELECT paper_type FROM exam_papers WHERE slug = '9702_s26_qp_44'").first()).paper_type, "structured",
      "Paper 4 is not inherently practical outside Computer Science 9618.");
    const discountedArchive = structuredClone(scienceArchive);
    discountedArchive.subjectCode = "9708";
    discountedArchive.subjectName = "Economics";
    Object.assign(discountedArchive.papers[0], { slug: "9708_s25_qp_14", year: 2025, paperNumber: 1,
      paperType: "mcq", durationMinutes: 60, totalMarks: 30, sourceQuestionCount: 30,
      discountedQuestions: [2], metadata: { positiveMarkTotal: 29 } });
    await writeFile(manifestPath, JSON.stringify(discountedArchive));
    const discountedPlan = await loadImportPlan(manifestPath, { publish: true });
    await execute(db, discountedPlan.sql);
    const discountedRecord = await db.prepare(`SELECT source_question_count, valid_question_count, total_marks,
      discounted_questions, metadata FROM exam_papers WHERE slug = '9708_s25_qp_14'`).first();
    assert.equal(discountedRecord.source_question_count, 30);
    assert.equal(discountedRecord.valid_question_count, 0);
    assert.equal(discountedRecord.total_marks, 30);
    assert.deepEqual(JSON.parse(discountedRecord.discounted_questions), [2]);
    assert.equal(JSON.parse(discountedRecord.metadata).positiveMarkTotal, 29);
    discountedArchive.papers[0].discountedQuestions = [2, 3];
    await execute(db, buildImportSql(discountedArchive));
    assert.deepEqual(JSON.parse((await db.prepare("SELECT discounted_questions FROM exam_papers WHERE slug = '9708_s25_qp_14'").first()).discounted_questions), [2, 3],
      "A repeat import updates the reviewed discounted-question list.");
    await writeFile(manifestPath, JSON.stringify(bundle));

    const publishPlan = await loadImportPlan(manifestPath, { publish: true });
    await execute(db, buildImportSql(publishPlan.bundle, { publish: true, timestamp: "2026-10-04T00:00:00.000Z" }));
    assert.equal((await db.prepare("SELECT status FROM exam_papers WHERE slug = ?").bind(paperSlug).first()).status, "published");
    assert.equal((await db.prepare("SELECT active FROM question_bank WHERE id = ?").bind(bundle.questions[0].id).first()).active, 1);

    await execute(db, plan.sql);
    assert.equal((await db.prepare("SELECT status FROM exam_papers WHERE slug = ?").bind(paperSlug).first()).status, "published", "a draft re-import must not unpublish a live paper");
    assert.equal((await db.prepare("SELECT active FROM question_bank WHERE id = ?").bind(bundle.questions[0].id).first()).active, 1, "a draft re-import must not deactivate a live question");
    const largeOfficialQuestion = structuredClone(bundle);
    const longText = "Official criterion 'quoted' — 原文 🧪\n".repeat(1250);
    largeOfficialQuestion.questions[0].content.blocks.push({ type: "text", text: longText });
    largeOfficialQuestion.questions[0].markScheme.blocks.push({ type: "text", text: longText });
    const largeSql = buildImportSql(largeOfficialQuestion, { publish: true });
    const largeStatements = unstable_splitSqlQuery(largeSql);
    assert(largeStatements.length > unstable_splitSqlQuery(plan.sql).length, "Long QP and MS documents are written separately from the parent metadata.");
    assert(largeStatements.every((statement) => Buffer.byteLength(statement, "utf8") < 100000), "Complete long official content uses bounded D1 statements.");
    for (let index = 0; index < largeStatements.length; index += 100) await db.batch(largeStatements.slice(index, index + 100).map((statement) => db.prepare(statement)));
    const complete = await db.prepare("SELECT structured_content, mark_scheme, stem, active FROM question_bank WHERE id = ?").bind(bundle.questions[0].id).first();
    assert.deepEqual(JSON.parse(complete.structured_content), largeOfficialQuestion.questions[0].content);
    assert.deepEqual(JSON.parse(complete.mark_scheme), largeOfficialQuestion.questions[0].markScheme);
    assert.equal(complete.stem, bundle.questions[0].stem);
    assert.equal(complete.active, 1);
    largeOfficialQuestion.questions[0].content.blocks[1].text = longText.repeat(3);
    assert.throws(() => buildImportSql(largeOfficialQuestion), /complete document exceeds the D1 SQL limit/, "An oversized individual document is rejected without silently truncating official content.");
  } finally {
    await mf.dispose();
  }

  const defaultPathBundle = structuredClone(bundle);
  delete defaultPathBundle.papers[0].qpStorageKey;
  delete defaultPathBundle.papers[0].msStorageKey;
  defaultPathBundle.files[1].storageKey = `papers/${paperSlug}/qp.pdf`;
  defaultPathBundle.files[2].storageKey = `papers/${paperSlug}/ms.pdf`;
  await writeFile(manifestPath, JSON.stringify(defaultPathBundle));
  const defaultPathPlan = await loadImportPlan(manifestPath);
  assert.match(defaultPathPlan.sql, new RegExp(`qpStorageKey.*papers/${paperSlug}/qp\\.pdf`));
  assert.match(defaultPathPlan.sql, new RegExp(`msStorageKey.*papers/${paperSlug}/ms\\.pdf`));

  const appliedCommands = [];
  await applyImportPlan(plan, {
    target: "local", database: "expassway-db", bucket: "expassway-content",
    async run(args) {
      appliedCommands.push(args);
      if (args[0] === "d1") assert.equal(await readFile(args[args.indexOf("--file") + 1], "utf8"), plan.sql);
    },
  });
  assert.deepEqual(appliedCommands.map((args) => args[0]), ["r2", "r2", "r2", "d1"]);
  assert(appliedCommands.every((args) => args.includes("--local")));
  const interruptedCommands = [];
  await assert.rejects(() => applyImportPlan(plan, {
    target: "local", database: "expassway-db", bucket: "expassway-content",
    async run(args) { interruptedCommands.push(args); throw new Error("fixture upload failed"); },
  }), /fixture upload failed/);
  assert.deepEqual(interruptedCommands.map((args) => args[0]), ["r2"], "failed file upload must stop before database publication");

  const missingSourceCount = structuredClone(bundle);
  delete missingSourceCount.papers[0].sourceQuestionCount;
  await writeFile(manifestPath, JSON.stringify(missingSourceCount));
  await assert.rejects(() => loadImportPlan(manifestPath), /actual positive original question count/);

  const sourceOnly = structuredClone(bundle);
  sourceOnly.questions = [];
  delete sourceOnly.papers[0].validQuestionCount;
  await writeFile(manifestPath, JSON.stringify(sourceOnly));
  const sourceOnlyPlan = await loadImportPlan(manifestPath);
  assert.match(sourceOnlyPlan.sql, /'structured', 90, 10, 0, 75/);

  const badHash = structuredClone(bundle);
  badHash.files[0].sha256 = "0".repeat(64);
  await writeFile(manifestPath, JSON.stringify(badHash));
  await assert.rejects(() => loadImportPlan(manifestPath), /SHA-256 mismatch/);

  const missingPair = structuredClone(bundle);
  missingPair.files = missingPair.files.filter((file) => file.storageKey !== files[2].storageKey);
  await writeFile(manifestPath, JSON.stringify(missingPair));
  await assert.rejects(() => loadImportPlan(manifestPath), /msStorageKey: File is not declared in files/);
} finally {
  await rm(packageRoot, { recursive: true, force: true });
}

console.log("Structured resource importer checks passed.");
