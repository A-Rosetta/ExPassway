import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Miniflare } from "miniflare";
import { unstable_splitSqlQuery } from "wrangler";
import { handleReadApiRequest } from "../cloudflare/read-api.js";
import { handleContentRequest, handleQuestionHintRequest } from "../cloudflare/content-api.js";
import { handleAdminApiRequest } from "../cloudflare/admin-api.js";
import worker from "../cloudflare/worker.js";

const AUTH_SECRET = "test-only-auth-secret-with-at-least-32-bytes";
async function token(userId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({ sub: userId, iat: now, exp: now + 3600 })).toString("base64url");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `${payload}.${Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))).toString("base64url")}`;
}
const mf = new Miniflare({
  compatibilityDate: "2026-07-29", d1Databases: { DB: "9618-test" },
  r2Buckets: { CONTENT_BUCKET: "9618-content-test" }, modules: true,
  script: "export default { fetch() { return new Response('ok'); } };",
});
try {
  const db = await mf.getD1Database("DB");
  const bucket = await mf.getR2Bucket("CONTENT_BUCKET");
  const migrate = async (file) => {
    const sql = await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8");
    for (const statement of unstable_splitSqlQuery(sql)) await db.prepare(statement).run();
  };
  for (const file of ["0001_initial.sql", "0002_supabase_auth.sql", "0003_admin_platform.sql", "0011_saved_papers.sql"]) await migrate(file);
  // Existing children must survive the migration, including their FK targets.
  await db.batch([
    db.prepare("INSERT INTO users (id,display_name,role) VALUES ('admin','Admin','admin')"),
    db.prepare("INSERT INTO exam_subjects(code,name,asset_key) VALUES ('0610','Biology','biology-0610')"),
    db.prepare("INSERT INTO question_bank(id,board,subject,paper,stem) VALUES ('mcq','CIE','IGCSE Biology','MCQ','Fixture')"),
    db.prepare("INSERT INTO question_hint_sets(id,question_id,language,prompt_version,question_fingerprint,hints,model) VALUES ('hint','mcq','en','v1','f','[]','fixture')"),
    db.prepare("INSERT INTO saved_papers(id,user_id,paper_code,title,subject_code,build_mode) VALUES ('saved','admin','CODE','Fixture','0610','manual')"),
    db.prepare("INSERT INTO saved_paper_items(paper_id,question_id,position) VALUES ('saved','mcq',0)"),
    db.prepare("INSERT INTO curriculum_versions(id,subject_code,qualification,exam_year_start,exam_year_end,version) VALUES ('curriculum','0610','IGCSE',2026,2028,'fixture')"),
    db.prepare("INSERT INTO curriculum_sections(id,curriculum_version_id,syllabus_code,title_en,level,sort_order) VALUES ('syllabus-section','curriculum','1','Fixture','section',1)"),
    db.prepare("INSERT INTO coursebook_chapters(id,book_key,chapter_no,title_en,sort_order) VALUES ('chapter','fixture',1,'Fixture',1)"),
    db.prepare("INSERT INTO coursebook_sections(id,coursebook_chapter_id,section_code,title_en,sort_order) VALUES ('book-section','chapter','1','Fixture',1)"),
    db.prepare("INSERT INTO question_section_mappings(question_id,curriculum_section_id,coursebook_section_id) VALUES ('mcq','syllabus-section','book-section')"),
    db.prepare("INSERT INTO question_attempts(id,user_id,question_id,curriculum_section_id,coursebook_section_id,mode,selected_index,correct,first_exposure) VALUES ('attempt','admin','mcq','syllabus-section','book-section','chapter',0,1,1)"),
  ]);
  await migrate("0019_9618_structured_content.sql");
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM question_hint_sets").first()).n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM saved_paper_items").first()).n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM question_section_mappings").first()).n, 1);
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM question_attempts").first()).n, 1);
  for (const table of ["question_hint_sets", "saved_paper_items", "question_section_mappings", "question_attempts"]) {
    const fks = await db.prepare(`PRAGMA foreign_key_list(${table})`).all();
    assert(fks.results.some((item) => item.table === "question_bank"), `${table} FK preserved`);
  }
  assert.deepEqual((await db.prepare("PRAGMA foreign_key_check").all()).results, []);
  const env = { DB: db, CONTENT_BUCKET: bucket, AUTH_SECRET };
  const call = async (handler, path, options = {}) => {
    const response = await handler(new Request(`https://expassway.test${path}`, options), env);
    return { response, payload: await response.clone().json().catch(() => null) };
  };
  const bearer = await token("admin");
  const headers = { Authorization: `Bearer ${bearer}` };
  assert.equal((await call(handleReadApiRequest, "/api/catalog/subjects/9618/overview")).response.status, 401);
  const lockedResource = await worker.fetch(new Request("https://expassway.test/api/content/resources/syllabus"), env);
  assert.equal(lockedResource.status, 401);
  assert.equal(lockedResource.headers.get("Cache-Control"), "private, no-store");
  const empty = await call(handleReadApiRequest, "/api/catalog/subjects/9618/overview", { headers });
  assert.equal(empty.response.status, 200);
  assert.equal(empty.payload.data.components.length, 4);
  assert.equal(empty.payload.data.counts.questions, 0);
  assert.equal(empty.payload.data.readiness.syllabus, false);
  const subjectList = await call(handleReadApiRequest, "/api/catalog/subjects");
  assert(subjectList.payload.data.some((subject) => subject.code === "9618" && subject.paperCount === 0));
  const capabilities = subjectList.payload.data.find((subject) => subject.code === "9618").capabilities;
  assert.equal(capabilities.papers, true);
  assert.equal(capabilities.manualPaperBuilder, true);
  assert.equal(capabilities.smartPaperBuilder, false);
  assert.equal(capabilities.onlinePractice, true);
  assert.equal(capabilities.structuredAiGrading, true);

  const slug = "9618_s26_qp_31";
  const assetBase = `/api/content/question-images/cie-as-a-level-computer-science-9618/${slug}`;
  const qpUrl = `${assetBase}/q01-01.png`;
  const msUrl = `${assetBase}/q01-ms-01.png`;
  const directory = [{ id: "chapter", code: "1", title: "Fixture chapter", children: [{ id: "section", code: "1.1", title: "Fixture section" }] }];
  await db.batch([
    db.prepare(`INSERT INTO exam_papers(slug,subject_code,year,season,paper_number,variant,paper_type,source_question_count,valid_question_count,total_marks,qp_file_name,ms_file_name)
      VALUES (?, '9618',2026,'s',3,1,'structured',1,1,12,'fixture-qp.pdf','fixture-ms.pdf')`).bind(slug),
    db.prepare(`INSERT INTO question_bank(id,board,subject,paper,stem,subject_code,paper_slug,question_no,question_type,max_marks,images,structured_content,mark_scheme)
      VALUES ('structured','CIE','AS & A Level Computer Science','Structured','Fixture structured prompt','9618',?,1,'structured',12,?,?,?)`)
      .bind(slug, JSON.stringify([{ url: qpUrl, order: 1 }]), JSON.stringify({ images: [{ url: qpUrl, order: 1 }], parts: [{ id: "a", maxMarks: 12, prompt: [] }] }), JSON.stringify({ images: [{ url: msUrl, order: 1 }], parts: [] })),
    db.prepare(`INSERT INTO subject_resources(id,subject_code,kind,title,storage_key,content_type,metadata) VALUES ('syllabus','9618','syllabus','Fixture syllabus','resources/syllabus.pdf','application/pdf',?)`).bind(JSON.stringify({ directory })),
    db.prepare(`INSERT INTO subject_resources(id,subject_code,kind,title,storage_key,metadata) VALUES ('textbook','9618','textbook','Fixture book','resources/book.pdf',?)`).bind(JSON.stringify({ directory, chapterMappings: [{ textbookSectionId: "section", syllabusSectionId: "section" }] })),
  ]);
  const full = (await call(handleReadApiRequest, "/api/catalog/subjects/9618/overview", { headers })).payload.data;
  assert.deepEqual(full.counts, { syllabus: 1, textbooks: 1, papers: 1, questions: 1, components: 4, resources: 2 });
  assert.equal(full.syllabus[0].children[0].id, "section");
  assert.equal(full.textbooks[0].chapters[0].id, "chapter");
  assert.equal(full.papers[0].totalMarks, 12);
  assert.equal(full.questions[0].answer, null);
  assert.equal(full.questions[0].questionType, "structured");
  assert.equal(full.questions[0].maxMarks, 12);
  assert.equal(full.questions[0].content.parts[0].id, "a");
  assert.equal(full.questions[0].markScheme.images[0].url, msUrl);
  assert.equal(full.readiness.manualPaperBuilder, true);
  const curriculum = (await call(handleReadApiRequest, "/api/meta/curriculum")).payload.data;
  assert.deepEqual(curriculum.boards.CIE["AS & A Level Computer Science"], ["Structured", "Practical"]);
  await db.prepare("UPDATE subject_resources SET metadata = '{}' WHERE id = 'syllabus'").run();
  const pdfOnly = (await call(handleReadApiRequest, "/api/catalog/subjects/9618/overview", { headers })).payload.data;
  assert.equal(pdfOnly.counts.syllabus, 1);
  assert.equal(pdfOnly.readiness.syllabus, true);
  assert.equal(pdfOnly.syllabus.length, 0);
  assert.equal(pdfOnly.syllabusResources[0].downloadUrl, "/api/content/resources/syllabus");
  await db.prepare(`INSERT INTO exam_papers(slug,subject_code,year,season,paper_number,variant,paper_type,source_question_count,valid_question_count,total_marks,qp_file_name,ms_file_name,metadata)
    VALUES ('9618_s26_qp_41','9618',2026,'s',4,1,'practical',3,0,75,'fixture-p4-qp.pdf','fixture-p4-ms.pdf',?)`)
    .bind(JSON.stringify({ qpStorageKey: "custom/p4-qp.pdf", msStorageKey: "custom/p4-ms.pdf" })).run();
  await bucket.put("custom/p4-qp.pdf", "fixture-paper4-qp");
  await bucket.put("custom/p4-ms.pdf", "fixture-paper4-ms");
  const sourceOnlyPaper = (await call(handleReadApiRequest, "/api/catalog/papers/9618_s26_qp_41")).payload.data;
  assert.equal(sourceOnlyPaper.validQuestionCount, 0);
  assert.equal(sourceOnlyPaper.totalMarks, 75);
  assert.deepEqual((await call(handleReadApiRequest, "/api/catalog/papers/9618_s26_qp_41/questions")).payload.data, []);
  assert.equal(await (await call(handleContentRequest, "/api/catalog/papers/9618_s26_qp_41/download/qp")).response.text(), "fixture-paper4-qp");
  assert.equal(await (await call(handleContentRequest, "/api/catalog/papers/9618_s26_qp_41/download/ms")).response.text(), "fixture-paper4-ms");
  await bucket.put("resources/syllabus.pdf", "fixture-pdf");
  assert.equal((await call(handleContentRequest, "/api/content/resources/syllabus")).response.status, 401);
  assert.equal((await call(handleContentRequest, "/api/content/resources/syllabus", { headers })).response.status, 200);
  assert.equal((await call(handleContentRequest, "/api/content/resources/syllabus", { method: "HEAD", headers })).response.status, 200);
  for (const url of [qpUrl, msUrl]) {
    await bucket.put(url.replace("/api/content/", ""), "fixture-image");
    assert.equal((await call(handleContentRequest, url)).response.status, 200);
  }
  await bucket.put(`${assetBase}/q01-02.png`.replace("/api/content/", ""), "unregistered-image");
  assert.equal((await call(handleContentRequest, `${assetBase}/q01-02.png`)).response.status, 404);
  const hints = await call(handleQuestionHintRequest, "/api/question-hints/structured", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ language: "en" }) });
  assert.equal(hints.payload.error.code, "UNSUPPORTED_QUESTION_TYPE");
  const importAttempt = await call(handleAdminApiRequest, "/api/admin/imports", { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ subjectCode: "9618" }) });
  assert.equal(importAttempt.payload.error.code, "UNSUPPORTED_IMPORT_TYPE");
  await db.prepare("UPDATE exam_subjects SET active = 0 WHERE code = '9618'").run();
  assert.equal((await call(handleContentRequest, "/api/content/resources/syllabus", { headers })).response.status, 404);
  console.log("9618 migration, directory/readiness, structured contract, resource authorization, and asset registration checks passed.");
} finally {
  await mf.dispose();
}
